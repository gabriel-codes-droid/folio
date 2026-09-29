const CHUNK_BYTES = 2 * 1024 * 1024;
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
  attempts = 4,
  timeoutMs = 45000,
  sleep = pause,
} = {}) {
  const entries = new Map();
  async function download(asset, onProgress) {
    const key = `${asset.url}?v=${asset.version}`;
    let entry = entries.get(key);
    if (!entry) {
      entry = { buffer: new Uint8Array(asset.bytes), offset: 0 };
      entries.set(key, entry);
    }
    while (entry.offset < asset.bytes) {
      const start = entry.offset;
      const end = Math.min(start + chunkBytes, asset.bytes) - 1;
      let failure;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(key, {
            headers: { Range: `bytes=${start}-${end}` },
            signal: controller.signal,
          });
          if (response.status !== 206 && response.status !== 200) throw new Error(`HTTP ${response.status}`);
          if (response.status === 206 && response.headers.get('Content-Range') !== `bytes ${start}-${end}/${asset.bytes}`) {
            throw new Error('Unexpected asset range; the file may have changed.');
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          // Development servers may ignore Range and send the entire file.
          const wholeFile = response.status === 200;
          if (bytes.length !== (wholeFile ? asset.bytes : end - start + 1)) throw new Error('Incomplete asset download.');
          entry.buffer.set(bytes, wholeFile ? 0 : start);
          entry.offset = wholeFile ? asset.bytes : end + 1;
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
