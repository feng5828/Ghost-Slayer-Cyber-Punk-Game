import * as THREE from 'three';

// 键鼠输入 → 统一的 input 结构（AI 也产出同样结构）
// { move:{x,z}, aim:Vector3, primary, primaryHeld, secondary, secondaryHeld }
export class Input {
  constructor(camera) {
    this.camera = camera;
    this.keys = new Set();
    this.mouseNDC = new THREE.Vector2();
    this.aim = new THREE.Vector3();
    this.primaryHeld = false;
    this.secondaryHeld = false;
    this._primaryPress = false;
    this._secondaryPress = false;
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') { this._primaryPress = true; this.primaryHeld = true; e.preventDefault(); }
      if (e.code === 'ShiftLeft') { this._secondaryPress = true; this.secondaryHeld = true; }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.primaryHeld = false;
      if (e.code === 'ShiftLeft') this.secondaryHeld = false;
    });
    window.addEventListener('mousemove', (e) => {
      this.mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.mouseX = e.clientX; this.mouseY = e.clientY;
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this._primaryPress = true; this.primaryHeld = true; }
      if (e.button === 2) { this._secondaryPress = true; this.secondaryHeld = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.primaryHeld = false;
      if (e.button === 2) this.secondaryHeld = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.primaryHeld = this.secondaryHeld = false;
    });
  }

  // 每帧调用：把鼠标投射到地面得到 aim 点，并打包本帧输入
  sample() {
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    this.raycaster.ray.intersectPlane(this.groundPlane, this.aim);

    let x = 0, z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 0) { x /= len; z /= len; }

    const out = {
      move: { x, z },
      aim: this.aim,
      primary: this._primaryPress,
      primaryHeld: this.primaryHeld,
      secondary: this._secondaryPress,
      secondaryHeld: this.secondaryHeld,
    };
    this._primaryPress = false;
    this._secondaryPress = false;
    return out;
  }
}
