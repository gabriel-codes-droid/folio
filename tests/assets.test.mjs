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
const source = files(join(root, 'src')).map(path => readFileSync(path, 'utf8')).join('\n');
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
