import { useCallback, useEffect, useState } from 'react';
import { Cache } from 'three';
import { createAssetDownloads } from './assetDownloads';
import { STAGE_ASSETS, STAGE_ORDER } from './sceneStages';
import { JOURNEY_SCROLL_HEIGHT } from './sceneConstants';

const imports = {
  opening: () => import('./SpaceCanvas'),
  moon: () => import('./MoonScene'),
};
const jobs = new Map();
function prepareStage(stage, onProgress) {
  if (!jobs.has(stage)) jobs.set(stage, { downloads: createAssetDownloads() });
  const job = jobs.get(stage);
  if (!job.promise) {
    Cache.enabled = true;
    job.promise = job.downloads.prepare(STAGE_ASSETS[stage], {
      concurrency: 3,
      onProgress,
      onAsset: (asset, buffer) => Cache.add(`file:${asset.url}`, buffer),
    }).then(imports[stage]).catch(error => { job.promise = null; throw error; });
  }
  return job.promise;
}

export default function SpaceExperience() {
  const [components, setComponents] = useState({});
  const [readyStages, setReadyStages] = useState({});
  const [stage, setStage] = useState('opening');
  const [status, setStatus] = useState({ progress: 0, error: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!stage) return;
    let active = true;
    setStatus({ progress: 0, error: '' });
    prepareStage(stage, progress => { if (active) setStatus({ progress, error: '' }); })
      .then(module => { if (active) setComponents(previous => ({ ...previous, [stage]: module.default })); })
      .catch(error => {
        console.error(`${stage} preparation failed`, error);
        if (active) setStatus(previous => ({ ...previous, error: 'This stage could not load. Please retry.' }));
      });
    return () => { active = false; };
  }, [stage, attempt]);

  const onPrepared = useCallback(completed => {
    performance.mark(`space:${completed}:ready`);
    jobs.get(completed)?.downloads.clear();
    for (const asset of STAGE_ASSETS[completed]) Cache.remove(`file:${asset.url}`);
    setReadyStages(previous => ({ ...previous, [completed]: Math.round(performance.now()) }));
    setStage(current => current === completed ? STAGE_ORDER[STAGE_ORDER.indexOf(completed) + 1] : current);
  }, []);
  const retry = () => setAttempt(value => value + 1);
  const Scene = components.opening;
  if (Scene) return <Scene initialProgress={0.75} onStagePrepared={onPrepared}
    stages={components} readyStages={readyStages} stageStatus={status} onRetry={retry} />;
  return (
    <section className="space-region" id="space-experience" aria-label="Interactive project journey">
      <div className="space-stage">
        <div className="space-status" role="status">
          {status.error || 'PREPARING YOUR EXPLORATION'}
          <progress value={status.progress * 0.75} max="1" aria-label="Preparing the opening scene" />
          <span>{Math.floor(status.progress * 75)}%</span>
          <a href="#contact">Get in touch while space prepares ↗</a>
          {status.error && <button onClick={retry}>Retry experience</button>}
        </div>
      </div>
      <div style={{ height: JOURNEY_SCROLL_HEIGHT }} />
    </section>
  );
}
