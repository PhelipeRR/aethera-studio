import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MemoryType } from '@neuralbridge/shared/domain';
import { REGIONS, type BrainCloud } from './anatomy';
import type { CameraFlightGoal, SceneCommands, SceneStats } from './controller';
import { ImpulseField, type Impulse } from './impulses';
import type { KnowledgeModel } from './knowledge';
import type { Network } from './network';
import { INTENSITY, QUALITY, type EffectIntensity, type QualityLevel } from './quality';
import { createRng } from './rng';
import { bokehFragment, bokehVertex, edgeFragment, edgeVertex, impulseVertex, particleVertex, softPointFragment } from './shaders';

// Everything three.js for the 3D brain, outside React: building, animating, picking and disposing.
// Two layers never mix: the decorative brain (particles, network, ambient impulses, generated here) and the
// knowledge layer (memories, stored links and calculated similarity, real retrievals). Only memories can be
// picked; nothing decorative is clickable or counted as a memory.

export const HOME = { position: new THREE.Vector3(2.75, 0.18, 0.12), target: new THREE.Vector3(0, -0.16, 0) };
const TRAIL = 6;
const FOCUS_DISTANCE = 1.05;
const CLICK_TOLERANCE_PX = 5;
const PICK_RADIUS_PX = 12;

/** Dark-theme memory type colours, the same as the 2D graph. */
const TYPE_COLOUR: Record<MemoryType, string> = {
  decision: '#fb923c',
  code_pattern: '#98cc6a',
  project_context: '#fcd34d',
  bug_fix: '#f27a90',
  learning: '#e2b46c',
  preference: '#e7e5e4',
  documentation: '#a8a29e',
  execution_summary: '#f59a62',
};

const PALETTE = {
  ember: new THREE.Color('#f97316'),
  deepEmber: new THREE.Color('#9a3412'),
  glow: new THREE.Color('#fdba74'),
  spark: new THREE.Color('#fbbf24'),
  white: new THREE.Color('#fff7ed'),
  ambientHead: new THREE.Color('#ffedd5'),
  realHead: new THREE.Color('#fff1c9'),
};

/**
 * Light adds up and alpha is left untouched: the canvas stays transparent, so the glow composites over the
 * page's dark gradient instead of punching dark holes in it (plain additive blending writes alpha 1).
 */
const additive = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

function particleGeometry(cloud: BrainCloud): THREE.BufferGeometry {
  const random = createRng(1234);
  const colours = new Float32Array(cloud.count * 3);
  const sizes = new Float32Array(cloud.count);
  const phases = new Float32Array(cloud.count);
  const colour = new THREE.Color();
  const cerebellum = REGIONS.indexOf('cerebellum');
  for (let i = 0; i < cloud.count; i++) {
    const r = random();
    // Mostly orange with amber sparks and a few white points; the cerebellum glows cyan as in the reference.
    const inCerebellum = cloud.regions[i] === cerebellum;
    const sparkShare = inCerebellum ? 0.9 : 0.12;
    if (r < sparkShare) colour.copy(PALETTE.spark).lerp(PALETTE.white, random() * (inCerebellum ? 0.45 : 0.25));
    else if (r < sparkShare + 0.03) colour.copy(PALETTE.white);
    else colour.copy(random() < 0.5 ? PALETTE.ember : PALETTE.deepEmber).lerp(PALETTE.glow, random() * 0.4);
    if (!cloud.surface[i]) colour.multiplyScalar(0.55);
    colour.toArray(colours, i * 3);
    sizes[i] = (cloud.surface[i] ? 2.4 : 1.8) + random() * 2.2 + (inCerebellum ? 0.8 : 0);
    phases[i] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aActivation', new THREE.BufferAttribute(new Float32Array(cloud.count * 2), 2).setUsage(THREE.DynamicDrawUsage));
  geometry.computeBoundingSphere();
  return geometry;
}

function segments(pairs: readonly (readonly [number, number])[], positions: Float32Array): THREE.BufferGeometry {
  const vertices = new Float32Array(pairs.length * 6);
  pairs.forEach(([a, b], i) => {
    vertices.set(positions.subarray(a * 3, a * 3 + 3), i * 6);
    vertices.set(positions.subarray(b * 3, b * 3 + 3), i * 6 + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  return geometry;
}

function impulseGeometry(capacity: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.2, 0), 2);
  return geometry;
}

function bokehGeometry(count: number): THREE.BufferGeometry {
  const random = createRng(77);
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const colour = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // A shell well outside the brain, so it reads as out-of-focus background from any angle.
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const radius = 3.2 + random() * 4;
    positions.set([radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi) * 0.7, radius * Math.sin(phi) * Math.sin(theta)], i * 3);
    colour.copy(random() < 0.82 ? PALETTE.deepEmber : PALETTE.spark).lerp(PALETTE.glow, random() * 0.3);
    colour.toArray(colours, i * 3);
    sizes[i] = 60 + random() * 160;
    phases[i] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  return geometry;
}

function uniform(material: THREE.ShaderMaterial, name: string, value: number): void {
  const entry = material.uniforms[name];
  if (entry) entry.value = value;
}

export interface RuntimeCallbacks {
  onSelect: (index: number | null) => void;
  onHover: (hover: { index: number; x: number; y: number } | null) => void;
  onStats: (stats: SceneStats) => void;
}

export interface RuntimeSettings {
  intensity: EffectIntensity;
  reducedMotion: boolean;
  autoRotate: boolean;
}

export class BrainRuntime implements SceneCommands {
  readonly root = new THREE.Group();
  private readonly decor: ImpulseField;
  private readonly spawnPerSecond: number;
  private real: ImpulseField | null = null;
  private knowledge: KnowledgeModel | null = null;
  private selected: number | null = null;
  private settings: RuntimeSettings = { intensity: 'normal', reducedMotion: false, autoRotate: true };
  private callbacks: RuntimeCallbacks | null = null;
  private readonly owned: { dispose(): void }[] = [];
  private readonly knowledgeOwned: { dispose(): void }[] = [];
  private readonly knowledgeGroup = new THREE.Group();
  private readonly selectionGroup = new THREE.Group();

  private readonly particles: THREE.BufferGeometry;
  private readonly edges: THREE.BufferGeometry;
  private readonly impulses: THREE.BufferGeometry;
  private readonly particleMaterial: THREE.ShaderMaterial;
  private readonly impulseMaterial: THREE.ShaderMaterial;
  private readonly bokehMaterial: THREE.ShaderMaterial;
  private readonly nodeGeometry = new THREE.IcosahedronGeometry(0.015, 1);
  private readonly nodeMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });
  private readonly selectedMaterial = new THREE.LineBasicMaterial({ color: '#f5f5f4', ...additive });
  private nodes: THREE.InstancedMesh | null = null;
  private halos: THREE.BufferGeometry | null = null;
  private typeColours: THREE.Color[] = [];

  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private element: HTMLElement | null = null;
  private flight: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;
  private interacting = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private clock = 0;
  private readonly stats = { frames: 0, windowFrames: 0, windowStart: 0 };
  private readonly scratch = { matrix: new THREE.Matrix4(), colour: new THREE.Color(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(), position: new THREE.Vector3() };

  constructor(
    private readonly cloud: BrainCloud,
    private readonly network: Network,
    quality: QualityLevel,
  ) {
    const settings = QUALITY[quality];
    this.decor = new ImpulseField(network, {
      maxImpulses: settings.maxImpulses,
      spawnPerSecond: settings.spawnPerSecond,
      speed: [0.38, 1.05],
      branchProbability: 0.42,
      hopFade: 0.83,
      nodeDecayPerSecond: 2.2,
      seed: 2026,
    });
    this.spawnPerSecond = settings.spawnPerSecond;

    this.particles = this.own(particleGeometry(cloud));
    const pairs: [number, number][] = [];
    for (let e = 0; e < network.edgeCount; e++) pairs.push([network.edges[e * 2] ?? 0, network.edges[e * 2 + 1] ?? 0]);
    this.edges = this.own(segments(pairs, network.nodePositions));
    this.edges.setAttribute('aActivation', new THREE.BufferAttribute(new Float32Array(network.edgeCount * 4), 2).setUsage(THREE.DynamicDrawUsage));
    this.impulses = this.own(impulseGeometry((settings.maxImpulses + 160) * TRAIL));
    const bokeh = this.own(bokehGeometry(settings.bokeh));

    this.particleMaterial = this.own(
      new THREE.ShaderMaterial({
        vertexShader: particleVertex,
        fragmentShader: softPointFragment,
        uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uGlow: { value: 1 }, uTwinkle: { value: 1 } },
        ...additive,
      }),
    );
    const edgeMaterial = this.own(new THREE.ShaderMaterial({ vertexShader: edgeVertex, fragmentShader: edgeFragment, uniforms: { uBase: { value: 0.085 } }, ...additive }));
    this.impulseMaterial = this.own(new THREE.ShaderMaterial({ vertexShader: impulseVertex, fragmentShader: softPointFragment, uniforms: { uPixelRatio: { value: 1 } }, ...additive }));
    this.bokehMaterial = this.own(
      new THREE.ShaderMaterial({ vertexShader: bokehVertex, fragmentShader: bokehFragment, uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uDrift: { value: 1 } }, ...additive }),
    );
    this.owned.push(this.nodeGeometry, this.nodeMaterial, this.selectedMaterial);

    const bokehPoints = new THREE.Points(bokeh, this.bokehMaterial);
    bokehPoints.frustumCulled = false;
    bokehPoints.renderOrder = -1;
    const impulsePoints = new THREE.Points(this.impulses, this.impulseMaterial);
    impulsePoints.frustumCulled = false;
    this.root.add(bokehPoints, new THREE.LineSegments(this.edges, edgeMaterial), new THREE.Points(this.particles, this.particleMaterial), impulsePoints, this.knowledgeGroup, this.selectionGroup);
  }

  private own<T extends { dispose(): void }>(value: T): T {
    this.owned.push(value);
    return value;
  }

  setCallbacks(callbacks: RuntimeCallbacks | null): void {
    this.callbacks = callbacks;
  }

  configure(settings: RuntimeSettings): void {
    this.settings = settings;
    const effects = INTENSITY[settings.intensity];
    this.decor.configure({ ambient: !settings.reducedMotion && effects.ambient > 0, spawnPerSecond: this.spawnPerSecond * effects.ambient });
  }

  /** Replaces the knowledge layer (memories and their real relations). */
  setKnowledge(knowledge: KnowledgeModel | null): void {
    this.knowledgeGroup.clear();
    for (const item of this.knowledgeOwned.splice(0)) item.dispose();
    this.nodes = null;
    this.halos = null;
    this.knowledge = knowledge;
    this.real = knowledge ? new ImpulseField(knowledge.network, { maxImpulses: 0, spawnPerSecond: 0, speed: [0.45, 0.8], branchProbability: 0.5, hopFade: 0.88, nodeDecayPerSecond: 0.9, seed: 7 }) : null;
    this.real?.configure({ ambient: false, spawnPerSecond: 0 });
    if (!knowledge?.memories.length) {
      this.setSelected(null);
      return;
    }

    this.typeColours = knowledge.memories.map((memory) => new THREE.Color(TYPE_COLOUR[memory.type]));
    const links = knowledge.edges.filter((edge) => edge.kind === 'link').map((edge) => [edge.a, edge.b] as const);
    const similar = knowledge.edges.filter((edge) => edge.kind === 'similarity').map((edge) => [edge.a, edge.b] as const);
    const linkGeometry = segments(links, knowledge.positions);
    const similarityGeometry = segments(similar, knowledge.positions);
    // With additive light, brightness is the colour itself (opacity does not apply).
    const linkMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color('#fed7aa').multiplyScalar(0.55), ...additive });
    const similarityMaterial = new THREE.LineDashedMaterial({ color: new THREE.Color('#fbbf24').multiplyScalar(0.5), dashSize: 0.025, gapSize: 0.02, ...additive });
    const similarityLines = new THREE.LineSegments(similarityGeometry, similarityMaterial);
    similarityLines.computeLineDistances();

    const count = knowledge.memories.length;
    const halos = new THREE.BufferGeometry();
    const colours = new Float32Array(count * 3);
    this.typeColours.forEach((colour, i) => colour.toArray(colours, i * 3));
    halos.setAttribute('position', new THREE.BufferAttribute(knowledge.positions, 3));
    halos.setAttribute('aColor', new THREE.BufferAttribute(colours, 3));
    halos.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count).fill(7), 1));
    halos.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(count), 1));
    halos.setAttribute('aActivation', new THREE.BufferAttribute(new Float32Array(count * 2), 2).setUsage(THREE.DynamicDrawUsage));
    this.halos = halos;

    const nodes = new THREE.InstancedMesh(this.nodeGeometry, this.nodeMaterial, count);
    nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    nodes.name = 'memories';
    this.nodes = nodes;
    this.knowledgeOwned.push(linkGeometry, similarityGeometry, linkMaterial, similarityMaterial, halos, { dispose: () => nodes.dispose() });
    this.knowledgeGroup.add(new THREE.LineSegments(linkGeometry, linkMaterial), similarityLines, new THREE.Points(halos, this.particleMaterial), nodes);
    this.setSelected(this.selected !== null && this.selected < count ? this.selected : null);
  }

  /** Highlights the selected memory and its connections. */
  setSelected(index: number | null): void {
    this.selected = index;
    for (const child of this.selectionGroup.children) if (child instanceof THREE.LineSegments) child.geometry.dispose();
    this.selectionGroup.clear();
    const knowledge = this.knowledge;
    if (index === null || !knowledge) return;
    const touching = knowledge.edges.filter((edge) => edge.a === index || edge.b === index).map((edge) => [edge.a, edge.b] as const);
    if (touching.length) this.selectionGroup.add(new THREE.LineSegments(segments(touching, knowledge.positions), this.selectedMaterial));
  }

  // --- camera ------------------------------------------------------------------------------------

  /** Orbit controls and picking on the canvas; returns the detach function. */
  attach(camera: THREE.PerspectiveCamera, element: HTMLElement): () => void {
    this.camera = camera;
    this.element = element;
    const orbit = new OrbitControls(camera, element);
    orbit.target.copy(HOME.target);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.minDistance = 0.9;
    orbit.maxDistance = 6;
    orbit.screenSpacePanning = true;
    orbit.autoRotateSpeed = 0.55;
    orbit.update();
    this.controls = orbit;
    const start = () => {
      this.interacting = true;
      this.flight = null;
      if (this.resumeTimer) clearTimeout(this.resumeTimer);
    };
    // Auto-rotation pauses while the user moves the camera and comes back a few seconds later.
    const end = () => {
      this.resumeTimer = setTimeout(() => (this.interacting = false), 4_000);
    };
    orbit.addEventListener('start', start);
    orbit.addEventListener('end', end);

    let down: { x: number; y: number } | null = null;
    const pointerDown = (event: PointerEvent) => (down = { x: event.clientX, y: event.clientY });
    const pointerUp = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_TOLERANCE_PX) return;
      down = null;
      this.callbacks?.onSelect(this.pick(event));
    };
    const pointerMove = (event: PointerEvent) => {
      if (event.buttons) return;
      const index = this.pick(event);
      element.style.cursor = index === null ? '' : 'pointer';
      this.callbacks?.onHover(index === null ? null : { index, x: event.offsetX, y: event.offsetY });
    };
    const pointerLeave = () => this.callbacks?.onHover(null);
    element.addEventListener('pointerdown', pointerDown);
    element.addEventListener('pointerup', pointerUp);
    element.addEventListener('pointermove', pointerMove);
    element.addEventListener('pointerleave', pointerLeave);
    return () => {
      orbit.removeEventListener('start', start);
      orbit.removeEventListener('end', end);
      element.removeEventListener('pointerdown', pointerDown);
      element.removeEventListener('pointerup', pointerUp);
      element.removeEventListener('pointermove', pointerMove);
      element.removeEventListener('pointerleave', pointerLeave);
      if (this.resumeTimer) clearTimeout(this.resumeTimer);
      orbit.dispose();
      this.controls = null;
      this.camera = null;
      this.element = null;
    };
  }

  /** The memory drawn nearest the pointer, within a few pixels: small nodes stay easy to click. */
  private pick(event: PointerEvent): number | null {
    const knowledge = this.knowledge;
    if (!knowledge || !this.camera || !this.element) return null;
    const rect = this.element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const point = this.scratch.position;
    let best: number | null = null;
    let bestDistance = PICK_RADIUS_PX;
    for (let i = 0; i < knowledge.memories.length; i++) {
      point.fromArray(knowledge.positions, i * 3).project(this.camera);
      if (point.z > 1) continue; // behind the camera
      const distance = Math.hypot(((point.x + 1) / 2) * rect.width - x, ((1 - point.y) / 2) * rect.height - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  private fly(position: THREE.Vector3, target: THREE.Vector3): void {
    if (!this.controls || !this.camera) return;
    // Spend any leftover drag inertia now; otherwise it keeps moving the camera after the flight ends.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    if (this.settings.reducedMotion) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.flight = { from: this.camera.position.clone(), to: position.clone(), fromTarget: this.controls.target.clone(), toTarget: target.clone(), t: 0 };
  }

  reset(): void {
    this.fly(HOME.position, HOME.target);
  }

  flightGoal(): CameraFlightGoal | null {
    return this.flight ? { position: [this.flight.to.x, this.flight.to.y, this.flight.to.z], target: [this.flight.toTarget.x, this.flight.toTarget.y, this.flight.toTarget.z] } : null;
  }

  resumeFlight(goal: CameraFlightGoal): void {
    this.fly(new THREE.Vector3(...goal.position), new THREE.Vector3(...goal.target));
  }

  focus(index: number): void {
    const knowledge = this.knowledge;
    if (!knowledge || index < 0 || index >= knowledge.memories.length) return;
    const target = new THREE.Vector3().fromArray(knowledge.positions, index * 3);
    const outward = target.clone().sub(HOME.target).normalize();
    this.fly(target.clone().add(outward.multiplyScalar(FOCUS_DISTANCE)), target);
  }

  orbit(azimuth: number, polar: number): void {
    if (!this.controls || !this.camera) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += azimuth;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + polar, 0.15, Math.PI - 0.15);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    this.controls.update();
  }

  zoom(factor: number): void {
    if (!this.controls || !this.camera) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance));
    this.controls.update();
  }

  /**
   * A real retrieval: the memory pulses, impulses run along its real relations, and the brain region
   * around it lights up. With reduced motion the same nodes light without moving impulses.
   */
  activate(index: number): void {
    const knowledge = this.knowledge;
    if (!knowledge || !this.real || index < 0 || index >= knowledge.memories.length) return;
    const reduced = this.settings.reducedMotion;
    if (reduced) this.real.highlight(index, 1.4, 'real');
    else this.real.fire(index, 1.4, 'real');
    const x = knowledge.positions[index * 3] ?? 0;
    const y = knowledge.positions[index * 3 + 1] ?? 0;
    const z = knowledge.positions[index * 3 + 2] ?? 0;
    const near: { node: number; d: number }[] = [];
    const p = this.network.nodePositions;
    for (let n = 0; n < this.network.nodeCount; n++) {
      const d = ((p[n * 3] ?? 0) - x) ** 2 + ((p[n * 3 + 1] ?? 0) - y) ** 2 + ((p[n * 3 + 2] ?? 0) - z) ** 2;
      if (d < 0.05) near.push({ node: n, d });
    }
    for (const { node } of near.sort((a, b) => a.d - b.d).slice(0, 6)) {
      if (reduced) this.decor.highlight(node, 1, 'real');
      else this.decor.fire(node, 1, 'real');
    }
  }

  // --- per frame ---------------------------------------------------------------------------------

  frame(delta: number, renderer: THREE.WebGLRenderer): void {
    const dt = Math.min(delta, 0.05);
    const effects = INTENSITY[this.settings.intensity];
    const motion = !this.settings.reducedMotion && effects.ambient > 0;
    if (motion) this.clock += dt;
    this.decor.step(dt);
    this.real?.step(dt);
    this.moveCamera(dt);

    const pixelRatio = renderer.getPixelRatio();
    uniform(this.particleMaterial, 'uTime', this.clock);
    uniform(this.particleMaterial, 'uPixelRatio', pixelRatio);
    uniform(this.particleMaterial, 'uGlow', effects.glow);
    uniform(this.particleMaterial, 'uTwinkle', motion ? 1 : 0);
    uniform(this.impulseMaterial, 'uPixelRatio', pixelRatio);
    uniform(this.bokehMaterial, 'uTime', this.clock);
    uniform(this.bokehMaterial, 'uPixelRatio', pixelRatio);
    uniform(this.bokehMaterial, 'uDrift', motion ? 1 : 0);

    this.updateBrain();
    const realCount = this.updateImpulses();
    this.updateMemories();
    this.report(renderer, realCount);
  }

  private moveCamera(dt: number): void {
    const orbit = this.controls;
    const camera = this.camera;
    if (!orbit || !camera) return;
    const f = this.flight;
    if (f) {
      f.t = Math.min(1, f.t + dt / 0.9);
      const ease = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      camera.position.lerpVectors(f.from, f.to, ease);
      orbit.target.lerpVectors(f.fromTarget, f.toTarget, ease);
      if (f.t >= 1) this.flight = null;
    }
    orbit.autoRotate = this.settings.autoRotate && !this.settings.reducedMotion && !this.interacting && !this.flight;
    orbit.update(dt);
  }

  private updateBrain(): void {
    const network = this.network;
    const activation = this.particles.getAttribute('aActivation') as THREE.BufferAttribute;
    const act = activation.array as Float32Array;
    for (let n = 0; n < network.nodeCount; n++) {
      const p = (network.nodeParticle[n] ?? 0) * 2;
      const realPart = this.decor.realActivation[n] ?? 0;
      act[p] = Math.max(0, (this.decor.nodeActivation[n] ?? 0) - realPart);
      act[p + 1] = realPart;
    }
    activation.needsUpdate = true;
    const edgeActivation = this.edges.getAttribute('aActivation') as THREE.BufferAttribute;
    const edgeAct = edgeActivation.array as Float32Array;
    for (let e = 0; e < network.edgeCount; e++) {
      const realPart = Math.min(this.decor.realActivation[network.edges[e * 2] ?? 0] ?? 0, this.decor.realActivation[network.edges[e * 2 + 1] ?? 0] ?? 0);
      const ambientPart = Math.max(0, (this.decor.edgeActivation[e] ?? 0) - realPart);
      edgeAct[e * 4] = ambientPart;
      edgeAct[e * 4 + 1] = realPart;
      edgeAct[e * 4 + 2] = ambientPart;
      edgeAct[e * 4 + 3] = realPart;
    }
    edgeActivation.needsUpdate = true;
  }

  /** Impulse heads and fading trails, from the brain network and from memory relations. */
  private updateImpulses(): number {
    const position = this.impulses.getAttribute('position') as THREE.BufferAttribute;
    const colour = this.impulses.getAttribute('aColor') as THREE.BufferAttribute;
    const size = this.impulses.getAttribute('aSize') as THREE.BufferAttribute;
    const alpha = this.impulses.getAttribute('aAlpha') as THREE.BufferAttribute;
    const positions = position.array as Float32Array;
    const colours = colour.array as Float32Array;
    const sizes = size.array as Float32Array;
    const alphas = alpha.array as Float32Array;
    const capacity = position.count;
    let used = 0;
    let realCount = 0;
    const draw = (field: ImpulseField, impulse: Impulse) => {
      const isReal = impulse.kind === 'real';
      if (isReal) realCount++;
      const step = 0.016 / field.edgeLength(impulse.edge);
      const head = isReal ? PALETTE.realHead : PALETTE.ambientHead;
      for (let k = 0; k < TRAIL && used < capacity; k++) {
        field.pointOn(impulse, impulse.progress - k * step, positions, used * 3);
        head.toArray(colours, used * 3);
        sizes[used] = (isReal ? 15 : 9) * (1 - k / (TRAIL + 1));
        alphas[used] = impulse.strength * (isReal ? 1.6 : 1.1) * (1 - k / TRAIL) ** 1.6;
        used++;
      }
    };
    for (const impulse of this.decor.impulses) draw(this.decor, impulse);
    if (this.real) for (const impulse of this.real.impulses) draw(this.real, impulse);
    this.impulses.setDrawRange(0, used);
    position.needsUpdate = true;
    colour.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
    return realCount;
  }

  /** Memory nodes: type colour, warmer and larger while a real retrieval lights them, white when selected. */
  private updateMemories(): void {
    const { nodes, knowledge, real, halos, scratch } = this;
    if (!nodes || !knowledge || !real || !halos) return;
    const haloActivation = halos.getAttribute('aActivation') as THREE.BufferAttribute;
    const haloAct = haloActivation.array as Float32Array;
    for (let i = 0; i < knowledge.memories.length; i++) {
      const lit = Math.min(1.2, real.realActivation[i] ?? 0);
      const chosen = this.selected === i;
      scratch.position.fromArray(knowledge.positions, i * 3);
      scratch.scale.setScalar((chosen ? 1.35 : 1) * (1 + lit * 0.9));
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      nodes.setMatrixAt(i, scratch.matrix);
      scratch.colour.copy(this.typeColours[i] ?? PALETTE.white).lerp(PALETTE.realHead, Math.min(1, lit));
      if (chosen) scratch.colour.lerp(PALETTE.white, 0.7);
      nodes.setColorAt(i, scratch.colour);
      haloAct[i * 2] = chosen ? 0.6 : 0;
      haloAct[i * 2 + 1] = lit;
    }
    nodes.instanceMatrix.needsUpdate = true;
    if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
    // Picking uses the bounding sphere; it must follow the instances.
    nodes.computeBoundingSphere();
    haloActivation.needsUpdate = true;
  }

  /** Frame rate, impulses and GPU resources in use, twice a second. */
  private report(renderer: THREE.WebGLRenderer, realCount: number): void {
    const s = this.stats;
    const now = performance.now();
    if (!s.windowStart) s.windowStart = now;
    s.frames++;
    s.windowFrames++;
    if (now - s.windowStart < 500) return;
    this.callbacks?.onStats({
      fps: Math.round((s.windowFrames * 1000) / (now - s.windowStart)),
      frames: s.frames,
      impulses: this.decor.impulses.length + (this.real?.impulses.length ?? 0),
      realImpulses: realCount,
      particles: this.cloud.count,
      connections: this.network.edgeCount,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      flying: this.flight ? 1 : 0,
      camera: this.camera && this.controls ? [...this.camera.position.toArray(), ...this.controls.target.toArray()].map((value) => value.toFixed(3)).join(' ') : '',
    });
    s.windowFrames = 0;
    s.windowStart = now;
  }

  dispose(): void {
    this.setKnowledge(null);
    this.selectionGroup.clear();
    this.root.clear();
    for (const item of this.owned.splice(0)) item.dispose();
  }
}
