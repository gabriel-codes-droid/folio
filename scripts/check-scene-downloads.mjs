// Exercise the same resumable loader against a real dev/production server.
// Usage: node scripts/check-scene-downloads.mjs http://127.0.0.1:4321
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SCENE_ASSETS } from '../src/data/sceneAssets.js';
import { createAssetDownloads } from '../src/components/assetDownloads.js';

const base = new URL(process.argv[2]);
if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Expected an HTTP(S) site URL.');
const loader = createAssetDownloads({ fetchImpl: (url, options) => fetch(new URL(url, base), options) });
let bytes = 0;
await loader.prepare(SCENE_ASSETS, {
  onAsset(asset, buffer) {
    assert.equal(createHash('sha256').update(new Uint8Array(buffer)).digest('hex').slice(0, 16), asset.version, `${asset.url} does not match the build`);
    bytes += buffer.byteLength;
    console.log(`Verified ${asset.url}: ${buffer.byteLength} bytes`);
  },
});
loader.clear();
console.log(`All ${SCENE_ASSETS.length} scene downloads verified: ${bytes} bytes.`);
