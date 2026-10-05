// Lossless EXT_meshopt_compression: no simplification, quantization, reordering,
// texture changes, or scene-graph edits. Every encoded view is byte-verified
// using the same decoder used by the installed React Three Drei loader.
// Usage: node scripts/optimize-glb-geometry.mjs input.glb output.glb
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'three-stdlib';

export const decoder = typeof MeshoptDecoder === 'function' ? MeshoptDecoder() : MeshoptDecoder;
export function readGlb(file) {
  assert.equal(file.readUInt32LE(0), 0x46546c67, 'Expected GLB');
  assert.equal(file.readUInt32LE(4), 2);
  assert.equal(file.readUInt32LE(8), file.length);
  const size = file.readUInt32LE(12);
  assert.equal(file.readUInt32LE(16), 0x4e4f534a);
  assert.equal(file.readUInt32LE(24 + size), 0x004e4942);
  return { json: JSON.parse(file.subarray(20, 20 + size)), bin: file.subarray(28 + size) };
}
export function writeGlb(json, binary) {
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  const bin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + bin.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, padded, binHeader, bin]);
}
export async function viewBytes(model, index) {
  const view = model.json.bufferViews[index];
  const compression = view.extensions?.EXT_meshopt_compression;
  if (!compression) return model.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  await decoder.ready;
  const result = new Uint8Array(view.byteLength);
  decoder.decodeGltfBuffer(result, compression.count, compression.byteStride,
    model.bin.subarray(compression.byteOffset ?? 0, (compression.byteOffset ?? 0) + compression.byteLength),
    compression.mode, compression.filter);
  return Buffer.from(result);
}

export async function compressGlb(source) {
  await Promise.all([MeshoptEncoder.ready, decoder.ready]);
  const { json, bin } = readGlb(source);
  assert.equal(json.buffers.length, 1, 'Expected one embedded source buffer');
  assert.ok(!json.buffers[0].uri);
  assert.ok(!json.extensionsUsed?.includes('EXT_meshopt_compression'), 'Already compressed');
  const images = new Set((json.images ?? []).map(image => image.bufferView));
  const chunks = [];
  let offset = 0, compressedViews = 0;
  const append = bytes => {
    const padding = (4 - offset % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
    const start = offset;
    chunks.push(bytes); offset += bytes.length;
    return start;
  };
  const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  for (let index = 0; index < json.bufferViews.length; index++) {
    const view = json.bufferViews[index];
    const original = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    let encoded, mode = 'ATTRIBUTES', stride = 4;
    if (!images.has(index) && original.length >= 256) {
      const accessors = (json.accessors ?? []).filter(accessor => accessor.bufferView === index);
      const sizes = new Set(accessors.map(accessor => componentBytes[accessor.componentType] * components[accessor.type]));
      const indexSize = accessors.length && accessors.every(accessor => accessor.type === 'SCALAR' && [5123, 5125].includes(accessor.componentType)) && sizes.size === 1 ? [...sizes][0] : null;
      if (indexSize && !view.byteStride) { mode = 'INDICES'; stride = indexSize; }
      else stride = view.byteStride ?? (sizes.size === 1 && [...sizes][0] % 4 === 0 ? [...sizes][0] : 4);
      if (stride <= 256 && original.length % stride === 0) {
        // Version 0 is required for EXT_meshopt_compression and older decoders.
        encoded = Buffer.from(MeshoptEncoder.encodeGltfBuffer(original, original.length / stride, stride, mode, 0));
        const decoded = new Uint8Array(original.length);
        decoder.decodeGltfBuffer(decoded, original.length / stride, stride, encoded, mode, 'NONE');
        assert.deepEqual(Buffer.from(decoded), original, `Buffer ${index} changed`);
      }
    }
    if (encoded && encoded.length + 160 < original.length) {
      const start = append(encoded);
      view.buffer = 1;
      view.extensions = { ...view.extensions, EXT_meshopt_compression: {
        buffer: 0, byteOffset: start, byteLength: encoded.length, byteStride: stride,
        count: original.length / stride, mode, filter: 'NONE',
      } };
      compressedViews++;
    } else {
      view.buffer = 0;
      view.byteOffset = append(original);
    }
  }
  json.buffers[0].byteLength = offset;
  if (compressedViews) {
    json.buffers.push({ byteLength: bin.length, extensions: { EXT_meshopt_compression: { fallback: true } } });
    json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_meshopt_compression'])];
    json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_meshopt_compression'])];
  }
  return { buffer: writeGlb(json, Buffer.concat(chunks)), compressedViews };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || resolve(input) === resolve(output)) throw new Error('Provide separate input/output GLB paths.');
  const source = readFileSync(input);
  const result = await compressGlb(source);
  writeFileSync(output, result.buffer);
  console.log(`${input}: ${source.length} -> ${result.buffer.length} bytes; ${result.compressedViews} lossless compressed buffers`);
}
