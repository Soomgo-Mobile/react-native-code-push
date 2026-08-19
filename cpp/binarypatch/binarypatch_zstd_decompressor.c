#include "binarypatch_zstd_decompressor.h"

#include <stdlib.h>
#include <string.h>

#include "zstd.h"

/*
 * Largest window a decompression session will accept, pinned to the window that the
 * `-c-zstd-21-24` generation options use: no patch this project produces declares a
 * window above 2^24. Keeping the bound at the generation limit means a corrupted
 * frame header that asks for a wider window is rejected before anything is
 * allocated, instead of being answered with an allocation that large - and applying
 * a patch keeps several decompression sessions open at once, so the bound applies
 * several times over. Changing the generation options is a patch format version
 * change, and this bound moves with them.
 */
#define BINARYPATCH_ZSTD_WINDOW_LOG_MAX 24

/*
 * One decompression session. The input and output buffers are allocated in the
 * same block as the struct (`buffers` is their start) to keep the number of
 * allocations per patch session down.
 */
typedef struct {
    const hpatch_TStreamInput* codeStream;
    hpatch_StreamPos_t         codeReadPos;
    hpatch_StreamPos_t         codeEnd;

    ZSTD_DStream*              dstream;
    ZSTD_inBuffer              in;
    size_t                     inCapacity;
    ZSTD_outBuffer             out;
    size_t                     outReadPos; /* bytes of `out` already handed to the caller */

    hpatch_dec_error_t         decError;
    unsigned char              buffers[1]; /* [inCapacity bytes][out.size bytes] */
} binarypatch_zstd_session;

static hpatch_BOOL _zstd_fail(binarypatch_zstd_session* self) {
    if (self->decError == hpatch_dec_ok) {
        self->decError = hpatch_dec_error;
    }
    return hpatch_FALSE;
}

static hpatch_BOOL _zstd_is_can_open(const char* compressType) {
    return (0 == strcmp(compressType, BINARYPATCH_ZSTD_COMPRESS_TYPE)) ? hpatch_TRUE : hpatch_FALSE;
}

static hpatch_decompressHandle _zstd_open(struct hpatch_TDecompress* decompressPlugin,
                                          hpatch_StreamPos_t dataSize,
                                          const struct hpatch_TStreamInput* codeStream,
                                          hpatch_StreamPos_t code_begin,
                                          hpatch_StreamPos_t code_end) {
    const size_t inCapacity = ZSTD_DStreamInSize();
    const size_t outCapacity = ZSTD_DStreamOutSize();
    binarypatch_zstd_session* self;

    /* The uncompressed size is tracked by the caller's patch stream, not here. */
    (void)dataSize;

    self = (binarypatch_zstd_session*)malloc(sizeof(binarypatch_zstd_session) + inCapacity + outCapacity);
    if (!self) {
        _hpatch_update_decError(decompressPlugin, hpatch_dec_mem_error);
        return 0;
    }
    memset(self, 0, sizeof(binarypatch_zstd_session));
    self->codeStream = codeStream;
    self->codeReadPos = code_begin;
    self->codeEnd = code_end;
    self->in.src = self->buffers;
    self->in.size = 0;
    self->in.pos = 0; /* pos == size: the input buffer starts empty and is refilled on demand */
    self->inCapacity = inCapacity;
    self->out.dst = self->buffers + inCapacity;
    self->out.size = outCapacity;
    self->out.pos = 0;
    self->outReadPos = 0;

    self->dstream = ZSTD_createDStream();
    if (!self->dstream) {
        free(self);
        _hpatch_update_decError(decompressPlugin, hpatch_dec_open_error);
        return 0;
    }
    /*
     * The window bound is applied here rather than left at zstd's default, and a
     * session that cannot take it is refused: without the bound a corrupted frame
     * header could ask for a much larger window than any patch legitimately needs.
     */
    if (ZSTD_isError(ZSTD_initDStream(self->dstream)) ||
        ZSTD_isError(ZSTD_DCtx_setParameter(self->dstream, ZSTD_d_windowLogMax,
                                            BINARYPATCH_ZSTD_WINDOW_LOG_MAX))) {
        ZSTD_freeDStream(self->dstream);
        free(self);
        _hpatch_update_decError(decompressPlugin, hpatch_dec_open_error);
        return 0;
    }
    return self;
}

static hpatch_BOOL _zstd_close(struct hpatch_TDecompress* decompressPlugin,
                               hpatch_decompressHandle decompressHandle) {
    binarypatch_zstd_session* self = (binarypatch_zstd_session*)decompressHandle;
    hpatch_BOOL result = hpatch_TRUE;
    if (!self) {
        return hpatch_TRUE;
    }
    /* Report the session's failure through the plugin so the caller can read it. */
    if (self->decError != hpatch_dec_ok) {
        _hpatch_update_decError(decompressPlugin, self->decError);
    }
    if (0 != ZSTD_freeDStream(self->dstream)) {
        result = hpatch_FALSE;
        _hpatch_update_decError(decompressPlugin, hpatch_dec_close_error);
    }
    free(self);
    return result;
}

/*
 * Must fill the whole `[out_part_data, out_part_data_end)` range; anything less is
 * an error by the `hpatch_TDecompress` contract.
 */
static hpatch_BOOL _zstd_decompress_part(hpatch_decompressHandle decompressHandle,
                                         unsigned char* out_part_data,
                                         unsigned char* out_part_data_end) {
    binarypatch_zstd_session* self = (binarypatch_zstd_session*)decompressHandle;

    while (out_part_data < out_part_data_end) {
        size_t ready = self->out.pos - self->outReadPos;
        size_t ret;

        if (ready > 0) {
            const size_t wanted = (size_t)(out_part_data_end - out_part_data);
            if (ready > wanted) {
                ready = wanted;
            }
            memcpy(out_part_data, (const unsigned char*)self->out.dst + self->outReadPos, ready);
            out_part_data += ready;
            self->outReadPos += ready;
            continue;
        }

        if (self->in.pos == self->in.size) {
            const hpatch_StreamPos_t remaining = self->codeEnd - self->codeReadPos;
            unsigned char* inBuf = (unsigned char*)self->in.src;
            size_t toRead = self->inCapacity;
            if (remaining < (hpatch_StreamPos_t)toRead) {
                toRead = (size_t)remaining;
            }
            self->in.pos = 0;
            self->in.size = toRead;
            if (toRead > 0) {
                if (!self->codeStream->read(self->codeStream, self->codeReadPos, inBuf, inBuf + toRead)) {
                    return _zstd_fail(self);
                }
                self->codeReadPos += toRead;
            }
        }

        self->out.pos = 0;
        self->outReadPos = 0;
        ret = ZSTD_decompressStream(self->dstream, &self->out, &self->in);
        if (ZSTD_isError(ret)) {
            return _zstd_fail(self);
        }
        /*
         * No progress with no input left means the compressed stream ended before
         * the patch asked for its last byte - a truncated or corrupt patch.
         */
        if (self->out.pos == 0) {
            return _zstd_fail(self);
        }
    }
    return hpatch_TRUE;
}

void binarypatch_zstd_decompressor_init(hpatch_TDecompress* out_decompressor) {
    memset(out_decompressor, 0, sizeof(hpatch_TDecompress));
    out_decompressor->is_can_open = _zstd_is_can_open;
    out_decompressor->open = _zstd_open;
    out_decompressor->close = _zstd_close;
    out_decompressor->decompress_part = _zstd_decompress_part;
    /* reset_code stays NULL: it is only needed for vcdiff style patches. */
}
