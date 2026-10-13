import { LoopOnce } from 'three';
import { sampleArrival } from './journey.js';

export function sampleCharacterPose(actions, progress) {
  const arrival = sampleArrival(progress);
  const weights = { hovering: arrival.flightWeight, landing: arrival.landingWeight, seated: arrival.seatedWeight };
  const times = { hovering: 0.25, landing: arrival.landingTime, seated: arrival.seatedTime };
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
