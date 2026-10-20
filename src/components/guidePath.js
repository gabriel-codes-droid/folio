import { sampleGuide } from './journey.js';
import { presentationNearDescription } from './presentation.js';

// Where the guide sits on screen for the current scroll, shared by the live
// 3D guide and its still placeholder so both follow exactly the same path.
// Stay in the outer margin until hero copy has passed, then cross into the
// gap between cards. Leave that gap only after the last card passes.
export function guideView() {
  const height = window.innerHeight;
  const scroll = window.scrollY;
  const services = document.getElementById('services')?.getBoundingClientRect();
  const work = document.getElementById('work')?.getBoundingClientRect();
  const hero = document.getElementById('about')?.getBoundingClientRect();
  const stops = [0, height * 0.25, (hero?.bottom || height) + scroll,
    (services?.top || 0) + scroll + height * 0.7,
    (services?.bottom || 0) + scroll, (work?.top || 0) + scroll + height * 0.4];
  for (let i = 1; i < stops.length; i++) stops[i] = Math.max(stops[i], stops[i - 1] + 1);
  const compact = window.innerWidth < 700;
  const guide = sampleGuide(scroll, stops, compact);
  const descriptions = [...document.querySelectorAll('.hero-copy, .capability article')].map(element => element.getBoundingClientRect());
  return { guide, compact, stops, scroll, presentation: presentationNearDescription(guide, descriptions, window.innerWidth, height) };
}

// Smoothing is applied to the scroll position the guide follows, not to its
// screen position: easing the position cut corners and lagged in opposite
// directions going down and up, so the two paths differed. Easing the scroll
// keeps the guide exactly on the path, merely a moment behind, both ways.
const FOLLOW_RATE = 2.4;
export function followScroll(current, target, delta) {
  return current + (target - current) * (1 - Math.exp(-Math.min(Math.max(delta, 0), 0.05) * FOLLOW_RATE));
}
export const guideAt = (scroll, view) => sampleGuide(scroll, view.stops, view.compact);

// The still guide records its followed scroll so the live guide can take
// over from the exact same point on the path.
export const sharedFollow = { scroll: null };
