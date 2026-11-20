// The town's one shared material family: MeshStandardMaterial with vertex colours, patched so a
// single draw call can hold stucco walls, domes, glossy windows, lawns, lamps and neon.
// Per-vertex `aInfo` = [building id, surface kind, glow, seed] drives:
//  - roughness/metalness per surface kind (glass shines, metalwork is metallic),
//  - procedural detail: stucco with thin horizontal reveals on walls, lawn speckle, cliff strata,
//  - night glow: windows switch on one by one at dusk and some go dark late at night,
//  - per-building highlight (emissive lift + rim) and pulse bounce (squash and stretch).
import * as THREE from 'three';
import { STYLE } from './palette.js';

/** @param {number[]} rgb */
const glslVec3 = (rgb) => `vec3( ${rgb.map((c) => c.toFixed(3)).join(', ')} )`;
const STRATA = STYLE.strata;

/** Number of building slots in the shader (index 0 = not a building). */
const BUILDING_SLOTS = 16;

/** Uniforms shared by every town material; update them once and all materials follow. */
export function createTownUniforms() {
  return {
    uTtTime: { value: 0 },
    uTtNight: { value: 0 },
    uTtLate: { value: 0 },
    uTtGlowGain: { value: 3 },
    uTtSway: { value: 1 },
    uTtHighlightColor: { value: new THREE.Color(0xffd98a) },
    uTtWarmA: { value: new THREE.Color(0xffc56e) },
    uTtWarmB: { value: new THREE.Color(0xffe2b0) },
    uTtBState: { value: Array.from({ length: BUILDING_SLOTS }, () => new THREE.Vector4()) },
    uTtBCenter: { value: Array.from({ length: BUILDING_SLOTS }, () => new THREE.Vector3()) },
  };
}

/** @typedef {ReturnType<typeof createTownUniforms>} TownUniforms */

const VERTEX_PARS = /* glsl */ `
attribute vec4 aInfo;
uniform vec4 uTtBState[${BUILDING_SLOTS}];
uniform vec3 uTtBCenter[${BUILDING_SLOTS}];
uniform float uTtTime;
uniform float uTtSway;
varying vec4 vTtInfo;
varying vec3 vTtWorld;
varying vec3 vTtNormalW;
varying float vTtHighlight;
`;

// Replaces three's project_vertex so the bounce can happen in world space (also for instances).
const VERTEX_PROJECT = /* glsl */ `
#ifdef TT_SWAY
  // Trees lean in the wind; weight by height so trunks stay planted.
  #ifdef USE_INSTANCING
    float ttPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.61;
  #else
    float ttPhase = 0.0;
  #endif
  float ttLean = max( 0.0, position.y - 0.35 ) * uTtSway;
  transformed.x += ( sin( uTtTime * 1.3 + ttPhase ) * 0.6 + sin( uTtTime * 2.9 + ttPhase * 1.7 ) * 0.25 ) * 0.035 * ttLean;
  transformed.z += cos( uTtTime * 1.1 + ttPhase * 1.3 ) * 0.025 * ttLean;
#endif
vec4 ttWorld = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  ttWorld = batchingMatrix * ttWorld;
#endif
#ifdef USE_INSTANCING
  ttWorld = instanceMatrix * ttWorld;
#endif
ttWorld = modelMatrix * ttWorld;
int ttId = int( aInfo.x + 0.5 );
vec4 ttState = uTtBState[ ttId ];
#ifdef TT_BOUNCE
  vec3 ttC = uTtBCenter[ ttId ];
  float ttB = ttState.x;
  ttWorld.xyz = ttC + ( ttWorld.xyz - ttC ) * vec3( 1.0 - 0.5 * ttB, 1.0 + ttB, 1.0 - 0.5 * ttB );
#endif
vTtWorld = ttWorld.xyz;
vTtInfo = aInfo;
vTtHighlight = ttState.y;
vec3 ttN = objectNormal;
#ifdef USE_INSTANCING
  ttN = mat3( instanceMatrix ) * ttN;
#endif
vTtNormalW = normalize( mat3( modelMatrix ) * ttN );
vec4 mvPosition = viewMatrix * ttWorld;
gl_Position = projectionMatrix * mvPosition;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uTtTime;
uniform float uTtNight;
uniform float uTtLate;
uniform float uTtGlowGain;
uniform vec3 uTtHighlightColor;
uniform vec3 uTtWarmA;
uniform vec3 uTtWarmB;
varying vec4 vTtInfo;
varying vec3 vTtWorld;
varying vec3 vTtNormalW;
varying float vTtHighlight;

// Roughness / metalness per surface kind (palette.js S).
const float TT_ROUGH[14] = float[14]( 0.86, 0.82, 0.96, 0.1, 0.26, 0.4, 0.45, 0.36, 0.16, 0.9, 0.6, 0.97, 0.4, 0.95 );
const float TT_METAL[14] = float[14]( 0.0, 0.0, 0.0, 0.0, 1.0, 0.05, 0.0, 0.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0 );

float ttHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

float ttNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( ttHash( i ), ttHash( i + vec3( 1, 0, 0 ) ), f.x ),
                   mix( ttHash( i + vec3( 0, 1, 0 ) ), ttHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( ttHash( i + vec3( 0, 0, 1 ) ), ttHash( i + vec3( 1, 0, 1 ) ), f.x ),
                   mix( ttHash( i + vec3( 0, 1, 1 ) ), ttHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}

// Layers on the island's sides: a grass lip, sandy soil, then pale coral rock, with wavy
// boundaries and embedded shells and pebbles.
vec3 ttStrata( vec3 w ) {
  float wave = ( ttNoise( vec3( w.x * 0.35 + w.z * 0.35, 0.0, 0.0 ) ) - 0.5 ) * 0.5 + sin( ( w.x + w.z ) * 0.7 ) * 0.08;
  float y = w.y + wave;
  vec3 c = ${glslVec3(STRATA.soil)};
  c = mix( c, ${glslVec3(STRATA.soilLight)}, smoothstep( -0.95, -0.85, y ) );
  c = mix( c, ${glslVec3(STRATA.soil.map((x) => x * 0.95))}, smoothstep( -0.45, -0.38, y ) );
  c = mix( c, ${glslVec3(STRATA.lip)}, smoothstep( -0.16, -0.08, y ) );
  vec3 rock = mix( ${glslVec3(STRATA.rock)}, ${glslVec3(STRATA.rockAlt)}, step( 0.5, fract( y * 1.6 ) ) * 0.6 );
  c = mix( rock, c, smoothstep( -1.75, -1.6, y ) );
  c = mix( ${glslVec3(STRATA.base)}, c, smoothstep( -3.3, -3.1, y ) );
  float pebble = smoothstep( 0.72, 0.78, ttNoise( w * vec3( 3.0, 5.0, 3.0 ) ) );
  return mix( c, c * 1.2 + 0.06, pebble * 0.7 );
}

// Smooth stucco with faint trowel marks and thin horizontal reveals, as on seaside art deco.
float ttStucco( vec3 w, vec3 n ) {
  float vertical = 1.0 - smoothstep( 0.3, 0.6, abs( n.y ) );
  float trowel = ttNoise( vec3( ( w.x + w.z ) * 2.3, w.y * 0.6, 1.7 ) ) - 0.5;
  float fy = fract( w.y / 1.15 + 0.08 );
  float reveal = 1.0 - smoothstep( 0.0, 0.035, min( fy, 1.0 - fy ) );
  return 1.0 + vertical * ( trowel * 0.04 - reveal * 0.07 );
}
`;

const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
float ttSurf = floor( vTtInfo.y + 0.5 );
int ttSi = int( ttSurf );
float ttGrain = ttNoise( vTtWorld * 1.9 ) * 0.6 + ttNoise( vTtWorld * 7.7 + 11.0 ) * 0.4;
if ( ttSurf == 11.0 ) {
  diffuseColor.rgb = ttStrata( vTtWorld );
} else if ( ttSurf == 2.0 ) {
  diffuseColor.rgb *= 0.82 + 0.3 * ttGrain;
} else if ( ttSurf == 9.0 ) {
  diffuseColor.rgb *= 0.72 + 0.45 * ttNoise( vTtWorld * 5.5 );
} else if ( ttSurf != 3.0 && ttSurf != 10.0 ) {
  diffuseColor.rgb *= 0.94 + 0.1 * ttGrain;
}
if ( ttSurf == 1.0 ) diffuseColor.rgb *= ttStucco( vTtWorld, vTtNormalW );
if ( ttSurf <= 1.0 || ttSurf == 5.0 ) {
  // Contact darkening where walls meet the ground.
  float ttWall = 1.0 - smoothstep( 0.4, 0.7, abs( vTtNormalW.y ) );
  diffuseColor.rgb *= mix( 1.0, mix( 0.74, 1.0, smoothstep( 0.0, 0.75, vTtWorld.y ) ), ttWall );
}
`;

const FRAGMENT_ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = TT_ROUGH[ ttSi ];
`;

const FRAGMENT_METAL = /* glsl */ `
#include <metalnessmap_fragment>
metalnessFactor = TT_METAL[ ttSi ];
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
float ttGlow = vTtInfo.z / 255.0;
if ( ttGlow > 0.0 ) {
  float ttSeed = vTtInfo.w / 255.0;
  float ttLit;
  if ( ttSurf == 10.0 ) {
    ttLit = 0.55 + 0.45 * uTtNight;
  } else if ( ttSurf == 12.0 ) {
    ttLit = smoothstep( 0.55, 0.6, fract( uTtTime * 0.6 + ttSeed ) );
  } else {
    // Windows and lamps switch on one by one as dusk falls ...
    ttLit = smoothstep( ttSeed * 0.55 + 0.12, ttSeed * 0.55 + 0.2, uTtNight );
    // ... and some windows go dark in the small hours.
    if ( ttSurf == 3.0 ) ttLit *= step( uTtLate * 0.7, fract( ttSeed * 7.13 + 0.05 ) );
  }
  vec3 ttGlowColor = ttSurf == 3.0 ? mix( uTtWarmA, uTtWarmB, fract( ttSeed * 13.7 ) ) : diffuseColor.rgb;
  // A few windows glow cyan or pink instead (screens, party lights).
  if ( ttSurf == 3.0 ) {
    float ttTv = fract( ttSeed * 29.3 );
    if ( ttTv > 0.86 ) ttGlowColor = ttTv > 0.93 ? vec3( 1.0, 0.45, 0.78 ) : vec3( 0.45, 0.85, 1.0 );
  }
  totalEmissiveRadiance += ttGlowColor * ttGlow * ttLit * uTtGlowGain;
  if ( ttSurf == 3.0 ) diffuseColor.rgb *= 1.0 - 0.7 * ttLit;
}
if ( vTtHighlight > 0.001 ) {
  vec3 ttView = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
  float ttRim = pow( 1.0 - saturate( dot( normal, ttView ) ), 2.0 );
  // Softer at night, when any lift stands out against the dark town.
  totalEmissiveRadiance += uTtHighlightColor * vTtHighlight * ( 0.08 + 0.42 * ttRim ) * ( 1.0 - 0.55 * uTtNight );
}
`;

/**
 * @param {TownUniforms} uniforms
 * @param {{bounce?: boolean, sway?: boolean, name: string}} variant
 * @returns {THREE.MeshStandardMaterial}
 */
export function createTownMaterial(uniforms, variant) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  material.name = `town-${variant.name}`;
  material.defines = {};
  if (variant.bounce) material.defines.TT_BOUNCE = '';
  if (variant.sway) material.defines.TT_SWAY = '';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <project_vertex>', VERTEX_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_COLOR)
      .replace('#include <roughnessmap_fragment>', FRAGMENT_ROUGH)
      .replace('#include <metalnessmap_fragment>', FRAGMENT_METAL)
      .replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE);
  };
  material.customProgramCacheKey = () => `town-${variant.name}`;
  return material;
}
