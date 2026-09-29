import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const source = files(join(root, 'src')).filter(path => !path.endsWith('sceneAssets.js')).map(path => readFileSync(path, 'utf8')).join('\n');
const assets = new Set([...source.matchAll(/['"`](\/(?:models|images)\/[^'"`]+)['"`]/g)].map(match => match[1]));

test('all scene model, animation, environment and background references exist', () => {
  assert.ok(assets.size > 10, 'The asset audit must cover the full scene');
  for (const asset of assets) assert.ok(existsSync(join(root, 'public', asset)), `Missing ${asset}`);
});

test('every shipped model has a source reference', () => {
  for (const file of readdirSync(join(root, 'public/models'))) {
    assert.ok(assets.has(`/models/${file}`), `Unreferenced model: ${file}`);
  }
});

test('scene GLBs contain full model data, not Git LFS pointers', () => {
  for (const asset of assets) {
    if (!asset.endsWith('.glb')) continue;
    const path = join(root, 'public', asset);
    const header = Buffer.alloc(12);
    const handle = openSync(path, 'r');
    try {
      assert.equal(readSync(handle, header, 0, header.length, 0), 12, `Truncated model: ${asset}`);
    } finally {
      closeSync(handle);
    }
    assert.equal(header.toString('ascii', 0, 4), 'glTF', `${asset} is not a model. Enable Git LFS in Vercel Project Settings > Git and redeploy, or run git lfs pull locally.`);
    assert.equal(header.readUInt32LE(4), 2, `Unsupported GLB version: ${asset}`);
    assert.equal(header.readUInt32LE(8), statSync(path).size, `Incomplete model download: ${asset}`);
  }
});

test('packed WebP textures declare their glTF extension and remain embedded', () => {
  for (const asset of assets) {
    if (!asset.endsWith('.glb')) continue;
    const bytes = readFileSync(join(root, 'public', asset));
    const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
    assert.ok((model.images ?? []).every(image => image.bufferView !== undefined), `${asset} has an external texture`);
    assert.ok((model.buffers ?? []).every(buffer => !buffer.uri), `${asset} has an external buffer`);
    for (const texture of model.textures ?? []) {
      const webp = texture.extensions?.EXT_texture_webp;
      if (webp) {
        assert.equal(model.images[webp.source].mimeType, 'image/webp');
        assert.ok(model.extensionsUsed?.includes('EXT_texture_webp'));
        if (texture.source === undefined) assert.ok(model.extensionsRequired?.includes('EXT_texture_webp'));
      } else {
        assert.notEqual(model.images[texture.source]?.mimeType, 'image/webp', `${asset} is missing EXT_texture_webp`);
      }
    }
  }
});
