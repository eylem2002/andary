// Water: the sea (turquoise shallows to deep blue, animated wave normals that sparkle in the sun,
// foam along the seawall and around the pier, warm town reflections at night), small pools
// (fountain basin, spa) and the fountain's falling jets.
import * as THREE from 'three';
import { BEACH, WATERLINE_Z } from './beach.js';
import { PLINTH, SEA } from './terrain.js';
import { STYLE } from './palette.js';

/** @param {number[]} rgb */
const glslVec3 = (rgb) => `vec3( ${rgb.map((c) => c.toFixed(3)).join(', ')} )`;

const WATER_VERTEX_PARS = /* glsl */ `
varying vec3 vWaterWorld;
`;
const WATER_VERTEX = /* glsl */ `
#include <project_vertex>
vWaterWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const WATER_FRAGMENT_PARS = /* glsl */ `
uniform float uTtTime;
uniform float uTtNight;
uniform vec4 uPier;
uniform float uShoreZ;
uniform vec2 uBeach;
varying vec3 vWaterWorld;

float wHash( vec2 p ) { return fract( sin( dot( p, vec2( 41.3, 289.1 ) ) ) * 43758.5453 ); }
float wNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wHash( i ), wHash( i + vec2( 1, 0 ) ), f.x ), mix( wHash( i + vec2( 0, 1 ) ), wHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
// Gradient of a few travelling waves (analytic, so normals are cheap and smooth).
vec2 wSlope( vec2 p, float t ) {
  vec2 g = vec2( 0.0 );
  vec2 d1 = normalize( vec2( 0.3, 1.0 ) ); float k1 = 1.7; float a1 = 0.05;
  vec2 d2 = normalize( vec2( -0.8, 0.6 ) ); float k2 = 2.9; float a2 = 0.03;
  vec2 d3 = normalize( vec2( 0.9, 0.2 ) ); float k3 = 5.3; float a3 = 0.016;
  g += d1 * k1 * a1 * cos( dot( d1, p ) * k1 + t * 1.1 );
  g += d2 * k2 * a2 * cos( dot( d2, p ) * k2 + t * 1.6 );
  g += d3 * k3 * a3 * cos( dot( d3, p ) * k3 + t * 2.3 );
  float n = wNoise( p * 3.1 + t * 0.4 ) - wNoise( p * 3.1 - t * 0.3 + 7.0 );
  g += vec2( n, -n ) * 0.12;
  return g;
}
float wRectDistance( vec2 p, vec4 r ) {
  vec2 c = vec2( r.x + r.y, r.z + r.w ) * 0.5;
  vec2 h = vec2( r.y - r.x, r.w - r.z ) * 0.5;
  vec2 q = abs( p - c ) - h;
  return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 );
}
`;

const SEA_COLOR = /* glsl */ `
#include <color_fragment>
// West of the groyne the water ends on the beach, further out than the seawall; the two blend
// across the groyne so no line shows in open water.
float wShore = mix( uBeach.y, uShoreZ, smoothstep( uBeach.x - 1.5, uBeach.x + 2.5, vWaterWorld.x ) );
float wDepth = clamp( ( wShore - vWaterWorld.z ) / 11.0, 0.0, 1.0 );
float wPierD = wRectDistance( vWaterWorld.xz, uPier );
wDepth = min( wDepth, clamp( wPierD / 3.0 + 0.15, 0.0, 1.0 ) );
vec3 wShallow = ${glslVec3(STYLE.water.shallow)};
vec3 wDeep = ${glslVec3(STYLE.water.deep)};
diffuseColor.rgb = mix( wShallow, wDeep, smoothstep( 0.0, 1.0, wDepth ) );
float wShoreDist = min( wShore - vWaterWorld.z, wPierD );
float wFoamBand = 1.0 - smoothstep( 0.05, 0.55, wShoreDist + ( wNoise( vWaterWorld.xz * 2.0 + uTtTime * 0.5 ) - 0.5 ) * 0.35 );
float wFoamRipple = smoothstep( 0.62, 0.7, wNoise( vWaterWorld.xz * 3.5 - uTtTime * 0.6 ) ) * ( 1.0 - smoothstep( 0.3, 1.4, wShoreDist ) );
float wFoam = clamp( wFoamBand + wFoamRipple * 0.6, 0.0, 1.0 );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.96, 0.95 ), wFoam * 0.85 );
`;

const SEA_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
vec2 wG = wSlope( vWaterWorld.xz, uTtTime );
vec3 wN = normalize( vec3( -wG.x, 1.0, -wG.y ) );
normal = normalize( ( viewMatrix * vec4( wN, 0.0 ) ).xyz );
`;

const SEA_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
// Shimmering reflections of the town's neon near the shore at night, pink and cyan.
float wNear = 1.0 - smoothstep( 0.0, 3.5, mix( uBeach.y, uShoreZ, smoothstep( uBeach.x - 1.5, uBeach.x + 2.5, vWaterWorld.x ) ) - vWaterWorld.z );
float wStreak = smoothstep( 0.55, 0.95, wNoise( vec2( vWaterWorld.x * 2.2, vWaterWorld.z * 9.0 + uTtTime * 0.7 ) ) );
totalEmissiveRadiance += mix( ${glslVec3(STYLE.water.streakA)}, ${glslVec3(STYLE.water.streakB)}, step( 0.5, fract( vWaterWorld.x * 0.21 ) ) ) * wNear * wStreak * uTtNight * 0.6;
`;

/**
 * @param {THREE.MeshStandardMaterial} material
 * @param {Record<string, {value: any}>} uniforms
 * @param {{color: string, normal: string, emissive: string, key: string}} parts
 */
function patchWater(material, uniforms, parts) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WATER_VERTEX_PARS}`)
      .replace('#include <project_vertex>', WATER_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', parts.color)
      .replace('#include <normal_fragment_maps>', parts.normal)
      .replace('#include <emissivemap_fragment>', parts.emissive);
  };
  material.customProgramCacheKey = () => parts.key;
}

/**
 * The sea surface north of the seawall.
 * @param {import('./town-material.js').TownUniforms} town
 * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} pier  world rect of the pier
 */
export function createSea(town, pier) {
  const { minX, maxX, minZ } = PLINTH;
  const w = maxX - minX - 0.12;
  const d = SEA.shoreZ - minZ - 0.12;
  const geometry = new THREE.PlaneGeometry(w, d, 1, 1).rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0 });
  material.name = 'sea';
  patchWater(material, {
    uTtTime: town.uTtTime,
    uTtNight: town.uTtNight,
    uPier: { value: new THREE.Vector4(pier.minX, pier.maxX, pier.minZ, pier.maxZ) },
    uShoreZ: { value: SEA.shoreZ },
    uBeach: { value: new THREE.Vector2(BEACH.maxX, WATERLINE_Z) },
  }, { color: SEA_COLOR, normal: SEA_NORMAL, emissive: SEA_EMISSIVE, key: 'sea' });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sea';
  mesh.position.set((minX + maxX) / 2, SEA.level, (minZ + SEA.shoreZ) / 2);
  mesh.receiveShadow = true;
  return mesh;
}

const POOL_COLOR = /* glsl */ `
#include <color_fragment>
float pRing = sin( length( vWaterWorld.xz - uPier.xy ) * 9.0 - uTtTime * 3.0 ) * 0.5 + 0.5;
float pCaustic = smoothstep( 0.55, 0.9, wNoise( vWaterWorld.xz * 4.0 + uTtTime * 0.5 ) * wNoise( vWaterWorld.xz * 3.0 - uTtTime * 0.4 + 3.0 ) * 1.8 );
diffuseColor.rgb = mix( vec3( 0.18, 0.66, 0.72 ), vec3( 0.55, 0.88, 0.9 ), pCaustic * 0.6 + pRing * 0.08 );
`;

const POOL_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
vec2 pG = wSlope( vWaterWorld.xz * 2.5, uTtTime * 1.4 ) * 0.5;
normal = normalize( ( viewMatrix * vec4( normalize( vec3( -pG.x, 1.0, -pG.y ) ), 0.0 ) ).xyz );
`;

const POOL_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
// Underwater lights make pools glow softly at night.
totalEmissiveRadiance += vec3( 0.2, 0.75, 0.85 ) * uTtNight * 0.35;
`;

/**
 * Material for small pools (fountain basin, spa). uPier.xy is reused as the ripple centre.
 * @param {import('./town-material.js').TownUniforms} town
 * @param {number} cx  ripple centre (world x)
 * @param {number} cz  ripple centre (world z)
 */
export function createPoolMaterial(town, cx, cz) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0 });
  material.name = 'pool';
  patchWater(material, {
    uTtTime: town.uTtTime,
    uTtNight: town.uTtNight,
    uPier: { value: new THREE.Vector4(cx, cz, 0, 0) },
    uShoreZ: { value: 0 },
    uBeach: { value: new THREE.Vector2(-1e4, 0) },
  }, { color: POOL_COLOR, normal: POOL_NORMAL, emissive: POOL_EMISSIVE, key: 'pool' });
  // Each pool has its own ripple centre but shares the program.
  return material;
}

const JET_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const JET_FRAGMENT = /* glsl */ `
uniform float uTtTime;
uniform float uTtNight;
varying vec2 vUv;
float jHash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
void main() {
  float streak = jHash( vec2( floor( vUv.x * 18.0 ), 0.0 ) );
  float flow = fract( vUv.y * 3.0 + uTtTime * ( 1.6 + streak ) );
  float a = ( 0.15 + 0.5 * smoothstep( 0.35, 0.95, flow ) ) * ( 0.35 + 0.65 * streak );
  vec3 col = mix( vec3( 0.62, 0.86, 0.95 ), vec3( 0.5, 0.8, 1.0 ), uTtNight );
  gl_FragColor = vec4( col * ( 1.0 + uTtNight * 0.8 ), a * 0.55 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Translucent, flowing material for the fountain's water jets and curtains.
 * @param {import('./town-material.js').TownUniforms} town
 */
export function createJetMaterial(town) {
  return new THREE.ShaderMaterial({
    name: 'fountain-jet',
    uniforms: { uTtTime: town.uTtTime, uTtNight: town.uTtNight },
    vertexShader: JET_VERTEX,
    fragmentShader: JET_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
