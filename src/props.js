import * as THREE from 'three';
import { rand, randInt, pick, dist2d } from './util.js';
import { damageProp, hitCreaturesAt } from './damage.js';

// ============================================================================
// 道具定义：涌现的基础 —— 每个道具只有几个共享属性
// flammable 可燃 / conductive 导电 / explosive 爆炸 / powered 带电 / charmable 可魅化
// ============================================================================
export const PROP_DEFS = {
  hay:     { name: '干草垛', hp: 30, points: 20, flammable: true, charmable: true, color: 0xd9b44a },
  fence:   { name: '木栅栏', hp: 20, points: 15, flammable: true, charmable: true, color: 0x8a6a42 },
  pole:    { name: '电线塔', hp: 80, points: 60, powered: true, conductive: true, color: 0x6b5030 },
  tank:    { name: '油罐',   hp: 40, points: 50, explosive: true, flammable: true, charmable: true, conductive: true, color: 0xa33327 },
  rock:    { name: '巨石',   hp: 70, points: 25, charmable: true, color: 0x8d9096 },
  grass:   { name: '草丛',   hp: 6,  points: 5,  flammable: true, noBody: true, color: 0x4d8a3a },
  balloon: { name: '热气球', hp: 400, points: 500, flammable: true, color: 0xd8503c },
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
function buildMeshAndBody(ctx, type, x, z) {
  const { RAPIER, world } = ctx.phys;
  const def = PROP_DEFS[type];
  const group = new THREE.Group();
  let body = null;

  const dyn = (px, py, pz, damping = 0.4) =>
    world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(px, py, pz)
      .setLinearDamping(damping).setAngularDamping(0.8));

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
    geoCache.pole ||= new THREE.CylinderGeometry(0.32, 0.4, 9, 8);
    geoCache.poleBar ||= new THREE.BoxGeometry(3.2, 0.25, 0.25);
    const trunk = new THREE.Mesh(geoCache.pole, mat(def.color));
    trunk.position.y = 4.5; trunk.castShadow = true;
    const bar = new THREE.Mesh(geoCache.poleBar, mat(0x4a3a24));
    bar.position.y = 8.2; bar.castShadow = true;
    group.add(trunk, bar);
    body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, z));
    world.createCollider(RAPIER.ColliderDesc.cylinder(4.5, 0.4).setTranslation(0, 4.5, 0), body);
  } else if (type === 'tank') {
    geoCache.tank ||= new THREE.CylinderGeometry(0.9, 0.9, 1.9, 14);
    const m = new THREE.Mesh(geoCache.tank, mat(def.color, { metalness: 0.35, roughness: 0.5 }));
    m.castShadow = true;
    group.add(m);
    body = dyn(x, 1.0, z, 0.5);
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.95, 0.9).setDensity(0.8).setFriction(0.6), body);
  } else if (type === 'rock') {
    geoCache.rock ||= new THREE.IcosahedronGeometry(1.35, 0);
    const m = new THREE.Mesh(geoCache.rock, mat(def.color, { roughness: 0.95 }));
    m.castShadow = true;
    group.add(m);
    body = dyn(x, 1.3, z, 0.3);
    world.createCollider(RAPIER.ColliderDesc.ball(1.25).setDensity(2.2).setFriction(0.9), body);
  } else if (type === 'grass') {
    geoCache.grass ||= new THREE.ConeGeometry(0.5, 1.2, 6);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geoCache.grass, mat(def.color));
      m.position.set(rand(-0.5, 0.5), 0.55, rand(-0.5, 0.5));
      m.scale.setScalar(rand(0.7, 1.15));
      group.add(m);
    }
    group.position.set(x, 0, z);
  } else if (type === 'balloon') {
    geoCache.balloonBall ||= new THREE.SphereGeometry(4.2, 20, 16);
    geoCache.balloonBasket ||= new THREE.BoxGeometry(2.2, 1.6, 2.2);
    const ball = new THREE.Mesh(geoCache.balloonBall, mat(def.color));
    ball.position.y = 9.5; ball.scale.y = 1.15; ball.castShadow = true;
    const basket = new THREE.Mesh(geoCache.balloonBasket, mat(0x7a5c34));
    basket.position.y = 1.4; basket.castShadow = true;
    group.add(ball, basket);
    body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, z));
    world.createCollider(RAPIER.ColliderDesc.ball(4.4).setTranslation(0, 9.5, 0), body);
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.1, 0.8, 1.1).setTranslation(0, 1.4, 0), body);
  }

  if (body) {
    const t = body.translation();
    group.position.set(t.x, t.y, t.z);
  }
  return { group, body };
}

export function createProp(ctx, type, x, z) {
  const def = PROP_DEFS[type];
  const { group, body } = buildMeshAndBody(ctx, type, x, z);
  ctx.three.scene.add(group);
  const prop = {
    id: ++_id, type, def, mesh: group, body, dead: false,
    fixed: !body || body.isFixed(),
    state: {
      hp: def.hp, burning: null, hitCd: 0,
      thrownBy: null,       // {owner, chain, t} 被打飞后成为"弹药"的归因
      charmedBy: null,      // 守护者魅化
      desiredVel: null,     // 魅化时由守护者写入
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
// 场地生成
// ============================================================================
export function buildArena(ctx) {
  const taken = [];
  const free = (x, z, r) => {
    if (Math.hypot(x, z) < 10) return false;
    for (const t of taken) if (dist2d(x, z, t.x, t.z) < r + t.r) return false;
    return true;
  };
  const put = (type, x, z, r) => { taken.push({ x, z, r }); return createProp(ctx, type, x, z); };
  const scatter = (type, count, r, minR = 14, maxR = 118) => {
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 30; tries++) {
        const a = rand(Math.PI * 2), d = rand(minR, maxR);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (free(x, z, r)) { put(type, x, z, r); break; }
      }
    }
  };

  // 热气球:场地中心地标,致敬原作
  put('balloon', 12, -6, 7);

  // 电线塔沿公路两侧排布(原作的公路)
  for (let z = -100; z <= 100; z += 25) {
    put('pole', z % 50 === 0 ? 7 : -7, z, 2);
  }

  // 栅栏排成行,烧起来会传火
  for (let row = 0; row < 6; row++) {
    const a = rand(Math.PI * 2), d = rand(25, 100);
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    const dir = rand(Math.PI);
    for (let i = -2; i <= 2; i++) {
      const x = cx + Math.cos(dir) * i * 2.6, z = cz + Math.sin(dir) * i * 2.6;
      if (free(x, z, 1.5)) put('fence', x, z, 1.5);
    }
  }

  scatter('hay', 26, 2.2);
  scatter('tank', 9, 2.0, 20);
  scatter('rock', 8, 2.2);
  scatter('grass', 46, 1.2, 12, 125);
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

    // 魅化道具:守护者写入的期望速度
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

// 吞噬碎片(金属球群成长用):返回被吞掉的数量
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
