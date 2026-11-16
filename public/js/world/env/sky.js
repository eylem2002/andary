// The sky: a screen-space gradient behind the floating plinth (no hard horizon, stars at night)
// and a matching image-based-lighting environment so glass and gold reflect the sky's colours.
import * as THREE from 'three';

const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 1.0, 1.0 );
}`;

const BACKDROP_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform float uStars;
uniform float uTime;
varying vec2 vUv;

float hash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}

void main() {
  float y = vUv.y;
  vec3 col = mix( uBottom, uHorizon, smoothstep( 0.0, 0.55, y ) );
  col = mix( col, uZenith, smoothstep( 0.5, 1.05, y ) );
  // A faint glow low in the sky keeps the backdrop from looking flat.
  col += uHorizon * 0.06 * ( 1.0 - abs( vUv.x - 0.5 ) * 1.4 ) * smoothstep( 0.2, 0.55, y ) * smoothstep( 0.9, 0.55, y );
  if ( uStars > 0.0 ) {
    // One candidate star per 7 px cell, at a random spot in the cell, drawn as a soft point.
    vec2 cell = floor( gl_FragCoord.xy / 7.0 );
    float h = hash( cell );
    vec2 spot = ( cell + vec2( hash( cell + 3.1 ), hash( cell + 7.7 ) ) ) * 7.0;
    float d = length( gl_FragCoord.xy - spot );
    float bright = step( 0.985, h ) * ( 0.35 + 0.65 * hash( cell + 1.9 ) );
    float star = bright * smoothstep( 1.3, 0.2, d ) * smoothstep( 0.3, 0.75, y );
    float twinkle = 0.7 + 0.3 * sin( uTime * ( 1.0 + h * 3.0 ) + h * 40.0 );
    col += vec3( 0.92, 0.95, 1.0 ) * star * twinkle * uStars;
  }
  // Dither to hide banding in the smooth gradient.
  col += ( hash( gl_FragCoord.xy + fract( uTime ) ) - 0.5 ) / 255.0;
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Full-screen gradient drawn first behind everything.
 * @returns {THREE.Mesh & {material: THREE.ShaderMaterial}}
 */
export function createBackdrop() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.ShaderMaterial({
    name: 'sky-backdrop',
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uStars: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: BACKDROP_VERTEX,
    fragmentShader: BACKDROP_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = /** @type {THREE.Mesh & {material: THREE.ShaderMaterial}} */ (new THREE.Mesh(geometry, material));
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

const ENV_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSun;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  vec3 sky = mix( uHorizon, uZenith, smoothstep( 0.0, 0.7, d.y ) );
  vec3 col = d.y >= 0.0 ? sky : mix( uHorizon * 0.7, uGround, smoothstep( 0.0, -0.4, d.y ) );
  float sun = smoothstep( 0.985, 0.998, dot( d, normalize( uSunDir ) ) );
  col += uSun * sun * 6.0;
  gl_FragColor = vec4( col, 1.0 );
}`;

const ENV_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

/**
 * Builds the reflection environment from the sky colours with PMREM. Regenerating costs a few
 * render passes, so callers throttle it to noticeable sky changes.
 * @param {THREE.WebGLRenderer} renderer
 */
export function createSkyEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    name: 'sky-env',
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: ENV_VERTEX,
    fragmentShader: ENV_FRAGMENT,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material);
  scene.add(sphere);
  /** @type {THREE.WebGLRenderTarget|null} */
  let target = null;
  return {
    material,
    /** Re-renders the environment; returns the new texture. */
    update() {
      const next = pmrem.fromScene(scene, 0.03, 0.1, 50);
      target?.dispose();
      target = next;
      return next.texture;
    },
    dispose() {
      target?.dispose();
      pmrem.dispose();
      sphere.geometry.dispose();
      material.dispose();
    },
  };
}
