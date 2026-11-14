// GLSL for the brain. Points are drawn as soft discs with additive blending, so overlapping particles
// build up the glow of the reference image without a post-processing pass.

/** Brain particles: twinkle, ambient activation (warm amber) and real activation (warm white). */
export const particleVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uGlow;
  uniform float uTwinkle;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  attribute vec2 aActivation;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float twinkle = 1.0 + uTwinkle * 0.35 * sin(uTime * (0.6 + aPhase * 1.7) + aPhase * 40.0);
    float ambient = min(aActivation.x, 1.4);
    float real = min(aActivation.y, 1.4);
    vec3 lit = mix(aColor, vec3(1.0, 0.8, 0.55), clamp(ambient, 0.0, 1.0));
    vColor = mix(lit, vec3(1.0, 0.93, 0.78), clamp(real, 0.0, 1.0));
    vAlpha = (0.55 + 0.45 * twinkle) * uGlow + ambient * 0.9 + real * 1.4;
    gl_PointSize = aSize * (1.0 + ambient * 1.4 + real * 2.6) * uPixelRatio * (2.6 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const softPointFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * core * core * vAlpha, 1.0);
  }
`;

/** Network connections: faint at rest, brighter where an impulse just passed. */
export const edgeVertex = /* glsl */ `
  uniform float uBase;
  attribute vec2 aActivation;
  varying vec3 vColor;
  void main() {
    float ambient = min(aActivation.x, 1.2);
    float real = min(aActivation.y, 1.2);
    vec3 rest = vec3(0.72, 0.28, 0.05);
    vColor = rest * uBase + vec3(1.0, 0.62, 0.2) * ambient * 0.55 + vec3(1.0, 0.9, 0.7) * real * 0.8;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const edgeFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

/** Impulses: a bright head with a short fading trail; real impulses are larger and warm white. */
export const impulseVertex = /* glsl */ `
  uniform float uPixelRatio;
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vColor = aColor;
    vAlpha = aAlpha;
    gl_PointSize = aSize * uPixelRatio * (2.6 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/** Out-of-focus particles far behind the brain, like the bokeh in the reference. */
export const bokehVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uDrift;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.y += uDrift * 0.08 * sin(uTime * 0.07 + aPhase * 6.28);
    p.z += uDrift * 0.08 * cos(uTime * 0.05 + aPhase * 3.1);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    vColor = aColor;
    vAlpha = 0.16 + 0.06 * sin(uTime * 0.2 * uDrift + aPhase * 9.0);
    gl_PointSize = aSize * uPixelRatio * (2.6 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const bokehFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float disc = smoothstep(0.5, 0.18, d);
    gl_FragColor = vec4(vColor * disc * vAlpha, 1.0);
  }
`;
