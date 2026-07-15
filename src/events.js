import * as THREE from 'three';
import { rand, lerp, damp } from './util.js';

// ============================================================================
// 全局事件:
// - 血月(最后60秒):天空变红,生物停止躲藏、反过来猎杀玩家,击杀分×2
// - 血雨(随机一次):大地湿滑、火焰熄灭
// ============================================================================

const BLOOD_MOON_LEFT = 60; // 剩余多少秒时触发

const NORMAL = {
  bg: new THREE.Color(0xd9ae87),
  fogNear: 70, fogFar: 260,
  hemiSky: new THREE.Color(0xffd9ae), hemiGround: new THREE.Color(0x7a685a),
  sunColor: new THREE.Color(0xffb26a), sunI: 1.35,
};
const RED = {
  bg: new THREE.Color(0x5a100a),
  fogNear: 30, fogFar: 140,
  hemiSky: new THREE.Color(0xb03020), hemiGround: new THREE.Color(0x38120c),
  sunColor: new THREE.Color(0xff5540), sunI: 0.9,
};

export class EventsSystem {
  constructor(ctx) {
    this.redK = 0;
    this.rainAt = rand(45, 100);
    this.rainDur = 22;
    this.rainDone = false;

    // 血雨粒子
    const N = 1400;
    this.rainPts = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.rainPts[i * 3] = rand(-45, 45);
      this.rainPts[i * 3 + 1] = rand(0, 40);
      this.rainPts[i * 3 + 2] = rand(-45, 45);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPts, 3));
    this.rainMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xbb1a10, size: 0.35, transparent: true, opacity: 0.75, depthWrite: false,
    }));
    this.rainMesh.visible = false;
    ctx.three.scene.add(this.rainMesh);
    this.rainGeo = geo;

    // 血月本体(远景大红球)
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(18, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xff3020, fog: false, transparent: true, opacity: 0 })
    );
    this.moon.position.set(80, 90, -160);
    ctx.three.scene.add(this.moon);
  }

  update(ctx, dt) {
    const t = ctx.matchTime;
    const { scene, sun, hemi } = ctx.three;
    const remain = ctx.matchDuration - t;

    // ---- 血月触发 ----
    if (!ctx.bloodMoon && remain <= BLOOD_MOON_LEFT) {
      ctx.bloodMoon = true;
      ctx.ui.banner('血月升起 —— 恶鬼开始反猎!斩杀×2');
      ctx.shake = Math.max(ctx.shake, 0.5);
    }

    // 红色渐变
    this.redK = damp(this.redK, ctx.bloodMoon ? 1 : 0, 0.8, dt);
    const k = this.redK;
    if (k > 0.001) {
      scene.background.copy(NORMAL.bg).lerp(RED.bg, k);
      scene.fog.color.copy(scene.background);
      scene.fog.near = lerp(NORMAL.fogNear, RED.fogNear, k);
      scene.fog.far = lerp(NORMAL.fogFar, RED.fogFar, k);
      hemi.color.copy(NORMAL.hemiSky).lerp(RED.hemiSky, k);
      hemi.groundColor.copy(NORMAL.hemiGround).lerp(RED.hemiGround, k);
      sun.color.copy(NORMAL.sunColor).lerp(RED.sunColor, k);
      sun.intensity = lerp(NORMAL.sunI, RED.sunI, k);
      this.moon.material.opacity = k * 0.95;
      this.moon.scale.setScalar(1 + Math.sin(ctx.time * 1.4) * 0.02);
    }

    // ---- 血雨 ----
    if (!this.rainDone && !ctx.rain.active && t >= this.rainAt) {
      ctx.rain.active = true;
      ctx.rain.slippery = true;
      this.rainEnd = t + this.rainDur;
      this.rainMesh.visible = true;
      ctx.ui.banner('血雨落下 —— 大地湿滑,火焰熄灭');
    }
    if (ctx.rain.active) {
      if (t >= this.rainEnd) {
        ctx.rain.active = false;
        ctx.rain.slippery = false;
        this.rainDone = true;
        this.rainMesh.visible = false;
      } else {
        const center = ctx.camTarget;
        this.rainMesh.position.set(center.x, 0, center.z);
        const arr = this.rainPts;
        for (let i = 0; i < arr.length; i += 3) {
          arr[i + 1] -= 38 * dt;
          if (arr[i + 1] < 0) {
            arr[i] = rand(-45, 45);
            arr[i + 1] = rand(30, 42);
            arr[i + 2] = rand(-45, 45);
          }
        }
        this.rainGeo.attributes.position.needsUpdate = true;
      }
    }
  }
}
