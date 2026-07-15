import * as THREE from 'three';

// ============================================================================
// 三渲二工具:
// 1. TOON(opts) —— 统一的卡通材质工厂(硬边色阶渐变,全场景共用)
// 2. GradeShader —— 全屏分调色 pass:暗部推冷紫、亮部推暖橙,夸张黄昏
// ============================================================================

let _ramp = null;

// 硬边三阶色阶:阴影 / 中间调 / 受光(NearestFilter 保证不插值 = 硬分界)
// 阴影档抬高到 128:黄昏依然明亮,阴影只是"变色"而不是"变黑"
export function toonRamp() {
  if (_ramp) return _ramp;
  const data = new Uint8Array([128, 128, 128, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
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

// 地面专用 toon 特例:保留色阶明暗,但把色相锚回固定的"米-红中间调",
// 削弱橙色阳光/紫色环境光对地面的染色(注入点在 fog 之前,远处雾色不受影响)
export function TOON_GROUND(opts = {}, baseTone = 0xe4c0a2, hold = 0.55) {
  const m = TOON(opts);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundBase = { value: new THREE.Color(baseTone) };
    shader.uniforms.uGroundHold = { value: hold };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {',
        'uniform vec3 uGroundBase;\nuniform float uGroundHold;\nvoid main() {')
      .replace('#include <fog_fragment>', `{
        float lumG = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 anchored = uGroundBase * (lumG * 1.25);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, anchored, uGroundHold);
      }
      #include <fog_fragment>`);
  };
  return m;
}

// 全屏分调色:按亮度把画面劈成冷紫暗部和暖橙亮部,再补一点饱和度
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    shadowTint: { value: new THREE.Vector3(0.88, 0.78, 1.08) }, // 冷紫(明亮版)
    lightTint: { value: new THREE.Vector3(1.14, 1.0, 0.86) },   // 暖橙
    saturation: { value: 1.18 },
    exposure: { value: 1.12 },
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
    uniform float exposure;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      // 暗部→冷紫,亮部→暖橙(分界柔一点避免色带撕裂)
      vec3 tint = mix(shadowTint, lightTint, smoothstep(0.12, 0.72, l));
      c.rgb *= tint * exposure;
      // 饱和度提升,卡通感
      float g = dot(c.rgb, vec3(0.3333));
      c.rgb = mix(vec3(g), c.rgb, saturation);
      gl_FragColor = c;
    }`,
};

// 轮廓墨线:对 toon 平涂色块做 Sobel 边缘检测,压上深色描边
// (toon 材质把表面拍平成色块后,颜色梯度基本就等于几何轮廓)
export const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    threshold: { value: 0.16 },  // 低于此梯度不描(放过地面纹理噪点)
    strength: { value: 0.85 },
    thickness: { value: 1.8 },   // 采样步长(像素)≈ 线宽
    lineColor: { value: new THREE.Vector3(0.16, 0.09, 0.18) }, // 暗紫墨线,配黄昏
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float threshold;
    uniform float strength;
    uniform float thickness;
    uniform vec3 lineColor;
    varying vec2 vUv;
    float lum(vec2 uv) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      return dot(c, vec3(0.299, 0.587, 0.114));
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 px = thickness / resolution;
      // Sobel
      float tl = lum(vUv + px * vec2(-1.0,  1.0));
      float tc = lum(vUv + px * vec2( 0.0,  1.0));
      float tr = lum(vUv + px * vec2( 1.0,  1.0));
      float ml = lum(vUv + px * vec2(-1.0,  0.0));
      float mr = lum(vUv + px * vec2( 1.0,  0.0));
      float bl = lum(vUv + px * vec2(-1.0, -1.0));
      float bc = lum(vUv + px * vec2( 0.0, -1.0));
      float br = lum(vUv + px * vec2( 1.0, -1.0));
      float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
      float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
      float edge = length(vec2(gx, gy));
      float k = smoothstep(threshold, threshold * 2.2, edge) * strength;
      c.rgb = mix(c.rgb, lineColor, k);
      gl_FragColor = c;
    }`,
};
