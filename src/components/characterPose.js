import { LoopOnce } from 'three';
import { sampleArrival, smooth, clamp } from './journey.js';

export function sampleCharacterPose(actions, progress, hoverTime = 0.25) {
  const arrival = sampleArrival(progress);
  // Blend the looping guide into the original scroll-sampled flight clip.
  // Both phases use the original flight FBX. The character wrapper turns
  // the guide upright and releases that correction smoothly on departure.
  const guideBlend = 1 - smooth(progress / 0.06);
  const weights = { hovering: arrival.flightWeight * guideBlend,
    flying: arrival.flightWeight * (1 - guideBlend),
    landing: arrival.landingWeight, seated: arrival.seatedWeight };
  const times = { hovering: hoverTime, flying: clamp(progress / 0.52), landing: arrival.landingTime, seated: arrival.seatedTime };
  for (const [name, action] of Object.entries(actions)) {
    action.enabled = true;
    action.paused = false;
    action.stopFading().setEffectiveWeight(weights[name]);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveTimeScale(0);
    action.time = times[name] * Math.max(0, action.getClip().duration - 0.001);
    action.play();
  }
}
