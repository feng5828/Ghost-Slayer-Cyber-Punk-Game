import * as THREE from 'three';
import { rand, lerp, damp } from './util.js';

// ============================================================================
// 全局事件:红天空缩圈(60秒后) + 血雨(随机一次)
// 继承原作的天空变红与血雨,在这里变成扭转战局的系统
// ============================================================================

const RED_SKY_AT = 60;
const ZONE_START_R = 115;
const ZONE_END_R = 28;
const ZONE_SHRINK_TIME = 110;
const ZONE_DPS = 6;

const NORMAL = {
  bg: new THREE.Color(0x6f9fd8),
  fogNear: 80, fogFar: 300,
  hemiSky: new THREE.Color(0xbdd6f2), hemiGround: new THREE.Color(0x3d5c33),
  sunColor: new THREE.Color(0xfff2dd), sunI: 1.6,
};
const RED = {
  bg: new THREE.Color(0x8a1408),
  fogNear: 35, fogFar: 160,
  hemiSky: new THREE.Color(0xc03018), hemiGround: new THREE.Color(0x401410),
  sunColor: new THREE.Color(0xff6644), sunI: 1.1,
};

export class EventsSystem {
  constructor(ctx) {
    this.redK = 0;           // 红天空强度 0→1
    this.rainAt = rand(75, 130);
    this.rainDur = 24;
    this.rainDone = false;

    // 结界圈(红色半透明圆筒)
    this.ring = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 30, 64, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff2a10, transparent: true, opacity: 0.0,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    this.ring.position.y = 15;
    ctx.three.scene.add(this.ring);

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
  }

  update(ctx, dt) {
    const t = ctx.matchTime;
    const { scene, sun, hemi } = ctx.three;

    // ---- 红天空触发 ----
    if (!ctx.zone.active && t >= RED_SKY_AT) {
      ctx.zone.active = true;
      ctx.ui.banner('天空变红了 —— 结界开始收缩!');
      ctx.shake = Math.max(ctx.shake, 0.5);
    }

    // 红色渐变
    const targetK = ctx.zone.active ? 1 : 0;
    this.redK = damp(this.redK, targetK, 0.8, dt);
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
    }

    // ---- 缩圈 ----
    if (ctx.zone.active) {
      const sh = Math.min((t - RED_SKY_AT) / ZONE_SHRINK_TIME, 1);
      ctx.zone.radius = lerp(ZONE_START_R, ZONE_END_R, sh);
      this.ring.scale.set(ctx.zone.radius, 1, ctx.zone.radius);
      this.ring.material.opacity = Math.min(this.ring.material.opacity + dt * 0.2, 0.3);
      // 圈外持续伤害
      for (const c of ctx.creatures) {
        if (!c.alive) continue;
        if (Math.hypot(c.pos.x, c.pos.z) > ctx.zone.radius) {
          c.takeDamage(ZONE_DPS * dt, null);
          if (c.isPlayer) ctx.ui.zoneWarn(true);
        } else if (c.isPlayer) ctx.ui.zoneWarn(false);
      }
    }

    // ---- 血雨 ----
    if (!this.rainDone && !ctx.rain.active && t >= this.rainAt) {
      ctx.rain.active = true;
      ctx.rain.slippery = true;
      this.rainEnd = t + this.rainDur;
      this.rainMesh.visible = true;
      ctx.ui.banner('血雨落下 —— 大地变得湿滑,火焰熄灭');
    }
    if (ctx.rain.active) {
      if (t >= this.rainEnd) {
        ctx.rain.active = false;
        ctx.rain.slippery = false;
        this.rainDone = true;
        this.rainMesh.visible = false;
      } else {
        // 粒子跟随镜头目标下落
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
