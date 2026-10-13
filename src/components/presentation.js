import { clamp, smooth } from './journey.js';

export const PRESENTATION_CHAINS = {
  arm_stretch_l_013: 'forearm_stretch_l_016',
  forearm_stretch_l_016: 'hand_l_019',
  hand_l_019: 'middle1_l_021',
  arm_stretch_r_036: 'forearm_stretch_r_038',
  forearm_stretch_r_038: 'hand_r_041',
  hand_r_041: 'middle1_r_043',
};

// One hand frames the description above, the other presents it below.
// Mirrored in character space rather than reusing unlike local bone axes.
export function presentationDirection(name, side) {
  const raised = side > 0 ? name.includes('_l_') : name.includes('_r_');
  if (name.startsWith('arm_')) return raised ? [side * 0.8, 0.3, 0.2] : [side * 0.42, -0.75, 0.28];
  if (name.startsWith('forearm_')) return raised ? [side * 0.6, 0.65, 0.2] : [side * 0.85, 0.28, 0.35];
  return [side * 0.8, raised ? 0.32 : 0.12, 0.25];
}

export function presentationNearDescription(guide, rectangles, width, height) {
  const x = guide[0] * width, y = (guide[1] - 0.12) * height;
  let best = { weight: 0, side: 1 };
  for (const rect of rectangles) {
    if (rect.bottom <= 0 || rect.top >= height || (x >= rect.left - 12 && x <= rect.right + 12)) continue;
    const verticalGap = Math.max(rect.top - y, y - rect.bottom, 0);
    const horizontalGap = Math.max(rect.left - x, x - rect.right, 0);
    const weight = smooth(1 - clamp(verticalGap / (height * 0.22)))
      * smooth(1 - clamp(horizontalGap / (width * 0.55)));
    if (weight > best.weight) best = { weight, side: x < rect.left ? 1 : -1 };
  }
  return best;
}
