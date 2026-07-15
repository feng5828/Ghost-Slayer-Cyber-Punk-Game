import * as THREE from 'three';
import { rand } from './util.js';
import { damageProp, hitCreaturesAt } from './damage.js';

// ============================================================================
// 道具定义:涌现的基础 —— 每个道具只有几个共享属性
// flammable 可燃 / conductive 导电 / explosive 爆炸 / powered 带电
// charmable 可魅化 / douses 摧毁时浇灭周围火焰
// ============================================================================
export const PROP_DEFS = {
  hay:     { name: '干草垛', hp: 30, points: 20, flammable: true, charmable: true, color: 0xd9b44a },
  fence:   { name: '木栅栏', hp: 20, points: 15, flammable: true, charmable: true, color: 0x8a6a42 },
  pole:    { name: '电灯柱', hp: 60, points: 50, powered: true, conductive: true, color: 0x6b5030 },
  tank:    { name: '火药桶', hp: 35, points: 50, explosive: true, flammable: true, charmable: true, conductive: true, color: 0x7a4a2c },
  rock:    { name: '石堆',   hp: 70, points: 25, charmable: true, color: 0x8d9096 },
  grass:   { name: '花草',   hp: 6,  points: 5,  flammable: true, noBody: true, color: 0x4d8a3a },
  balloon: { name: '热气球', hp: 400, points: 500, flammable: true, color: 0xd8503c },
  hedge:   { name: '树篱',   hp: 25, points: 10, flammable: true, color: 0x3e6b2f },
  house:   { name: '木屋',   hp: 150, points: 80, flammable: true, color: 0x9c7a4e },
  cart:    { name: '木车',   hp: 35, points: 25, flammable: true, charmable: true, color: 0x8a6a42 },
  well:    { name: '水井',   hp: 60, points: 30, douses: true, color: 0x9aa0a6 },
};

let _id = 0;
const geoCache = {};
const matCache = {};

function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache[key]) matCache[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
  return matCache[key];
}

// ---------------------------------------------------------------------------
// 各类道具的网格 + 物理体
// ---------------------------------------------------------------------------
function buildMeshAndBody(ctx, type, x, z, opts = {}) {
  const { RAPIER, world } = ctx.phys;
  const def = PROP_DEFS[type];
  const group = new THREE.Group();
  let body = null;

  const dyn = (px, py, pz, damping = 0.4) =>
    world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(px, py, pz)
      .setLinearDamping(damping).setAngularDamping(0.8));
  const fixed = (px, py, pz) =>
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz));

  if (type === 'hay') {
    geoCache.hay ||= new THREE.CylinderGeometry(1.0, 1.0, 1.5, 14).rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(geoCache.hay, mat(def.color));
    m.castShadow = true;
    group.add(m);
    body = dyn(x, 1.1, z, 0.25);
    world.createCollider(RAPIER.ColliderDesc.ball(1.0).setDensity(0.5).setFriction(0.7).setRestitution(0.15), body);
  } else if (type === 'fence') {
    geoCache.fence ||= new THREE.BoxGeometry(2.4, 1.1, 0.16);
    const m = new THREE.Mesh(geoCache.fence, mat(def.color));
    m.castShadow = true;
    group.add(m);
    body = dyn(x, 0.7, z, 0.6);
    body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(Math.PI * 2)), true);
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.2, 0.55, 0.08).setDensity(0.4).setFriction(0.8), body);
  } else if (type === 'pole') {
    geoCache.pole ||= new THREE.CylinderGeometry(0.22, 0.3, 6, 8);
    geoCache.lantern ||= new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const trunk = new THREE.Mesh(geoCache.pole, mat(def.color));
    trunk.position.y = 3; trunk.castShadow = true;
    const lantern = new THREE.Mesh(geoCache.lantern,
      mat(0xffd75e, { emissive: 0xcc9922, emissiveIntensity: 0.9, roughness: 0.4 }));
    lantern.position.y = 5.7;
    group.add(trunk, lantern);
    body = fixed(x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.cylinder(3, 0.3).setTranslation(0, 3, 0), body);
  } else if (type === 'tank') {
    geoCache.tank ||= new THREE.CylinderGeometry(0.7, 0.7, 1.3, 12);
    const m = new THREE.Mesh(geoCache.tank, mat(def.color, { roughness: 0.7 }));
    m.castShadow = true;
    group.add(m);
    body = dyn(x, 0.7, z, 0.5);
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.65, 0.7).setDensity(0.8).setFriction(0.6), body);
  } else if (type === 'rock') {
    geoCache.rock ||= new THREE.IcosahedronGeometry(1.35, 0);
    const m = new THREE.Mesh(geoCache.rock, mat(def.color, { roughness: 0.95 }));
    m.castShadow = true;
    group.add(m);
    body = dyn(x, 1.3, z, 0.3);
    world.createCollider(RAPIER.ColliderDesc.ball(1.25).setDensity(2.2).setFriction(0.9), body);
  } else if (type === 'grass') {
    geoCache.grass ||= new THREE.ConeGeometry(0.5, 1.2, 6);
    geoCache.flower ||= new THREE.SphereGeometry(0.14, 6, 5);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geoCache.grass, mat(def.color));
      m.position.set(rand(-0.5, 0.5), 0.55, rand(-0.5, 0.5));
      m.scale.setScalar(rand(0.7, 1.15));
      group.add(m);
    }
    const f = new THREE.Mesh(geoCache.flower, mat(0xe0e070, { roughness: 0.6 }));
    f.position.set(rand(-0.3, 0.3), 1.15, rand(-0.3, 0.3));
    group.add(f);
    group.position.set(x, 0, z);
  } else if (type === 'balloon') {
    geoCache.balloonBall ||= new THREE.SphereGeometry(4.2, 20, 16);
    geoCache.balloonBasket ||= new THREE.BoxGeometry(2.2, 1.6, 2.2);
    const ball = new THREE.Mesh(geoCache.balloonBall, mat(def.color));
    ball.position.y = 9.5; ball.scale.y = 1.15; ball.castShadow = true;
    const basket = new THREE.Mesh(geoCache.balloonBasket, mat(0x7a5c34));
    basket.position.y = 1.4; basket.castShadow = true;
    group.add(ball, basket);
    body = fixed(x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.ball(4.4).setTranslation(0, 9.5, 0), body);
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.1, 0.8, 1.1).setTranslation(0, 1.4, 0), body);
  } else if (type === 'hedge') {
    // 迷宫墙体:轴对齐,尺寸由 opts.w / opts.d 指定
    geoCache.hedge ||= new THREE.BoxGeometry(1, 1, 1);
    const w = opts.w || 6.8, d = opts.d || 1.2;
    const m = new THREE.Mesh(geoCache.hedge, mat(def.color, { roughness: 1.0 }));
    m.scale.set(w, 2.2, d);
    m.position.y = 1.1;
    m.castShadow = true;
    group.add(m);
    body = fixed(x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, 1.1, d / 2).setTranslation(0, 1.1, 0), body);
  } else if (type === 'house') {
    geoCache.houseBase ||= new THREE.BoxGeometry(6.5, 4, 6.5);
    geoCache.houseRoof ||= new THREE.ConeGeometry(5.2, 2.8, 4);
    const base = new THREE.Mesh(geoCache.houseBase, mat(def.color));
    base.position.y = 2; base.castShadow = true;
    const roof = new THREE.Mesh(geoCache.houseRoof, mat(0x7a3b2a, { roughness: 0.9 }));
    roof.position.y = 5.4; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
    const door = new THREE.Mesh(
      geoCache.hedge ||= new THREE.BoxGeometry(1, 1, 1),
      mat(0x4a3020)
    );
    door.scale.set(1.2, 2.2, 0.1); door.position.set(0, 1.1, 3.28);
    group.add(base, roof, door);
    body = fixed(x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.cuboid(3.25, 2, 3.25).setTranslation(0, 2, 0), body);
  } else if (type === 'cart') {
    geoCache.cartBody ||= new THREE.BoxGeometry(2.4, 0.9, 1.5);
    geoCache.cartWheel ||= new THREE.CylinderGeometry(0.5, 0.5, 0.15, 10).rotateX(Math.PI / 2);
    const cb = new THREE.Mesh(geoCache.cartBody, mat(def.color));
    cb.position.y = 0.1; cb.castShadow = true;
    group.add(cb);
    for (const [wx, wz] of [[-0.8, 0.8], [0.8, 0.8], [-0.8, -0.8], [0.8, -0.8]]) {
      const wm = new THREE.Mesh(geoCache.cartWheel, mat(0x3a3028));
      wm.position.set(wx, -0.3, wz);
      group.add(wm);
    }
    body = dyn(x, 1.0, z, 0.3);
    world.createCollider(RAPIER.ColliderDesc.ball(1.0).setDensity(0.6).setFriction(0.7).setRestitution(0.1), body);
  } else if (type === 'well') {
    geoCache.well ||= new THREE.CylinderGeometry(1.2, 1.3, 1.3, 12);
    const m = new THREE.Mesh(geoCache.well, mat(def.color, { roughness: 0.95 }));
    m.position.y = 0.65; m.castShadow = true;
    const water = new THREE.Mesh(
      geoCache.wellWater ||= new THREE.CylinderGeometry(1.0, 1.0, 0.1, 12),
      mat(0x3a6a9a, { roughness: 0.2, metalness: 0.1 })
    );
    water.position.y = 1.26;
    group.add(m, water);
    body = fixed(x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.65, 1.25).setTranslation(0, 0.65, 0), body);
  }

  if (body) {
    const t = body.translation();
    group.position.set(t.x, t.y, t.z);
  }
  return { group, body };
}

export function createProp(ctx, type, x, z, opts = {}) {
  const def = PROP_DEFS[type];
  const { group, body } = buildMeshAndBody(ctx, type, x, z, opts);
  ctx.three.scene.add(group);
  const prop = {
    id: ++_id, type, def, mesh: group, body, dead: false,
    fixed: !body || body.isFixed(),
    state: {
      hp: def.hp, burning: null, hitCd: 0,
      thrownBy: null,       // {owner, chain, t} 被打飞后成为"弹药"的归因
      charmedBy: null,      // 纸傀儡魅化
      desiredVel: null,     // 魅化时由纸傀儡写入
    },
  };
  ctx.props.push(prop);
  return prop;
}

export function propPos(prop) {
  if (prop.body) { const t = prop.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); }
  return prop.mesh.position.clone();
}

// ============================================================================
// 碎片:所有被摧毁物 / 被打散的生物部件都变成物理碎片,可二次伤害、可被吞噬
// ============================================================================
const debrisGeo = new THREE.BoxGeometry(1, 1, 1);

export function spawnDebris(ctx, pos, color, count, src, opts = {}) {
  const { RAPIER, world } = ctx.phys;
  for (let i = 0; i < count; i++) {
    const big = opts.big && i === 0;
    const s = big ? rand(0.9, 1.3) : rand(0.22, 0.42);
    const mesh = new THREE.Mesh(debrisGeo, mat(color));
    mesh.scale.set(s, big ? s * (opts.tall ? 5 : 1) : s, s);
    mesh.castShadow = !big ? false : true;
    ctx.three.scene.add(mesh);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x + rand(-0.5, 0.5), pos.y + rand(0.2, 1.2), pos.z + rand(-0.5, 0.5))
        .setLinearDamping(0.2).setAngularDamping(0.5)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(s / 2, (big && opts.tall ? s * 2.5 : s) / 2, s / 2)
        .setDensity(big ? 1.6 : 0.7).setFriction(0.7).setRestitution(0.3),
      body
    );
    body.applyImpulse({
      x: rand(-1, 1) * s * 3,
      y: rand(2, 5) * s * (big ? 2 : 1),
      z: rand(-1, 1) * s * 3,
    }, true);
    ctx.debris.push({
      mesh, body, big,
      owner: src ? src.owner : null,
      chain: src ? src.chain : 0,
      dieAt: ctx.time + (big ? 12 : rand(5, 8)),
      cd: 0,
    });
  }
}

function removeDebris(ctx, d) {
  ctx.phys.world.removeRigidBody(d.body);
  ctx.three.scene.remove(d.mesh);
}

// ============================================================================
// 每帧更新:同步物理、"道具当炮弹"的连锁伤害、碎片撞击、碎片寿命
// ============================================================================
const _v = new THREE.Vector3();

export function updateProps(ctx, dt) {
  // --- 道具同步 & 被打飞的道具作为炮弹 ---
  for (const p of ctx.props) {
    if (p.dead || !p.body) continue;
    const t = p.body.translation(), r = p.body.rotation();
    p.mesh.position.set(t.x, t.y, t.z);
    p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    if (t.y < -8) { p.dead = true; cleanupProp(ctx, p); continue; }

    // 魅化道具:纸傀儡写入的期望速度
    if (p.state.desiredVel) {
      p.body.setLinvel(p.state.desiredVel, true);
    }

    const tb = p.state.thrownBy;
    if (tb && ctx.time - tb.t < 3.0) {
      const lv = p.body.linvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      if (speed > 8 && ctx.time > p.state.hitCd) {
        // 撞其他道具
        for (const q of ctx.props) {
          if (q === p || q.dead) continue;
          const qp = propPos(q);
          if (qp.distanceToSquared(_v.set(t.x, t.y, t.z)) < 2.4 * 2.4) {
            damageProp(ctx, q, speed * 1.6, { owner: tb.owner, chain: tb.chain });
            p.state.hitCd = ctx.time + 0.3;
          }
        }
        // 撞生物
        hitCreaturesAt(ctx, _v.set(t.x, t.y, t.z), 2.2, speed * 0.8, { owner: tb.owner, chain: tb.chain }, null);
      }
    } else if (tb) {
      p.state.thrownBy = null;
    }
  }

  // --- 碎片 ---
  for (let i = ctx.debris.length - 1; i >= 0; i--) {
    const d = ctx.debris[i];
    if (ctx.time > d.dieAt) { removeDebris(ctx, d); ctx.debris.splice(i, 1); continue; }
    const t = d.body.translation(), r = d.body.rotation();
    if (t.y < -8) { removeDebris(ctx, d); ctx.debris.splice(i, 1); continue; }
    d.mesh.position.set(t.x, t.y, t.z);
    d.mesh.quaternion.set(r.x, r.y, r.z, r.w);

    if (!d.owner || ctx.time < d.cd) continue;
    const lv = d.body.linvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    if (speed < 7) continue;
    const dmg = speed * (d.big ? 6 : 1.3);
    for (const q of ctx.props) {
      if (q.dead) continue;
      const qp = propPos(q);
      if (qp.distanceToSquared(_v.set(t.x, t.y, t.z)) < 1.8 * 1.8) {
        damageProp(ctx, q, dmg, { owner: d.owner, chain: d.chain });
        d.cd = ctx.time + 0.35;
        break;
      }
    }
    if (ctx.time >= d.cd) {
      if (hitCreaturesAt(ctx, _v.set(t.x, t.y, t.z), 1.6, dmg * 0.5, { owner: d.owner, chain: d.chain }, null)) {
        d.cd = ctx.time + 0.4;
      }
    }
  }
}

// 吞噬碎片(鬼火群成长用):返回被吞掉的数量
export function consumeDebrisNear(ctx, center, radius, maxCount) {
  let eaten = 0;
  for (let i = ctx.debris.length - 1; i >= 0 && eaten < maxCount; i--) {
    const d = ctx.debris[i];
    if (d.big) continue;
    const t = d.body.translation();
    const dx = t.x - center.x, dy = t.y - center.y, dz = t.z - center.z;
    const dsq = dx * dx + dy * dy + dz * dz;
    if (dsq < 1.5 * 1.5) {
      removeDebris(ctx, d); ctx.debris.splice(i, 1); eaten++;
    } else if (dsq < radius * radius) {
      // 吸向中心
      const k = 14 / Math.max(Math.sqrt(dsq), 1);
      d.body.setLinvel({ x: -dx * k, y: -dy * k, z: -dz * k }, true);
    }
  }
  return eaten;
}

export function cleanupProp(ctx, prop) {
  if (prop.body) { ctx.phys.world.removeRigidBody(prop.body); prop.body = null; }
  ctx.three.scene.remove(prop.mesh);
  if (prop.state.flameSprite) {
    ctx.three.scene.remove(prop.state.flameSprite);
    prop.state.flameSprite = null;
  }
}
