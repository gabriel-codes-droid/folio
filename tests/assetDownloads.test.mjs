import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Cache, FileLoader } from 'three';
import { createAssetDownloads } from '../src/components/assetDownloads.js';
import { SCENE_ASSETS } from '../src/data/sceneAssets.js';

const asset = { url: '/models/test.fbx', bytes: 12, version: 'test' };
const bytes = Uint8Array.from({ length: 12 }, (_, i) => i);
function rangeResponse(start, end, bytes = 12) {
  return new Response(Uint8Array.from({ length: end - start + 1 }, (_, i) => start + i), {
    status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${bytes}` },
  });
}
const requestedRange = options => options.headers?.Range ?? null;
function streamed(parts, { fail = false, ...options } = {}) {
  let next = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (next < parts.length) controller.enqueue(parts[next++]);
    else if (fail) controller.error(new TypeError('Connection lost'));
    else controller.close();
  } }), options);
}
const noCache = () => ({ read: async () => null, write: async () => {}, remove: async () => {} });

test('a healthy asset streams in one versioned request without Range and reports byte progress', async () => {
  const requested = [];
  const loader = createAssetDownloads({ progressIntervalMs: 0, fetchImpl: async (url, options) => {
    assert.equal(url, '/models/test.fbx?v=test');
    requested.push(requestedRange(options));
    return streamed([bytes.slice(0, 4), bytes.slice(4)]);
  } });
  const progress = [];
  let result;
  await loader.prepare([asset], { onProgress: value => progress.push(value), onAsset: (_, data) => { result = data; } });
  assert.deepEqual(requested, [null]);
  assert.deepEqual(new Uint8Array(result), bytes);
  assert.ok(progress.includes(4 / 12), 'progress includes bytes received before EOF');
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, i) => !i || value >= progress[i - 1]));
});

test('a failed stream resumes after its last received byte without downloading the prefix twice', async () => {
  const requested = [];
  const loader = createAssetDownloads({ sleep: async () => {}, fetchImpl: async (_, options) => {
    requested.push(requestedRange(options));
    return requested.length === 1
      ? streamed([bytes.slice(0, 4), bytes.slice(4, 7)], { fail: true })
      : rangeResponse(7, 11);
  } });
  let result;
  await loader.prepare([asset], { onAsset: (_, data) => { result = data; } });
  assert.deepEqual(requested, [null, 'bytes=7-']);
  assert.deepEqual(new Uint8Array(result), bytes);
});

test('a premature clean EOF also resumes from the exact received offset', async () => {
  const requested = [];
  const loader = createAssetDownloads({ sleep: async () => {}, fetchImpl: async (_, options) => {
    requested.push(requestedRange(options));
    return requested.length === 1 ? new Response(bytes.slice(0, 3)) : rangeResponse(3, 11);
  } });
  await loader.prepare([asset]);
  assert.deepEqual(requested, [null, 'bytes=3-']);
});

test('manual retry resumes the failed asset and reuses completed assets', async () => {
  let offline = true;
  const requests = [];
  const loader = createAssetDownloads({ attempts: 1, fetchImpl: async (url, options) => {
    requests.push([url, requestedRange(options)]);
    if (!url.includes('second')) return new Response(bytes);
    if (offline) return streamed([bytes.slice(0, 4)], { fail: true });
    return rangeResponse(4, 11);
  } });
  const assets = [asset, { ...asset, url: '/models/second.fbx' }];
  await assert.rejects(loader.prepare(assets, { concurrency: 1 }), /second.fbx/);
  offline = false;
  requests.length = 0;
  await loader.prepare(assets, { concurrency: 1 });
  assert.deepEqual(requests.map(([url, range]) => [url.split('?')[0], range]), [['/models/second.fbx', 'bytes=4-']]);
});

test('a server ignoring resume Range with 200 replaces the prefix instead of appending', async () => {
  const requests = [];
  const loader = createAssetDownloads({ sleep: async () => {}, fetchImpl: async (_, options) => {
    requests.push(requestedRange(options));
    return requests.length === 1 ? streamed([bytes.slice(0, 5)], { fail: true }) : new Response(bytes);
  } });
  let result;
  await loader.prepare([asset], { onAsset: (_, data) => { result = data; } });
  assert.deepEqual(requests, [null, 'bytes=5-']);
  assert.deepEqual(new Uint8Array(result), bytes);
});

test('if a replacement 200 stream also fails, resume uses its valid prefix and progress stays monotonic', async () => {
  const requests = [], progress = [];
  const loader = createAssetDownloads({ progressIntervalMs: 0, sleep: async () => {}, fetchImpl: async (_, options) => {
    requests.push(requestedRange(options));
    if (requests.length === 1) return streamed([bytes.slice(0, 5)], { fail: true });
    if (requests.length === 2) return streamed([bytes.slice(0, 2)], { fail: true });
    return rangeResponse(2, 11);
  } });
  let result;
  await loader.prepare([asset], { onProgress: value => progress.push(value), onAsset: (_, data) => { result = data; } });
  assert.deepEqual(requests, [null, 'bytes=5-', 'bytes=2-']);
  assert.deepEqual(new Uint8Array(result), bytes);
  assert.ok(progress.every((value, i) => !i || value >= progress[i - 1]));
});

test('rejects partial, wrong-range, oversized, incorrect-length and pointer files without caching success', async () => {
  for (const response of [
    () => new Response(new Uint8Array(3)),
    () => rangeResponse(1, 4),
    () => new Response(new Uint8Array(13)),
    () => streamed([new Uint8Array(12), new Uint8Array(1)]),
    () => new Response(new Uint8Array(12), { headers: { 'Content-Length': '13' } }),
    () => new Response('version text'),
  ]) {
    let cacheWrites = 0, prepared = false;
    const loader = createAssetDownloads({ attempts: 1, cache: { ...noCache(), write: async () => { cacheWrites++; } }, fetchImpl: async () => response() });
    await assert.rejects(loader.prepare([{ ...asset, url: '/models/test.glb' }], { onAsset: () => { prepared = true; } }));
    assert.equal(prepared, false);
    assert.equal(cacheWrites, 0);
  }
});

test('wrong resume ranges cannot overwrite the retained prefix', async () => {
  const requests = [];
  const loader = createAssetDownloads({ sleep: async () => {}, fetchImpl: async (_, options) => {
    requests.push(requestedRange(options));
    if (requests.length === 1) return streamed([bytes.slice(0, 4)], { fail: true });
    return rangeResponse(requests.length === 2 ? 5 : 4, 11);
  } });
  let result;
  await loader.prepare([asset], { onAsset: (_, data) => { result = data; } });
  assert.deepEqual(requests, [null, 'bytes=4-', 'bytes=4-']);
  assert.deepEqual(new Uint8Array(result), bytes);
});

test('oversized or invalid complete responses reset to byte zero for manual retry', async () => {
  for (const response of [() => new Response(new Uint8Array(13)), () => new Response(new Uint8Array(12))]) {
    const glb = bytes.slice();
    new DataView(glb.buffer).setUint32(0, 0x46546c67, true);
    new DataView(glb.buffer).setUint32(4, 2, true);
    new DataView(glb.buffer).setUint32(8, 12, true);
    const requests = [];
    const loader = createAssetDownloads({ attempts: 1, fetchImpl: async (_, options) => {
      requests.push(requestedRange(options));
      return requests.length === 1 ? response() : new Response(glb);
    } });
    const model = { ...asset, url: '/models/test.glb' };
    await assert.rejects(loader.prepare([model]));
    await loader.prepare([model]);
    assert.deepEqual(requests, [null, null]);
  }
});

test('HTTP-encoded Content-Length is not confused with decoded asset length', async () => {
  const loader = createAssetDownloads({ fetchImpl: async () => new Response(bytes, {
    headers: { 'Content-Encoding': 'gzip', 'Content-Length': '9' },
  }) });
  await loader.prepare([asset]);
});

test('limits simultaneous streams to two assets', async () => {
  let active = 0, peak = 0;
  const loader = createAssetDownloads({ fetchImpl: async () => {
    active++; peak = Math.max(peak, active);
    return new Response(new ReadableStream({ start(controller) {
      setTimeout(() => { active--; controller.enqueue(bytes); controller.close(); }, 5);
    } }));
  } });
  await loader.prepare(Array.from({ length: 6 }, (_, i) => ({ ...asset, url: `/models/${i}.fbx` })));
  assert.equal(peak, 2);
});

test('a stalled initial request is aborted and can be retried', async () => {
  let attempts = 0;
  const loader = createAssetDownloads({ timeoutMs: 5, attempts: 2, sleep: async () => {}, fetchImpl: async (_, { signal }) => {
    if (++attempts === 2) return new Response(new Uint8Array(12));
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
  } });
  await loader.prepare([asset]);
  assert.equal(attempts, 2);
});

test('a stalled body is aborted and resumes from its delivered prefix', async () => {
  const requests = [];
  const loader = createAssetDownloads({ timeoutMs: 10, sleep: async () => {}, fetchImpl: async (_, options) => {
    requests.push(requestedRange(options));
    if (requests.length > 1) return rangeResponse(4, 11);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 4));
      options.signal.addEventListener('abort', () => controller.error(new Error('Aborted')), { once: true });
    } }));
  } });
  await loader.prepare([asset]);
  assert.deepEqual(requests, [null, 'bytes=4-']);
});

test('a slow stream is not timed out while data keeps arriving', async () => {
  let requests = 0;
  const started = Date.now();
  const loader = createAssetDownloads({ timeoutMs: 100, attempts: 1, fetchImpl: async (_, { signal }) => {
    requests++;
    let timer;
    const body = new ReadableStream({ start(controller) {
      let sent = 0;
      timer = setInterval(() => {
        controller.enqueue(new Uint8Array(1));
        if (++sent === 12) { clearInterval(timer); controller.close(); }
      }, 30);
      signal.addEventListener('abort', () => { clearInterval(timer); controller.error(new Error('Aborted')); }, { once: true });
    }, cancel() { clearInterval(timer); } });
    return new Response(body);
  } });
  await loader.prepare([asset]);
  assert.equal(requests, 1);
  assert.ok(Date.now() - started > 100, 'Transfer must exceed the idle timeout in total');
});

test('retries retain bounded attempts and exponential backoff', async () => {
  const waits = [];
  let requests = 0;
  const loader = createAssetDownloads({ sleep: async delay => waits.push(delay), fetchImpl: async () => {
    requests++;
    throw new TypeError('Offline');
  } });
  await assert.rejects(loader.prepare([asset]), /Retry to resume/);
  assert.equal(requests, 4);
  assert.deepEqual(waits, [750, 1500, 3000]);
});

test('clear releases in-memory buffers and empty manifests report completion', async () => {
  let requests = 0;
  const loader = createAssetDownloads({ cache: noCache(), fetchImpl: async () => { requests++; return new Response(bytes); } });
  await loader.prepare([asset]);
  await loader.prepare([asset]);
  assert.equal(requests, 1);
  loader.clear();
  await loader.prepare([asset]);
  assert.equal(requests, 2);
  const progress = [];
  await loader.prepare([], { onProgress: value => progress.push(value) });
  assert.deepEqual(progress, [1]);
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
