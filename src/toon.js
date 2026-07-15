import * as THREE from 'three';

// ============================================================================
// 三渲二工具:
// 1. TOON(opts) —— 统一的卡通材质工厂(硬边色阶渐变,全场景共用)
// 2. GradeShader —— 全屏分调色 pass:暗部推冷紫、亮部推暖橙,夸张黄昏
// ============================================================================

let _ramp = null;

// 硬边三阶色阶:阴影 / 中间调 / 受光(NearestFilter 保证不插值 = 硬分界)
export function toonRamp() {
  if (_ramp) return _ramp;
  const data = new Uint8Array([90, 90, 90, 255, 165, 165, 165, 255, 255, 255, 255, 255]);
  _ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  _ramp.minFilter = THREE.NearestFilter;
  _ramp.magFilter = THREE.NearestFilter;
  _ramp.needsUpdate = true;
  return _ramp;
}

// MeshToonMaterial 不认识 metalness/roughness 等 PBR 参数,这里统一过滤
const ALLOWED = ['color', 'map', 'emissive', 'emissiveIntensity', 'emissiveMap',
  'transparent', 'opacity', 'side', 'fog', 'alphaTest'];

export function TOON(opts = {}) {
  const params = { gradientMap: toonRamp() };
  for (const k of ALLOWED) {
    if (opts[k] !== undefined) params[k] = opts[k];
  }
  return new THREE.MeshToonMaterial(params);
}

// 全屏分调色:按亮度把画面劈成冷紫暗部和暖橙亮部,再补一点饱和度
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    shadowTint: { value: new THREE.Vector3(0.68, 0.56, 1.05) }, // 冷紫
    lightTint: { value: new THREE.Vector3(1.14, 0.97, 0.80) },  // 暖橙
    saturation: { value: 1.22 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 shadowTint;
    uniform vec3 lightTint;
    uniform float saturation;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      // 暗部→冷紫,亮部→暖橙(分界柔一点避免色带撕裂)
      vec3 tint = mix(shadowTint, lightTint, smoothstep(0.12, 0.72, l));
      c.rgb *= tint;
      // 饱和度提升,卡通感
      float g = dot(c.rgb, vec3(0.3333));
      c.rgb = mix(vec3(g), c.rgb, saturation);
      gl_FragColor = c;
    }`,
};
