import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Cache, FileLoader } from 'three';
import { createAssetDownloads } from '../src/components/assetDownloads.js';
import { SCENE_ASSETS } from '../src/data/sceneAssets.js';

const asset = { url: '/models/test.fbx', bytes: 12, version: 'test' };
function rangeResponse(start, end, bytes = 12) {
  return new Response(Uint8Array.from({ length: end - start + 1 }, (_, i) => start + i), {
    status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${bytes}` },
  });
}
const range = options => options.headers.Range.match(/bytes=(\d+)-(\d+)/).slice(1).map(Number);

test('failed chunks retry without re-fetching successful chunks', async () => {
  const requested = [];
  let failed = false;
  const loader = createAssetDownloads({ chunkBytes: 4, sleep: async () => {}, fetchImpl: async (url, options) => {
    assert.equal(url, '/models/test.fbx?v=test');
    const [start, end] = range(options);
    requested.push(start);
    if (start === 4 && !failed) { failed = true; throw new TypeError('Failed to fetch'); }
    return rangeResponse(start, end);
  } });
  const progress = [];
  let result;
  await loader.prepare([asset], { onProgress: value => progress.push(value), onAsset: (_, data) => { result = data; } });
  assert.deepEqual(requested, [0, 4, 4, 8]);
  assert.deepEqual([...new Uint8Array(result)], Array.from({ length: 12 }, (_, i) => i));
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, i) => !i || value >= progress[i - 1]));
});

test('manual retry resumes the failed asset and reuses completed assets', async () => {
  let offline = true;
  const requests = [];
  const loader = createAssetDownloads({ chunkBytes: 4, attempts: 1, fetchImpl: async (url, options) => {
    const [start, end] = range(options);
    requests.push([url, start]);
    if (url.includes('second') && start === 4 && offline) throw new TypeError('Offline');
    return rangeResponse(start, end);
  } });
  const assets = [asset, { ...asset, url: '/models/second.fbx' }];
  await assert.rejects(loader.prepare(assets, { concurrency: 1 }), /second.fbx/);
  offline = false;
  requests.length = 0;
  await loader.prepare(assets, { concurrency: 1 });
  assert.deepEqual(requests.map(([url, start]) => [url.split('?')[0], start]), [['/models/second.fbx', 4], ['/models/second.fbx', 8]]);
});

test('supports a server sending a full 200 response instead of byte ranges', async () => {
  let requests = 0;
  const loader = createAssetDownloads({ chunkBytes: 4, fetchImpl: async () => { requests++; return new Response(new Uint8Array(12)); } });
  await loader.prepare([asset]);
  assert.equal(requests, 1);
});

test('rejects partial, wrong-range and pointer files without caching success', async () => {
  for (const response of [
    () => new Response(new Uint8Array(3)),
    () => rangeResponse(1, 4),
    () => new Response('version text'),
  ]) {
    const loader = createAssetDownloads({ attempts: 1, chunkBytes: 4, fetchImpl: async () => response() });
    let cached = false;
    await assert.rejects(loader.prepare([{ ...asset, url: '/models/test.glb' }], { onAsset: () => { cached = true; } }));
    assert.equal(cached, false);
  }
});

test('limits simultaneous requests to two assets', async () => {
  let active = 0, peak = 0;
  const loader = createAssetDownloads({ fetchImpl: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return new Response(new Uint8Array(12));
  } });
  await loader.prepare(Array.from({ length: 6 }, (_, i) => ({ ...asset, url: `/models/${i}.fbx` })));
  assert.equal(peak, 2);
});

test('a stalled chunk is aborted and can be retried', async () => {
  let attempts = 0;
  const loader = createAssetDownloads({ timeoutMs: 5, attempts: 2, sleep: async () => {}, fetchImpl: async (_, { signal }) => {
    if (++attempts === 2) return new Response(new Uint8Array(12));
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
  } });
  await loader.prepare([asset]);
  assert.equal(attempts, 2);
});

test('prefetched data is reused by the installed Three FileLoader', async () => {
  Cache.enabled = true;
  const bytes = new ArrayBuffer(12);
  Cache.add('file:/models/prefetched.fbx', bytes);
  try {
    const result = await new FileLoader().setResponseType('arraybuffer').loadAsync('/models/prefetched.fbx');
    assert.equal(result, bytes);
  } finally { Cache.remove('file:/models/prefetched.fbx'); Cache.enabled = false; }
});

test('download manifest matches shipped assets and excludes the full-size EXR', () => {
  const directory = new URL('../public/models/', import.meta.url);
  assert.deepEqual(SCENE_ASSETS.map(entry => entry.url.split('/').pop()).sort(), readdirSync(directory).sort());
  for (const entry of SCENE_ASSETS) {
    const file = new URL(entry.url.slice('/models/'.length), directory);
    assert.equal(entry.bytes, statSync(file).size);
    assert.equal(entry.version, createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16));
  }
  assert.ok(!SCENE_ASSETS.some(entry => entry.url.endsWith('.exr')));
  assert.ok(SCENE_ASSETS.find(entry => entry.url.endsWith('.hdr')).bytes < 3 * 1024 * 1024);
  const wrapper = readFileSync(new URL('../src/components/SpaceExperience.jsx', import.meta.url), 'utf8');
  assert.match(wrapper, /\.then\(\(\) => import\('\.\/SpaceCanvas'\)\)/);
  assert.doesNotMatch(wrapper, /location.reload/);
});
