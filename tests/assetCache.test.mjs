import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ASSET_CACHE_NAME, assetKey, createAssetCache } from '../src/components/assetCache.js';
import { createAssetDownloads } from '../src/components/assetDownloads.js';

const baseUrl = 'https://portfolio.example/';
const bytes = Uint8Array.from({ length: 12 }, (_, i) => i);
const asset = { url: '/models/test.fbx', bytes: 12, version: 'v1' };
const absoluteKey = entry => new URL(assetKey(entry), baseUrl).href;
function memoryStorage() {
  const records = new Map(), opened = [];
  const key = request => typeof request === 'string' ? request : request.url;
  const cache = {
    async match(request) { return records.get(key(request))?.clone(); },
    async put(request, response) { records.set(key(request), response.clone()); },
    async delete(request) { return records.delete(key(request)); },
    async keys() { return [...records.keys()].map(url => new Request(url)); },
  };
  return { records, cache, opened, async open(name) { opened.push(name); return cache; } };
}
const helperFor = storage => createAssetCache({ baseUrl, getStorage: () => storage });

test('complete assets persist across new loader instances without another network request', async () => {
  const storage = memoryStorage(), writes = [];
  const persistent = helperFor(storage);
  const first = createAssetDownloads({
    cache: { ...persistent, write(...args) { const pending = persistent.write(...args); writes.push(pending); return pending; } },
    fetchImpl: async (_, options) => { assert.equal(options.headers, undefined); return new Response(bytes); },
  });
  await first.prepare([asset]);
  await Promise.all(writes);
  first.clear();
  const second = createAssetDownloads({ cache: helperFor(storage), fetchImpl: async () => { throw new Error('Cache hit must not fetch'); } });
  let result;
  await second.prepare([asset], { onAsset: (_, data) => { result = data; } });
  assert.deepEqual(new Uint8Array(result), bytes);
  assert.ok(storage.opened.every(name => name === ASSET_CACHE_NAME));
});

test('versions are separate keys and cleanup only removes older versions of this exact asset', async () => {
  const storage = memoryStorage(), cache = helperFor(storage);
  const current = { ...asset, version: 'v2' };
  const preserved = [
    new URL('/models/other.fbx?v=v1', baseUrl).href,
    new URL('/models/test.fbx', baseUrl).href,
    new URL('/models/test.fbx?format=other&v=v1', baseUrl).href,
    'https://different.example/models/test.fbx?v=v1',
  ];
  storage.records.set(absoluteKey(asset), new Response(bytes));
  for (const key of preserved) storage.records.set(key, new Response(bytes));
  assert.equal(await cache.read(current), null);
  await cache.write(current, bytes.buffer);
  assert.equal(storage.records.has(absoluteKey(asset)), false);
  assert.equal(storage.records.has(absoluteKey(current)), true);
  for (const key of preserved) assert.equal(storage.records.has(key), true);
  assert.deepEqual(storage.opened, [ASSET_CACHE_NAME], 'only the app-owned cache is opened');
});

test('CacheStorage missing, access denied, open errors and read errors fall back to a download', async () => {
  for (const getStorage of [
    () => undefined,
    () => { throw new Error('SecurityError'); },
    () => ({ open: async () => { throw new Error('Private mode'); } }),
    () => ({ open: async () => ({ match: async () => { throw new Error('Disk failure'); } }) }),
  ]) {
    let requests = 0;
    const cache = createAssetCache({ getStorage, baseUrl });
    const loader = createAssetDownloads({ cache, fetchImpl: async () => { requests++; return new Response(bytes); } });
    await loader.prepare([asset]);
    assert.equal(requests, 1);
    assert.equal(await cache.read(asset), null);
  }
});

test('quota errors and stale-cleanup errors never reject cache writes or the loader', async () => {
  for (const operation of ['put', 'keys', 'delete']) {
    const storage = memoryStorage();
    storage.records.set(absoluteKey({ ...asset, version: 'old' }), new Response(bytes));
    storage.cache[operation] = async () => { throw new Error('Quota or disk error'); };
    const cache = helperFor(storage);
    await assert.doesNotReject(cache.write(asset, bytes.buffer));
    let requests = 0;
    const loader = createAssetDownloads({ cache, fetchImpl: async () => { requests++; return new Response(bytes); } });
    await loader.prepare([asset]);
    assert.equal(requests, 1);
  }
});

test('stalled storage has a bounded read delay and is skipped for the rest of the visit', async () => {
  let opens = 0;
  const cache = createAssetCache({ baseUrl, timeoutMs: 10, getStorage: () => ({ open() { opens++; return new Promise(() => {}); } }) });
  let requests = 0;
  const loader = createAssetDownloads({ cache, fetchImpl: async () => { requests++; return new Response(bytes); } });
  await loader.prepare([asset, { ...asset, url: '/models/second.fbx' }]);
  assert.equal(opens, 1);
  assert.equal(requests, 2);
  assert.equal(await cache.read(asset), null);
});

test('the default storage budget keeps a healthy cache read alive beyond one second', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const storage = memoryStorage();
  let finishRead;
  storage.cache.match = () => new Promise(resolve => { finishRead = resolve; });
  const cache = helperFor(storage);
  const pending = cache.read(asset);
  // Let the asynchronous cache-open/match chain reach the controlled read.
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  assert.equal(typeof finishRead, 'function');
  context.mock.timers.tick(1500);
  finishRead(new Response(bytes));
  assert.deepEqual(new Uint8Array(await pending), bytes);
});

test('pending persistent writes do not hold up successful preparation', async () => {
  const storage = memoryStorage();
  let finishWrite;
  storage.cache.put = () => new Promise(resolve => { finishWrite = resolve; });
  const cache = createAssetCache({ baseUrl, timeoutMs: 1000, getStorage: () => storage });
  const loader = createAssetDownloads({ cache, fetchImpl: async () => new Response(bytes) });
  let timer;
  try {
    await Promise.race([
      loader.prepare([asset]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Preparation waited for storage')), 100); }),
    ]);
  } finally { clearTimeout(timer); finishWrite?.(); }
});

test('invalid stored status or byte lengths are discarded and fetched again', async () => {
  for (const response of [
    () => new Response(bytes.slice(0, 4)),
    () => new Response(bytes, { headers: { 'Content-Length': '4' } }),
    () => new Response(bytes, { status: 206 }),
  ]) {
    const storage = memoryStorage();
    storage.records.set(absoluteKey(asset), response());
    let requests = 0;
    const loader = createAssetDownloads({ cache: helperFor(storage), fetchImpl: async () => { requests++; return new Response(bytes); } });
    await loader.prepare([asset]);
    assert.equal(requests, 1);
  }
});

test('an invalid cached GLB is discarded even when its byte length is correct', async () => {
  const model = { ...asset, url: '/models/test.glb' };
  const glb = new Uint8Array(12), view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 12, true);
  const storage = memoryStorage();
  storage.records.set(absoluteKey(model), new Response(bytes));
  let requests = 0, result;
  const loader = createAssetDownloads({ cache: helperFor(storage), fetchImpl: async () => { requests++; return new Response(glb); } });
  await loader.prepare([model], { onAsset: (_, data) => { result = data; } });
  assert.equal(requests, 1);
  assert.deepEqual(new Uint8Array(result), glb);
});

test('same-size cached corruption is rejected using the manifest version hash', async () => {
  const hashed = { ...asset, version: createHash('sha256').update(bytes).digest('hex').slice(0, 16) };
  const storage = memoryStorage();
  storage.records.set(absoluteKey(hashed), new Response(new Uint8Array(12)));
  let requests = 0;
  const loader = createAssetDownloads({ cache: helperFor(storage), fetchImpl: async () => { requests++; return new Response(bytes); } });
  await loader.prepare([hashed]);
  assert.equal(requests, 1);
});

test('same-size wrong-version network responses cannot be cached as success', async () => {
  const hashed = { ...asset, version: createHash('sha256').update(bytes).digest('hex').slice(0, 16) };
  const storage = memoryStorage();
  const loader = createAssetDownloads({ attempts: 1, cache: helperFor(storage), fetchImpl: async () => new Response(new Uint8Array(12)) });
  await assert.rejects(loader.prepare([hashed]), error => /Asset version/.test(error.cause?.message));
  assert.equal(storage.records.size, 0);
});

test('a failed version check restarts from zero and only caches the valid retry', async () => {
  const hashed = { ...asset, version: createHash('sha256').update(bytes).digest('hex').slice(0, 16) };
  const requests = [], writes = [];
  const loader = createAssetDownloads({
    attempts: 2,
    sleep: async () => {},
    cache: {
      read: async () => null,
      remove: async () => {},
      write: async (_, buffer) => { writes.push(new Uint8Array(buffer).slice()); },
    },
    fetchImpl: async (_, options) => {
      requests.push(options.headers?.Range ?? null);
      return new Response(requests.length === 1 ? new Uint8Array(12) : bytes);
    },
  });
  await loader.prepare([hashed]);
  assert.deepEqual(requests, [null, null]);
  assert.deepEqual(writes, [bytes]);
});
