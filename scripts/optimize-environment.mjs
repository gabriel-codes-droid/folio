// Same HDR lighting, downsampled in linear space for reflections (not the backdrop).
// Usage: node scripts/optimize-environment.mjs source.exr output.hdr
import { readFile, writeFile } from 'node:fs/promises';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { FloatType } from 'three';

const [input, output] = process.argv.slice(2);
if (!input || !output || input === output) throw new Error('Provide separate EXR input and HDR output paths.');
const source = await readFile(input);
const texture = new EXRLoader().setDataType(FloatType).parse(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
const width = Math.min(1024, texture.width);
const height = Math.round(texture.height * width / texture.width);
const channels = texture.data.length / (texture.width * texture.height);
const parts = [Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`)];
for (let y = 0; y < height; y++) {
  const row = Buffer.alloc(width * 4);
  for (let x = 0; x < width; x++) {
    const rgb = [0, 0, 0];
    let count = 0;
    for (let sy = Math.floor(y * texture.height / height); sy < Math.floor((y + 1) * texture.height / height); sy++) {
      for (let sx = Math.floor(x * texture.width / width); sx < Math.floor((x + 1) * texture.width / width); sx++) {
        // EXRLoader's data is bottom-up, HDRLoader uploads top-down data flipped.
        const index = ((texture.height - sy - 1) * texture.width + sx) * channels;
        for (let c = 0; c < 3; c++) rgb[c] += Math.max(0, texture.data[index + c]);
        count++;
      }
    }
    const max = Math.max(...rgb) / count;
    if (max < 1e-32) continue;
    const exponent = Math.floor(Math.log2(max)) + 1;
    for (let c = 0; c < 3; c++) row[c * width + x] = Math.min(255, Math.floor(rgb[c] / count * 2 ** (8 - exponent)));
    row[3 * width + x] = exponent + 128;
  }
  parts.push(Buffer.from([2, 2, width >> 8, width & 255]));
  // Literal RLE blocks: straightforward, valid RGBE, and still only ~2 MB.
  for (let c = 0; c < 4; c++) for (let x = 0; x < width; x += 128) {
    const count = Math.min(128, width - x);
    parts.push(Buffer.from([count]), row.subarray(c * width + x, c * width + x + count));
  }
}
const result = Buffer.concat(parts);
const decoded = new HDRLoader().setDataType(FloatType).parse(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength));
if (decoded.width !== width || decoded.height !== height || decoded.data.some(value => !Number.isFinite(value))) throw new Error('HDR round-trip validation failed.');
await writeFile(output, result);
console.log(`Environment: ${texture.width}x${texture.height}, ${source.length} bytes -> ${width}x${height}, ${result.length} bytes`);
