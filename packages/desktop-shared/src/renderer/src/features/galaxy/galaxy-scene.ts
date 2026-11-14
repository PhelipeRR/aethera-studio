import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/*
 * Memory Galaxy scene (lote 50.06), outside React. Two layers never mix:
 *  - the black hole (event horizon, accretion disk, photon ring, halo): decorative, never picked or counted;
 *  - the stars: exactly one point per real memory, the only pickable things.
 * The arm glow is drawn from the stars themselves (a wide, faint pass over the same points), so no light in the
 * galaxy exists without a memory behind it.
 */

export const STAR_STATE = { dimmed: -1, normal: 0, match: 1, selected: 2, hovered: 3 } as const;

export interface SceneStats {
  frames: number;
  fps: number;
  /** ms from construction to the first frame with stars. */
  firstStarsFrameMs: number | null;
}

export interface GalaxySceneOptions {
  reducedMotion: boolean;
  pixelRatioCap?: number;
  onPick: (index: number | null) => void;
  onHover: (index: number | null) => void;
  /** Called once, with performance.now(), on the first frame that draws the stars. */
  onFirstStars?: (at: number) => void;
}

const HOME = { position: new THREE.Vector3(0, 15.5, 27.5), target: new THREE.Vector3(0, -1.2, 0) };
const PICK_RADIUS_PX = 14;
const CLICK_TOLERANCE_PX = 5;

const additive = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

const starVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aState;
  attribute float aPulse;
  uniform float uClock;
  varying float vPulse;
  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uSpread;
  varying vec3 vColor;
  varying float vState;
  varying float vTwinkle;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float distanceScale = clamp(16.0 / -mv.z, 0.55, 2.6);
    // The arm glow is a far-field effect: it never grows past its overview size when the camera comes close.
    if (uSpread > 1.5) distanceScale = min(distanceScale, 0.75);
    float stateScale = aState > 2.5 ? 2.1 : aState > 1.5 ? 2.6 : aState > 0.5 ? 1.7 : aState < -0.5 ? 0.7 : 1.0;
    // A real recall (MCP or RAG context) lights the star for a few seconds.
    vPulse = clamp(1.0 - (uClock - aPulse) / 6.0, 0.0, 1.0);
    stateScale *= 1.0 + vPulse * 1.8;
    vTwinkle = 0.86 + 0.14 * sin(uTime * 1.3 + position.x * 3.1 + position.z * 1.7);
    gl_PointSize = max(1.6, aSize * uSpread * uPixelRatio * distanceScale * stateScale);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vState = aState;
  }
`;

const starFragment = /* glsl */ `
  uniform float uGlowPass;
  uniform float uGlowGain;
  varying vec3 vColor;
  varying float vState;
  varying float vTwinkle;
  varying float vPulse;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    if (uGlowPass > 0.5) {
      // Wide, faint pass: the arms glow where memories are dense.
      float haze = exp(-d * d * 7.0) * (vState < -0.5 ? 0.015 : 0.11) * uGlowGain;
      gl_FragColor = vec4(vColor * 0.9, haze);
      return;
    }
    float core = smoothstep(0.5, 0.0, d);
    float glow = exp(-d * d * 30.0);
    float alpha = (core * 0.7 + glow * 1.15) * vTwinkle;
    vec3 colour = mix(vColor, vec3(1.0, 0.97, 0.9), glow * 0.55);
    if (vState > 1.5) { colour = mix(colour, vec3(1.0, 0.92, 0.7), 0.5); alpha *= 1.4; }
    colour = mix(colour, vec3(1.0, 0.86, 0.5), vPulse * 0.7);
    alpha *= 1.0 + vPulse;
    if (vState < -0.5) alpha *= 0.16;
    gl_FragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
  }
`;

const diskVertex = /* glsl */ `
  varying vec2 vPolar;
  varying vec3 vWorld;
  uniform float uInner;
  uniform float uOuter;
  void main() {
    float r = length(position.xy);
    vPolar = vec2((r - uInner) / (uOuter - uInner), atan(position.y, position.x));
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const diskFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCameraRight;
  varying vec2 vPolar;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float r = clamp(vPolar.x, 0.0, 1.0);
    float a = vPolar.y;
    // Matter spirals inward: the pattern turns faster near the horizon.
    float swirl = a * 3.0 + log(0.08 + r) * 5.5 - uTime * (0.9 + 1.6 * (1.0 - r));
    float streaks = noise(vec2(swirl * 2.2, r * 22.0)) * 0.6 + noise(vec2(swirl * 5.0, r * 48.0)) * 0.4;
    float falloff = pow(1.0 - r, 1.7) * smoothstep(0.0, 0.05, r);
    float hot = smoothstep(0.32, 0.0, r);
    // Relativistic beaming: the side moving towards the camera is brighter.
    float beam = 1.0 + 0.55 * dot(normalize(vec3(-vWorld.z, 0.0, vWorld.x)), uCameraRight);
    vec3 gold = vec3(0.85, 0.66, 0.36);
    vec3 cream = vec3(1.0, 0.93, 0.78);
    vec3 colour = mix(gold, cream, hot) * (0.45 + 0.9 * streaks);
    float alpha = falloff * (0.5 + 1.1 * streaks) * beam;
    gl_FragColor = vec4(colour * beam, clamp(alpha, 0.0, 1.0));
  }
`;

const billboardVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv - 0.5;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
    mv.xy += position.xy * scale;
    gl_Position = projectionMatrix * mv;
  }
`;

const ringFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float d = length(vUv) * 2.0;
    float ring = exp(-pow((d - 0.42) * 26.0, 2.0));
    float lensed = exp(-pow((d - 0.5) * 9.0, 2.0)) * 0.35 * (0.6 + 0.4 * abs(vUv.y * 2.0 / max(d, 0.001)));
    float halo = exp(-d * d * 5.5) * 0.22;
    float flicker = 0.94 + 0.06 * sin(uTime * 2.1);
    vec3 colour = mix(vec3(0.82, 0.6, 0.3), vec3(1.0, 0.88, 0.62), ring * 0.7);
    float alpha = (ring * 0.7 + lensed + halo) * flicker;
    gl_FragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
  }
`;

export class GalaxyScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly starGeometry = new THREE.BufferGeometry();
  private readonly starMaterial: THREE.ShaderMaterial;
  private readonly glowMaterial: THREE.ShaderMaterial;
  private readonly diskMaterial: THREE.ShaderMaterial;
  private readonly ringMaterial: THREE.ShaderMaterial;
  private readonly linkMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color('#e2c486'), transparent: true, opacity: 0.38, depthWrite: false });
  private links: THREE.LineSegments | null = null;
  private beams: { line: THREE.Line; start: number }[] = [];
  private stars: THREE.Points | null = null;
  private glow: THREE.Points | null = null;
  private positions: Float32Array = new Float32Array(0);
  private labelAnchors: { point: THREE.Vector3; element: HTMLElement }[] = [];
  private frame = 0;
  private running = true;
  private reducedMotion: boolean;
  private time = 0;
  private flight: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;
  private readonly started = performance.now();
  private firstStarsFrameMs: number | null = null;
  private frames = 0;
  private fps = 0;
  private fpsWindow: { start: number; frames: number } = { start: performance.now(), frames: 0 };
  private hovered: number | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private hoverQueued = false;
  private lastPointer = { x: 0, y: 0 };
  private readonly scratch = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: GalaxySceneOptions) {
    this.reducedMotion = options.reducedMotion;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.pixelRatioCap ?? 1.75));
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.copy(HOME.position);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(HOME.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 48;
    this.controls.maxPolarAngle = Math.PI * 0.88;
    this.controls.screenSpacePanning = true;
    this.controls.autoRotateSpeed = 0.28;
    this.controls.autoRotate = !this.reducedMotion;
    this.controls.addEventListener('start', () => { this.flight = null; });

    const pixelRatio = this.renderer.getPixelRatio();
    const starUniforms = (glow: number) => ({ uPixelRatio: { value: pixelRatio }, uTime: { value: 0 }, uClock: { value: 0 }, uSpread: { value: glow ? 9 : 1 }, uGlowPass: { value: glow }, uGlowGain: { value: 1 } });
    this.starMaterial = new THREE.ShaderMaterial({ vertexShader: starVertex, fragmentShader: starFragment, uniforms: starUniforms(0), ...additive });
    this.glowMaterial = new THREE.ShaderMaterial({ vertexShader: starVertex, fragmentShader: starFragment, uniforms: starUniforms(1), ...additive });

    // Black hole: small on purpose, well inside the first stars (DISK.inner = 3.4).
    const horizon = new THREE.Mesh(new THREE.SphereGeometry(0.62, 48, 32), new THREE.MeshBasicMaterial({ color: 0x010405 }));
    horizon.renderOrder = 1;
    this.diskMaterial = new THREE.ShaderMaterial({
      vertexShader: diskVertex,
      fragmentShader: diskFragment,
      uniforms: { uTime: { value: 0 }, uInner: { value: 0.78 }, uOuter: { value: 3.1 }, uCameraRight: { value: new THREE.Vector3(1, 0, 0) } },
      side: THREE.DoubleSide,
      ...additive,
    });
    const disk = new THREE.Mesh(new THREE.RingGeometry(0.78, 3.1, 160, 1), this.diskMaterial);
    disk.rotation.x = -Math.PI / 2;
    disk.renderOrder = 2;
    this.ringMaterial = new THREE.ShaderMaterial({ vertexShader: billboardVertex, fragmentShader: ringFragment, uniforms: { uTime: { value: 0 } }, ...additive });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.ringMaterial);
    ring.scale.setScalar(3.4);
    ring.renderOrder = 3;
    ring.frustumCulled = false;
    const blackHole = new THREE.Group();
    blackHole.name = 'black-hole';
    blackHole.add(horizon, disk, ring);
    this.scene.add(blackHole);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.loop();
  }

  /** One star per memory. Colours are linear RGB triplets, sizes in pixels. */
  setStars(positions: Float32Array, colours: Float32Array, sizes: Float32Array): void {
    this.positions = positions;
    // Overlapping haze adds up: dense galaxies get a fainter glow per star so the arms keep their colour.
    const gain = this.glowMaterial.uniforms['uGlowGain'];
    if (gain) gain.value = Math.min(1, Math.max(0.22, Math.sqrt(400 / Math.max(1, positions.length / 3))));
    this.starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starGeometry.setAttribute('aColor', new THREE.BufferAttribute(colours, 3));
    this.starGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.starGeometry.setAttribute('aState', new THREE.BufferAttribute(new Float32Array(positions.length / 3), 1).setUsage(THREE.DynamicDrawUsage));
    this.starGeometry.setAttribute('aPulse', new THREE.BufferAttribute(new Float32Array(positions.length / 3).fill(-1000), 1).setUsage(THREE.DynamicDrawUsage));
    this.starGeometry.computeBoundingSphere();
    if (!this.stars) {
      this.glow = new THREE.Points(this.starGeometry, this.glowMaterial);
      this.stars = new THREE.Points(this.starGeometry, this.starMaterial);
      this.glow.renderOrder = 0;
      this.stars.renderOrder = 4;
      this.scene.add(this.glow, this.stars);
    }
  }

  /**
   * Lights stars that were really retrieved (lote 50.07): a glow on the star and a fading beam from the black hole,
   * the core that pulls knowledge in. Beams are few and short-lived; with reduced motion they appear without motion.
   */
  pulse(indices: readonly number[]): void {
    const attribute = this.starGeometry.getAttribute('aPulse') as THREE.BufferAttribute | undefined;
    if (!attribute) return;
    const now = this.clock.elapsedTime;
    for (const index of indices) {
      if (index < 0 || index >= attribute.count) continue;
      (attribute.array as Float32Array)[index] = now;
      const target = new THREE.Vector3(this.positions[index * 3] ?? 0, this.positions[index * 3 + 1] ?? 0, this.positions[index * 3 + 2] ?? 0);
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), target]);
      const material = new THREE.LineBasicMaterial({ color: new THREE.Color('#ffd27a'), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 5;
      this.scene.add(line);
      this.beams.push({ line, start: now });
    }
    attribute.needsUpdate = true;
    while (this.beams.length > 40) this.dropBeam(0);
  }

  private dropBeam(index: number): void {
    const [beam] = this.beams.splice(index, 1);
    if (!beam) return;
    this.scene.remove(beam.line);
    beam.line.geometry.dispose();
    (beam.line.material as THREE.Material).dispose();
  }

  setStates(states: Float32Array): void {
    const attribute = this.starGeometry.getAttribute('aState') as THREE.BufferAttribute | undefined;
    if (!attribute || attribute.count !== states.length) return;
    (attribute.array as Float32Array).set(states);
    attribute.needsUpdate = true;
  }

  /** Stored links only, as index pairs. */
  setLinks(pairs: readonly (readonly [number, number])[], visible: boolean): void {
    if (this.links) { this.scene.remove(this.links); this.links.geometry.dispose(); this.links = null; }
    if (!visible || pairs.length === 0) return;
    const vertices = new Float32Array(pairs.length * 6);
    pairs.forEach(([a, b], i) => {
      vertices.set(this.positions.subarray(a * 3, a * 3 + 3), i * 6);
      vertices.set(this.positions.subarray(b * 3, b * 3 + 3), i * 6 + 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.links = new THREE.LineSegments(geometry, this.linkMaterial);
    this.links.renderOrder = 3;
    this.scene.add(this.links);
  }

  /** HTML labels that follow 3D points (group names). Elements are moved directly, no React render per frame. */
  setLabelAnchors(anchors: { point: [number, number, number]; element: HTMLElement }[]): void {
    this.labelAnchors = anchors.map((anchor) => ({ point: new THREE.Vector3(...anchor.point), element: anchor.element }));
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on && !this.reducedMotion;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) this.controls.autoRotate = false;
  }

  /** Flies the camera to a star; instant with reduced motion. */
  focus(index: number): void {
    if (index < 0 || index * 3 >= this.positions.length) return;
    const target = new THREE.Vector3((this.positions[index * 3] ?? 0), (this.positions[index * 3 + 1] ?? 0), (this.positions[index * 3 + 2] ?? 0));
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const to = target.clone().add(direction.multiplyScalar(6.5));
    this.startFlight(to, target);
  }

  /** Flies to a point, such as the centre of a group. */
  focusPoint(point: [number, number, number], distance = 11): void {
    const target = new THREE.Vector3(...point);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.startFlight(target.clone().add(direction.multiplyScalar(distance)), target);
  }

  resetView(): void {
    this.startFlight(HOME.position.clone(), HOME.target.clone());
  }

  zoom(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
    const length = THREE.MathUtils.clamp(offset.length(), this.controls.minDistance, this.controls.maxDistance);
    this.startFlight(this.controls.target.clone().add(offset.setLength(length)), this.controls.target.clone());
  }

  /** Rotates around the target, for keyboard users. */
  orbit(radians: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), radians);
    this.startFlight(this.controls.target.clone().add(offset), this.controls.target.clone());
  }

  stats(): SceneStats {
    return { frames: this.frames, fps: this.fps, firstStarsFrameMs: this.firstStarsFrameMs };
  }

  /** Nearest star to a canvas point within the pick radius, front-most first. */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const states = (this.starGeometry.getAttribute('aState') as THREE.BufferAttribute | undefined)?.array as Float32Array | undefined;
    let best: number | null = null;
    let bestScore = Infinity;
    const count = this.positions.length / 3;
    for (let i = 0; i < count; i++) {
      if (states && (states[i] ?? 0) < -0.5) continue;
      this.scratch.set((this.positions[i * 3] ?? 0), (this.positions[i * 3 + 1] ?? 0), (this.positions[i * 3 + 2] ?? 0)).project(this.camera);
      if (this.scratch.z > 1 || this.scratch.z < -1) continue;
      const sx = (this.scratch.x * 0.5 + 0.5) * rect.width;
      const sy = (-this.scratch.y * 0.5 + 0.5) * rect.height;
      const distance = Math.hypot(sx - x, sy - y);
      if (distance > PICK_RADIUS_PX) continue;
      const score = distance + this.scratch.z * 4;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.controls.dispose();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    });
    this.starGeometry.dispose();
    this.renderer.dispose();
  }

  private startFlight(to: THREE.Vector3, toTarget: THREE.Vector3): void {
    if (this.reducedMotion) {
      this.camera.position.copy(to);
      this.controls.target.copy(toTarget);
      this.flight = null;
      return;
    }
    this.flight = { from: this.camera.position.clone(), to, fromTarget: this.controls.target.clone(), toTarget, t: 0 };
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private readonly loop = (): void => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const delta = Math.min(this.clock.getDelta(), 0.1);
    if (!this.reducedMotion) this.time += delta;
    if (this.flight) {
      this.flight.t = Math.min(1, this.flight.t + delta / 0.9);
      const eased = 1 - (1 - this.flight.t) ** 3;
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, eased);
      this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, eased);
      if (this.flight.t >= 1) this.flight = null;
    }
    this.controls.update(delta);
    this.cameraRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const clock = this.clock.elapsedTime;
    for (const material of [this.starMaterial, this.glowMaterial]) {
      const uniformClock = material.uniforms['uClock'];
      if (uniformClock) uniformClock.value = clock;
    }
    for (let b = this.beams.length - 1; b >= 0; b--) {
      const beam = this.beams[b];
      if (!beam) continue;
      const age = clock - beam.start;
      if (age > 3) this.dropBeam(b);
      else (beam.line.material as THREE.LineBasicMaterial).opacity = 0.8 * (1 - age / 3);
    }
    for (const material of [this.starMaterial, this.glowMaterial, this.diskMaterial, this.ringMaterial]) {
      const time = material.uniforms['uTime'];
      if (time) time.value = this.time;
    }
    (this.diskMaterial.uniforms['uCameraRight']?.value as THREE.Vector3 | undefined)?.copy(this.cameraRight);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();

    this.frames++;
    if (this.firstStarsFrameMs === null && this.stars) {
      this.firstStarsFrameMs = performance.now() - this.started;
      this.options.onFirstStars?.(performance.now());
    }
    this.fpsWindow.frames++;
    const now = performance.now();
    if (now - this.fpsWindow.start >= 500) {
      this.fps = (this.fpsWindow.frames * 1000) / (now - this.fpsWindow.start);
      this.fpsWindow = { start: now, frames: 0 };
    }
  };

  private updateLabels(): void {
    if (this.labelAnchors.length === 0) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    for (const anchor of this.labelAnchors) {
      this.scratch.copy(anchor.point).project(this.camera);
      const visible = this.scratch.z < 1 && Math.abs(this.scratch.x) < 1.1 && Math.abs(this.scratch.y) < 1.1;
      anchor.element.style.opacity = visible ? '' : '0';
      anchor.element.style.transform = `translate(${((this.scratch.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-this.scratch.y * 0.5 + 0.5) * height).toFixed(1)}px)`;
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_TOLERANCE_PX) return;
    this.options.onPick(this.pick(event.clientX, event.clientY));
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.lastPointer = { x: event.clientX, y: event.clientY };
    if (this.pointerDown || this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => {
      this.hoverQueued = false;
      const next = this.pick(this.lastPointer.x, this.lastPointer.y);
      this.canvas.style.cursor = next === null ? '' : 'pointer';
      if (next !== this.hovered) { this.hovered = next; this.options.onHover(next); }
    });
  };

  private readonly onPointerLeave = (): void => {
    if (this.hovered !== null) { this.hovered = null; this.options.onHover(null); }
  };

  private readonly onVisibility = (): void => {
    if (!document.hidden) this.clock.getDelta();
  };
}
