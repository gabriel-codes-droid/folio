const CHUNK_BYTES = 256 * 1024;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export class AssetDownloadError extends Error {
  constructor(url, cause) {
    super(`Could not download ${url.split('/').pop()}. Retry to resume.`, { cause });
    this.name = 'AssetDownloadError';
    this.url = url;
  }
}

// Kept outside React: retry resumes successful chunks instead of reloading the
// page and throwing away hundreds of MB. Nothing touches global fetch/loaders.
export function createAssetDownloads({
  fetchImpl = (...args) => fetch(...args),
  chunkBytes = CHUNK_BYTES,
  maxChunkBytes = chunkBytes === CHUNK_BYTES ? 2 * 1024 * 1024 : chunkBytes,
  attempts = 4,
  timeoutMs = 45000,
  sleep = pause,
} = {}) {
  const entries = new Map();
  async function download(asset, onProgress) {
    const key = `${asset.url}?v=${asset.version}`;
    let entry = entries.get(key);
    if (!entry) {
      entry = { buffer: new Uint8Array(asset.bytes), offset: 0, chunkBytes };
      entries.set(key, entry);
    }
    while (entry.offset < asset.bytes) {
      const start = entry.offset;
      const end = Math.min(start + entry.chunkBytes, asset.bytes) - 1;
      let failure;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const controller = new AbortController();
        let timer;
        // This is an idle timeout, not a deadline for the entire transfer:
        // slow connections must not lose a chunk while bytes keep arriving.
        const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), timeoutMs); };
        resetTimer();
        const started = Date.now();
        try {
          const response = await fetchImpl(key, {
            headers: { Range: `bytes=${start}-${end}` },
            signal: controller.signal,
          });
          if (response.status !== 206 && response.status !== 200) throw new Error(`HTTP ${response.status}`);
          if (response.status === 206 && response.headers.get('Content-Range') !== `bytes ${start}-${end}/${asset.bytes}`) {
            throw new Error('Unexpected asset range; the file may have changed.');
          }
          // Development servers may ignore Range and send the entire file.
          const wholeFile = response.status === 200;
          const expected = wholeFile ? asset.bytes : end - start + 1;
          const reader = response.body.getReader();
          let received = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            resetTimer();
            if (received + value.length > expected) throw new Error('Oversized asset response.');
            // A failed chunk is overwritten from the same offset on retry.
            entry.buffer.set(value, (wholeFile ? 0 : start) + received);
            received += value.length;
          }
          if (received !== expected) throw new Error('Incomplete asset download.');
          entry.offset = wholeFile ? asset.bytes : end + 1;
          const elapsed = Date.now() - started;
          if (elapsed < 4000) entry.chunkBytes = Math.min(maxChunkBytes, entry.chunkBytes * 2);
          else if (elapsed > 12000) entry.chunkBytes = Math.max(Math.min(chunkBytes, 64 * 1024), Math.floor(entry.chunkBytes / 2));
          failure = null;
          onProgress?.();
          break;
        } catch (error) {
          controller.abort();
          failure = error;
        } finally {
          clearTimeout(timer);
        }
        if (attempt + 1 < attempts) await sleep(750 * 2 ** attempt);
      }
      if (failure) throw new AssetDownloadError(asset.url, failure);
    }
    if (asset.url.endsWith('.glb')) {
      const view = new DataView(entry.buffer.buffer);
      if (view.byteLength < 12 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== asset.bytes) {
        entries.delete(key);
        throw new AssetDownloadError(asset.url, new Error('Invalid GLB data.'));
      }
    }
    return entry.buffer.buffer;
  }

  async function prepare(assets, { onProgress, onAsset, concurrency = 2 } = {}) {
    const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
    const report = () => onProgress?.(assets.reduce((sum, asset) => sum + (entries.get(`${asset.url}?v=${asset.version}`)?.offset ?? 0), 0) / total);
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
    report();
    await Promise.all(Array.from({ length: Math.min(concurrency, assets.length) }, worker));
    if (failure) throw failure;
  }
  return { prepare, clear: () => entries.clear() };
}
