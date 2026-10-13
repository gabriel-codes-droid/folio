import { useEffect, useRef } from 'react';
import { rippleOrigin } from './sonarCoordinates';

const TAU = Math.PI * 2;
const MAX_DPR = 1.5;
const FRAME_INTERVAL = 1000 / 60;

// Decorative canvas background for the post-journey page. It uses short
// bursts instead of an always-running loop and pauses when off-screen.
export default function SonarGrid({
  background = false,
  // Neutral silver-white matches the supplied sonar-grid reference. The
  // alpha-driven resting/wave states create the grey-to-white contrast.
  color = '#f5f5f5',
  spacing = 28,
  dotRadius = 1.15,
  baseOpacity = 0.27,
  maxWaveOpacity = 0.42,
  pingEvery = 6.5,
  speed = 260,
  ringWidth = 88,
  amplitude = 1.2,
}) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const ringsRef = useRef([]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!host || !canvas || !context) return undefined;

    const restingOpacity = Math.max(0, Math.min(1, Number.isFinite(baseOpacity) ? baseOpacity : 0.27));
    // A lower wave ceiling must not dim the configured resting grid.
    const peakOpacity = Math.max(restingOpacity, Math.min(1, Number.isFinite(maxWaveOpacity) ? maxWaveOpacity : 0.42));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 1;
    let height = 1;
    let visible = true;
    let seeded = false;
    let frameId = 0;
    let timerId = 0;
    let lastDraw = -Infinity;
    let nextPing = performance.now() + pingEvery * 1000;

    const addRing = (x, y, born = performance.now()) => {
      ringsRef.current.push({ x, y, born });
      if (ringsRef.current.length > 5) ringsRef.current.shift();
    };

    const draw = (now) => {
      const lifetime = (Math.hypot(width, height) + ringWidth) / speed;
      ringsRef.current = ringsRef.current.filter(ring => (now - ring.born) / 1000 < lifetime);
      const liveRings = ringsRef.current.map(ring => {
        const age = (now - ring.born) / 1000;
        const radius = age * speed;
        return { ...ring, radius, reach: radius + ringWidth,
          innerSquared: Math.max(0, radius - ringWidth) ** 2,
          outerSquared: (radius + ringWidth) ** 2, fade: 1 - age / lifetime };
      });

      context.clearRect(0, 0, width, height);
      context.fillStyle = color;
      const columns = Math.ceil(width / spacing) + 1;
      const rows = Math.ceil(height / spacing) + 1;
      const offsetX = (width - (columns - 1) * spacing) / 2;
      const offsetY = (height - (rows - 1) * spacing) / 2;
      const energized = [];

      context.globalAlpha = restingOpacity;
      context.beginPath();
      for (let column = 0; column < columns; column++) {
        const x = offsetX + column * spacing;
        for (let row = 0; row < rows; row++) {
          const y = offsetY + row * spacing;
          let energy = 0;
          for (const ring of liveRings) {
            if (Math.abs(x - ring.x) > ring.reach || Math.abs(y - ring.y) > ring.reach) continue;
            const squared = (x - ring.x) ** 2 + (y - ring.y) ** 2;
            if (squared < ring.innerSquared || squared > ring.outerSquared) continue;
            const distance = Math.abs(Math.sqrt(squared) - ring.radius);
            if (distance >= ringWidth) continue;
            const t = 1 - distance / ringWidth;
            energy = Math.max(energy, t * t * (3 - 2 * t) * ring.fade);
          }
          if (energy < 0.01) {
            context.moveTo(x + dotRadius, y);
            context.arc(x, y, dotRadius, 0, TAU);
          } else energized.push(x, y, energy);
        }
      }
      context.fill();

      // Batch similarly bright dots: at most 16 fill calls instead of one
      // per illuminated dot. Radius still varies continuously with the wave.
      const batches = Array.from({ length: 16 }, () => new Path2D());
      for (let index = 0; index < energized.length; index += 3) {
        const energy = energized[index + 2];
        const path = batches[Math.min(15, Math.floor(energy * 16))];
        const radius = dotRadius * (1 + amplitude * energy);
        path.moveTo(energized[index] + radius, energized[index + 1]);
        path.arc(energized[index], energized[index + 1], radius, 0, TAU);
      }
      batches.forEach((path, index) => {
        context.globalAlpha = restingOpacity + (peakOpacity - restingOpacity) * ((index + .5) / 16);
        context.fill(path);
      });
      context.globalAlpha = 1;
    };

    const schedule = (delay) => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => tick(performance.now()), Math.max(16, delay));
    };

    const tick = (now) => {
      frameId = 0;
      if (!visible || document.hidden) return;
      if (reducedMotion.matches) {
        ringsRef.current = [];
        draw(now);
        return;
      }
      // High-refresh monitors need not run this background at 120–240 Hz.
      if (now - lastDraw < FRAME_INTERVAL - .5) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      lastDraw = now;
      if (pingEvery > 0 && now >= nextPing) {
        addRing(width * (.16 + Math.random() * .68), height * (.18 + Math.random() * .64), now);
        nextPing = now + pingEvery * 1000;
      }
      draw(now);
      if (ringsRef.current.length) frameId = requestAnimationFrame(tick);
      else if (pingEvery > 0) schedule(nextPing - now);
    };

    const wake = () => {
      if (visible && !document.hidden && !frameId) {
        window.clearTimeout(timerId);
        frameId = requestAnimationFrame(tick);
      }
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(background ? Math.min(rect.height, window.innerHeight) : rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!seeded && !reducedMotion.matches) {
        seeded = true;
        addRing(width * .67, height * .38, performance.now() - 450);
      }
      draw(performance.now());
      wake();
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) wake();
    });
    const resizeObserver = new ResizeObserver(resize);
    const onVisibility = () => { if (!document.hidden) wake(); };
    // Listen without making the decorative canvas intercept links or cards.
    // Measure the sticky canvas, not the tall section, to keep the ripple
    // centered under the pointer even after scrolling.
    const surface = background ? host.closest('.editorial') : host;
    const onClick = (event) => {
      if (!visible || document.hidden || reducedMotion.matches || event.detail === 0) return;
      if (!surface?.contains(event.target)) return;
      const origin = rippleOrigin(event.clientX, event.clientY, canvas.getBoundingClientRect(), width, height);
      if (!origin) return;
      addRing(origin.x, origin.y);
      wake();
    };

    resizeObserver.observe(host);
    observer.observe(host);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('click', onClick, { capture: true, passive: true });
    reducedMotion.addEventListener('change', wake);
    resize();

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('click', onClick, true);
      reducedMotion.removeEventListener('change', wake);
      cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [background, amplitude, baseOpacity, maxWaveOpacity, color, dotRadius, pingEvery, ringWidth, spacing, speed]);

  return (
    <section
      className={background ? 'sonar-backdrop' : 'sonar-page'}
      ref={hostRef}
      aria-hidden="true"
      style={{
        position: background ? 'absolute' : 'relative', inset: background ? 0 : undefined,
        zIndex: background ? 0 : 1, minHeight: background ? undefined : '100svh',
        pointerEvents: 'none', overflow: 'clip',
        background: 'radial-gradient(ellipse at 50% 50%, #101010 0%, #050505 46%, #000 100%)',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: background ? 'sticky' : 'absolute', top: 0, display: 'block', width: '100%', height: background ? '100svh' : '100%', pointerEvents: 'none' }}
      />
    </section>
  );
}
