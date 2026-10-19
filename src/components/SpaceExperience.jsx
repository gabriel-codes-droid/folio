import { useCallback, useEffect, useState } from 'react';
import { Cache } from 'three';
import { STAGE_ASSETS, STAGE_ORDER } from './sceneStages';
import { JOURNEY_SCROLL_HEIGHT } from './sceneConstants';
import { markStageReady, onSceneProgress, releaseStage, sceneDownload } from './sceneDownloads';

const imports = {
  opening: () => import('./SpaceCanvas'),
  moon: () => import('./MoonScene'),
};

// Downloads were started by the boot script; this hands the buffers to
// three's loaders and mounts each stage as it arrives. The page opens with
// the guide; the moon and planets join while the visitor reads the intro.
export default function SpaceExperience() {
  const [components, setComponents] = useState({});
  const [readyStages, setReadyStages] = useState({});
  const [groups, setGroups] = useState({ destination: 0 });
  const [errors, setErrors] = useState({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => onSceneProgress(setGroups), []);
  useEffect(() => {
    let active = true;
    for (const stage of STAGE_ORDER) {
      sceneDownload(stage)
        .then(buffers => {
          Cache.enabled = true;
          for (const [url, buffer] of buffers) Cache.add(`file:${url}`, buffer);
          return imports[stage]();
        })
        .then(module => { if (active) setComponents(previous => ({ ...previous, [stage]: module.default })); })
        .catch(error => {
          console.error(`${stage} preparation failed`, error);
          if (active) setErrors(previous => ({ ...previous, [stage]: 'This stage could not load. Please retry.' }));
        });
    }
    return () => { active = false; };
  }, [attempt]);

  const onPrepared = useCallback(completed => {
    performance.mark(`space:${completed}:ready`);
    releaseStage(completed);
    for (const asset of STAGE_ASSETS[completed]) Cache.remove(`file:${asset.url}`);
    markStageReady(completed);
    setReadyStages(previous => previous[completed] ? previous : ({ ...previous, [completed]: Math.round(performance.now()) }));
  }, []);
  const retry = () => { setErrors({}); setAttempt(value => value + 1); };
  const moonStatus = { progress: groups.destination, error: errors.moon || '' };
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
