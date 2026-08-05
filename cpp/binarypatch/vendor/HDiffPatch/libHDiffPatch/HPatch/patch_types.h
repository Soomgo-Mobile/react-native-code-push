//  patch_types.h
//
/*
 The MIT License (MIT)
 Copyright (c) 2012-2018 HouSisong
 
 Permission is hereby granted, free of charge, to any person
 obtaining a copy of this software and associated documentation
 files (the "Software"), to deal in the Software without
 restriction, including without limitation the rights to use,
 copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the
 Software is furnished to do so, subject to the following
 conditions:
 
 The above copyright notice and this permission notice shall be
 included in all copies of the Software.
 
 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 OTHER DEALINGS IN THE SOFTWARE.
 */

#ifndef HPatch_patch_types_h
#define HPatch_patch_types_h

#include <string.h> //for size_t memset memcpy memmove
#include <assert.h>

#ifdef __cplusplus
extern "C" {
#endif

#define HDIFFPATCH_VERSION_MAJOR    5
#define HDIFFPATCH_VERSION_MINOR    1
#define HDIFFPATCH_VERSION_RELEASE  3

#define _HDIFFPATCH_VERSION          HDIFFPATCH_VERSION_MAJOR.HDIFFPATCH_VERSION_MINOR.HDIFFPATCH_VERSION_RELEASE
#define _HDIFFPATCH_QUOTE(str) #str
#define _HDIFFPATCH_EXPAND_AND_QUOTE(str) _HDIFFPATCH_QUOTE(str)
#define HDIFFPATCH_VERSION_STRING   _HDIFFPATCH_EXPAND_AND_QUOTE(_HDIFFPATCH_VERSION)
#define HDIFFPATCH_VERSION_NUMBER   ((HDIFFPATCH_VERSION_MAJOR*1000+HDIFFPATCH_VERSION_MINOR)*1000+HDIFFPATCH_VERSION_RELEASE)

#ifndef _IS_USED_MULTITHREAD
#   define _IS_USED_MULTITHREAD 1
#endif
#ifndef _HPATCH_IS_USED_MULTITHREAD
#   define _HPATCH_IS_USED_MULTITHREAD   _IS_USED_MULTITHREAD
#endif

#ifndef hpatch_int
    typedef int                 hpatch_int;
#endif
#ifndef hpatch_uint
    typedef unsigned int        hpatch_uint;
#endif
#ifndef hpatch_size_t
    typedef size_t              hpatch_size_t;
#endif
#ifndef hpatch_uint32_t
#ifdef _MSC_VER
#   if (_MSC_VER >= 1300)
    typedef unsigned __int32    hpatch_uint32_t;
#   else
    typedef unsigned int        hpatch_uint32_t;
#   endif
#else
    typedef unsigned int        hpatch_uint32_t;
#endif
#endif
#ifndef hpatch_uint64_t
#ifdef _MSC_VER
    typedef unsigned __int64    hpatch_uint64_t;
#else
    typedef unsigned long long  hpatch_uint64_t;
#endif
#endif
#ifndef hpatch_int64_t
#ifdef _MSC_VER
    typedef __int64             hpatch_int64_t;
#else
    typedef long long           hpatch_int64_t;
#endif
#endif
#ifndef hpatch_StreamPos_t
    typedef hpatch_uint64_t     hpatch_StreamPos_t; // file size type
#endif
#define hpatch_kNullStreamPos   (~(hpatch_StreamPos_t)0)

#ifndef hpatch_BOOL
    typedef unsigned int        hpatch_BOOL;
#endif
#define     hpatch_FALSE    0
#define     hpatch_TRUE     ((hpatch_BOOL)(!hpatch_FALSE))
    
#ifndef hpatch_byte
    typedef unsigned char       hpatch_byte;
#endif

#if (_HPATCH_IS_USED_errno)
typedef    unsigned int hpatch_FileError_t;// 0: no error; other: saved errno value;
#else
typedef    hpatch_BOOL  hpatch_FileError_t;// 0: no error; other: error;
#endif

#ifdef _MSC_VER
#   define hpatch_inline _inline
#else
#   define hpatch_inline inline
#endif

#ifndef hpatch_force_inline
#if defined(_MSC_VER)
#   define hpatch_force_inline __forceinline
#elif defined(__GNUC__) || defined(__clang__) || defined(__CC_ARM)
#   define hpatch_force_inline __attribute__((always_inline)) inline
#elif defined(__ICCARM__)
#   define hpatch_force_inline _Pragma("inline=forced")
#else
#   define hpatch_force_inline hpatch_inline
#endif
#endif

//PRIu64 for printf type hpatch_StreamPos_t
#ifndef PRIu64
#   ifdef _MSC_VER
#       define PRIu64 "I64u"
#   else
#       define PRIu64 "llu"
#   endif
#endif

#ifdef ANDROID
#   include <android/log.h>
#   define LOG_ERR(...) __android_log_print(ANDROID_LOG_ERROR, "hpatch", __VA_ARGS__)
#else
#   include <stdio.h>  //for stderr
#   define LOG_ERR(...) fprintf(stderr,__VA_ARGS__)
#endif
#ifndef _HPATCH_IS_USED_errno
#   define  _HPATCH_IS_USED_errno 1
#endif
#define _hpatch_import_system_tag "call import system api"
#if (_HPATCH_IS_USED_errno)
#   define  LOG_ERRNO(_err_no) \
        LOG_ERR(_hpatch_import_system_tag" error! errno: %d, errmsg: %s.\n",_err_no,strerror(_err_no))
#else
#   define  LOG_ERRNO(_err_no) LOG_ERR(_hpatch_import_system_tag" error!\n")
#endif
    
#define _hpatch_align_type_lower(uint_type,p,align2pow) (((uint_type)(p)) & (~(uint_type)((align2pow)-1)))
#define _hpatch_align_lower(p,align2pow) _hpatch_align_type_lower(hpatch_size_t,p,align2pow)
#define _hpatch_align_upper(p,align2pow) _hpatch_align_lower(((hpatch_size_t)(p))+((align2pow)-1),align2pow)
    
static hpatch_force_inline hpatch_StreamPos_t _hpatch_pos_min(hpatch_StreamPos_t a,hpatch_StreamPos_t b){ return (a<b)?a:b; }
static hpatch_force_inline hpatch_StreamPos_t _hpatch_pos_max(hpatch_StreamPos_t a,hpatch_StreamPos_t b){ return (a>b)?a:b; }


    typedef void* hpatch_TStreamInputHandle;
    typedef void* hpatch_TStreamOutputHandle;
    
    typedef struct hpatch_TStreamInput{
        void*            streamImport;
        hpatch_StreamPos_t streamSize; //stream size,max readable range;
        //read() must read (out_data_end-out_data), otherwise error return hpatch_FALSE
        hpatch_BOOL            (*read)(const struct hpatch_TStreamInput* stream,hpatch_StreamPos_t readFromPos,
                                       unsigned char* out_data,unsigned char* out_data_end);
        void*        _private_reserved;
    } hpatch_TStreamInput;
    
    typedef struct hpatch_TStreamOutput{
        void*            streamImport;
        hpatch_StreamPos_t streamSize; //stream size,max writable range; not is write pos!
        //read_writed for ReadWriteIO, can null!
        hpatch_BOOL     (*read_writed)(const struct hpatch_TStreamOutput* stream,hpatch_StreamPos_t readFromPos,
                                       unsigned char* out_data,unsigned char* out_data_end);
        //write() must wrote (out_data_end-out_data), otherwise error return hpatch_FALSE
        hpatch_BOOL           (*write)(const struct hpatch_TStreamOutput* stream,hpatch_StreamPos_t writeToPos,
                                       const unsigned char* data,const unsigned char* data_end);
    } hpatch_TStreamOutput;
    
    //default once I/O (read/write) byte size
    #ifndef hpatch_kStreamCacheSize
    #   define hpatch_kStreamCacheSize      4096
    #endif
    #ifndef hpatch_kFileIOBufBetterSize
    #   define hpatch_kFileIOBufBetterSize  (1024*64)
    #endif
    
    #ifndef hpatch_kMaxPluginTypeLength
    #   define hpatch_kMaxPluginTypeLength   (256+8-1)
    #endif

    #ifndef hpatch_kWindowDiffHeadMaxSize
    #   define hpatch_kWindowDiffHeadMaxSize   hpatch_kStreamCacheSize
    #endif

    #ifndef hpatch_kMaxWindowMetaCount
    #   define hpatch_kMaxWindowMetaCount    64     //must 2^N
    #endif

    typedef struct hpatch_compressedDiffInfo{
        hpatch_StreamPos_t  newDataSize;
        hpatch_StreamPos_t  oldDataSize;
        hpatch_uint         compressedCount;//number of decompress handles that must be opened simultaneously
        char                compressType[hpatch_kMaxPluginTypeLength+1]; //ascii cstring 
    } hpatch_compressedDiffInfo;
    
    typedef void*  hpatch_decompressHandle;
    typedef enum{
        hpatch_dec_ok=0,
        hpatch_dec_mem_error,
        hpatch_dec_open_error,
        hpatch_dec_error,
        hpatch_dec_close_error,
    } hpatch_dec_error_t;
    typedef struct hpatch_TDecompress{
        hpatch_BOOL        (*is_can_open)(const char* compressType);
        //error return 0.
        hpatch_decompressHandle   (*open)(struct hpatch_TDecompress* decompressPlugin,
                                          hpatch_StreamPos_t dataSize,
                                          const struct hpatch_TStreamInput* codeStream,
                                          hpatch_StreamPos_t code_begin,
                                          hpatch_StreamPos_t code_end);//codeSize==code_end-code_begin
        hpatch_BOOL              (*close)(struct hpatch_TDecompress* decompressPlugin,
                                          hpatch_decompressHandle decompressHandle);
        //decompress_part() must out (out_part_data_end-out_part_data), otherwise error return hpatch_FALSE
        hpatch_BOOL    (*decompress_part)(hpatch_decompressHandle decompressHandle,
                                          unsigned char* out_part_data,unsigned char* out_part_data_end);
        //reset_code add new compressed data; for support vcpatch, can NULL
        hpatch_BOOL         (*reset_code)(hpatch_decompressHandle decompressHandle,
                                          hpatch_StreamPos_t dataSize,
                                          const struct hpatch_TStreamInput* codeStream,
                                          hpatch_StreamPos_t code_begin,
                                          hpatch_StreamPos_t code_end);
        volatile hpatch_dec_error_t decError; //if decError is read, each patch session must use its own hpatch_TDecompress instance
        size_t                      dec_threadNum; //for multi-thread decompress, <=1 means single thread (default)
    } hpatch_TDecompress;
    #define _hpatch_update_decError(decompressPlugin,errorCode) \
        do { if ((decompressPlugin)->decError==hpatch_dec_ok)   \
                (decompressPlugin)->decError=errorCode;     } while(0)
    
    
    const hpatch_TStreamInput* mem_as_hStreamInput(hpatch_TStreamInput* out_stream,
                                                   const unsigned char* mem,const unsigned char* mem_end);
    const hpatch_TStreamOutput* mem_as_hStreamOutput(hpatch_TStreamOutput* out_stream,
                                                     unsigned char* mem,unsigned char* mem_end);
    
    hpatch_BOOL hpatch_deccompress_mem(hpatch_TDecompress* decompressPlugin,
                                       const unsigned char* code,const unsigned char* code_end,
                                       unsigned char* out_data,unsigned char* out_data_end);
    
    typedef struct{
        hpatch_TStreamInput         base;
        const hpatch_TStreamInput*  srcStream;
        hpatch_StreamPos_t          clipBeginPos;
    } TStreamInputClip;
    //clip srcStream from clipBeginPos to clipEndPos as a new StreamInput;
    void TStreamInputClip_init(TStreamInputClip* self,const hpatch_TStreamInput*  srcStream,
                               hpatch_StreamPos_t clipBeginPos,hpatch_StreamPos_t clipEndPos);
    typedef struct{
        hpatch_TStreamOutput        base;
        const hpatch_TStreamOutput* srcStream;
        hpatch_StreamPos_t          clipBeginPos;
    } TStreamOutputClip;
    //clip srcStream from clipBeginPos to clipEndPos as a new StreamInput;
    void TStreamOutputClip_init(TStreamOutputClip* self,const hpatch_TStreamOutput*  srcStream,
                                hpatch_StreamPos_t clipBeginPos,hpatch_StreamPos_t clipEndPos);

    
    #define  hpatch_kMaxPackedUIntBytes ((sizeof(hpatch_StreamPos_t)*8+6)/7+1)
    hpatch_BOOL hpatch_packUIntWithTag(unsigned char** out_code,unsigned char* out_code_end,
                                       hpatch_StreamPos_t uValue,hpatch_uint highTag,const hpatch_uint kTagBit);
    hpatch_uint hpatch_packUIntWithTag_size(hpatch_StreamPos_t uValue,const hpatch_uint kTagBit);
    #define hpatch_packUInt(out_code,out_code_end,uValue) \
                hpatch_packUIntWithTag(out_code,out_code_end,uValue,0,0)
    #define hpatch_packUInt_size(uValue) hpatch_packUIntWithTag_size(uValue,0)
    
    hpatch_BOOL hpatch_unpackUIntWithTag(const unsigned char** src_code,const unsigned char* src_code_end,
                                         hpatch_StreamPos_t* result,const hpatch_uint kTagBit);
    #define hpatch_unpackUInt(src_code,src_code_end,result) \
                hpatch_unpackUIntWithTag(src_code,src_code_end,result,0)

    
    typedef struct hpatch_TCover{
        hpatch_StreamPos_t oldPos;
        hpatch_StreamPos_t newPos;
        hpatch_StreamPos_t length;
    } hpatch_TCover;

    //opened input covers
    typedef struct hpatch_TCovers{
        hpatch_StreamPos_t (*leave_cover_count)(const struct hpatch_TCovers* covers);
        //read out a cover,and to next cover pos; if error then return false
        hpatch_BOOL               (*read_cover)(struct hpatch_TCovers* covers,hpatch_TCover* out_cover);
        hpatch_BOOL                (*is_finish)(const struct hpatch_TCovers* covers);
        hpatch_BOOL                    (*close)(struct hpatch_TCovers* covers);
    } hpatch_TCovers;
    
    typedef struct{
        hpatch_StreamPos_t  newDataSize;
        hpatch_StreamPos_t  oldDataSize;
        hpatch_StreamPos_t  uncompressedSize;
        hpatch_StreamPos_t  compressedSize;
        hpatch_StreamPos_t  diffDataPos;
        hpatch_StreamPos_t  coverCount;
        hpatch_StreamPos_t  stepMemSize;
        char                compressType[hpatch_kMaxPluginTypeLength+1]; //ascii cstring
    } hpatch_singleCompressedDiffInfo;

    hpatch_inline static void _singleDiffInfoToHDiffInfo(hpatch_compressedDiffInfo* out_diffInfo,const hpatch_singleCompressedDiffInfo* singleDiffInfo){
        out_diffInfo->newDataSize=singleDiffInfo->newDataSize;
        out_diffInfo->oldDataSize=singleDiffInfo->oldDataSize;
        out_diffInfo->compressedCount=(singleDiffInfo->compressedSize>0)?1:0;
        memcpy(out_diffInfo->compressType,singleDiffInfo->compressType,strlen(singleDiffInfo->compressType)+1);
    }
    
    typedef struct sspatch_listener_t{ 
        void*         import;   
        hpatch_BOOL (*onDiffInfo)(struct sspatch_listener_t* listener,
                                  const hpatch_singleCompressedDiffInfo* info,
                                  hpatch_TDecompress** out_decompressPlugin,//find decompressPlugin by info->compressType
                                  unsigned char** out_temp_cache,    //*out_temp_cacheEnd-*out_temp_cache == info->stepMemSize + (I/O cache memory)
                                  unsigned char** out_temp_cacheEnd);//  note: (I/O cache memory) >= hpatch_kStreamCacheSize*3
        void        (*onPatchFinish)(struct sspatch_listener_t* listener, //onPatchFinish can null
                                     unsigned char* temp_cache, unsigned char* temp_cacheEnd);
    } sspatch_listener_t;

    typedef struct{
        hpatch_TStreamInput     base;
        hpatch_TDecompress*     _decompressPlugin;
        hpatch_decompressHandle _decompressHandle;
    } hpatch_TUncompresser_t;

    typedef struct sspatch_coversListener_t{
        void*         import;
        void        (*onStepCoversReset)(struct sspatch_coversListener_t* listener,hpatch_StreamPos_t leaveCoverCount);//can be NULL; data in covers_cache will become invalid; if leaveCoverCount==0, the step is finished
        void        (*onStepCovers)(struct sspatch_coversListener_t* listener,
                                    const unsigned char* covers_cache,const unsigned char* covers_cacheEnd);//if covers_cache==covers_cacheEnd==0, step finish
    } sspatch_coversListener_t;
    
    typedef struct{
        const unsigned char* covers_cache;
        const unsigned char* covers_cacheEnd;
        hpatch_StreamPos_t   lastOldEnd;
        hpatch_StreamPos_t   lastNewEnd;
        hpatch_TCover        cover;
    } sspatch_covers_t;

    hpatch_inline static void sspatch_covers_init(sspatch_covers_t* self) { memset(self,0,sizeof(*self)); }
    hpatch_inline static void sspatch_covers_setCoversCache(sspatch_covers_t* self,const unsigned char* covers_cache,const unsigned char* covers_cacheEnd){
                                    self->covers_cache=covers_cache; self->covers_cacheEnd=covers_cacheEnd; }
    hpatch_inline static hpatch_BOOL sspatch_covers_isHaveNextCover(const sspatch_covers_t* self) { return (self->covers_cache!=(self)->covers_cacheEnd); }

    hpatch_BOOL sspatch_covers_nextCover(sspatch_covers_t* self);
    

    typedef struct{
        hpatch_StreamPos_t  oldPos;
        hpatch_StreamPos_t  newPos;
        hpatch_StreamPos_t  oldLength;
        hpatch_StreamPos_t  newLength;
    } hpatch_TWindow;


    typedef struct hpatch_windowDiffInfo{
        hpatch_StreamPos_t  newDataSize;
        hpatch_StreamPos_t  oldDataSize;
        hpatch_StreamPos_t  coverCount;
        hpatch_StreamPos_t  windowCount;
        hpatch_StreamPos_t  windowMetaCount;       //2^N, >=2 & <= hpatch_kMaxWindowMetaCount
        hpatch_StreamPos_t  maxStepMemSize;
        hpatch_StreamPos_t  maxSubCoverCount;
        hpatch_StreamPos_t  maxWindowOldSize;
        hpatch_StreamPos_t  checksumByteSize;      //0 no checksum
        hpatch_StreamPos_t  extraDataSize;
        hpatch_StreamPos_t  uncompressedSize;      //windowDiffStreamSize
        hpatch_StreamPos_t  compressedSize;        //0 uncompressed, >0 compressed
        hpatch_StreamPos_t  otherInfoPos;
        hpatch_StreamPos_t  otherInfoEndPos;
        hpatch_StreamPos_t  windowDataPos; //window data begin pos(compressed data begin pos);
                                           //the checksum section for old/new/diff data begin pos = windowDataPos-3*checksumByteSize;
        hpatch_StreamPos_t  _headFixedInfoPos;
        char                compressType[hpatch_kMaxPluginTypeLength+1];
        char                checksumType[hpatch_kMaxPluginTypeLength+1];
    } hpatch_windowDiffInfo;
    
    typedef enum TWindowPatchResult{
        kWindowPatch_ok=0,
        kWindowPatch_load_head_error,
        kWindowPatch_new_size_error,
        kWindowPatch_old_size_error,
        kWindowPatch_onDiffInfo_error,
        kWindowPatch_temp_mem_error,
        kWindowPatch_decompress_open_error,
        kWindowPatch_patch_error,
        kWindowPatch_checksum_plugin_error,
        kWindowPatch_checksum_open_error,
        kWindowPatch_checksum_old_error,
        kWindowPatch_checksum_new_error,
        kWindowPatch_checksum_diff_error,
    } TWindowPatchResult;

    hpatch_inline static void _winDiffInfoToHDiffInfo(hpatch_compressedDiffInfo* out_diffInfo,const hpatch_windowDiffInfo* winDiffInfo){
        out_diffInfo->newDataSize=winDiffInfo->newDataSize;
        out_diffInfo->oldDataSize=winDiffInfo->oldDataSize;
        out_diffInfo->compressedCount=(winDiffInfo->compressedSize>0)?1:0;
        memcpy(out_diffInfo->compressType,winDiffInfo->compressType,strlen(winDiffInfo->compressType)+1);
    }

    struct hpatch_TChecksum;
    typedef struct winpatch_listener_t{
        void*         import;   
        hpatch_BOOL (*onDiffInfo)(struct winpatch_listener_t* listener,
                                  const hpatch_windowDiffInfo* info,
                                  hpatch_TDecompress** out_decompressPlugin,//find decompressPlugin by info->compressType
                                  struct hpatch_TChecksum** out_checksumPlugin, //find checksumPlugin by info->checksumType
                                  hpatch_BOOL* isChecksumNew,   // *isChecksumNew default true when info->checksumByteSize>0
                                  hpatch_BOOL* isChecksumOld,hpatch_BOOL* isChecksumDiff,//*isChecksumOld & *isChecksumDiff default false
                                  unsigned char** out_temp_cache,    //*out_temp_cacheEnd-*out_temp_cache == info->maxWindowOldSize + info->stepMemSize + (I/O cache memory)
                                  unsigned char** out_temp_cacheEnd);//    note: (I/O cache memory) >= hpatch_kStreamCacheSize*3
        void        (*onPatchFinish)(struct winpatch_listener_t* listener, //onPatchFinish can null
                                     unsigned char* temp_cache, unsigned char* temp_cacheEnd);
    } winpatch_listener_t;

#ifdef __cplusplus
}
#endif
#endif
