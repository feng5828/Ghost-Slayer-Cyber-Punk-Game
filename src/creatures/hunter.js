import * as THREE from 'three';
import { Creature } from './base.js';
import { meleeHit, hitCreaturesAt, addFlash } from '../damage.js';
import { ignite } from '../fire.js';
import { nearbyProps, damageProp } from '../damage.js';
import { damp, clamp } from '../util.js';

// ============================================================================
// 猎魔人(玩家):斩妖除魔的夜行者
// 左键/空格 = 桃木剑突刺斩(位移+挥砍,斩妖主力)
// 右键 = 掷火符(符落起火 → 用火焰把躲藏的恶鬼逼出来)
// ============================================================================

const MAX_HP = 120;
const SPEED = 17;
const LUNGE_SPEED = 34;
const LUNGE_TIME = 0.28;
const ATTACK_CD = 1.1;
const ATTACK_DMG_CREATURE = 70;
const ATTACK_DMG_PROP = 45;
const TORCH_CD = 4.0;
const TORCH_RANGE = 22;
const REGEN_DELAY = 5.0;
const REGEN_RATE = 5;

export class Hunter extends Creature {
  constructor(ctx, opts) {
    super(ctx, { ...opts, kind: 'hunter', cname: '猎魔人', color: 0x3a4a6a });
    this.hp = MAX_HP;
    this.colRadius = 0.7;
    this.attackCd = 0;
    this.torchCd = 0;
    this.lungeT = 0;
    this.lungeDir = new THREE.Vector3(0, 0, -1);
    this.lastHurtAt = -99;
    this.torches = [];
    this.facing = 0;

    // 造型:深蓝斗篷身影 + 白眼 + 长刀
    const cloak = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 1.7, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a3450, roughness: 0.85 })
    );
    cloak.position.y = 0.85; cloak.castShadow = true;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x1c2438, roughness: 0.9 })
    );
    head.position.y = 1.85;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xe8f0ff });
    for (const ex of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), eyeMat);
      eye.position.set(ex, 1.88, -0.28);
      this.root.add(eye);
    }
    // 桃木剑:暗红木色,剑脊一线朱砂
    this.blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.03, 1.7),
      new THREE.MeshStandardMaterial({ color: 0x9a5a3a, roughness: 0.6, emissive: 0x3a0d05, emissiveIntensity: 0.4 })
    );
    this.blade.position.set(0.5, 1.1, -0.5);
    this.figure = new THREE.Group();
    this.figure.add(cloak, head, this.blade);
    this.root.add(this.figure);

    // 火符预制:一张燃着的黄符纸
    this.torchGeo = new THREE.BoxGeometry(0.3, 0.02, 0.48);
    this.torchMat = new THREE.MeshStandardMaterial({
      color: 0xf0dc9a, emissive: 0xcc4410, emissiveIntensity: 0.9,
    });
  }

  hpText() { return `生命 ${Math.ceil(this.hp)}`; }
  hpRatio() { return this.hp / MAX_HP; }
  hittable() { return [{ pos: this.pos, r: 0.9 }]; }

  takeDamage(n, src) {
    if (!this.alive) return;
    this.hp -= n;
    this.lastHurtAt = this.ctx.time;
    this.ctx.ui.hurtFlash();
    if (this.hp <= 0) this.die(src);
  }

  update(dt, input) {
    if (!this.alive) return;
    const ctx = this.ctx;
    this.attackCd -= dt;
    this.torchCd -= dt;

    // 回血
    if (ctx.time - this.lastHurtAt > REGEN_DELAY && this.hp < MAX_HP) {
      this.hp = Math.min(this.hp + REGEN_RATE * dt, MAX_HP);
    }

    // ---- 突刺斩击 ----
    if (input.primary && this.attackCd <= 0 && this.stun <= 0) {
      this.attackCd = ATTACK_CD;
      this.lungeT = LUNGE_TIME;
      if (input.aim) {
        this.lungeDir.copy(input.aim).sub(this.pos).setY(0);
        if (this.lungeDir.lengthSq() < 0.1) this.lungeDir.set(input.move.x, 0, input.move.z);
        this.lungeDir.normalize();
      }
    }
    this.lungeT = Math.max(0, this.lungeT - dt);

    if (this.lungeT > 0) {
      this.stun = Math.max(0, this.stun - dt);
      this.elecT = Math.max(0, this.elecT - dt);
      this.vel.copy(this.lungeDir).multiplyScalar(LUNGE_SPEED);
      this.pos.addScaledVector(this.vel, dt);
      this.pos.x = clamp(this.pos.x, -110, 110);
      this.pos.z = clamp(this.pos.z, -110, 110);

      // 挥砍判定(突刺途中持续,前方一个弧)
      const hitPos = this.pos.clone().addScaledVector(this.lungeDir, 1.8);
      const src = { owner: this, chain: 0 };
      meleeHit(ctx, this, hitPos, 2.3, ATTACK_DMG_PROP, src);
      hitCreaturesAt(ctx, hitPos, 2.6, ATTACK_DMG_CREATURE, src, this);
      // 刀光
      if (this.lungeT > LUNGE_TIME - dt * 2) addFlash(ctx, hitPos.clone().setY(1.2), 2.2, 0xdde8ff);
    } else {
      this.moveCommon(dt, input, SPEED, 9);
    }
    this.collide();

    // ---- 掷火符 ----
    if (input.secondary && this.torchCd <= 0 && this.stun <= 0 && input.aim) {
      this.torchCd = TORCH_CD;
      const to = input.aim.clone().setY(0);
      const d = to.distanceTo(this.pos);
      if (d > TORCH_RANGE) to.sub(this.pos).setLength(TORCH_RANGE).add(this.pos);
      const mesh = new THREE.Mesh(this.torchGeo, this.torchMat);
      ctx.three.scene.add(mesh);
      this.torches.push({
        mesh, from: this.pos.clone().setY(1.4), to, t: 0,
        dur: 0.45 + to.distanceTo(this.pos) * 0.012,
      });
    }
    // 火符飞行(纸片翻飞)
    for (let i = this.torches.length - 1; i >= 0; i--) {
      const tc = this.torches[i];
      tc.t += dt;
      const k = Math.min(tc.t / tc.dur, 1);
      tc.mesh.position.lerpVectors(tc.from, tc.to, k);
      tc.mesh.position.y = tc.from.y + Math.sin(k * Math.PI) * 5 - k * 1.2;
      tc.mesh.rotation.x += dt * 12;
      if (k >= 1) {
        ctx.three.scene.remove(tc.mesh);
        this.torches.splice(i, 1);
        // 落地:点燃 + 小伤害
        addFlash(ctx, tc.to.clone().setY(0.5), 3, 0xff8a30);
        const src = { owner: this, chain: 0 };
        for (const p of nearbyProps(ctx, tc.to, 3.0)) {
          if (p.def.flammable) ignite(ctx, p, src);
          damageProp(ctx, p, 12, src);
        }
        hitCreaturesAt(ctx, tc.to, 3.0, 18, src, this);
      }
    }

    // ---- 朝向与姿态 ----
    let face = this.facing;
    if (this.lungeT > 0) face = Math.atan2(-this.lungeDir.x, -this.lungeDir.z);
    else if (input.aim) {
      const dx = input.aim.x - this.pos.x, dz = input.aim.z - this.pos.z;
      if (dx * dx + dz * dz > 1) face = Math.atan2(-dx, -dz);
    }
    this.facing = face;
    this.figure.rotation.y = damp(this.figure.rotation.y, face, 12, dt);
    this.figure.position.copy(this.pos);
    this.figure.position.y = Math.abs(Math.sin(ctx.time * 8)) * 0.06 * Math.min(this.vel.length() / SPEED, 1);
    // 挥刀动画
    const swing = this.attackCd > ATTACK_CD - 0.3 ? (ATTACK_CD - this.attackCd) / 0.3 : 0;
    this.blade.rotation.y = swing > 0 ? Math.sin(swing * Math.PI) * -2.2 : 0;
    const elecFlash = this.elecT > 0 && Math.sin(ctx.time * 30) > 0;
    this.blade.material.emissive = new THREE.Color(elecFlash ? 0x4488ff : 0x000000);
  }
}
