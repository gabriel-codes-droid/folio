import { useCallback, useEffect, useState } from 'react';
import { Cache } from 'three';
import { createAssetDownloads } from './assetDownloads';
import { STAGE_ASSETS, STAGE_ORDER } from './sceneStages';
import { JOURNEY_SCROLL_HEIGHT } from './sceneConstants';
import { reportBoot } from './SceneReady';
import { bootProgress, groupBytes } from './bootProgress';

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
      concurrency: 4,
      onProgress,
      onAsset: (asset, buffer) => Cache.add(`file:${asset.url}`, buffer),
    }).then(imports[stage]).catch(error => { job.promise = null; throw error; });
  }
  return job.promise;
}

// Every stage downloads at once and the boot curtain stays down until the
// guide, the moon and all four planets are parsed and warmed on the GPU.
// Nothing streams in after the page opens, so the journey never stalls.
export default function SpaceExperience() {
  const [components, setComponents] = useState({});
  const [readyStages, setReadyStages] = useState({});
  const [received, setReceived] = useState({});
  const [errors, setErrors] = useState({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    for (const stage of STAGE_ORDER) {
      prepareStage(stage, (_, bytes) => { if (active) setReceived(previous => ({ ...previous, ...bytes })); })
        .then(module => { if (active) setComponents(previous => ({ ...previous, [stage]: module.default })); })
        .catch(error => {
          console.error(`${stage} preparation failed`, error);
          if (active) setErrors(previous => ({ ...previous, [stage]: 'This stage could not load. Please retry.' }));
        });
    }
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    const failure = Object.values(errors)[0];
    if (failure) { reportBoot('error', 0, failure); return; }
    const groups = groupBytes(received);
    const { stage, progress } = bootProgress(groups, readyStages);
    reportBoot(stage, progress, '', {
      guide: groups.guide, moon: groups.moon, planets: groups.planets,
      gpu: (readyStages.opening ? 0.5 : 0) + (readyStages.moon ? 0.5 : 0),
    });
  }, [received, readyStages, errors]);

  const onPrepared = useCallback(completed => {
    performance.mark(`space:${completed}:ready`);
    jobs.get(completed)?.downloads.clear();
    for (const asset of STAGE_ASSETS[completed]) Cache.remove(`file:${asset.url}`);
    setReadyStages(previous => previous[completed] ? previous : ({ ...previous, [completed]: Math.round(performance.now()) }));
  }, []);
  const retry = () => { setErrors({}); setAttempt(value => value + 1); };
  const moonStatus = { progress: groupBytes(received).moon, error: errors.moon || '' };
  const Scene = components.opening;
  if (Scene) return <Scene onStagePrepared={onPrepared}
    stages={components} readyStages={readyStages} stageStatus={moonStatus} onRetry={retry} />;
  return (
    <section className="space-region" id="space-experience" aria-label="Interactive project journey">
      <div className="space-stage" />
      <div style={{ height: JOURNEY_SCROLL_HEIGHT }} />
    </section>
  );
}
