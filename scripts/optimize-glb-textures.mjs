// Repack embedded PNG/JPEG GLB textures as high-quality WebP without changing
// geometry, skeletons, animation tracks, or material links. An optional maximum
// texture edge also bounds decoded/GPU memory for web delivery.
//
// Usage:
//   node scripts/optimize-glb-textures.mjs input.glb output.glb [maximumEdge]
//
// The command never edits the input. It keeps an original image untouched if
// WebP would make it larger, which makes the result safe for mixed-source GLBs.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const [inputPath, outputPath, edgeArgument] = process.argv.slice(2);
const maximumEdge = edgeArgument ? Number(edgeArgument) : null;
if (maximumEdge !== null && (!Number.isInteger(maximumEdge) || maximumEdge < 256)) {
  throw new Error('Maximum texture edge must be an integer of at least 256 pixels.');
}

if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/optimize-glb-textures.mjs input.glb output.glb');
}
if (path.resolve(inputPath) === path.resolve(outputPath)) {
  throw new Error('Use a separate output path to preserve the original model.');
}

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function align4(buffer, fill = 0) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, fill)]) : buffer;
}

function readGlb(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${inputPath} is not a GLB file.`);
  let offset = 12;
  let json;
  let binary;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(chunk.toString('utf8').trim());
    if (type === BIN_CHUNK) binary = chunk;
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error(`${inputPath} is missing its JSON or binary GLB chunk.`);
  return { json, binary };
}

function writeGlb(json, binary) {
  const jsonChunk = align4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binaryChunk = align4(binary);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(JSON_CHUNK, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryChunk.length, 0);
  binaryHeader.writeUInt32LE(BIN_CHUNK, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binaryChunk]);
}

const source = await readFile(inputPath);
const { json, binary } = readGlb(source);
const imagesByView = new Map();
console.log(`Optimizing ${path.basename(inputPath)} (${(source.length / 1024 / 1024).toFixed(2)} MB)…`);

for (const image of json.images ?? []) {
  if (image.bufferView === undefined) continue;
  imagesByView.set(image.bufferView, image);
}

const rebuiltViews = [];
let oldImageBytes = 0;
let newImageBytes = 0;
let converted = 0;

for (let index = 0; index < (json.bufferViews ?? []).length; index += 1) {
  const view = json.bufferViews[index];
  const start = view.byteOffset ?? 0;
  const original = binary.subarray(start, start + view.byteLength);
  const image = imagesByView.get(index);
  let replacement = original;

  if (image && /image\/(png|jpeg|jpg|webp)$/i.test(image.mimeType ?? '')) {
    const pipeline = sharp(original, { animated: false, limitInputPixels: false });
    const metadata = await pipeline.metadata();
    const needsResize = maximumEdge && Math.max(metadata.width, metadata.height) > maximumEdge;
    const needsEncoding = needsResize || image.mimeType !== 'image/webp';
    if (needsEncoding) {
      console.log(`  texture ${converted + 1}/${json.images.length}`);
      oldImageBytes += original.length;
      if (needsResize) pipeline.resize({ width: maximumEdge, height: maximumEdge, fit: 'inside', withoutEnlargement: true });
      const candidate = await pipeline
        .webp({ quality: 92, alphaQuality: 100, effort: 4, smartSubsample: true })
        .toBuffer();
      if (needsResize || candidate.length < original.length) {
        replacement = candidate;
        image.mimeType = 'image/webp';
        converted += 1;
      }
      newImageBytes += replacement.length;
    }
  }

  const offset = rebuiltViews.reduce((length, part) => length + part.length, 0);
  const alignedOffset = (offset + 3) & ~3;
  if (alignedOffset > offset) rebuiltViews.push(Buffer.alloc(alignedOffset - offset));
  view.byteOffset = alignedOffset;
  view.byteLength = replacement.length;
  rebuiltViews.push(replacement);
}

const rebuiltBinary = Buffer.concat(rebuiltViews);
json.buffers[0].byteLength = rebuiltBinary.length;
// WebP is an extension in glTF, not a core texture source. Preserve any
// existing texture extensions while declaring the format for conforming loaders.
for (const texture of json.textures ?? []) {
  if (texture.source === undefined || json.images[texture.source]?.mimeType !== 'image/webp') continue;
  texture.extensions = { ...texture.extensions, EXT_texture_webp: { source: texture.source } };
  delete texture.source;
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_texture_webp'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_texture_webp'])];
}
const output = writeGlb(json, rebuiltBinary);
await writeFile(outputPath, output);

const megabytes = bytes => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
console.log(`${path.basename(inputPath)} → ${path.basename(outputPath)}`);
console.log(`Textures: ${converted} converted, ${megabytes(oldImageBytes)} → ${megabytes(newImageBytes)}`);
console.log(`GLB: ${megabytes(source.length)} → ${megabytes(output.length)}`);
