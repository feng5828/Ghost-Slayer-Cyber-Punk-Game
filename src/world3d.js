import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { rand, pick } from './util.js';
import { TOON, TOON_GROUND, GradeShader, OutlineShader } from './toon.js';

// ============================================================================
// 新赛博中式 · 黄昏老街:石板路贴图 + 暖阳低角度打光 + 霓虹泛光(Bloom)
// ============================================================================

// 程序化石板路:暖灰石板 + 深缝 + 磨损斑驳
function makeGroundTexture() {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#d8cbae';
  g.fillRect(0, 0, S, S);

  // 石板(米色系,错缝排列)
  const tile = 128;
  let row = 0;
  for (let y = 0; y < S; y += tile) {
    const off = (row++ % 2) * (tile / 2);
    for (let x = -tile; x < S + tile; x += tile) {
      g.fillStyle = pick(['#e0d3b6', '#d4c7aa', '#e6dabf', '#cec1a4', '#dccfb2']);
      g.fillRect(x + off + 3, y + 3, tile - 6, tile - 6);
    }
  }
  // 磨损噪点与青苔渍
  for (let i = 0; i < 9000; i++) {
    const mossy = Math.random() < 0.15;
    g.fillStyle = mossy
      ? `rgba(${rand(60, 90) | 0},${rand(90, 110) | 0},${rand(50, 70) | 0},${rand(0.05, 0.15)})`
      : `rgba(${rand(40, 90) | 0},${rand(40, 85) | 0},${rand(35, 75) | 0},${rand(0.04, 0.14)})`;
    g.fillRect(rand(S), rand(S), rand(1, 4), rand(1, 4));
  }
  // 大块水渍阴影
  for (let i = 0; i < 10; i++) {
    g.fillStyle = `rgba(50,48,40,${rand(0.05, 0.12)})`;
    g.beginPath();
    g.ellipse(rand(S), rand(S), rand(30, 90), rand(20, 60), rand(Math.PI), 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 主街:更大的条石板 + 深色车辙
function makeRoadTexture() {
  const W = 256, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#cabd9e';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 128) {
    g.fillStyle = pick(['#d2c5a8', '#c6b99c', '#d8ccb0']);
    g.fillRect(4, y + 4, W - 8, 120);
  }
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${rand(40, 90) | 0},${rand(40, 85) | 0},${rand(35, 70) | 0},${rand(0.05, 0.12)})`;
    g.fillRect(rand(W), rand(H), rand(1, 3), rand(1, 3));
  }
  // 两道浅车辙
  g.fillStyle = 'rgba(45,42,36,0.18)';
  g.fillRect(W * 0.22, 0, 26, H);
  g.fillRect(W * 0.68, 0, 26, H);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld3D() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf09a6a);
  scene.fog = new THREE.Fog(0xf09a6a, 70, 260);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 700);
  camera.position.set(0, 17, 11);
  camera.lookAt(0, 0, 0);

  // 夸张黄昏的光影分色(明亮版):阳光浓橙 / 环境光亮紫 → 受光面吃橙、阴影面吃紫但依然透亮
  const hemi = new THREE.HemisphereLight(0xa88ad8, 0x6a5a94, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffa64e, 1.85);
  sun.position.set(95, 42, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150;
  sc.near = 10; sc.far = 350;
  scene.add(sun);

  // 地面
  const groundTex = makeGroundTexture();
  groundTex.repeat.set(13, 13);
  // 亮橙霓虹感地面:色相锚定亮橙 + 少量自发光(亮砖会轻微越过泛光阈值)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(340, 340),
    TOON_GROUND({
      map: groundTex,
      emissive: new THREE.Color(0xff7a30), emissiveIntensity: 0.18,
    }, 0xffa056, 0.62)
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // 主街
  const roadTex = makeRoadTexture();
  roadTex.repeat.set(1, 20);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 340),
    TOON_GROUND({
      map: roadTex,
      emissive: new THREE.Color(0xf06a28), emissiveIntensity: 0.14,
    }, 0xf29048, 0.62)
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.02;
  road.receiveShadow = true;
  scene.add(road);

  // 霓虹泛光
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // 轮廓墨线(在泛光前,避免给辉光描边)
  const outline = new ShaderPass(OutlineShader);
  outline.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
  composer.addPass(outline);
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.42,  // strength:白天场景收敛些,霓虹微微渗光即可
    0.4,   // radius
    0.82   // threshold:只有高亮 emissive(霓虹/灯笼)起辉,暖阳画面不糊
  );
  composer.addPass(bloom);
  // 分调色:暗部推冷紫、亮部推暖橙 —— 夸张黄昏的最后一层
  composer.addPass(new ShaderPass(GradeShader));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    outline.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, sun, hemi, composer };
}
