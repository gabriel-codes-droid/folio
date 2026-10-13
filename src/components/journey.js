import { HOP_WAYPOINTS, LAUNCH_POINT, FLIGHT_APEX, MOON_SEAT_POSITION, PLANET_ROW_Z } from './sceneConstants.js';

export const PHASE_BANDS = [
  { end: 0.08, phase: 'sleeping' },
  { end: 0.18, phase: 'waking' },
  { end: 0.30, phase: 'idle' },
  { end: 0.46, phase: 'hopping' },
  { end: 0.54, phase: 'launching' },
  { end: 0.78, phase: 'flying' },
  { end: 0.88, phase: 'landing' },
  { end: 1, phase: 'seated' },
];
export const clamp = value => Math.min(1, Math.max(0, value));
export const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// One reversible timeline for descent, touchdown and sitting. Finish the
// descent before folding into the seated pose; no wall-clock restart on entry.
export function sampleArrival(progress) {
  const touchdown = smooth((progress - 0.78) / 0.055);
  const seatedWeight = smooth((progress - 0.835) / 0.045);
  const flightWeight = 1 - smooth((progress - 0.78) / 0.02);
  return {
    touchdown,
    seatedWeight,
    flightWeight,
    landingWeight: (1 - flightWeight) * (1 - seatedWeight),
    landingTime: clamp((progress - 0.78) / 0.055),
    seatedTime: seatedWeight,
    cameraBlend: smooth((progress - 0.70) / 0.18),
  };
}
// Give the hops 50% more scroll distance while retaining the authored camera,
// pose and world-path timeline. All consumers receive this same playhead.
export function pacedJourneyProgress(scroll) {
  const distance = clamp(scroll) * 1.08;
  if (distance <= 0.30) return distance;
  if (distance <= 0.54) return 0.30 + (distance - 0.30) / 1.5;
  return Math.min(1, distance - 0.08);
}
export function phaseForProgress(progress) {
  return PHASE_BANDS.find(band => progress < band.end)?.phase || 'seated';
}

// The hop sequence is staged for a front/three-quarter camera: the mech keeps
// its chest toward the viewer while crossing the cubes, then turns in flight
// toward the planet row.  The authored bot faces +Z at yaw 0.
const HOP_FACING_YAW = 0;

// Every branch meets the next at the same world position. No wall-clock hop
// index: wheel speed and reverse scrolling cannot skip or teleport the route.
export function sampleJourney(progress, position) {
  const p = clamp(progress);
  const count = HOP_WAYPOINTS.length - 1;
  const facing = Math.atan2(-MOON_SEAT_POSITION[0], PLANET_ROW_Z - MOON_SEAT_POSITION[2]);
  if (p < 0.30) {
    position.fromArray(HOP_WAYPOINTS[0]);
    return HOP_FACING_YAW;
  }
  if (p < 0.46) {
    const route = clamp((p - 0.30) / 0.16) * count;
    const index = Math.min(count - 1, Math.floor(route));
    const local = route - index;
    const from = HOP_WAYPOINTS[index], to = HOP_WAYPOINTS[index + 1];
    // A brief contact beat at both ends makes each surface landing readable.
    const t = smooth((local - 0.10) / 0.80);
    position.set(from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * 0.9,
      from[2] + (to[2] - from[2]) * t);
    // Keep the mech facing the front while hopping. The camera does the
    // three-quarter reveal; the body should not look like it is running away.
    return HOP_FACING_YAW;
  }
  if (p < 0.54) {
    const t = smooth((p - 0.46) / 0.08);
    position.set(LAUNCH_POINT[0], LAUNCH_POINT[1] + (FLIGHT_APEX[1] - LAUNCH_POINT[1]) * t, LAUNCH_POINT[2]);
    return HOP_FACING_YAW;
  }
  if (p < 0.78) {
    const t = smooth((p - 0.54) / 0.24);
    position.set(FLIGHT_APEX[0] + (MOON_SEAT_POSITION[0] - FLIGHT_APEX[0]) * t,
      FLIGHT_APEX[1] + (MOON_SEAT_POSITION[1] + 1.2 - FLIGHT_APEX[1]) * t,
      FLIGHT_APEX[2] + (MOON_SEAT_POSITION[2] - FLIGHT_APEX[2]) * t);
    // No dedicated turn FBX is present in public/models. Blend the existing
    // flight clip with a deterministic shortest-path yaw so the turn reads as
    // an intentional in-flight orientation change rather than a snap.
    const turn = Math.atan2(Math.sin(facing - HOP_FACING_YAW), Math.cos(facing - HOP_FACING_YAW));
    return HOP_FACING_YAW + turn * t;
  }
  position.fromArray(MOON_SEAT_POSITION);
  if (p < 0.88) position.y += 1.2 * (1 - sampleArrival(p).touchdown);
  return facing;
}
