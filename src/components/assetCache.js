export const ASSET_CACHE_NAME = 'portfolio-scene-assets-v1';
export const assetKey = asset => `${asset.url}?v=${encodeURIComponent(asset.version)}`;

// Optional, origin-local storage only. Browsers may deny CacheStorage or evict
// it at any time, so neither a failed operation nor a stalled storage backend
// is allowed to hold up the scene. Writes run in the background.
export function createAssetCache({
  getStorage = () => globalThis.caches,
  baseUrl = globalThis.location?.href ?? 'https://portfolio.invalid/',
  // Large models can take more than a second to read or persist on mobile
  // storage. Keep the fallback bounded without abandoning healthy cache I/O.
  timeoutMs = 5000,
} = {}) {
  let enabled = true;
  let opened;
  const keyFor = asset => new URL(assetKey(asset), baseUrl).href;
  const open = () => opened ??= Promise.resolve().then(() => getStorage()?.open(ASSET_CACHE_NAME));
  async function optional(operation) {
    if (!enabled) return null;
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation).catch(() => { enabled = false; return null; }),
        new Promise(resolve => { timer = setTimeout(() => { enabled = false; resolve(null); }, timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  return {
    read(asset) {
      return optional(async () => {
        const cache = await open();
        if (!cache) { enabled = false; return null; }
        const response = await cache.match(keyFor(asset));
        if (!response) return null;
        const length = response.headers.get('Content-Length');
        if (response.status !== 200 || (length !== null && Number(length) !== asset.bytes)) {
          void cache.delete(keyFor(asset)).catch(() => {});
          return null;
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== asset.bytes) {
          void cache.delete(keyFor(asset)).catch(() => {});
          return null;
        }
        return buffer;
      });
    },
    remove(asset) {
      return optional(async () => (await open())?.delete(keyFor(asset)));
    },
    write(asset, buffer) {
      return optional(async () => {
        const cache = await open();
        if (!cache) { enabled = false; return; }
        const key = keyFor(asset);
        await cache.put(key, new Response(buffer, { headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(buffer.byteLength),
        } }));
        // Only remove superseded versions of this exact asset in OUR cache.
        // Never clear CacheStorage, other caches, or another model's entries.
        const current = new URL(key);
        current.searchParams.delete('v');
        for (const request of await cache.keys()) {
          if (request.url === key) continue;
          const previous = new URL(request.url);
          if (!previous.searchParams.has('v')) continue;
          previous.searchParams.delete('v');
          if (previous.href === current.href) await cache.delete(request);
        }
      });
    },
  };
}
