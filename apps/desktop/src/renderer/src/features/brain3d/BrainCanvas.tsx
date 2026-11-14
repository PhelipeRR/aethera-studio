import { useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import type { BrainCloud } from './anatomy';
import type { SceneController, SceneStats } from './controller';
import type { KnowledgeModel } from './knowledge';
import type { Network } from './network';
import { QUALITY, type EffectIntensity, type QualityLevel } from './quality';
import { BrainRuntime, HOME } from './scene-runtime';

export interface BrainCanvasProps {
  cloud: BrainCloud;
  network: Network;
  quality: QualityLevel;
  intensity: EffectIntensity;
  reducedMotion: boolean;
  autoRotate: boolean;
  paused: boolean;
  knowledge: KnowledgeModel | null;
  selected: number | null;
  controller: SceneController;
  onSelect: (index: number | null) => void;
  onHover: (hover: { index: number; x: number; y: number } | null) => void;
  onStats: (stats: SceneStats) => void;
  onContextLost: () => void;
}

/** Wires a BrainRuntime (all the three.js work) into React Three Fiber's render loop. */
function Scene(props: BrainCanvasProps) {
  const { cloud, network, quality, knowledge, selected, controller, intensity, reducedMotion, autoRotate, onSelect, onHover, onStats, onContextLost } = props;
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const runtime = useMemo(() => new BrainRuntime(cloud, network, quality), [cloud, network, quality]);

  useEffect(() => {
    scene.add(runtime.root);
    return () => {
      scene.remove(runtime.root);
      runtime.dispose();
    };
  }, [runtime, scene]);
  useEffect(() => runtime.attach(camera as PerspectiveCamera, gl.domElement), [runtime, camera, gl]);
  useEffect(() => controller.attach(runtime), [runtime, controller]);
  useEffect(() => {
    runtime.setCallbacks({ onSelect, onHover, onStats });
    return () => runtime.setCallbacks(null);
  }, [runtime, onSelect, onHover, onStats]);
  useEffect(() => runtime.configure({ intensity, reducedMotion, autoRotate }), [runtime, intensity, reducedMotion, autoRotate]);
  useEffect(() => runtime.setKnowledge(knowledge), [runtime, knowledge]);
  useEffect(() => runtime.setSelected(selected), [runtime, selected]);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      onContextLost();
    };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl, onContextLost]);

  useFrame((_state, delta) => runtime.frame(delta, gl));
  return null;
}

/** The 3D brain. Mounted only after WebGL was confirmed; frames stop while `paused`. */
export default function BrainCanvas(props: BrainCanvasProps) {
  return (
    <Canvas
      frameloop={props.paused ? 'never' : 'always'}
      dpr={[1, QUALITY[props.quality].pixelRatio]}
      gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 40, near: 0.05, far: 60, position: HOME.position.toArray() }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      aria-hidden="true"
    >
      <Scene {...props} />
    </Canvas>
  );
}
