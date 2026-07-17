import * as THREE from 'three';
import { Creature } from './base.js';
import { TOON } from '../toon.js';
import { meleeHit, addFlash } from '../damage.js';
import { consumeDebrisNear, spawnDebris, propPos } from '../props.js';
import { rand, damp, clamp, pick } from '../util.js';

// ============================================================================
// 鬼火群(青磷阴火):一簇漂浮的鬼火焰,寄生在庙里的火盆中。
// 解密式击杀:它藏在被占据的火盆里,砍它只会缩回火盆续命;
// 必须先破坏所有被占火盆,把火全逼出来(released)后才能打虚弱、Q 收服。
// ============================================================================

const START_COUNT = 14;
const MAX_COUNT = 44;
const GROW_PER_HP = 70;
const CLAIM_MAX = 8;      // 最多占据几个火盆
const RESERVE = 5;        // 每个火盆藏的火量

// 泪滴火苗贴图(上尖下宽,加法混合发光)
let _flameTex = null;
function ghostFlameTexture() {
  if (_flameTex) return _flameTex;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 96;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 62, 2, 32, 54, 36);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(180,255,220,0.92)');
  grad.addColorStop(0.7, 'rgba(70,220,170,0.5)');
  grad.addColorStop(1, 'rgba(30,120,90,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(32, 4);
  g.bezierCurveTo(52, 40, 55, 66, 32, 92);
  g.bezierCurveTo(9, 66, 12, 40, 32, 4);
  g.closePath();
  g.fill();
  _flameTex = new THREE.CanvasTexture(cv);
  return _flameTex;
}
function flameSprite(color, scale = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: ghostFlameTexture(), color, transparent: true, opacity: 0.7,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.set(0.7 * scale, 1.15 * scale, 1);
  return s;
}

export class Spheres extends Creature {
  constructor(ctx, opts) {
    super(ctx, { ...opts, kind: 'spheres', cname: '鬼火群', color: 0x8fe8c4 });
    this.count = START_COUNT;
    this.growth = 0;
    this.dmgAccum = 0;
    this.mode = 'cloud';
    this.drillDir = new THREE.Vector3(0, 0, -1);

    // 占据/解密状态
    this.braziers = [];      // 被占火盆
    this.streams = [];        // 火盆↔火团 的火流
    this.released = false;    // 全部火盆被毁 → 可收服
    this.hiding = false;      // 缩在火盆中(无敌)
    this.hideT = 0;
    this.hideBrazier = null;
    this.hideRegen = false;
    this.diveT = rand(4, 8);  // 常态钻进/涌出计时

    // 火焰簇(替换旧的实心小球)
    this.wisps = [];
    for (let i = 0; i < MAX_COUNT; i++) {
      const w = flameSprite(0x8fffcf, 1);
      w.visible = false;
      this.root.add(w);
      this.wisps.push(w);
    }
    this.balls = [];
    for (let i = 0; i < MAX_COUNT; i++) {
      this.balls.push({
        pos: this.pos.clone().add(new THREE.Vector3(rand(-2, 2), rand(0.8, 3), rand(-2, 2))),
        la: rand(0.8, 2.2), lb: rand(0.8, 2.2), lc: rand(0.8, 2.2),
        pa: rand(Math.PI * 2), pb: rand(Math.PI * 2), pc: rand(Math.PI * 2),
      });
    }
    this._target = new THREE.Vector3();

    // 芯焰核心:亮心 + 上窜火舌
    this.coreMat = TOON({ color: 0x0c2a20, emissive: 0x6fffcf, emissiveIntensity: 1.6 });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), this.coreMat);
    this.root.add(this.core);
    this.coreFlame = flameSprite(0xbfffe6, 2.2);
    this.root.add(this.coreFlame);
    this.embers = [];
    for (let i = 0; i < 5; i++) {
      const s = flameSprite(0x9fffe0, 0.7);
      this.root.add(s);
      this.embers.push(s);
    }

    this.claimBraziers();
  }

  // 认领庙区中心附近点亮的火盆(出生/逃逸后)
  claimBraziers() {
    const v = this.ctx.village;
    const c = v && v.templeCenter;
    if (!c) { this.released = true; return; }
    const R2 = (v.templeR || 40) ** 2;
    const cands = [];
    for (const p of this.ctx.props) {
      if (p.dead || p.type !== 'brazier' || !p.state.lit || p.state.hauntedBy) continue;
      const pp = propPos(p);
      const d = (pp.x - c.x) ** 2 + (pp.z - c.z) ** 2;
      if (d <= R2) cands.push({ p, d });
    }
    cands.sort((a, b) => a.d - b.d);
    for (const { p } of cands.slice(0, CLAIM_MAX)) {
      p.state.hauntedBy = this;
      p.state.reserve = RESERVE;
      const fl = p.mesh.userData.litFlame;
      if (fl) fl.material.color.setHex(0x6fffcf); // 火苗转青绿
      this.braziers.push(p);
      const sm = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 1),
        new THREE.MeshBasicMaterial({ color: 0x6fffcf, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      this.ctx.three.scene.add(sm);
      this.streams.push({ p, mesh: sm });
    }
    this.released = this.braziers.length === 0;
  }

  onDestroyedProp(hp) {
    this.growth += hp;
    while (this.growth >= GROW_PER_HP && this.count < MAX_COUNT) { this.growth -= GROW_PER_HP; this.count++; }
  }

  hpText() {
    if (!this.released && this.braziers.length) return `鬼火 ${this.count} · 巢穴火盆 ${this.braziers.length}`;
    return `鬼火 ${this.count}${this.released ? ' · 已逼出' : ''}`;
  }
  hpRatio() { return this.count / MAX_COUNT; }

  hittable() {
    if (this.hiding) return []; // 缩在火盆里,打不到
    const out = [{ pos: this.pos, r: 1.2 }];
    for (let i = 0; i < this.count; i += 6) out.push({ pos: this.balls[i].pos, r: 0.5 });
    return out;
  }

  takeDamage(n, src) {
    if (!this.alive || this.weakened || this.hiding) return;
    this.dmgAccum += n;
    while (this.dmgAccum >= 12) {
      this.dmgAccum -= 12;
      this.count--;
      if (this.count >= 0 && this.balls[this.count]) spawnDebris(this.ctx, this.balls[this.count].pos.clone(), 0x8fe8c4, 1, null);
      if (this.count < 5) {
        this.count = 5; this.dmgAccum = 0;
        // 还有巢穴 → 缩回火盆续命(打不死);全逼出后才可虚弱收服
        if (!this.released && this.braziers.length > 0) this.retreatToBrazier();
        else this.enterWeakened();
        return;
      }
    }
  }

  restoreFull() {
    this.count = START_COUNT;
    this.dmgAccum = 0;
    this.growth = 0;
    for (let i = 0; i < this.count; i++) {
      this.balls[i].pos.set(this.pos.x + rand(-2, 2), rand(0.8, 3), this.pos.z + rand(-2, 2));
    }
    // 逃逸后如果庙里还有可占火盆(且尚未被逼出),重新认领
    if (!this.released && this.braziers.length === 0) this.claimBraziers();
  }

  // ---- 火盆解密:缩回 / 涌出 / 释放 ----
  retreatToBrazier() {
    let best = null, bd = Infinity;
    for (const b of this.braziers) {
      const pp = propPos(b);
      const d = (pp.x - this.pos.x) ** 2 + (pp.z - this.pos.z) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) { this.enterWeakened(); return; }
    this.ctx.ui.popup(this.ctx, '鬼火缩回火盆!', this.pos, 'bad');
    this.diveInto(best, true);
  }

  diveInto(brazier, regen) {
    if (!brazier) return;
    this.hiding = true;
    this.hideT = regen ? 2.4 : 1.0;
    this.hideBrazier = brazier;
    this.hideRegen = regen;
    addFlash(this.ctx, this.pos.clone().setY(1.2), 4, 0x6fffcf);
  }

  _emerge() {
    this.hiding = false;
    if (this.hideBrazier) {
      const fl = this.hideBrazier.mesh.userData.litFlame;
      if (fl && fl.userData.base) fl.scale.setScalar(fl.userData.base);
    }
    const others = this.braziers.filter((b) => b !== this.hideBrazier);
    const out = pick(others.length ? others : this.braziers);
    if (out) { const bp = propPos(out); this.pos.set(bp.x, 0, bp.z); }
    if (this.hideRegen) {
      this.count = Math.max(this.count, START_COUNT);
      this.dmgAccum = 0;
      addFlash(this.ctx, this.pos.clone().setY(1.2), 5, 0x6fffcf);
      this.ctx.ui.popup(this.ctx, '鬼火自火盆涌出', this.pos, 0);
    }
    this.hideBrazier = null;
  }

  // 火盆被摧毁 → 逼出藏火(由 damage.destroyProp 调用)
  releaseBrazier(prop) {
    const idx = this.braziers.indexOf(prop);
    if (idx < 0) return;
    this.braziers.splice(idx, 1);
    prop.state.hauntedBy = null;
    this.count = Math.min(this.count + (prop.state.reserve || RESERVE), MAX_COUNT);
    addFlash(this.ctx, propPos(prop).setY(1.2), 5, 0x6fffcf);
    this.ctx.shake = Math.max(this.ctx.shake, 0.4);
    for (let i = this.streams.length - 1; i >= 0; i--) {
      if (this.streams[i].p === prop) { this.ctx.three.scene.remove(this.streams[i].mesh); this.streams.splice(i, 1); }
    }
    if (this.hiding && this.hideBrazier === prop) this._emerge();
    if (this.braziers.length === 0 && !this.released) {
      this.released = true;
      this.ctx.ui.banner('鬼火巢穴尽毁 —— 逼出全部,趁现在收服!');
    } else {
      this.ctx.ui.popup(this.ctx, '火盆碎裂,鬼火涌出!', propPos(prop), 'bad');
    }
  }

  _updateStreams(dt, t) {
    for (let i = this.streams.length - 1; i >= 0; i--) {
      const s = this.streams[i];
      if (s.p.dead) { this.ctx.three.scene.remove(s.mesh); this.streams.splice(i, 1); continue; }
      const a = propPos(s.p); const bx = this.pos.x, bz = this.pos.z, by = 1.3;
      const len = Math.hypot(a.x - bx, (a.y + 1.4) - by, a.z - bz);
      s.mesh.position.set((a.x + bx) / 2, (a.y + 1.4 + by) / 2, (a.z + bz) / 2);
      s.mesh.scale.set(1, 1, Math.max(len, 0.1));
      s.mesh.lookAt(bx, by, bz);
      s.mesh.material.opacity = 0.3 + Math.sin(t * 8 + i) * 0.18;
    }
  }

  updateHide(dt) {
    const t = this.ctx.time;
    this.hideT -= dt;
    const bp = this.hideBrazier ? propPos(this.hideBrazier) : (this.braziers[0] ? propPos(this.braziers[0]) : null);
    if (bp) { this.pos.x = damp(this.pos.x, bp.x, 8, dt); this.pos.z = damp(this.pos.z, bp.z, 8, dt); }
    for (const w of this.wisps) w.visible = false;
    this.core.visible = false; this.coreFlame.visible = false;
    for (const e of this.embers) e.visible = false;
    const fl = this.hideBrazier && this.hideBrazier.mesh.userData.litFlame;
    if (fl) fl.scale.setScalar(1.6 + Math.sin(t * 14) * 0.35); // 火盆焰随藏火胀大
    this._updateStreams(dt, t);
    if (this.hideT <= 0) this._emerge();
  }

  update(dt, input) {
    if (!this.alive) return;
    if (this.updateWeakened(dt)) return;
    if (this.hiding) { this.updateHide(dt); return; }
    const ctx = this.ctx;

    // 阵型切换
    if (this.stun > 0) this.mode = 'cloud';
    else if (input.primaryHeld) this.mode = 'drill';
    else if (input.secondaryHeld) this.mode = 'ring';
    else this.mode = 'cloud';

    if (this.mode === 'drill' && input.aim) {
      const d = this._target.copy(input.aim).sub(this.pos).setY(0);
      if (d.lengthSq() > 0.5) this.drillDir.copy(d.normalize());
    }

    if (this.mode === 'drill') {
      this.stun = Math.max(0, this.stun - dt);
      this.elecT = Math.max(0, this.elecT - dt);
      const spd = ctx.rain.slippery ? 20 : 26;
      this.vel.x = damp(this.vel.x, this.drillDir.x * spd, 5, dt);
      this.vel.z = damp(this.vel.z, this.drillDir.z * spd, 5, dt);
      this.pos.x = clamp(this.pos.x + this.vel.x * dt, -145, 145);
      this.pos.z = clamp(this.pos.z + this.vel.z * dt, -145, 145);
    } else {
      this.moveCommon(dt, input, this.mode === 'ring' ? 8 : 13, 5);
    }
    this.collide();
    this.pos.y = 0;

    const elec = this.elecT > 0;
    if (elec) this.dmgAccum += 1.5 * dt;
    const t = ctx.time;

    // 常态钻进/涌出(玩家不在近处时,演出"火住在火盆里")
    this.diveT -= dt;
    if (this.braziers.length > 0 && this.diveT <= 0) {
      this.diveT = rand(5, 9);
      const pd = ctx.player ? this.pos.distanceTo(ctx.player.pos) : 999;
      if (pd > 26) { this.diveInto(pick(this.braziers), false); this._updateStreams(dt, t); return; }
    }

    // 火焰阵型位置
    const growR = 2.2 + this.count * 0.07;
    for (let i = 0; i < this.count; i++) {
      const b = this.balls[i];
      const frac = i / Math.max(this.count, 1);
      if (this.mode === 'drill') {
        const row = i % 6, ring = Math.floor(i / 6);
        const ang = t * 14 + row * (Math.PI * 2 / 6) + ring * 0.5;
        const rr = 0.25 + ring * 0.32;
        const side = new THREE.Vector3(-this.drillDir.z, 0, this.drillDir.x);
        this._target.copy(this.pos).addScaledVector(this.drillDir, 1.5 + ring * 0.75).addScaledVector(side, Math.cos(ang) * rr);
        this._target.y = 1.0 + Math.sin(ang) * rr;
      } else if (this.mode === 'ring') {
        const ang = t * 5.5 + frac * Math.PI * 2;
        this._target.set(this.pos.x + Math.cos(ang) * 7, 1.1 + Math.sin(t * 3 + i) * 0.3, this.pos.z + Math.sin(ang) * 7);
      } else {
        this._target.set(
          this.pos.x + Math.sin(b.la * t * 0.9 + b.pa) * growR,
          1.7 + Math.sin(b.lb * t * 0.9 + b.pb) * 1.1,
          this.pos.z + Math.sin(b.lc * t * 0.9 + b.pc) * growR
        );
      }
      const k = this.mode === 'drill' ? 10 : 6;
      b.pos.lerp(this._target, 1 - Math.exp(-k * dt));
    }

    // 火焰簇渲染:摇曳明灭
    const tint = elec ? 0x66aaff : 0x8fffcf;
    for (let i = 0; i < MAX_COUNT; i++) {
      const w = this.wisps[i];
      if (i < this.count) {
        w.visible = true;
        w.position.copy(this.balls[i].pos);
        const fl = 0.85 + Math.sin(t * 10 + i * 1.3) * 0.28;
        w.scale.set(0.65 * fl, 1.15 * fl, 1);
        w.material.opacity = 0.6 + Math.sin(t * 13 + i) * 0.22;
        w.material.color.setHex(tint);
      } else { w.visible = false; }
    }

    // 芯焰核心 + 火舌 + 余烬
    this.core.visible = true; this.coreFlame.visible = true;
    this.core.position.set(this.pos.x, 1.3 + Math.sin(t * 4) * 0.15, this.pos.z);
    this.core.rotation.x += dt * 1.5; this.core.rotation.y += dt * 2.0;
    this.core.scale.setScalar(0.35 + this.count * 0.012 + Math.sin(t * 12) * 0.06);
    this.coreMat.emissive.setHex(elec ? 0x66aaff : 0x6fffcf);
    this.coreMat.emissiveIntensity = 1.3 + Math.sin(t * 10) * 0.4 + (elec ? 0.6 : 0);
    this.coreFlame.position.set(this.pos.x, 1.9 + Math.sin(t * 9) * 0.15, this.pos.z);
    const cf = 1.9 + this.count * 0.03 + Math.sin(t * 15) * 0.2;
    this.coreFlame.scale.set(cf * 0.7, cf, 1);
    this.coreFlame.material.color.setHex(elec ? 0x9fd0ff : 0xbfffe6);
    for (let i = 0; i < this.embers.length; i++) {
      const e = this.embers[i], a = t * (1.5 + i * 0.3) + i * 1.7;
      e.visible = true;
      e.position.set(this.pos.x + Math.cos(a) * (1.2 + i * 0.2), 1.4 + Math.sin(a * 1.5) * 0.7, this.pos.z + Math.sin(a) * (1.2 + i * 0.2));
      const es = 0.5 + Math.sin(t * 8 + i) * 0.15;
      e.scale.set(es * 0.7, es, 1);
    }

    // 火盆↔火团 火流
    this._updateStreams(dt, t);

    // 伤害
    const dps = (this.mode === 'drill' ? 110 : this.mode === 'ring' ? 48 : 8) * (elec ? 1.6 : 1);
    const perHit = dps * 0.22;
    const src = { owner: this, chain: 0 };
    const step = this.mode === 'cloud' ? 3 : 2;
    for (let i = 0; i < this.count; i += step) meleeHit(ctx, this, this.balls[i].pos, 0.95, perHit, src);

    // 吞噬碎片成长
    const eaten = consumeDebrisNear(ctx, this.pos, 7, 3);
    if (eaten > 0 && this.count < MAX_COUNT) this.count = Math.min(this.count + eaten, MAX_COUNT);
  }
}
