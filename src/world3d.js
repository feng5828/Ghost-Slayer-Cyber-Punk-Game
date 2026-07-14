import * as THREE from 'three';

export function createWorld3D() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6f9fd8);
  scene.fog = new THREE.Fog(0x6f9fd8, 80, 300);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 700);
  camera.position.set(0, 26, 18);
  camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xbdd6f2, 0x3d5c33, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(70, 110, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150;
  sc.near = 10; sc.far = 350;
  scene.add(sun);

  const texLoader = new THREE.TextureLoader();
  const grassTex = texLoader.load('/textures/grass_green.png');
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(50, 50);
  grassTex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(340, 340),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadTex = texLoader.load('/textures/road_asphalt.png');
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(1, 42);
  roadTex.colorSpace = THREE.SRGBColorSpace;
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 340),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.02;
  road.receiveShadow = true;
  scene.add(road);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, sun, hemi };
}
