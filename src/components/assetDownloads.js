import { assetKey, createAssetCache } from './assetCache.js';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class AssetDownloadError extends Error {
  constructor(url, cause) {
    super(`Could not download ${url.split('/').pop()}. Retry to resume.`, { cause });
    this.name = 'AssetDownloadError';
    this.url = url;
  }
}

async function validate(asset, buffer) {
  if (buffer.byteLength !== asset.bytes) throw new Error('Incomplete asset download.');
  if (asset.url.endsWith('.glb')) {
    const view = new DataView(buffer);
    if (view.byteLength < 12 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== asset.bytes) {
      throw new Error('Invalid GLB data.');
    }
  }
  // The manifest's version is the first 16 SHA-256 hex characters. Verify it
  // when Web Crypto is available, including when reading persistent storage,
  // so a same-size stale/corrupt response cannot be retained as this version.
  if (/^[a-f0-9]{16}$/.test(asset.version) && globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    const version = Array.from(new Uint8Array(digest).slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('');
    if (version !== asset.version) throw new Error('Asset version does not match its contents.');
  }
}

// Kept outside React: healthy transfers use one streaming request per asset.
// Retry keeps every received byte and asks for only the remaining suffix.
// Nothing touches global fetch/loaders; completed, validated files may also
// be reused after a page reload through optional CacheStorage.
export function createAssetDownloads({
  fetchImpl = (...args) => fetch(...args),
  attempts = 4,
  timeoutMs = 45000,
  sleep = pause,
  cache = createAssetCache(),
  progressIntervalMs = 100,
} = {}) {
  const entries = new Map();
  async function download(asset, onProgress) {
    const key = assetKey(asset);
    let entry = entries.get(key);
    if (!entry) {
      const saved = await cache.read(asset);
      if (saved) {
        try {
          await validate(asset, saved);
          entry = { buffer: new Uint8Array(saved), offset: asset.bytes, progress: asset.bytes, complete: true };
        } catch {
          void cache.remove(asset);
        }
      }
      entry ??= { buffer: new Uint8Array(asset.bytes), offset: 0, progress: 0, complete: false };
      entries.set(key, entry);
    }
    if (entry.complete) { onProgress(true); return entry.buffer.buffer; }
    let failure;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const start = entry.offset;
      const controller = new AbortController();
      let timer;
      let reader;
      // An idle timeout, not a deadline for the whole asset: a slow transfer
      // remains healthy as long as it keeps delivering bytes.
      const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), timeoutMs); };
      resetTimer();
      try {
        const response = await fetchImpl(key, {
          ...(start ? { headers: { Range: `bytes=${start}-` } } : {}),
          signal: controller.signal,
        });
        if (response.status !== 206 && response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (response.status === 206 && response.headers.get('Content-Range') !== `bytes ${start}-${asset.bytes - 1}/${asset.bytes}`) {
          throw new Error('Unexpected asset range; the file may have changed.');
        }
        // A server may ignore Range. Replace the prefix from byte zero rather
        // than appending the complete response to an already received prefix.
        const responseStart = response.status === 200 ? 0 : start;
        const expected = asset.bytes - responseStart;
        const length = response.headers.get('Content-Length');
        // Content-Length describes encoded bytes when HTTP compression is in
        // use, whereas fetch delivers decoded bytes. Validate the stream too.
        if (!response.headers.get('Content-Encoding') && length !== null && Number(length) !== expected) {
          throw new Error('Unexpected asset length; the file may have changed.');
        }
        reader = response.body.getReader();
        entry.offset = responseStart;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value.length) continue;
          resetTimer();
          if (entry.offset + value.length > asset.bytes) {
            entry.offset = 0;
            throw new Error('Oversized asset response.');
          }
          entry.buffer.set(value, entry.offset);
          entry.offset += value.length;
          entry.progress = Math.max(entry.progress, entry.offset);
          onProgress();
        }
        if (entry.offset !== asset.bytes) throw new Error('Incomplete asset download.');
        clearTimeout(timer);
        await validate(asset, entry.buffer.buffer);
        entry.complete = true;
        // Cache only after EOF, length, GLB header and version validation. A slow
        // disk, quota error or private-mode restriction never delays rendering.
        void cache.write(asset, entry.buffer.buffer);
        onProgress(true);
        return entry.buffer.buffer;
      } catch (error) {
        controller.abort();
        if (reader) void reader.cancel().catch(() => {});
        // Receiving the claimed length is not enough without clean EOF and
        // validation (there could be excess bytes or an invalid GLB header).
        if (entry.offset === asset.bytes) entry.offset = 0;
        failure = error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt + 1 < attempts) await sleep(750 * 2 ** attempt);
    }
    throw new AssetDownloadError(asset.url, failure);
  }

  async function prepare(assets, { onProgress, onAsset, concurrency = 2 } = {}) {
    const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
    let lastReport = 0;
    const report = (force = false) => {
      const now = Date.now();
      if (!force && now - lastReport < progressIntervalMs) return;
      lastReport = now;
      onProgress?.(total ? assets.reduce((sum, asset) => sum + (entries.get(assetKey(asset))?.progress ?? 0), 0) / total : 1);
    };
    let next = 0;
    let failure;
    const worker = async () => {
      while (next < assets.length && !failure) {
        const asset = assets[next++];
        try {
          const buffer = await download(asset, report);
          onAsset?.(asset, buffer);
        }
        catch (error) { failure ??= error; }
      }
    };
    report(true);
    await Promise.all(Array.from({ length: Math.min(concurrency, assets.length) }, worker));
    if (failure) throw failure;
  }
  return { prepare, clear: () => entries.clear() };
}
