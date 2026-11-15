// Drives the loading screen. The time limit uses the page clock (time since
// navigation), because shader compilation can stall animation frames.
// The percentage follows real progress (it never
// completes on a timer), but the screen itself is time-boxed: after
// MAX_SCREEN_MS, or SKIP, it docks into a slim bottom strip and the page opens.
import { createRollingNumber } from './rollingNumber.js';

export const MIN_VISIBLE_MS = 900;
export const MAX_SCREEN_MS = 8000;
// Shader preparation blocks the page anyway, so if the guide is already in
// that final step at the limit, let it finish, up to this hard limit.
export const HARD_MAX_SCREEN_MS = 12000;
const COMPLETION_HOLD_MS = 150;
const LAUNCH_MS = 380;
const REVEAL_MS = 800;
const DOCKED_HIDE_MS = 1400;
const LABELS = { loading: 'DOWNLOADING THE GUIDE', preparing: 'PREPARING THE SCENE', ready: 'READY FOR LAUNCH' };

export function initLoadScreen() {
  const root = document.getElementById('boot-hud');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const $ = id => document.getElementById(id);
  const label = $('boot-label');
  const smallPercent = $('boot-small-percent');
  const skip = $('boot-skip');
  const retry = $('boot-retry');
  const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const digits = createRollingNumber($('boot-digits'), { reducedMotion });
  let lastFrame = performance.now();
  let visible = 0; // ms the screen has been visible (background tabs don't count)
  let preparingSince = null;
  let actual = 0;
  let displayed = 0;
  let shown = 0;
  let ready = false;
  let failed = false;
  let holdStarted = null;
  let phase = 'loading'; // loading -> complete -> launch -> revealing -> gone; or docked
  let raf = 0;

  const unlock = () => document.documentElement.classList.remove('portfolio-booting');

  function read() {
    if (failed) return;
    const stage = root.dataset.stage;
    if (stage === 'error') {
      failed = true;
      root.dataset.presentation = 'error';
      label.textContent = '3D UNAVAILABLE';
      retry.hidden = false;
      skip.textContent = 'CONTINUE →';
      skip.style.animation = 'none';
      skip.style.opacity = '1';
      return;
    }
    actual = Math.max(actual, Math.min(.99, Number(root.dataset.progress) || 0));
    ready = stage === 'ready';
    if (stage === 'preparing' && preparingSince === null) preparingSince = visible;
    if (phase === 'loading' || phase === 'docked') label.textContent = LABELS[stage] || LABELS.loading;
  }

  function later(callback, delay) { window.setTimeout(callback, delay); }

  function gone() {
    phase = 'gone';
    cancelAnimationFrame(raf);
    window.removeEventListener('portfolio:boot', read);
    root.hidden = true;
  }

  function reveal() {
    phase = 'revealing';
    root.dataset.presentation = 'revealing';
    unlock();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    window.dispatchEvent(new Event('portfolio:revealing'));
    later(gone, reducedMotion ? 50 : REVEAL_MS + 100);
  }

  function launch() {
    phase = 'launch';
    root.dataset.presentation = 'launch';
    later(reveal, reducedMotion ? 0 : LAUNCH_MS);
  }

  // Stop covering the page; keep reporting progress in a slim strip.
  function dock() {
    if (phase !== 'loading' && phase !== 'complete') return;
    phase = 'docked';
    root.dataset.docked = 'true';
    if (!failed) root.dataset.presentation = 'loading';
    root.setAttribute('aria-label', 'Loading the 3D scene');
    unlock();
    window.dispatchEvent(new Event('portfolio:revealing'));
  }

  function show(integer) {
    if (integer === shown) return;
    shown = integer;
    digits.set(integer);
    smallPercent.textContent = `${integer}%`;
    root.setAttribute('aria-valuenow', String(integer));
  }

  function frame(now) {
    if (phase === 'gone') return;
    const delta = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (!document.hidden) visible += delta * 1000;
    if (!failed && (phase === 'loading' || phase === 'complete' || phase === 'docked')) {
      // Shader preparation reports no bytes; creep honestly toward (not to) 100.
      const creep = preparingSince === null ? 0 : Math.min(.12, (visible - preparingSince) / 1000 * .03);
      const timeCap = phase === 'docked' ? 1 : Math.min(1, visible / MIN_VISIBLE_MS);
      const goal = Math.min(ready ? 1 : Math.min(.97, actual + creep), timeCap);
      const gap = Math.max(0, goal - displayed);
      displayed += Math.min(gap, Math.max(gap * (1 - Math.exp(-delta * (ready ? 10 : 5))), .3 * delta), 1.6 * delta);
      if (ready && gap < .005 && timeCap === 1) displayed = 1;
      root.style.setProperty('--p', displayed.toFixed(4));
      show(displayed === 1 ? 100 : Math.min(99, Math.floor(displayed * 100)));
      if (displayed === 1 && phase === 'docked') {
        phase = 'gone-soon';
        root.dataset.presentation = 'done';
        label.textContent = '3D READY';
        later(gone, DOCKED_HIDE_MS);
        return;
      }
      if (displayed === 1 && phase !== 'docked') {
        if (holdStarted === null) { holdStarted = visible; phase = 'complete'; root.dataset.presentation = 'complete'; label.textContent = LABELS.ready; }
        if (visible - holdStarted >= COMPLETION_HOLD_MS) launch();
      } else if (phase !== 'docked' && !ready && now >= (root.dataset.stage === 'preparing' ? HARD_MAX_SCREEN_MS : MAX_SCREEN_MS)) {
        dock();
      }
    }
    raf = requestAnimationFrame(frame);
  }

  skip.addEventListener('click', () => {
    if (failed && !root.dataset.docked) { phase = 'gone'; unlock(); root.hidden = true; return; }
    dock();
  });
  retry.addEventListener('click', () => window.location.reload());
  window.addEventListener('portfolio:boot', read);
  read();
  raf = requestAnimationFrame(frame);
}
