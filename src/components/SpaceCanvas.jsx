import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Suspense, useRef, useState, useEffect, useCallback, Component } from 'react';
import * as THREE from 'three';
import { phaseForProgress, spaceJourneyProgress, sceneExitInset, shouldHoldSceneExit, sampleArrival, sampleJourney, sampleGuide, smooth } from './journey';
import { advanceProgress, availableProgress } from './sceneStages';
import TacticalAstronaut from './TacticalAstronaut';
import { presentationNearDescription } from './presentation';
import SceneReady, { AssetProgress, reportBoot } from './SceneReady';
import { MOON_CENTER, MOON_RADIUS, GUIDE_CAMERA_POSITION, GUIDE_CAMERA_LOOK,
  GALLERY_CAMERA_POSITION, GALLERY_CAMERA_LOOK, JOURNEY_SCROLL_HEIGHT } from './sceneConstants';

class SceneErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) {
    console.error('Scene preparation failed', error);
    if (this.props.onError) this.props.onError();
    else reportBoot('error', 0, 'The experience could not prepare. Please reload.');
  }
  render() { return this.state.failed ? null : this.props.children; }
}

function Playback({ desired, actual, readyStages, onPhase, onBuffer }) {
  const last = useRef({ phase: 'hovering', waiting: false });
  useFrame((_, delta) => {
    actual.current = advanceProgress(actual.current, desired.current, readyStages, delta);
    const phase = phaseForProgress(actual.current);
    const waiting = desired.current > availableProgress(desired.current, readyStages) + 0.001;
    if (phase !== last.current.phase) { last.current.phase = phase; onPhase(phase); }
    if (waiting !== last.current.waiting) { last.current.waiting = waiting; onBuffer(waiting); }
  }, -4);
  return null;
}

function GuideController({ progressRef, phase, viewRef }) {
  const { camera } = useThree();
  const worldPosition = useRef(new THREE.Vector3());
  const yawRef = useRef(0);
  const presentationRef = useRef({ weight: 0, side: 1 });
  const departure = useRef(new THREE.Vector3());
  const lastProgress = useRef(-1);
  const guide = useRef([0.34, 0.80]);
  const entered = useRef(false);
  const scratch = useMemoVectors();
  useFrame((state, delta) => {
    const p = progressRef.current;
    const view = viewRef.current;
    // Frames only start once the guide is warmed, so this is its arrival.
    // At the top it replaces the still in place; if the visitor has already
    // scrolled on, it flies in from the right edge so they notice it.
    if (!entered.current) {
      entered.current = true;
      guide.current = window.scrollY > window.innerHeight * 0.6 ? [1.2, view.guide[1]] : [...view.guide];
    }
    const presentation = view.presentation || { weight: 0, side: 1 };
    const presentationEase = 1 - Math.exp(-Math.min(delta, 0.05) * 3.5);
    const switchingSide = presentationRef.current.side !== presentation.side;
    const settled = Math.hypot(guide.current[0] - view.guide[0], guide.current[1] - view.guide[1]) < 0.025;
    const targetPresentation = p === 0 && settled && !switchingSide ? presentation.weight : 0;
    presentationRef.current.weight += (targetPresentation - presentationRef.current.weight) * presentationEase;
    if (presentationRef.current.weight < 0.02) presentationRef.current.side = presentation.side;
    const fov = view.compact ? 60 : 52;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    scratch.finalCamera.z = view.compact ? 21 : GALLERY_CAMERA_POSITION[2];
    const blend = sampleArrival(p).cameraBlend;
    // The camera settles once scroll settles, leaving drag controls in charge.
    if (p !== lastProgress.current || p === 0) {
      camera.position.fromArray(GUIDE_CAMERA_POSITION).lerp(scratch.finalCamera, blend);
      scratch.look.fromArray(GUIDE_CAMERA_LOOK).lerp(scratch.finalLook, blend);
      if (state.controls) { state.controls.target.copy(scratch.look); state.controls.update(); }
      else camera.lookAt(scratch.look);
      camera.updateMatrixWorld();
    }
    if (p === 0) {
      const speed = 1 - Math.exp(-Math.min(delta, 0.05) * 2.4);
      guide.current = guide.current.map((value, axis) => value + (view.guide[axis] - value) * speed);
      scratch.ray.set(guide.current[0] * 2 - 1, 1 - guide.current[1] * 2, 0.5)
        .unproject(camera).sub(camera.position).normalize();
      worldPosition.current.copy(camera.position).addScaledVector(scratch.ray, view.compact ? 9 : 7.5);
      departure.current.copy(worldPosition.current);
      yawRef.current = -0.12 + presentationRef.current.side * presentationRef.current.weight * 0.85;
    } else {
      yawRef.current = sampleJourney(p, worldPosition.current, departure.current.toArray());
    }
    lastProgress.current = p;
  }, -3);
  return <TacticalAstronaut phase={phase} scale={1}
    journeyProgressRef={progressRef} worldPositionRef={worldPosition} controlledYawRef={yawRef} presentationRef={presentationRef} />;
}

function useMemoVectors() {
  const ref = useRef(null);
  if (!ref.current) ref.current = { ray: new THREE.Vector3(), look: new THREE.Vector3(),
    finalCamera: new THREE.Vector3(...GALLERY_CAMERA_POSITION), finalLook: new THREE.Vector3(...GALLERY_CAMERA_LOOK) };
  return ref.current;
}

export default function SpaceCanvas({ initialProgress = 0, onStagePrepared, stages, readyStages, stageStatus, onRetry }) {
  const MoonScene = stages.moon;
  const regionRef = useRef(null);
  const canvasShellRef = useRef(null);
  const moonRoot = useRef(null);
  const desired = useRef(0);
  const actual = useRef(0);
  const viewRef = useRef({ guide: [0.34, 0.80], compact: false });
  const [phase, setPhase] = useState('hovering');
  const [active, setActive] = useState(true);
  const [inSpace, setInSpace] = useState(false);
  const [ready, setReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [stageError, setStageError] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [preparation, setPreparation] = useState({ progress: initialProgress, error: '' });
  const dialogRef = useRef(null);
  const warmingStage = !stageError && Object.keys(stages).some(stage => !readyStages[stage]);
  const handleReady = useCallback(() => { setReady(true); onStagePrepared('opening'); }, [onStagePrepared]);
  // The page is already open by now: show the in-scene retry, not the loader.
  const handleStageError = useCallback(() => setStageError(true), []);

  useEffect(() => {
    const update = event => setPreparation(previous => ({ ...event.detail, progress: Math.max(previous.progress, event.detail.progress) }));
    window.addEventListener('portfolio:preparation', update);
    return () => window.removeEventListener('portfolio:preparation', update);
  }, []);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const height = window.innerHeight;
      const scroll = window.scrollY;
      let section = regionRef.current?.getBoundingClientRect();
      if (!section) return;
      // A fast scroll cannot reveal the next section while the slower
      // cinematic playhead is still landing. Upward scrolling stays free.
      if (shouldHoldSceneExit(actual.current, section.bottom, height) && section.bottom < height - 1) {
        desired.current = 1;
        window.scrollTo({ top: scroll + section.bottom - height, behavior: 'instant' });
        schedule();
        return;
      }
      const services = document.getElementById('services')?.getBoundingClientRect();
      const work = document.getElementById('work')?.getBoundingClientRect();
      const hero = document.getElementById('about')?.getBoundingClientRect();
      // Stay in the outer margin until hero copy has passed, then cross into
      // the gap between cards. Leave that gap only after the last card passes.
      const stops = [0, height * 0.25, (hero?.bottom || height) + scroll,
        (services?.top || 0) + scroll + height * 0.7,
        (services?.bottom || 0) + scroll, (work?.top || 0) + scroll + height * 0.4];
      for (let i = 1; i < stops.length; i++) stops[i] = Math.max(stops[i], stops[i - 1] + 1);
      const compact = window.innerWidth < 700;
      const guide = sampleGuide(scroll, stops, compact);
      const descriptions = [...document.querySelectorAll('.hero-copy, .capability article')].map(element => element.getBoundingClientRect());
      viewRef.current = { guide, compact,
        presentation: presentationNearDescription(guide, descriptions, window.innerWidth, height) };
      desired.current = spaceJourneyProgress(section.top, section.height, height);
      // Clip the fixed canvas at the section boundary as the following
      // editorial content enters. Update its style without frame rerenders.
      if (canvasShellRef.current) {
        canvasShellRef.current.style.clipPath = `inset(0px 0px ${sceneExitInset(section.bottom, height)}px 0px)`;
      }
      setInSpace(section.top <= height * 0.85 && section.bottom > 0);
      setActive(section.bottom > 0);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const guardExit = event => {
      const section = regionRef.current?.getBoundingClientRect();
      if (event.deltaY > 0 && section && shouldHoldSceneExit(actual.current, section.bottom, window.innerHeight)) {
        desired.current = 1;
        event.preventDefault();
      }
    };
    window.addEventListener('wheel', guardExit, { passive: false });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('wheel', guardExit); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, []);
  useEffect(() => { if (phase !== 'seated' || !inSpace) setSelectedProject(null); }, [phase, inSpace]);
  useEffect(() => {
    if (!selectedProject) return;
    const previous = document.activeElement;
    dialogRef.current?.focus();
    const close = event => { if (event.key === 'Escape') setSelectedProject(null); };
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('keydown', close); previous?.focus?.(); };
  }, [selectedProject]);

  const gallery = phase === 'seated' && inSpace && active;
  return <>
    <section ref={regionRef} className="space-region" id="space-experience" aria-label="Explore my projects in space"
      data-phase={phase} data-ready-stages={JSON.stringify(readyStages)}>
      <div className="space-stage">
        {inSpace && !ready && <div className="space-status" role="status">{preparation.error || 'PREPARING YOUR EXPLORATION'}
          <progress value={preparation.progress} max="1" /><span>{Math.floor(preparation.progress * 100)}%</span>
          {preparation.error && <button onClick={() => window.location.reload()}>Retry experience</button>}
          <button type="button" data-open-projects aria-haspopup="dialog">Browse the project list instead →</button>
        </div>}
      </div>
      <div style={{ height: JOURNEY_SCROLL_HEIGHT }} />
    </section>
    <div ref={canvasShellRef} className={`guide-canvas-shell${gallery ? ' is-gallery' : ''}`} style={{ opacity: ready && active ? 1 : 0 }} aria-hidden={!active}>
      {/* No frames until the guide is warmed: a visible frame would compile
          every shader at once and freeze the already-open page. */}
      <SceneErrorBoundary><Canvas frameloop={ready && (active || warmingStage) ? 'always' : 'never'}
        camera={{ position: GUIDE_CAMERA_POSITION, fov: 52 }} dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}>
        <AssetProgress />
        <Playback desired={desired} actual={actual} readyStages={readyStages} onPhase={setPhase} onBuffer={setBuffering} />
        <Suspense fallback={null}>
          <ambientLight intensity={0.4} color="#4a5568" />
          <directionalLight position={[10, 10, 5]} intensity={1} color="#e2e8f0" />
          <pointLight position={[-10, -5, -10]} intensity={0.6} color="#3b82f6" distance={30} />
          <pointLight position={[10, 5, 10]} intensity={0.5} color="#8b5cf6" distance={25} />
          {/* Keep the light count fixed (it is baked into every shader) and
              small: each point light makes every shader slower to compile. */}
          <Environment files="/models/night-sky.hdr" background={false} />
          <GuideController progressRef={actual} phase={phase} viewRef={viewRef} />
          <SceneReady onReady={handleReady} />
          <OrbitControls makeDefault enabled={gallery} enableZoom={false} enablePan screenSpacePanning
            mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }}
            panSpeed={0.35} rotateSpeed={0.35} enableDamping dampingFactor={0.04}
            maxPolarAngle={Math.PI / 1.8} minPolarAngle={Math.PI / 5} />
          <EffectComposer multisampling={0}><Bloom luminanceThreshold={0.9} luminanceSmoothing={0.9} intensity={0.8} radius={0.3} /></EffectComposer>
        </Suspense>
        {MoonScene && <SceneErrorBoundary onError={handleStageError}><Suspense fallback={null}>
          <group ref={moonRoot}><group visible={inSpace && !!readyStages.moon}>
            <MoonScene moonPosition={MOON_CENTER} moonRadius={MOON_RADIUS} planetsVisible
              labelsVisible={gallery} onSelect={setSelectedProject} />
          </group><SceneReady rootRef={moonRoot} onError={handleStageError} onReady={() => onStagePrepared('moon')} /></group>
        </Suspense></SceneErrorBoundary>}
      </Canvas></SceneErrorBoundary>
    </div>
    {inSpace && active && ready && buffering && <div className="journey-ui">
      {buffering && <div className="stage-buffer" role="status">
        <span>{stageError ? 'Please reload the experience.' : stageStatus.error || `Preparing your destination… ${Math.floor(stageStatus.progress * 100)}%`}</span>
        {stageStatus.error && <button onClick={onRetry}>Retry</button>}
        <button type="button" data-open-projects aria-haspopup="dialog">Project list →</button>
      </div>}
    </div>}
    {selectedProject && <div className="project-dialog" onClick={() => setSelectedProject(null)}>
      <section className="project-panel" role="dialog" aria-modal="true" aria-labelledby="project-title" aria-describedby="project-description"
        onClick={event => event.stopPropagation()} onKeyDown={event => {
          if (event.key !== 'Tab') return;
          const controls = event.currentTarget.querySelectorAll('button, a[href]');
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <button ref={dialogRef} onClick={() => setSelectedProject(null)} aria-label="Close project">✕</button>
        <p className="project-coordinate">PROJECT ARCHIVE / {selectedProject.number}</p><h2 id="project-title">{selectedProject.title}</h2>
        <div className="project-detail-section"><h3>Description:</h3><p id="project-description">{selectedProject.description}</p></div>
        <div className="project-detail-section"><h3>Tech Stack:</h3><ul className="project-tags">{selectedProject.subtitle.split(' · ').map(tech => <li key={tech}>{({ Node: 'Node.js', Tailwind: 'Tailwind CSS' })[tech] || tech}</li>)}</ul></div>
        <a className="project-live-link" href={selectedProject.url} target="_blank" rel="noopener noreferrer">VIEW LIVE PROJECT <span aria-hidden="true">↗</span></a>
        <div className="project-panel-footer" aria-hidden="true"><span>◈ PROJECT / {selectedProject.number}</span><span>PORTFOLIO SYSTEM</span></div>
      </section>
    </div>}
  </>;
}
