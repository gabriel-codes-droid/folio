import { createAssetDownloads } from './assetDownloads.js';
import { STAGE_ASSETS } from './sceneStages.js';
import { bootProgress, groupBytes, reportBoot } from './bootProgress.js';

// Plain module with no three.js or React: the boot script starts downloads
// the moment the page opens, instead of after ~1 MB of scene JavaScript.
// The guide downloads first with full bandwidth; the moon follows.
const jobs = {};
const received = {};
const ready = {};
const listeners = new Set();
let failure = '';

function publish() {
  const groups = groupBytes(received);
  if (failure) reportBoot('error', 0, failure);
  else {
    const { stage, progress } = bootProgress(groups, ready);
    reportBoot(stage, progress, '', {
      guide: groups.guide, moon: groups.moon, planets: groups.planets, gpu: ready.opening ? 1 : 0,
    });
  }
  listeners.forEach(listener => listener(groups));
}

function run(stage) {
  const job = jobs[stage] ??= { downloads: createAssetDownloads(), buffers: new Map() };
  job.promise ??= job.downloads.prepare(STAGE_ASSETS[stage], {
    concurrency: 4,
    onProgress: (_, bytes) => { Object.assign(received, bytes); publish(); },
    onAsset: (asset, buffer) => job.buffers.set(asset.url, buffer),
  }).then(() => job.buffers).catch(error => {
    job.promise = null;
    // Only the guide can block the page; moon failures surface in the scene.
    if (stage === 'opening') { failure = 'Something couldn’t load. Please try again.'; publish(); }
    throw error;
  });
  return job.promise;
}

export function sceneDownload(stage) {
  if (stage !== 'moon') return run(stage);
  return (jobs.opening?.promise ?? run('opening')).catch(() => {}).then(() => run('moon'));
}

export function startSceneDownloads() {
  sceneDownload('opening').catch(() => {});
  sceneDownload('moon').catch(() => {});
}

export function markStageReady(stage) {
  if (ready[stage]) return;
  ready[stage] = true;
  publish();
}

export function releaseStage(stage) {
  jobs[stage]?.downloads.clear();
  jobs[stage]?.buffers.clear();
}

export function onSceneProgress(listener) {
  listeners.add(listener);
  listener(groupBytes(received));
  return () => listeners.delete(listener);
}
