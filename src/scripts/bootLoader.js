// The visual percentage follows actual preparation and never completes on a
// timer alone. A cached load still gets a short, legible launch.
import { createNumberSwap, SWAP_INTERVAL } from './numberSwap.js';

const MIN_VISIBLE_MS = 800;
const COMPLETION_HOLD_MS = 220;
const LAUNCH_MS = 520;
const REVEAL_MS = 1100;
const MOON_DISTANCE_KM = 384400;
const ROWS = ['guide', 'moon', 'planets', 'gpu'];

const formatKm = value => Math.round(value).toString().padStart(6, '0').replace(/(\d{3})(\d{3})$/, '$1 $2');
const formatClock = ms => {
  const total = Math.floor(ms / 10);
  const centis = total % 100, seconds = Math.floor(total / 100) % 60, minutes = Math.floor(total / 6000);
  return `T+ ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
};

export function initBootLoader() {
  const root = document.getElementById('boot-hud');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const $ = id => document.getElementById(id);
  const panel = $('boot-panel');
  const progressbar = $('boot-progress');
  const rocket = $('boot-rocket');
  const trail = $('boot-trail');
  const altitude = $('boot-altitude');
  const clock = $('boot-clock');
  const announcement = $('boot-announcement');
  const error = $('boot-error');
  const stars = [...root.querySelectorAll('.boot-stars')];
  const rows = Object.fromEntries(ROWS.map(key => [key, root.querySelector(`[data-row="${key}"]`)]));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const counter = createNumberSwap($('boot-number'), reducedMotion);
  const started = performance.now();
  let lastFrame = started;
  let visibleTime = 0;
  let displayed = 0;
  let shown = 0;
  let lastSwapAt = -Infinity;
  let actual = 0;
  let ready = false;
  let failed = false;
  let pageLoaded = document.readyState === 'complete';
  let fontsLoaded = !document.fonts;
  let holdStarted = null;
  let phase = 'loading';
  let disposed = false;
  let raf = 0;
  let timers = [];
  const rowState = {};

  // Star layers drift on the compositor; only their playback rate changes,
  // so they stay smooth while models parse on the main thread.
  const drift = reducedMotion ? [] : stars.map((layer, index) => layer.animate?.(
    [{ transform: 'translate3d(0, -50%, 0)' }, { transform: 'translate3d(0, 0, 0)' }],
    { duration: index ? 9000 : 16000, iterations: Infinity },
  )).filter(Boolean);

  const markPageLoaded = () => { pageLoaded = true; };
  window.addEventListener('load', markPageLoaded, { once: true });
  if (document.fonts) document.fonts.ready.then(() => { fontsLoaded = true; });

  function readProgress() {
    if (disposed) return;
    if (root.dataset.stage === 'error') {
      failed = true;
      error.hidden = false;
      root.dataset.presentation = 'error';
      announcement.textContent = root.dataset.error || 'Something couldn’t load. Please try again.';
      root.setAttribute('aria-busy', 'false');
      return;
    }
    actual = Math.max(actual, Math.min(.99, Number(root.dataset.progress) || 0));
    ready = root.dataset.stage === 'ready';
    for (const key of ROWS) {
      const value = Math.max(rowState[key] ?? 0, Math.min(1, Number(root.dataset[key]) || 0));
      if (value === rowState[key] || !rows[key]) continue;
      rowState[key] = value;
      const status = rows[key].querySelector('.boot-row-status');
      const bar = rows[key].querySelector('.boot-row-bar');
      rows[key].dataset.state = value >= 1 ? 'done' : value > 0 ? 'active' : 'queued';
      if (status) status.textContent = value >= 1 ? (key === 'gpu' ? 'READY' : 'LOADED') : value > 0 ? `${Math.floor(value * 100)}%` : 'QUEUED';
      if (bar) bar.style.transform = `scaleX(${value})`;
    }
    // Shaders compile as one step after the guide arrives; say so.
    if (rows.gpu && !rowState.gpu && rowState.guide >= 1 && rows.gpu.dataset.state === 'queued') {
      rows.gpu.dataset.state = 'active';
      rows.gpu.querySelector('.boot-row-status').textContent = 'COMPILING';
    }
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
    window.removeEventListener('portfolio:boot', readProgress);
    window.removeEventListener('load', markPageLoaded);
    window.removeEventListener('wheel', lockScroll);
    window.removeEventListener('touchmove', lockScroll);
    window.removeEventListener('keydown', lockKeys);
    panel.removeEventListener('transitionend', onTransitionEnd);
  }

  function finishReveal() {
    if (disposed) return;
    disposed = true;
    cleanup();
    root.hidden = true;
    root.dataset.revealed = 'true';
    root.setAttribute('aria-busy', 'false');
    document.documentElement.classList.remove('portfolio-booting');
    drift.forEach(animation => animation.cancel());
    counter.dispose();
    window.dispatchEvent(new Event('portfolio:revealed'));
  }

  function onTransitionEnd(event) {
    if (event.target === panel && event.propertyName === 'transform') finishReveal();
  }

  function later(callback, delay) { timers.push(window.setTimeout(callback, delay)); }

  function launch() {
    phase = 'launch';
    root.dataset.presentation = 'launch';
    announcement.textContent = 'Ready. Your journey begins.';
    drift.forEach(animation => { animation.playbackRate = 6; });
    later(reveal, reducedMotion ? 0 : LAUNCH_MS);
  }

  function reveal() {
    phase = 'revealing';
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    root.dataset.presentation = 'revealing';
    // The hero entrance starts as the panel lifts, so it plays in view.
    window.dispatchEvent(new Event('portfolio:revealing'));
    panel.addEventListener('transitionend', onTransitionEnd);
    // Fallback for background tabs or browsers that omit transitionend.
    later(finishReveal, (reducedMotion ? 200 : REVEAL_MS) + 200);
  }

  function render(progress, now) {
    // The rocket crosses the track less its own length (container units).
    rocket.style.transform = `translate3d(calc(${progress.toFixed(4)} * (100cqw - 100%)), 0, 0)`;
    trail.style.transform = `scaleX(${progress.toFixed(4)})`;
    altitude.textContent = `${formatKm(progress * MOON_DISTANCE_KM)} KM`;
    clock.textContent = formatClock(now - started);
  }

  function frame(now) {
    if (disposed) return;
    const delta = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (!document.hidden) visibleTime += delta * 1000;
    if (!failed && phase === 'loading') {
      const allReady = ready && pageLoaded && fontsLoaded;
      // Time only limits the display rate; it never creates readiness.
      const timeCap = Math.min(1, visibleTime / MIN_VISIBLE_MS);
      const target = Math.min(allReady ? 1 : actual, timeCap);
      const gap = Math.max(0, target - displayed);
      // Ease toward real progress, with a minimum pace so the last few
      // percent never crawl, and a ceiling so big jumps still read as motion.
      const rate = allReady ? 10 : 5;
      displayed += Math.min(gap, Math.max(gap * (1 - Math.exp(-delta * rate)), .4 * delta), 1.6 * delta);
      if (allReady && gap < .005 && timeCap === 1) displayed = 1;
      const integer = displayed === 1 ? 100 : Math.min(99, Math.floor(displayed * 100));
      if (integer !== shown && (now - lastSwapAt >= SWAP_INTERVAL || integer === 100)) {
        shown = integer;
        lastSwapAt = now;
        counter.set(integer);
        progressbar.setAttribute('aria-valuenow', String(integer));
        root.dataset.displayProgress = String(integer);
      }
      drift.forEach(animation => { animation.playbackRate = 1 + displayed * 2.5; });
      if (!allReady) {
        holdStarted = null;
        if (root.dataset.presentation === 'complete') root.dataset.presentation = 'loading';
      }
      if (allReady && shown === 100) {
        if (holdStarted === null) {
          holdStarted = visibleTime;
          root.dataset.presentation = 'complete';
        }
        if (visibleTime - holdStarted >= COMPLETION_HOLD_MS) launch();
      }
    }
    render(phase === 'loading' ? displayed : 1, now);
    raf = requestAnimationFrame(frame);
  }

  function lockScroll(event) { if (phase === 'loading' || phase === 'launch') event.preventDefault(); }
  function lockKeys(event) {
    if (phase !== 'loading' && phase !== 'launch') return;
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key) && event.target.tagName !== 'BUTTON') event.preventDefault();
  }
  $('boot-retry').addEventListener('click', () => window.location.reload());
  window.addEventListener('wheel', lockScroll, { passive: false });
  window.addEventListener('touchmove', lockScroll, { passive: false });
  window.addEventListener('keydown', lockKeys);
  window.addEventListener('portfolio:boot', readProgress);
  readProgress();
  raf = requestAnimationFrame(frame);
}
