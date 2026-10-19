// Drives the slim 3D loading strip. The page never waits for it: it eases
// toward the progress reported by sceneDownloads, says READY when the guide
// has been warmed, then slides away.
const HIDE_AFTER_MS = 1400;

export function initLoadStrip() {
  const root = document.getElementById('boot-hud');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const rocket = document.getElementById('boot-rocket');
  const trail = document.getElementById('boot-trail');
  const label = document.getElementById('boot-label');
  const percent = document.getElementById('boot-percent');
  const retry = document.getElementById('boot-retry');
  let target = 0;
  let displayed = 0;
  let shown = -1;
  let ready = false;
  let finished = false;
  let lastFrame = performance.now();
  let raf = 0;

  function read() {
    if (finished) return;
    if (root.dataset.stage === 'error') {
      finished = true;
      cancelAnimationFrame(raf);
      root.dataset.state = 'error';
      label.textContent = '3D UNAVAILABLE';
      retry.hidden = false;
      return;
    }
    target = Math.max(target, Math.min(1, Number(root.dataset.progress) || 0));
    ready = root.dataset.stage === 'ready';
  }

  function finish() {
    finished = true;
    root.dataset.state = 'done';
    root.setAttribute('aria-valuenow', '100');
    label.textContent = '3D READY';
    window.removeEventListener('portfolio:boot', read);
    window.setTimeout(() => { root.hidden = true; }, HIDE_AFTER_MS);
  }

  function frame(now) {
    if (finished) return;
    const delta = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    const goal = ready ? 1 : target;
    const gap = Math.max(0, goal - displayed);
    // Once ready, finish fast: a cached visit completes before the strip
    // would fade in, so it never flashes.
    displayed += Math.min(gap, Math.max(gap * (1 - Math.exp(-delta * (ready ? 14 : 6))), (ready ? 2.5 : .3) * delta));
    if (ready && gap < .005) displayed = 1;
    // The rocket crosses the track less its own length (container units).
    rocket.style.transform = `translate3d(calc(${displayed.toFixed(4)} * (100cqw - 100%)), 0, 0)`;
    trail.style.transform = `scaleX(${displayed.toFixed(4)})`;
    const integer = displayed === 1 ? 100 : Math.min(99, Math.floor(displayed * 100));
    if (integer !== shown) {
      shown = integer;
      percent.textContent = String(integer);
      root.setAttribute('aria-valuenow', String(integer));
    }
    if (displayed === 1) { finish(); return; }
    raf = requestAnimationFrame(frame);
  }

  retry.addEventListener('click', () => window.location.reload());
  window.addEventListener('portfolio:boot', read);
  read();
  raf = requestAnimationFrame(frame);
}
