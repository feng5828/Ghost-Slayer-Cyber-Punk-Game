import * as THREE from 'three';
import { Creature } from './base.js';
import { explode, destroyProp } from '../damage.js';
import { propPos } from '../props.js';
import { damp } from '../util.js';

// ============================================================================
// 守护者:原作里唯一的善意,在这里黑化成最阴险的操纵者
// 凝视魅化(左键长按)把道具变成仆从环绕自己;指挥突击(右键)全员导弹化
// 不能直接破坏 —— 它的力量全部来自被它操纵的东西
// ============================================================================

const MAX_MINIONS = 4;
const CHARM_TIME = 0.7;
const CHARM_RANGE = 30;   // 距守护者
const CURSOR_RANGE = 5;   // 距鼠标点
const MAX_HP = 120;

export class Guardian extends Creature {
  constructor(ctx, opts) {
    super(ctx, { ...opts, kind: 'guardian', cname: '守护者', color: 0xeadfb8 });
    this.hp = MAX_HP;
    this.minions = [];        // 魅化的道具
    this.charmTarget = null;
    this.charmProgress = 0;
    this.hoverY = 1.8;

    // 造型:米黄陶瓷球 + 蓝眼睛 + 天线星星(原作造型移植)
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xeadfb8, roughness: 0.7 })
    );
    body.castShadow = true;
    this.bodyMesh = body;
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2650d9, roughness: 0.3 });
    for (const ex of [-0.2, 0.2]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), eyeMat);
      eye.position.set(ex, 0.1, -0.45);
      body.add(eye);
    }
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16),
      new THREE.MeshStandardMaterial({ color: 0xffd75e, emissive: 0x886611, roughness: 0.4 })
    );
    star.position.y = 1.0;
    this.star = star;
    body.add(star);
    this.root.add(body);

    // 凝视射线可视化
    this.ray = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x7ac8ff, transparent: true, opacity: 0.6, depthWrite: false })
    );
    this.ray.visible = false;
    ctx.three.scene.add(this.ray);
  }

  hpText() { return `核心 ${Math.ceil(this.hp)} / 仆从 ${this.minions.length}`; }
  hpRatio() { return this.hp / MAX_HP; }

  hittable() { return [{ pos: this.pos, r: 0.9 }]; }

  takeDamage(n, src) {
    if (!this.alive) return;
    this.hp -= n;
    if (this.hp <= 0) {
      this.releaseAll();
      this.ray.visible = false;
      this.die(src);
    }
  }

  onDestroyedProp() {
    this.hp = Math.min(this.hp + 6, MAX_HP); // 破坏回复少量核心
  }

  releaseMinion(m) {
    m.state.charmedBy = null;
    m.state.desiredVel = null;
    m.state.missile = null;
  }

  releaseAll() {
    for (const m of this.minions) this.releaseMinion(m);
    this.minions.length = 0;
  }

  update(dt, input) {
    if (!this.alive) return;
    const ctx = this.ctx;
    this.moveCommon(dt, input, 21, 8);
    this.collide();
    this.pos.y = 0;

    // 漂浮 + 星星旋转
    this.hoverY = 1.8 + Math.sin(ctx.time * 2.2) * 0.25;
    this.bodyMesh.position.set(this.pos.x, this.hoverY, this.pos.z);
    this.star.rotation.y += dt * 3;
    if (this.vel.lengthSq() > 1) {
      this.bodyMesh.rotation.y = damp(this.bodyMesh.rotation.y, Math.atan2(-this.vel.x, -this.vel.z), 6, dt);
    }
    const elec = this.elecT > 0;
    this.bodyMesh.material.emissive.setHex(elec ? 0x4488ff : 0x000000);

    // ---- 凝视魅化 ----
    this.ray.visible = false;
    if (input.primaryHeld && input.aim && this.stun <= 0) {
      const cand = this.findCharmCandidate(input.aim);
      // 没有道具目标时,试着魅化鼠标附近的孤魂(变成自爆仆从)
      if (!cand && (this._critterCd || 0) < ctx.time) {
        const cr = ctx.critters.charmNear(input.aim, this, 2.5);
        if (cr) {
          this._critterCd = ctx.time + 1.0;
          if (this.isPlayer) ctx.ui.popup(ctx, '魅化了孤魂', cr.pos, 0);
        }
      }
      if (cand !== this.charmTarget) { this.charmTarget = cand; this.charmProgress = 0; }
      if (cand) {
        this.charmProgress += dt / CHARM_TIME;
        // 射线可视化
        const from = new THREE.Vector3(this.pos.x, this.hoverY, this.pos.z);
        const to = propPos(cand).setY(1.0);
        const mid = from.clone().lerp(to, 0.5);
        const len = from.distanceTo(to);
        this.ray.position.copy(mid);
        this.ray.scale.set(1, len, 1);
        this.ray.lookAt(to);
        this.ray.rotateX(Math.PI / 2);
        this.ray.visible = true;

        if (this.charmProgress >= 1) {
          this.charm(cand);
          this.charmTarget = null;
          this.charmProgress = 0;
        }
      }
      if (this.isPlayer) ctx.ui.charmRing(input, this.charmProgress);
    } else {
      this.charmTarget = null;
      this.charmProgress = 0;
      if (this.isPlayer) ctx.ui.charmRing(null, 0);
    }

    // ---- 指挥突击:所有仆从导弹化,冲向最近的敌方生物 ----
    if (input.secondary && this.minions.length > 0) {
      const enemy = this.nearestEnemy();
      if (enemy) {
        for (const m of this.minions) {
          m.state.missile = { target: enemy, t: 0 };
        }
        if (this.isPlayer) ctx.ui.popup(ctx, '突击!', this.pos, 1);
      }
    }

    // ---- 仆从更新 ----
    for (let i = this.minions.length - 1; i >= 0; i--) {
      const m = this.minions[i];
      if (m.dead) { this.minions.splice(i, 1); continue; }
      const mp = propPos(m);

      if (m.state.missile) {
        const ms = m.state.missile;
        ms.t += dt;
        const tgt = ms.target;
        if (!tgt.alive || ms.t > 3.0) {
          // 没打中:恢复环绕
          m.state.missile = null;
          continue;
        }
        const dir = tgt.pos.clone().setY(1.2).sub(mp);
        const dist = dir.length();
        dir.normalize();
        m.state.desiredVel = { x: dir.x * 34, y: dir.y * 34, z: dir.z * 34 };
        if (dist < 2.5) {
          // 命中:小爆炸,归因守护者,连锁深度1(被操纵物=一层连锁)
          const at = mp.clone();
          this.minions.splice(i, 1);
          this.releaseMinion(m);
          explode(ctx, at, 4.5, 45 + m.body.mass() * 8, { owner: this, chain: 1 });
          // 仆从自身作为弹药被消耗(也给守护者计分)
          destroyProp(ctx, m, { owner: this, chain: 1 });
        }
      } else {
        // 环绕轨道
        const ang = ctx.time * 1.6 + (i / Math.max(this.minions.length, 1)) * Math.PI * 2;
        const tx = this.pos.x + Math.cos(ang) * 3.6;
        const tz = this.pos.z + Math.sin(ang) * 3.6;
        const ty = 2.0 + Math.sin(ctx.time * 2 + i) * 0.4;
        m.state.desiredVel = { x: (tx - mp.x) * 5, y: (ty - mp.y) * 5, z: (tz - mp.z) * 5 };
      }
    }
  }

  findCharmCandidate(aim) {
    let best = null, bestD = CURSOR_RANGE * CURSOR_RANGE;
    for (const p of this.ctx.props) {
      if (p.dead || !p.def.charmable || p.state.charmedBy) continue;
      const pp = propPos(p);
      if (pp.distanceToSquared(this.pos) > CHARM_RANGE * CHARM_RANGE) continue;
      const d = (pp.x - aim.x) ** 2 + (pp.z - aim.z) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  charm(prop) {
    prop.state.charmedBy = this;
    this.minions.push(prop);
    if (this.minions.length > MAX_MINIONS) {
      const old = this.minions.shift();
      this.releaseMinion(old);
    }
    if (this.isPlayer) this.ctx.ui.popup(this.ctx, `魅化了${prop.def.name}`, propPos(prop), 0);
  }

  nearestEnemy() {
    // 猎杀模式:守护者的敌人永远是猎人
    const p = this.ctx.player;
    if (p && p.alive && p !== this) return p;
    let best = null, bd = Infinity;
    for (const c of this.ctx.creatures) {
      if (c === this || !c.alive) continue;
      const d = c.pos.distanceToSquared(this.pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
}
