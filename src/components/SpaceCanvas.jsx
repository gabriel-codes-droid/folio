import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Suspense, useRef, useState, useEffect, useCallback, Component } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import * as THREE from 'three';
import { phaseForProgress, smooth, pacedJourneyProgress } from './journey';
import TacticalAstronaut from './TacticalAstronaut';
import SleepModule from './SleepModule';
import { advanceProgress, availableProgress } from './sceneStages';
import SceneReady, { AssetProgress, reportBoot } from './SceneReady';
import {
  HOP_WAYPOINTS,
  MOON_CENTER,
  MOON_RADIUS,
  MOON_SEAT_POSITION,
  MECH_SLEEP_POSITION,
} from './sceneConstants';

gsap.registerPlugin(ScrollTrigger);

const MOON_POSITION = MOON_CENTER;

/**
 * Lives inside <Canvas>. Reads scroll progress every frame (via a ref, not
 * React state, so this never triggers a re-render on scroll) and moves both
 * the astronaut wrapper and the camera toward the moon accordingly. This is
 * what actually makes "fly down and land on the moon, watch the planets"
 * happen — previously nothing moved the astronaut or camera through world
 * space at all during the flying phase, only the phase name changed.
 */
function JourneyController({ progressRef, phase }) {
  const targetPosition = useRef(new THREE.Vector3());
  const targetLook = useRef(new THREE.Vector3());
  const cameraForward = useRef(new THREE.Vector3());
  const cameraRight = useRef(new THREE.Vector3());
  const { camera } = useThree();
  // Follow scroll only while progress is changing. Once the scroll settles,
  // OrbitControls owns the camera so a cursor drag is not overwritten every
  // animation frame by the cinematic follow camera.
  const lastProgressRef = useRef(-1);

  // Shared refs so the camera can track the mech during hop/launch/flight.
  const mechPosRef = useRef(new THREE.Vector3());
  const mechYawRef = useRef(0);

  // Fresh framing for the horizontal module: the mech sleeps just inside the
  // open +Z hatch. Camera sits just outside that end and looks down the
  // corridor so the interior fills the opening like the supplied reference.
  const heroCamPos = useRef(new THREE.Vector3(0, 0.5, 23.0));
  const heroCamLook = useRef(new THREE.Vector3(0, -4, 10));
  // Sleep camera: just inside the open end, looking down the module's length
  // toward the mech. This keeps the interior wall normals facing the camera,
  // while the slight left/above offset preserves the reference composition.
  const sleepSpot = MECH_SLEEP_POSITION;
  const sleepCamPos = useRef(
    new THREE.Vector3(0, 1.2, sleepSpot[2] + 4.3)
  );
  const sleepCamLook = useRef(
    new THREE.Vector3(0, -0.8, 4.2)
  );
  // Zoomed-in moon-watching framing: the moon is enlarged and pulled forward,
  // so the seated mech + planet row fit the screen together. Camera sits above
  // and in front, looking down at the seat/planet row.
  const moonCamPos = useRef(
    new THREE.Vector3(0, MOON_SEAT_POSITION[1] + 3.0, 1.0)
  );
  const moonCamLook = useRef(
    new THREE.Vector3(0, MOON_SEAT_POSITION[1] + 1.35, -9.5)
  );

  useFrame((state) => {
    const progress = progressRef.current;
    const p = mechPosRef.current;
    const controls = state.controls;
    // Let dragging own the view after the scroll settles.
    if (Math.abs(progress - lastProgressRef.current) < 0.00001) return;
    lastProgressRef.current = progress;
    if (progress < 0.30) {
      const reveal = smooth((progress - 0.18) / 0.12);
      targetPosition.current.lerpVectors(sleepCamPos.current, heroCamPos.current, reveal);
      targetLook.current.lerpVectors(sleepCamLook.current, heroCamLook.current, reveal);
    } else if (progress < 0.78) {
      // Show the hop route from a front/three-quarter cinematic angle. The
      // mech faces the viewer as it lands on each cube, then its yaw turns
      // toward the planets during flight. Keeping the camera in front avoids
      // the rear-view "obby" read while preserving the authored route.
      const yaw = mechYawRef.current;
      cameraForward.current.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
      cameraRight.current.set(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();
      targetPosition.current.copy(p)
        .addScaledVector(cameraForward.current, 4.8)
        .addScaledVector(cameraRight.current, 2.2);
      targetPosition.current.y += 2.4;
      targetLook.current.copy(p);
      targetLook.current.y += 0.5;
      const chaseStart = progress < 0.46 ? 0.30 : 0.46;
      const chaseAnchor = progress < 0.46 ? sleepCamPos.current : heroCamPos.current;
      const chaseBlend = smooth((progress - chaseStart) / 0.06);
      targetPosition.current.lerpVectors(chaseAnchor, targetPosition.current, chaseBlend);
      const moonBlend = smooth((progress - 0.70) / 0.18);
      targetPosition.current.lerp(moonCamPos.current, moonBlend);
      targetLook.current.lerp(moonCamLook.current, moonBlend);
    } else {
      targetPosition.current.copy(moonCamPos.current);
      targetLook.current.copy(moonCamLook.current);
    }
    camera.position.copy(targetPosition.current);
    if (controls) {
      controls.target.copy(targetLook.current);
      controls.update();
    } else camera.lookAt(targetLook.current);
  }, -1);

  return (
    <group>
      <TacticalAstronaut
        phase={phase}
        position={[0, 0, 0]}
        scale={1}
        hopPoints={HOP_WAYPOINTS}
        journeyProgressRef={progressRef}
        mechPosRef={mechPosRef}
        mechYawRef={mechYawRef}
      />
    </group>
  );
}

class SceneErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) {
    console.error('Scene loading failed', error);
    if (this.props.onError) this.props.onError();
    else reportBoot('error', 0, 'An asset could not load. Reload to retry.');
  }
  render() { return this.state.failed ? null : this.props.children; }
}

function StagePlayback({ desired, actual, readyStages, onPhase, onBuffer }) {
  const last = useRef({ phase: 'sleeping', waiting: false });
  useFrame((_, delta) => {
    actual.current = advanceProgress(actual.current, desired.current, readyStages, delta);
    const phase = phaseForProgress(actual.current);
    const waiting = desired.current > availableProgress(desired.current, readyStages) + 0.001;
    if (phase !== last.current.phase) { last.current.phase = phase; onPhase(phase); }
    if (waiting !== last.current.waiting) { last.current.waiting = waiting; onBuffer(waiting); }
  }, -2);
  return null;
}

const SpaceCanvas = ({ initialProgress = 0, onStagePrepared, stages, readyStages, stageStatus, onRetry }) => {
  const ControlCubeField = stages.route;
  const MoonScene = stages.moon;
  const DistantDebris = stages.debris;
  const warmingStage = Object.keys(stages).some(stage => !readyStages[stage]);
  const desiredProgressRef = useRef(0);
  const routeRoot = useRef(null);
  const moonRoot = useRef(null);
  const debrisRoot = useRef(null);
  const [buffering, setBuffering] = useState(false);
  const [stageError, setStageError] = useState(false);
  const handleStageError = useCallback(() => setStageError(true), []);
  const scrollTrackRef = useRef(null);
  const [astronautPhase, setAstronautPhase] = useState('sleeping');
  const scrollProgressRef = useRef(0);
  const regionRef = useRef(null);
  const [inView, setInView] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [preparation, setPreparation] = useState({ progress: initialProgress, error: '' });
  useEffect(() => {
    const update = event => setPreparation(previous => ({ ...event.detail, progress: Math.max(previous.progress, event.detail.progress) }));
    window.addEventListener('portfolio:preparation', update);
    return () => window.removeEventListener('portfolio:preparation', update);
  }, []);
  const dialogRef = useRef(null);
  useEffect(() => {
    if (astronautPhase !== 'seated' || !inView) setSelectedProject(null);
  }, [astronautPhase, inView]);
  useEffect(() => {
    if (!selectedProject) return;
    const previous = document.activeElement;
    dialogRef.current?.focus();
    const close = event => { if (event.key === 'Escape') setSelectedProject(null); };
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('keydown', close); previous?.focus?.(); };
  }, [selectedProject]);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    if (regionRef.current) observer.observe(regionRef.current);
    return () => observer.disconnect();
  }, []);

  const [ready, setReady] = useState(false);
  // Was two-stage: prepared → wait for BootLoader's 'portfolio:revealed'
  // event → ready. Removing the loading screen removes whatever dispatches
  // that event, which would otherwise leave `ready` permanently false and
  // freeze scrolling/dragging entirely. Now goes straight from the scene
  // actually being GPU-prepared (SceneReady's onReady) to ready — the real
  // warm-up work SceneReady does (texture upload, shader compile, GPU fence
  // sync) is untouched, only the visual loading screen and its event
  // hand-off are gone.
  const handleReady = useCallback(() => { setReady(true); onStagePrepared('opening'); }, [onStagePrepared]);

  useEffect(() => {
    if (!ready || !scrollTrackRef.current) return;
    const playhead = { progress: 0 };
    // scrub only smooths an attached animation; it did nothing on the old
    // bare ScrollTrigger. Drive both phase and camera from the same tween.
    const animation = gsap.to(playhead, {
      progress: 1,
      ease: 'none',
      onUpdate: () => {
        const progress = pacedJourneyProgress(playhead.progress);
        desiredProgressRef.current = progress;
      },
      scrollTrigger: {
        trigger: scrollTrackRef.current,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.65,
        invalidateOnRefresh: true,
      },
    });
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener('portfolio:revealed', refresh);
    const raf = requestAnimationFrame(refresh);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('portfolio:revealed', refresh);
      animation.scrollTrigger?.kill();
      animation.kill();
    };
  }, [ready]);

  return (
    <>
      <section ref={regionRef} className="space-region" id="space-experience" aria-label="Interactive project journey" data-ready-stages={JSON.stringify(readyStages)} data-phase={astronautPhase}>
      <div className="space-stage">
        {!ready && <div className="space-status" role="status">{preparation.error || 'PREPARING EXPERIENCE'}<progress value={preparation.progress} max="1" aria-label="Preparing the 3D experience" /><span>{Math.floor(preparation.progress * 100)}%</span>{preparation.error && <button onClick={() => window.location.reload()}>Retry experience</button>}</div>}
        {ready && buffering && <div className="stage-buffer" role="status">
          <span>{stageError ? 'This stage needs a reload.' : stageStatus.error || `Preparing ${!readyStages.route ? 'the cube route' : 'the planets'}… ${Math.floor(stageStatus.progress * 100)}%`}</span>
          {stageError ? <button onClick={() => window.location.reload()}>Reload scene</button> : stageStatus.error && <button onClick={onRetry}>Retry stage</button>}
          <a href="#contact">Get in touch ↗</a>
        </div>}
        <SceneErrorBoundary>
        <Canvas
          frameloop={!ready || inView || warmingStage ? 'always' : 'never'}
          camera={{ position: [0, 0, 6], fov: 52 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          dpr={[1, 1.5]}
          style={{
            backgroundColor: '#010103',
            backgroundImage: "url('/images/stars-clean.png')",
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            backgroundRepeat: 'no-repeat',
          }}
        >
          <AssetProgress />
          <Suspense fallback={null}>
          <ambientLight intensity={0.4} color="#4a5568" />
          <directionalLight position={[10, 10, 5]} intensity={1.0} color="#e2e8f0" />
          <pointLight position={[-10, -5, -10]} intensity={0.6} color="#3b82f6" distance={30} />
          <pointLight position={[10, 5, 10]} intensity={0.5} color="#8b5cf6" distance={25} />

            {/* Same night-sky lighting, downsampled for reflections. The
                visible star background is unchanged; no 73 MB EXR download. */}
            <Environment files="/models/night-sky.hdr" background={false} />

            {/* Prepare the route while the mech sleeps. StagePlayback holds
                the wake-up beat until these cubes are fully GPU-ready. */}
            {ControlCubeField && <SceneErrorBoundary onError={handleStageError}><Suspense fallback={null}>
            <group ref={routeRoot}>
            <ControlCubeField
              visible={
                astronautPhase === 'sleeping'
                || astronautPhase === 'waking'
                || astronautPhase === 'idle'
                || astronautPhase === 'hopping'
                || astronautPhase === 'launching'
              }
              platformsVisible={
                astronautPhase === 'sleeping'
                || astronautPhase === 'waking'
                || astronautPhase === 'idle'
                || astronautPhase === 'hopping'
                || astronautPhase === 'launching'
              }
              firstPlatformOnly={false}
            />
            <SceneReady quiet rootRef={routeRoot} onError={handleStageError} onReady={() => onStagePrepared('route')} />
            </group>
            </Suspense></SceneErrorBoundary>}

            {/* The mech sleeps inside the middle of this ISS module scan,
                replacing the earlier crash-site-ground approach. Visible
                through the whole pre-flight stretch (continuous, not a
                pop-in/out) since it's a fixed structure he's resting in
                and then leaving, same reasoning as the cube field staying
                visible throughout. */}
            <SleepModule
              visible={
                astronautPhase === 'sleeping'
                || astronautPhase === 'waking'
                || astronautPhase === 'idle'
                || astronautPhase === 'hopping'
                || astronautPhase === 'launching'
              }
            />

            {/* Was part of the old CrashSite.jsx, which got deleted entirely
                along with the ground approach it was paired with — the
                debris rendering itself was never actually broken, it just
                had no home to render from anymore. Re-wired standalone,
                visible through the same continuous opening stretch as the
                cube field and sleep module. */}
            {DistantDebris && <SceneErrorBoundary onError={handleStageError}><Suspense fallback={null}>
            <group ref={debrisRoot}>
            <DistantDebris
              visible={
                astronautPhase === 'sleeping'
                || astronautPhase === 'waking'
                || astronautPhase === 'idle'
                || astronautPhase === 'hopping'
                || astronautPhase === 'launching'
              }
            />
            <SceneReady quiet rootRef={debrisRoot} onError={handleStageError} onReady={() => onStagePrepared('debris')} />
            </group>
            </Suspense></SceneErrorBoundary>}

            {/* The moon/planets enter after the cube route and launch beat.
                Solid surfaces occlude the star background throughout flight. */}
            {MoonScene && <SceneErrorBoundary onError={handleStageError}><Suspense fallback={null}><group ref={moonRoot}><group
              visible={
                astronautPhase === 'flying'
                || astronautPhase === 'landing'
                || astronautPhase === 'seated'
              }
            >
              <MoonScene
                moonPosition={MOON_POSITION}
                moonRadius={MOON_RADIUS}
                labelsVisible={astronautPhase === 'seated' && inView}
                onSelect={setSelectedProject}
                planetsVisible={
                  astronautPhase === 'flying'
                  || astronautPhase === 'landing'
                  || astronautPhase === 'seated'
                }
              />
            </group>
            <SceneReady quiet rootRef={moonRoot} onError={handleStageError} onReady={() => onStagePrepared('moon')} />
            </group>
            </Suspense></SceneErrorBoundary>}

            <StagePlayback desired={desiredProgressRef} actual={scrollProgressRef} readyStages={readyStages} onPhase={setAstronautPhase} onBuffer={setBuffering} />
            <JourneyController progressRef={scrollProgressRef} phase={astronautPhase} />

          <SceneReady onReady={handleReady} />
          <OrbitControls
            makeDefault
            enabled={ready}
            enableRotate={true}
            enableZoom={false}
            // Primary drag pans the camera through the fixed scene. The
            // world is never rotated as one object; middle-drag can still
            // orbit for a closer inspection.
            enablePan={true}
            screenSpacePanning={true}
            mouseButtons={{
              LEFT: THREE.MOUSE.PAN,
              MIDDLE: THREE.MOUSE.ROTATE,
              RIGHT: THREE.MOUSE.PAN,
            }}
            panSpeed={0.45}
            zoomSpeed={0.6}
            rotateSpeed={0.45}
            maxPolarAngle={Math.PI / 1.8}
            minPolarAngle={Math.PI / 5}
            minDistance={2}
            maxDistance={45}
            enableDamping={true}
            dampingFactor={0.04}
          />

          <EffectComposer multisampling={0}>
            <Bloom
              luminanceThreshold={0.9}
              luminanceSmoothing={0.9}
              intensity={0.8}
              radius={0.3}
            />
          </EffectComposer>
          </Suspense>
        </Canvas>
        </SceneErrorBoundary>

      </div>

      {selectedProject && (
        <div className="project-dialog" onClick={() => setSelectedProject(null)}>
          <section className="project-panel" role="dialog" aria-modal="true" aria-labelledby="project-title" aria-describedby="project-description" onClick={event => event.stopPropagation()} onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const controls = event.currentTarget.querySelectorAll('button, a[href]');
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }}>
            <button ref={dialogRef} onClick={() => setSelectedProject(null)} aria-label="Close project">✕</button>
            <p className="project-coordinate">PROJECT ARCHIVE / {selectedProject.number}</p>
            <h2 id="project-title">{selectedProject.title}</h2>
            <div className="project-detail-section">
              <h3>Description:</h3>
              <p id="project-description">{selectedProject.description}</p>
            </div>
            <div className="project-detail-section">
              <h3>Tech Stack:</h3>
              <ul className="project-tags">{selectedProject.subtitle.split(' · ').map(tech => <li key={tech}>{({ Node: 'Node.js', Tailwind: 'Tailwind CSS' })[tech] || tech}</li>)}</ul>
            </div>
            <a className="project-live-link" href={selectedProject.url} target="_blank" rel="noopener noreferrer" aria-label={`View ${selectedProject.name} live project (opens in a new tab)`}>VIEW LIVE PROJECT <span aria-hidden="true">↗</span></a>
            <div className="project-panel-footer" aria-hidden="true"><span>◈ PROJECT / {selectedProject.number}</span><span>PORTFOLIO SYSTEM</span></div>
          </section>
        </div>
      )}

      {/* Scroll track — drives the whole jump/fly/land/sit sequence. Tune
          this height to make the sequence feel faster or slower to scroll
          through. */}
      <div ref={scrollTrackRef} style={{ height: '520vh' }} />
      </section>
    </>
  );
};

export default SpaceCanvas;
