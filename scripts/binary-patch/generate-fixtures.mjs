#!/usr/bin/env node
/**
 * Regenerates the binary patch fixtures used by `cli/utils/binaryPatch.test.ts`.
 *
 * The fixtures are committed so the tests can verify the patch format against
 * bytes that were produced once and never change. This script exists so that
 * regenerating them stays reproducible: the bundle contents come from a seeded
 * PRNG rather than from `Math.random`, so running it again yields byte identical
 * `base.bundle` and `target.bundle`.
 *
 * The bundles are platform neutral bytes. They imitate the shape of a bytecode
 * bundle - repeated blocks with scattered edits and a chunk appended at the end -
 * because that is the shape the patch format has to compress well, but nothing in
 * the codec contract depends on them being real bytecode.
 *
 * Usage:
 *   node scripts/binary-patch/generate-fixtures.mjs
 *
 * Requires hdiffz, which `scripts/binary-patch/build-hdiffpatch.sh` installs.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const fixtureDir = path.join(repoRoot, 'cli', 'fixtures', 'binary-patch');

/** Any 32 bit value works; it is fixed only so the output never changes. */
const SEED = 0x5eed1234;
const BLOCK_SIZE = 256;
/** Number of distinct blocks the base bundle is assembled from. */
const BLOCK_VARIANTS = 32;
const BASE_SIZE = 64 * 1024;
const APPENDED_SIZE = 8 * 1024;
const EDIT_COUNT = 24;
const EDIT_SIZE = 16;
/**
 * Bytes that only exist in the target end up in the patch's zstd streams. Drawing
 * them from a small alphabet keeps them entropy compressible, so the patch really
 * contains Huffman coded zstd blocks; uniformly random bytes would be stored raw
 * and the decompressor in the appliers would never be exercised.
 */
const NEW_DATA_ALPHABET = Buffer.from([
    0x00, 0x01, 0x02, 0x03, 0x08, 0x10, 0x11, 0x20, 0x41, 0x42, 0x43, 0x61, 0x62, 0x7f, 0xc0, 0xff,
]);

/** xorshift32: tiny, dependency free and deterministic across Node versions. */
function createRandom(seed) {
    let state = seed >>> 0;
    return function nextUint32() {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state;
    };
}

function randomBytes(nextUint32, size) {
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
        bytes[i] = nextUint32() & 0xff;
    }
    return bytes;
}

function randomNewDataBytes(nextUint32, size) {
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
        bytes[i] = NEW_DATA_ALPHABET[nextUint32() % NEW_DATA_ALPHABET.length];
    }
    return bytes;
}

/**
 * Builds the base bundle by repeating a small set of pseudo random blocks, which
 * gives the diff algorithm long matches to find, like real bytecode does.
 */
function buildBaseBundle(nextUint32) {
    const variants = [];
    for (let i = 0; i < BLOCK_VARIANTS; i++) {
        variants.push(randomBytes(nextUint32, BLOCK_SIZE));
    }

    const base = Buffer.alloc(BASE_SIZE);
    for (let offset = 0; offset < BASE_SIZE; offset += BLOCK_SIZE) {
        const variant = variants[nextUint32() % BLOCK_VARIANTS];
        variant.copy(base, offset, 0, Math.min(BLOCK_SIZE, BASE_SIZE - offset));
    }
    return base;
}

/**
 * Builds the target bundle as the base with edits scattered evenly through it plus
 * a chunk appended at the end. Both kinds of change matter: scattered edits force
 * the patch to carry many small diffs, and the appended chunk makes the target
 * larger than the base.
 */
function buildTargetBundle(nextUint32, base) {
    const target = Buffer.concat([base, Buffer.alloc(APPENDED_SIZE)]);

    for (let i = 0; i < EDIT_COUNT; i++) {
        const offset = Math.floor((BASE_SIZE * (2 * i + 1)) / (2 * EDIT_COUNT));
        randomNewDataBytes(nextUint32, EDIT_SIZE).copy(target, offset);
    }

    // Half fresh bytes, half a slice of the base, so the appended chunk exercises
    // both "new data" and "copy from old" instructions.
    const appendOffset = BASE_SIZE;
    const freshSize = APPENDED_SIZE / 2;
    randomNewDataBytes(nextUint32, freshSize).copy(target, appendOffset);
    base.copy(target, appendOffset + freshSize, 0, APPENDED_SIZE - freshSize);

    return target;
}

function resolveHdiffz() {
    // Kept in sync with the lookup order in cli/utils/binaryPatch.ts.
    const toolsDir = process.env.HDIFFPATCH_TOOLS_DIR || path.join(repoRoot, '.hdiffpatch-tools');
    const hdiffz = path.join(toolsDir, 'hdiffz');
    if (!fs.existsSync(hdiffz)) {
        throw new Error(
            `hdiffz not found at ${hdiffz}. Run scripts/binary-patch/build-hdiffpatch.sh first, ` +
                `or set HDIFFPATCH_TOOLS_DIR to a directory that contains hdiffz.`,
        );
    }
    return hdiffz;
}

function sha256(filePath) {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function main() {
    const hdiffz = resolveHdiffz();
    const nextUint32 = createRandom(SEED);

    const base = buildBaseBundle(nextUint32);
    const target = buildTargetBundle(nextUint32, base);

    fs.mkdirSync(fixtureDir, { recursive: true });
    const basePath = path.join(fixtureDir, 'base.bundle');
    const targetPath = path.join(fixtureDir, 'target.bundle');
    const patchPath = path.join(fixtureDir, 'update.patch');
    fs.writeFileSync(basePath, base);
    fs.writeFileSync(targetPath, target);

    // Must stay identical to the options the CLI release flow uses; a patch made
    // with different options would not exercise the format the appliers support.
    execFileSync(hdiffz, ['-f', '-m-6', '-c-zstd-21-24', basePath, targetPath, patchPath], {
        stdio: 'inherit',
    });

    for (const filePath of [basePath, targetPath, patchPath]) {
        console.log(`${sha256(filePath)}  ${fs.statSync(filePath).size} bytes  ${path.relative(repoRoot, filePath)}`);
    }
}

main();
