import * as THREE from 'three';
import { spawnDebris, propPos, cleanupProp } from './props.js';
import { ignite } from './fire.js';

// ============================================================================
// 伤害与破坏:一切破坏都带 src = {owner, chain}
// chain 是连锁深度,决定计分倍率 —— 涌现玩法的经济核心
// ============================================================================

export function damageProp(ctx, prop, amount, src) {
  if (prop.dead || amount <= 0) return;
  prop.state.hp -= amount;
  if (prop.state.hp <= 0) destroyProp(ctx, prop, src);
}

export function destroyProp(ctx, prop, src) {
  if (prop.dead) return;
  prop.dead = true;
  const pos = propPos(prop);
  const def = prop.def;
  const owner = src && src.owner;
  const chain = src ? src.chain : 0;

  if (owner && owner.alive) {
    ctx.score.award(ctx, owner, def.points, chain, def.name, pos);
    if (owner.onDestroyedProp) owner.onDestroyedProp(def.hp);
  }

  // 碎片继承归因,连锁深度 +1 —— 碎片再砸坏东西就是连锁
  const nextSrc = { owner, chain: chain + 1 };
  if (prop.type === 'pole') {
    // 电线塔:倒下的塔身是危险的大型碎片
    spawnDebris(ctx, new THREE.Vector3(pos.x, 5, pos.z), def.color, 4, nextSrc, { big: true, tall: true });
  } else if (prop.type === 'balloon') {
    spawnDebris(ctx, new THREE.Vector3(pos.x, 8, pos.z), def.color, 10, nextSrc);
    ctx.ui.banner('热气球被击落了!!');
    ctx.shake = Math.max(ctx.shake, 1.0);
  } else {
    spawnDebris(ctx, pos, def.color, prop.type === 'grass' ? 2 : 4, nextSrc);
  }

  // 属性驱动的连锁反应 —— 不写死结果,只触发系统
  if (def.explosive) explode(ctx, pos, 8, 60, nextSrc);
  if (def.powered) spark(ctx, pos, nextSrc);
  if (prop.state.burning) {
    // 燃烧中被摧毁:火种溅到附近可燃物
    for (const q of nearbyProps(ctx, pos, 3.5)) {
      if (q.def.flammable && !q.dead) ignite(ctx, q, { owner: prop.state.burning.owner, chain: prop.state.burning.chain + 1 });
    }
  }

  cleanupProp(ctx, prop);
  const idx = ctx.props.indexOf(prop);
  if (idx >= 0) ctx.props.splice(idx, 1);
}

export function nearbyProps(ctx, pos, radius) {
  const out = [];
  const r2 = radius * radius;
  for (const p of ctx.props) {
    if (p.dead) continue;
    if (propPos(p).distanceToSquared(pos) < r2) out.push(p);
  }
  return out;
}

// ============================================================================
// 近战扫击:生物身体撞击道具/小人/其他生物的统一入口
// ============================================================================
export function meleeHit(ctx, owner, pos, radius, dmg, src, impulseScale = 1) {
  if (dmg <= 0) return 0;
  let hits = 0;
  const r2 = radius * radius;
  for (const p of ctx.props) {
    if (p.dead) continue;
    const pp = propPos(p);
    if (pp.distanceToSquared(pos) >= r2) continue;
    if (ctx.time < p.state.hitCd) continue;
    p.state.hitCd = ctx.time + 0.22;
    damageProp(ctx, p, dmg, src);
    hits++;
    // 击飞:被打飞的道具带上归因,砸到别的东西算连锁
    if (p.body && !p.fixed && !p.dead) {
      const dir = pp.clone().sub(pos);
      dir.y = 0.4; dir.normalize();
      const mass = p.body.mass();
      const kick = Math.min(dmg * 0.5, 16) * impulseScale;
      p.body.applyImpulse({ x: dir.x * kick * mass, y: dir.y * kick * 0.8 * mass, z: dir.z * kick * mass }, true);
      p.state.thrownBy = { owner: src.owner, chain: src.chain + 1, t: ctx.time };
    }
  }
  // 小人
  ctx.critters.hitAt(ctx, pos, radius, src);
  // 其他生物
  hits += hitCreaturesAt(ctx, pos, radius, dmg * 0.3, src, owner);
  return hits;
}

// 对生物的范围伤害(owner 排除自己),带每对冷却避免逐帧融化
export function hitCreaturesAt(ctx, pos, radius, dmg, src, exclude) {
  if (dmg <= 0) return 0;
  let hits = 0;
  for (const c of ctx.creatures) {
    if (!c.alive || c === exclude || c === (src && src.owner)) continue;
    for (const h of c.hittable()) {
      if (h.pos.distanceTo(pos) < radius + h.r) {
        const key = 'cd_' + (src && src.owner ? src.owner.id : 'x');
        if (ctx.time < (c._hitCds?.[key] || 0)) break;
        (c._hitCds ||= {})[key] = ctx.time + 0.35;
        c.takeDamage(dmg, src);
        hits++;
        break;
      }
    }
  }
  return hits;
}

// ============================================================================
// 爆炸:范围伤害 + 冲击波 + 点燃 —— 油罐、导弹化道具共用
// ============================================================================
export function explode(ctx, pos, radius, dmg, src) {
  ctx.shake = Math.max(ctx.shake, 0.7);
  addFlash(ctx, pos, radius, 0xff8a30);
  for (const p of nearbyProps(ctx, pos, radius)) {
    const pp = propPos(p);
    const d = pp.distanceTo(pos);
    const falloff = 1 - d / (radius + 0.01);
    damageProp(ctx, p, dmg * falloff, src);
    if (!p.dead && p.body && !p.fixed) {
      const dir = pp.sub(pos); dir.y = Math.abs(dir.y) + 1.5; dir.normalize();
      const mass = p.body.mass();
      p.body.applyImpulse({ x: dir.x * 30 * falloff * mass, y: dir.y * 22 * falloff * mass, z: dir.z * 30 * falloff * mass }, true);
      p.state.thrownBy = { owner: src.owner, chain: src.chain, t: ctx.time };
    }
    if (!p.dead && p.def.flammable) ignite(ctx, p, src);
  }
  hitCreaturesAt(ctx, pos, radius * 0.9, dmg * 0.6, src, null);
  ctx.critters.hitAt(ctx, pos, radius * 0.9, src);
}

// ============================================================================
// 电火花:电线塔倒塌 → 电击生物、点燃可燃物、沿导电物传导
// ============================================================================
export function spark(ctx, pos, src) {
  addFlash(ctx, pos, 6, 0x7ac8ff);
  for (const c of ctx.creatures) {
    if (!c.alive) continue;
    if (c.pos.distanceTo(pos) < 7) c.electrify(4.0, src);
  }
  for (const p of nearbyProps(ctx, pos, 6)) {
    if (p.def.flammable) ignite(ctx, p, src);
    if (p.def.conductive && !p.dead) damageProp(ctx, p, 30, { owner: src.owner, chain: src.chain + 1 });
  }
  ctx.critters.hitAt(ctx, pos, 5, src);
}

// ============================================================================
// 简单爆闪特效(膨胀球体渐隐)
// ============================================================================
const flashGeo = new THREE.SphereGeometry(1, 12, 8);

export function addFlash(ctx, pos, radius, color) {
  const m = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  m.position.copy(pos);
  ctx.three.scene.add(m);
  ctx.fx.push({ mesh: m, t: 0, dur: 0.45, maxR: radius });
}

export function updateFx(ctx, dt) {
  for (let i = ctx.fx.length - 1; i >= 0; i--) {
    const f = ctx.fx[i];
    f.t += dt;
    const k = f.t / f.dur;
    if (k >= 1) {
      ctx.three.scene.remove(f.mesh);
      f.mesh.material.dispose();
      ctx.fx.splice(i, 1);
      continue;
    }
    f.mesh.scale.setScalar(0.3 + k * f.maxR);
    f.mesh.material.opacity = 0.85 * (1 - k);
  }
}
