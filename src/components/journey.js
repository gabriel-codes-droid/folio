import { MOON_SEAT_POSITION, PLANET_ROW_Z } from './sceneConstants.js';

export const clamp = value => Math.min(1, Math.max(0, value));
export const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
export const PHASE_BANDS = [
  { end: 0.05, phase: 'hovering' },
  { end: 0.52, phase: 'flying' },
  { end: 0.84, phase: 'landing' },
  { end: 1, phase: 'seated' },
];
export const phaseForProgress = p => PHASE_BANDS.find(band => p < band.end)?.phase || 'seated';

// Keep over a third of the project section for browsing after arrival.
export function pacedJourneyProgress(scroll) {
  const p = clamp(scroll);
  return p <= 0.65 ? p / 0.65 * 0.84 : 0.84 + (p - 0.65) / 0.35 * 0.16;
}

// Begin the departure while the star field enters the viewport, not after
// its upper edge has already reached the top and the guide has waited there.
export function spaceJourneyProgress(sectionTop, sectionHeight, viewportHeight) {
  const lead = viewportHeight * 0.85;
  return pacedJourneyProgress((lead - sectionTop) / Math.max(1, sectionHeight - viewportHeight + lead));
}

export function sceneExitInset(sectionBottom, viewportHeight) {
  return Math.min(viewportHeight, Math.max(0, viewportHeight - sectionBottom));
}

export function sampleArrival(progress) {
  const touchdown = smooth((progress - 0.52) / 0.16);
  const seatedWeight = smooth((progress - 0.68) / 0.16);
  const flightWeight = 1 - smooth((progress - 0.52) / 0.055);
  return { touchdown, seatedWeight, flightWeight,
    landingWeight: (1 - flightWeight) * (1 - seatedWeight),
    landingTime: clamp((progress - 0.52) / 0.16),
    seatedTime: seatedWeight,
    cameraBlend: smooth(progress / 0.84),
  };
}

// Arrival starts from the same projected position used beside Selected Work.
// This is evaluated in both directions; no jumps, bounces or hop indices.
export function sampleJourney(progress, position, departure = [3, MOON_SEAT_POSITION[1] + 4, -2]) {
  const p = clamp(progress);
  const travel = smooth(p / 0.52);
  if (p < 0.52) {
    position.set(departure[0] * (1 - travel),
      departure[1] + (MOON_SEAT_POSITION[1] + 1.2 - departure[1]) * travel,
      departure[2] + (MOON_SEAT_POSITION[2] - departure[2]) * travel);
  } else {
    position.fromArray(MOON_SEAT_POSITION);
    position.y += 1.2 * (1 - sampleArrival(p).touchdown);
  }
  const facing = Math.atan2(-MOON_SEAT_POSITION[0], PLANET_ROW_Z - MOON_SEAT_POSITION[2]);
  return -0.12 + (facing + 0.12) * smooth(p / 0.45);
}

// Screen positions live in the open areas beside the name and between cards.
export function sampleGuide(scroll, stops, compact = false) {
  const anchors = compact
    ? [[0.22, 0.72], [0.24, 0.65], [0.24, 0.65], [0.52, 0.60], [0.22, 0.60], [0.22, 0.65]]
    : [[0.34, 0.80], [0.28, 0.65], [0.28, 0.65], [0.58, 0.60], [0.24, 0.60], [0.24, 0.72]];
  for (let i = 0; i < stops.length - 1; i++) {
    if (scroll <= stops[i + 1]) {
      const t = smooth((scroll - stops[i]) / Math.max(1, stops[i + 1] - stops[i]));
      return anchors[i].map((value, axis) => value + (anchors[i + 1][axis] - value) * t);
    }
  }
  return anchors[anchors.length - 1];
}
