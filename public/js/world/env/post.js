// Post-processing. High quality: multisampled HDR render → bloom (stronger at night, for the
// neon) → tilt-shift blur on the top and bottom bands (the miniature look), with the colour grade
// folded into the second blur pass → tone mapping and sRGB. The grade is the sunset-coast look:
// a little more saturation and contrast, cool shadows, warm highlights and a soft vignette;
// violet shadows at night. Low quality renders straight to the canvas without it.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { gradeAt } from './grade.js';

/**
 * One NaN or infinite pixel in the HDR frame (a bad vertex colour, a degenerate normal, a value
 * past half-float range) is harmless on its own, but bloom blurs it through every mip level and the
 * tilt-shift spreads it further, until the whole frame is NaN: a black (or, on a transparent
 * canvas, empty) town. Every pass that reads the frame reads it through ttSafe, which turns such
 * pixels black and keeps the rest in half-float range.
 */
const SAFE_GLSL = /* glsl */ `
vec4 ttSafe( vec4 c ) {
  if ( any( isnan( c ) ) || any( isinf( c ) ) ) return vec4( 0.0, 0.0, 0.0, 1.0 );
  return clamp( c, vec4( 0.0 ), vec4( 64000.0 ) );
}
`;

/** Three's horizontal tilt-shift blur, reading the frame through ttSafe. */
const SafeTiltShader = {
  name: 'SafeTiltShader',
  uniforms: HorizontalTiltShiftShader.uniforms,
  vertexShader: HorizontalTiltShiftShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float h;
    uniform float r;
    varying vec2 vUv;
    ${SAFE_GLSL}
    void main() {
      vec4 sum = vec4( 0.0 );
      float hh = h * abs( r - vUv.y );
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x - 4.0 * hh, vUv.y ) ) ) * 0.051;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x - 3.0 * hh, vUv.y ) ) ) * 0.0918;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x - 2.0 * hh, vUv.y ) ) ) * 0.12245;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x - 1.0 * hh, vUv.y ) ) ) * 0.1531;
      sum += ttSafe( texture2D( tDiffuse, vUv ) ) * 0.1633;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x + 1.0 * hh, vUv.y ) ) ) * 0.1531;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x + 2.0 * hh, vUv.y ) ) ) * 0.12245;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x + 3.0 * hh, vUv.y ) ) ) * 0.0918;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x + 4.0 * hh, vUv.y ) ) ) * 0.051;
      gl_FragColor = sum;
    }`,
};

/** Three's vertical tilt-shift blur with the colour grade applied to its result (linear HDR). */
const TiltGradeShader = {
  name: 'TiltGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    v: { value: 1 / 512 },
    r: { value: 0.35 },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uShadow: { value: new THREE.Vector3(1, 1, 1) },
    uHighlight: { value: new THREE.Vector3(1, 1, 1) },
    uVignette: { value: 0 },
  },
  vertexShader: VerticalTiltShiftShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float v;
    uniform float r;
    uniform float uSat;
    uniform float uContrast;
    uniform vec3 uShadow;
    uniform vec3 uHighlight;
    uniform float uVignette;
    varying vec2 vUv;
    ${SAFE_GLSL}
    void main() {
      vec4 sum = vec4( 0.0 );
      float vv = v * abs( r - vUv.y );
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x, vUv.y - 4.0 * vv ) ) ) * 0.051;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x, vUv.y - 3.0 * vv ) ) ) * 0.0918;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x, vUv.y - 2.0 * vv ) ) ) * 0.12245;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x, vUv.y - 1.0 * vv ) ) ) * 0.1531;
      sum += ttSafe( texture2D( tDiffuse, vUv ) ) * 0.1633;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x, vUv.y + 1.0 * vv ) ) ) * 0.1531;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x, vUv.y + 2.0 * vv ) ) ) * 0.12245;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x, vUv.y + 3.0 * vv ) ) ) * 0.0918;
      sum += ttSafe( texture2D( tDiffuse, vec2( vUv.x, vUv.y + 4.0 * vv ) ) ) * 0.051;

      vec3 c = sum.rgb;
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      // Split toning: cool shadows, warm highlights.
      c *= mix( uShadow, uHighlight, smoothstep( 0.04, 0.8, l ) );
      // Saturation, then contrast around mid grey (in log space, so highlights keep their range).
      c = max( mix( vec3( l ), c, uSat ), vec3( 0.0 ) );
      c = 0.18 * pow( max( c, vec3( 1e-5 ) ) / 0.18, vec3( uContrast ) );
      // A soft vignette pulls the eye to the middle of the shot.
      vec2 d = vUv - 0.5;
      c *= 1.0 - uVignette * smoothstep( 0.18, 0.62, dot( d, d ) * 2.0 );
      gl_FragColor = vec4( c, sum.a );
    }`,
};

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 */
export function createPost(renderer, scene, camera) {
  /** @type {null | {composer: EffectComposer, bloom: UnrealBloomPass, tiltH: ShaderPass, tiltV: ShaderPass}} */
  let chain = null;
  let width = 1;
  let height = 1;
  let tilt = 2.2;
  let gradeNight = 0;
  const bloomSettings = { strength: 0.2, threshold: 0.9 };

  function buildChain() {
    const pr = renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(width * pr, height * pr, { type: THREE.HalfFloatType });
    target.texture.name = 'town.hdr';
    const composer = new EffectComposer(renderer, target);
    // Only the buffer the scene is drawn into needs multisampling (2 samples are plenty on
    // high-density screens). The RenderPass draws into renderTarget2 (the composer's first read
    // buffer); the pass list below swaps buffers an even number of times per frame (two
    // tilt-shift passes; bloom and output do not swap), so it is that buffer on every frame.
    composer.renderTarget2.samples = pr >= 1.5 ? 2 : 4;
    composer.setPixelRatio(pr);
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), bloomSettings.strength, 0.55, bloomSettings.threshold);
    // Bloom's first step reads the frame; sanitise it there so no bad pixel reaches the blur.
    const highPass = bloom.materialHighPassFilter;
    const read = 'vec4 texel = texture2D( tDiffuse, vUv );';
    if (highPass.fragmentShader.includes(read)) {
      highPass.fragmentShader = `${SAFE_GLSL}\n${highPass.fragmentShader.replace(read, 'vec4 texel = ttSafe( texture2D( tDiffuse, vUv ) );')}`;
      highPass.needsUpdate = true;
    }
    composer.addPass(bloom);
    const tiltH = new ShaderPass(SafeTiltShader);
    const tiltV = new ShaderPass(TiltGradeShader);
    composer.addPass(tiltH);
    composer.addPass(tiltV);
    const output = new OutputPass();
    output.needsSwap = false;
    composer.addPass(output);
    chain = { composer, bloom, tiltH, tiltV };
    updateTilt();
    updateGrade();
  }

  function updateGrade() {
    if (!chain) return;
    const g = gradeAt(gradeNight);
    const u = chain.tiltV.uniforms;
    u.uSat.value = g.saturation;
    u.uContrast.value = g.contrast;
    u.uShadow.value.set(g.shadow[0], g.shadow[1], g.shadow[2]);
    u.uHighlight.value.set(g.highlight[0], g.highlight[1], g.highlight[2]);
    u.uVignette.value = g.vignette;
  }

  function updateTilt() {
    if (!chain) return;
    chain.tiltH.uniforms.h.value = tilt / width;
    chain.tiltV.uniforms.v.value = tilt / height;
    chain.tiltH.uniforms.r.value = 0.5;
    chain.tiltV.uniforms.r.value = 0.5;
  }

  function disposeChain() {
    if (!chain) return;
    for (const pass of chain.composer.passes) pass.dispose?.();
    chain.composer.dispose();
    chain = null;
  }

  return {
    /** @param {'high'|'low'} quality */
    setQuality(quality) {
      if (quality === 'high' && !chain) buildChain();
      if (quality === 'low') disposeChain();
    },
    /** @param {number} w @param {number} h */
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      if (!chain) return;
      chain.composer.setPixelRatio(renderer.getPixelRatio());
      chain.composer.setSize(width, height);
      updateTilt();
    },
    /** @param {number} strength @param {number} threshold */
    setBloom(strength, threshold) {
      bloomSettings.strength = strength;
      bloomSettings.threshold = threshold;
      if (!chain) return;
      chain.bloom.strength = strength;
      chain.bloom.threshold = threshold;
    },
    /** @param {number} night 0..1: the grade turns from day to night */
    setGrade(night) {
      gradeNight = night;
      updateGrade();
    },
    /** @param {number} amount blur strength at the screen edges (≈ px per tap) */
    setTiltShift(amount) {
      tilt = amount;
      updateTilt();
    },
    /** @param {number} dt */
    render(dt) {
      if (chain) chain.composer.render(dt);
      else renderer.render(scene, camera);
    },
    dispose: disposeChain,
  };
}
