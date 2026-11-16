// Post-processing. High quality: multisampled HDR render → subtle bloom (stronger at night) →
// tilt-shift blur on the top and bottom bands (the miniature look) → tone mapping and sRGB.
// Low quality renders straight to the canvas; three applies the same tone mapping in-shader.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

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
    composer.addPass(bloom);
    const tiltH = new ShaderPass(HorizontalTiltShiftShader);
    const tiltV = new ShaderPass(VerticalTiltShiftShader);
    composer.addPass(tiltH);
    composer.addPass(tiltV);
    const output = new OutputPass();
    output.needsSwap = false;
    composer.addPass(output);
    chain = { composer, bloom, tiltH, tiltV };
    updateTilt();
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
