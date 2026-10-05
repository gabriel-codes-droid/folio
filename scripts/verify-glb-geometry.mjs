import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readGlb, viewBytes } from './optimize-glb-geometry.mjs';

// Ignore storage addresses only; retain every scene, material, accessor,
// animation, transform, buffer layout and decoded byte in the fingerprint.
export async function contentHash(buffer) {
  const model = readGlb(buffer);
  const metadata = structuredClone(model.json);
  delete metadata.buffers;
  delete metadata.bufferViews;
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (metadata[key]) {
      metadata[key] = metadata[key].filter(name => name !== 'EXT_meshopt_compression');
      if (!metadata[key].length) delete metadata[key];
    }
  }
  const hash = createHash('sha256').update(JSON.stringify(metadata));
  for (let index = 0; index < model.json.bufferViews.length; index++) {
    const metadata = structuredClone(model.json.bufferViews[index]);
    delete metadata.buffer;
    delete metadata.byteOffset;
    if (metadata.extensions?.EXT_meshopt_compression) {
      delete metadata.extensions.EXT_meshopt_compression;
      if (!Object.keys(metadata.extensions).length) delete metadata.extensions;
    }
    hash.update(JSON.stringify(metadata));
    hash.update(await viewBytes(model, index));
  }
  return hash.digest('hex');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  const original = await contentHash(readFileSync(input));
  const optimized = await contentHash(readFileSync(output));
  assert.equal(optimized, original, 'Decoded scene data changed');
  console.log(`Verified byte-identical scene contents: ${output} (${optimized})`);
}
