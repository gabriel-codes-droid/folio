// Verify a texture-only repack has not changed geometry, rigs, transforms or animation.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';

function read(path) {
  const file = readFileSync(path);
  assert.equal(file.readUInt32LE(0), 0x46546c67);
  assert.equal(file.readUInt32LE(8), file.length);
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength));
  return { json, bin: file.subarray(28 + jsonLength) };
}
const [input, output, edgeArgument] = process.argv.slice(2);
const maximumEdge = Number(edgeArgument) || Infinity;
const before = read(input), after = read(output);
for (const key of ['scenes', 'scene', 'nodes', 'meshes', 'skins', 'animations', 'accessors', 'materials']) {
  // JSON serialization normalizes -0 to 0; both describe the same bound.
  const normalize = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  assert.deepEqual(normalize(after.json[key]), normalize(before.json[key]), `${key} changed`);
}
const imageViews = new Set(before.json.images?.map(image => image.bufferView));
assert.equal(after.json.bufferViews.length, before.json.bufferViews.length);
const bytes = (model, index) => {
  const view = model.json.bufferViews[index];
  return model.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
};
for (let i = 0; i < before.json.bufferViews.length; i++) {
  if (!imageViews.has(i)) assert.deepEqual(bytes(after, i), bytes(before, i), `Geometry/animation buffer ${i} changed`);
  else {
    const original = await sharp(bytes(before, i)).metadata();
    const packed = await sharp(bytes(after, i)).metadata();
    const ratio = Math.min(1, maximumEdge / Math.max(original.width, original.height));
    assert.equal(packed.width, Math.round(original.width * ratio));
    assert.equal(packed.height, Math.round(original.height * ratio));
    assert.equal(packed.hasAlpha, original.hasAlpha);
  }
}
for (let i = 0; i < (before.json.textures?.length ?? 0); i++) {
  const source = texture => texture.source ?? texture.extensions?.EXT_texture_webp?.source;
  assert.equal(source(after.json.textures[i]), source(before.json.textures[i]), `Texture ${i} changed image`);
  assert.equal(after.json.textures[i].sampler, before.json.textures[i].sampler);
}
console.log(`Verified ${output}: geometry, rigs, animation and material links unchanged; texture dimensions match the requested cap.`);
