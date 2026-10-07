import { useEffect, useState } from 'react';
import { Cache } from 'three';
import { SCENE_ASSETS } from '../data/sceneAssets';
import { createAssetDownloads } from './assetDownloads';

const downloads = createAssetDownloads();
let preparation;
const listeners = new Set();
let progress = 0;
function prepareScene() {
  if (!preparation) {
    Cache.enabled = true;
    preparation = downloads.prepare(SCENE_ASSETS, {
      // Vercel's edge can serve several immutable model files concurrently;
      // keep the loader's default of two for constrained callers, while the
      // portfolio warms its scene with a third stream to reduce request wait.
      concurrency: 3,
      onProgress: value => { progress = value; for (const listener of listeners) listener(value); },
      onAsset: (asset, buffer) => Cache.add(`file:${asset.url}`, buffer),
    }).then(() => import('./SpaceCanvas')).catch(error => {
      preparation = null;
      throw error;
    });
  }
  return preparation;
}

function releaseDownloads() {
  downloads.clear();
  for (const asset of SCENE_ASSETS) Cache.remove(`file:${asset.url}`);
}

export default function SpaceExperience() {
  const [Scene, setScene] = useState(null);
  const [status, setStatus] = useState({ progress, error: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const update = value => { if (active) setStatus({ progress: value, error: '' }); };
    listeners.add(update);
    update(progress);
    prepareScene().then(module => { if (active) setScene(() => module.default); }).catch(error => {
      console.error('Scene asset download failed', error);
      if (active) setStatus(previous => ({ ...previous, error: error.message }));
    });
    return () => { active = false; listeners.delete(update); };
  }, [attempt]);

  if (Scene) return <Scene initialProgress={0.75} onPrepared={releaseDownloads} />;
  // Preserve exactly the scene's scroll footprint while downloading. Only
  // import the model components after their binary data is cached, so their
  // module-scope preloads cannot start a competing request avalanche.
  return (
    <section className="space-region" id="space-experience" aria-label="Interactive project journey">
      <div className="space-stage">
        <div className="space-status" role="status">
          {status.error || 'PREPARING EXPERIENCE'}
          <progress value={status.progress * 0.75} max="1" aria-label="Preparing the 3D experience" />
          <span>{Math.floor(status.progress * 75)}%</span>
          {status.error && <button onClick={() => setAttempt(value => value + 1)}>Retry experience</button>}
        </div>
      </div>
      <div style={{ height: '520vh' }} />
    </section>
  );
}
