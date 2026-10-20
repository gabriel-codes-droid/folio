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
  return { guide, compact, presentation: presentationNearDescription(guide, descriptions, window.innerWidth, height) };
}
