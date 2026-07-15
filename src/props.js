import * as THREE from 'three';
import { rand, pick } from './util.js';
import { damageProp, hitCreaturesAt } from './damage.js';

// ============================================================================
// 道具定义:涌现的基础 —— 每个道具只有几个共享属性
// flammable 可燃 / conductive 导电 / explosive 爆炸 / powered 带电
// charmable 可魅化 / douses 摧毁时浇灭周围火焰
// ============================================================================
export const PROP_DEFS = {
  hay:     { name: '废料捆',   hp: 30, points: 20, flammable: true, charmable: true, color: 0x4a4438 },
  fence:   { name: '全息广告牌', hp: 20, points: 15, flammable: true, charmable: true, color: 0x23283a },
  pole:    { name: '灯笼灯柱', hp: 60, points: 50, powered: true, conductive: true, color: 0x2a2e3c },
  tank:    { name: '等离子罐', hp: 35, points: 50, explosive: true, flammable: true, charmable: true, conductive: true, color: 0x323848 },
  rock:    { name: '水泥墩',   hp: 70, points: 25, charmable: true, color: 0x565b66 },
  grass:   { name: '盆栽',     hp: 6,  points: 5,  flammable: true, noBody: true, color: 0x3e7a3a },
  balloon: { name: '巨型灯笼', hp: 400, points: 500, flammable: true, color: 0xc22a1a },
  hedge:   { name: '青砖巷墙', hp: 25, points: 10, flammable: true, color: 0x8e8578 },
  house:   { name: '居民楼',   hp: 150, points: 80, flammable: true, color: 0xd8cfc0 },
  arch:    { name: '牌坊',     hp: 120, points: 60, flammable: true, color: 0x7a2018 },
  cart:    { name: '悬浮板车', hp: 35, points: 25, flammable: true, charmable: true, color: 0x2c3040 },
  well:    { name: '冷却泵',   hp: 60, points: 30, douses: true, color: 0x2a3444 },
};

// 霓虹配色盘(招牌/灯带随机取)
const NEON = [0x00e5ff, 0xff2d95, 0xffd75e, 0x7cffb0, 0xff5a3a];

let _id = 0;
const geoCache = {};
const matCache = {};

function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache[key]) matCache[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
  return matCache[key];
}

// 发光材质:泛光管线会让它起辉
function neonMat(color, intensity = 1.3) {
  return mat(0x0a0a12, { emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
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

  const box = (geoCache.box ||= new THREE.BoxGeometry(1, 1, 1));

  if (type === 'hay') {
    // 废料捆:歪斜堆叠的暗色废件 + 一块还亮着的碎屏
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(box, mat(pick([0x4a4438, 0x3c3a34, 0x50483a])));
      m.scale.set(rand(0.8, 1.5), rand(0.5, 0.9), rand(0.8, 1.4));
      m.position.set(rand(-0.4, 0.4), rand(-0.5, 0.5), rand(-0.4, 0.4));
      m.rotation.set(rand(-0.4, 0.4), rand(Math.PI), rand(-0.3, 0.3));
      m.castShadow = true;
      group.add(m);
    }
    const scrap = new THREE.Mesh(box, neonMat(pick(NEON), 0.8));
    scrap.scale.set(0.5, 0.05, 0.35);
    scrap.position.set(rand(-0.4, 0.4), 0.55, rand(-0.4, 0.4));
    scrap.rotation.y = rand(Math.PI);
    group.add(scrap);
    body = dyn(x, 1.1, z, 0.25);
    world.createCollider(RAPIER.ColliderDesc.ball(1.0).setDensity(0.5).setFriction(0.7).setRestitution(0.15), body);
  } else if (type === 'fence') {
    // 全息广告牌:暗色框 + 发亮的屏面
    const frame = new THREE.Mesh(box, mat(def.color, { metalness: 0.4, roughness: 0.5 }));
    frame.scale.set(2.4, 1.1, 0.16);
    frame.castShadow = true;
    const screen = new THREE.Mesh(box, neonMat(pick(NEON), 1.1));
    screen.scale.set(2.1, 0.85, 0.05);
    screen.position.z = 0.09;
    const legL = new THREE.Mesh(box, mat(0x14161f));
    legL.scale.set(0.1, 0.5, 0.1); legL.position.set(-0.9, -0.75, 0);
    const legR = legL.clone(); legR.position.x = 0.9;
    group.add(frame, screen, legL, legR);
    body = dyn(x, 0.7, z, 0.6);
    body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(Math.PI * 2)), true);
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.2, 0.55, 0.08).setDensity(0.4).setFriction(0.8), body);
  } else if (type === 'pole') {
    // 灯笼灯柱:金属杆 + 悬灯笼 + 中段全息环
    geoCache.pole ||= new THREE.CylinderGeometry(0.14, 0.2, 6, 8);
    geoCache.lanternBall ||= new THREE.SphereGeometry(0.42, 12, 10);
    geoCache.holoRing ||= new THREE.TorusGeometry(0.55, 0.035, 8, 24);
    const trunk = new THREE.Mesh(geoCache.pole, mat(def.color, { metalness: 0.6, roughness: 0.4 }));
    trunk.position.y = 3; trunk.castShadow = true;
    const arm = new THREE.Mesh(box, mat(def.color, { metalness: 0.6, roughness: 0.4 }));
    arm.scale.set(1.1, 0.08, 0.08); arm.position.set(0.45, 5.9, 0);
    const lantern = new THREE.Mesh(geoCache.lanternBall, neonMat(0xff3a2a, 1.4));
    lantern.scale.y = 1.25; lantern.position.set(0.9, 5.45, 0);
    const tassel = new THREE.Mesh(box, neonMat(0xffd75e, 0.7));
    tassel.scale.set(0.05, 0.4, 0.05); tassel.position.set(0.9, 4.85, 0);
    const ring = new THREE.Mesh(geoCache.holoRing, neonMat(0x00e5ff, 1.0));
    ring.rotation.x = Math.PI / 2; ring.position.y = 3.6;
    group.add(trunk, arm, lantern, tassel, ring);
    body = fixed(x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.cylinder(3, 0.3).setTranslation(0, 3, 0), body);
  } else if (type === 'tank') {
    // 等离子罐:金属罐体 + 双发光环 + 阀门
    geoCache.tank ||= new THREE.CylinderGeometry(0.7, 0.7, 1.3, 14);
    geoCache.tankRing ||= new THREE.CylinderGeometry(0.72, 0.72, 0.1, 14);
    const m = new THREE.Mesh(geoCache.tank, mat(def.color, { metalness: 0.7, roughness: 0.35 }));
    m.castShadow = true;
    const r1 = new THREE.Mesh(geoCache.tankRing, neonMat(0xff2d95, 1.4));
    r1.position.y = 0.3;
    const r2 = new THREE.Mesh(geoCache.tankRing, neonMat(0xff2d95, 1.4));
    r2.position.y = -0.3;
    const valve = new THREE.Mesh(box, mat(0x14161f, { metalness: 0.5 }));
    valve.scale.set(0.25, 0.2, 0.25); valve.position.y = 0.75;
    group.add(m, r1, r2, valve);
    body = dyn(x, 0.7, z, 0.5);
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.65, 0.7).setDensity(0.8).setFriction(0.6), body);
  } else if (type === 'rock') {
    // 水泥墩:混凝土 + 一角警示灯贴
    geoCache.rock ||= new THREE.IcosahedronGeometry(1.35, 0);
    const m = new THREE.Mesh(geoCache.rock, mat(def.color, { roughness: 0.95 }));
    m.castShadow = true;
    const tag = new THREE.Mesh(box, neonMat(0xffd75e, 0.7));
    tag.scale.set(0.5, 0.12, 0.04);
    tag.position.set(0, 0.4, 1.22);
    group.add(m, tag);
    body = dyn(x, 1.3, z, 0.3);
    world.createCollider(RAPIER.ColliderDesc.ball(1.25).setDensity(2.2).setFriction(0.9), body);
  } else if (type === 'grass') {
    // 盆栽:陶盆 + 绿植(街边生活气息)
    geoCache.pot ||= new THREE.CylinderGeometry(0.35, 0.26, 0.42, 8);
    geoCache.blade ||= new THREE.ConeGeometry(0.11, 0.9, 5);
    const pot = new THREE.Mesh(geoCache.pot, mat(0x9a5636, { roughness: 0.9 }));
    pot.position.y = 0.21;
    group.add(pot);
    const leafColor = pick([0x3e7a3a, 0x4e8a42, 0x357036]);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(geoCache.blade, mat(leafColor, { roughness: 0.85 }));
      b.position.set(rand(-0.15, 0.15), 0.78, rand(-0.15, 0.15));
      b.rotation.set(rand(-0.35, 0.35), 0, rand(-0.35, 0.35));
      b.scale.setScalar(rand(0.7, 1.2));
      b.castShadow = true;
      group.add(b);
    }
    if (Math.random() < 0.4) {
      const flower = new THREE.Mesh(box, neonMat(pick([0xff5a3a, 0xffd75e]), 0.55));
      flower.scale.setScalar(0.12);
      flower.position.set(rand(-0.15, 0.15), 1.0, rand(-0.15, 0.15));
      group.add(flower);
    }
    group.position.set(x, 0, z);
  } else if (type === 'balloon') {
    // 巨型灯笼:街区上空的大红灯笼(泛光地标)
    geoCache.balloonBall ||= new THREE.SphereGeometry(4.2, 20, 16);
    geoCache.lanternCap ||= new THREE.CylinderGeometry(1.6, 2.0, 0.6, 12);
    const ball = new THREE.Mesh(geoCache.balloonBall,
      mat(0x8a1408, { emissive: 0xff3020, emissiveIntensity: 0.55, roughness: 0.6 }));
    ball.position.y = 9.5; ball.scale.y = 0.92; ball.castShadow = true;
    const capT = new THREE.Mesh(geoCache.lanternCap, mat(0x1c1408, { metalness: 0.4 }));
    capT.position.y = 13.3;
    const capB = new THREE.Mesh(geoCache.lanternCap, mat(0x1c1408, { metalness: 0.4 }));
    capB.position.y = 5.7; capB.rotation.x = Math.PI;
    // 垂下的书法幡
    const banner = new THREE.Mesh(box, mat(0x6a0f0a, { emissive: 0xaa2010, emissiveIntensity: 0.3 }));
    banner.scale.set(0.9, 3.6, 0.06); banner.position.y = 3.6;
    const pod = new THREE.Mesh(box, mat(0x14161f, { metalness: 0.5 }));
    pod.scale.set(2.2, 1.6, 2.2); pod.position.y = 1.4; pod.castShadow = true;
    group.add(ball, capT, capB, banner, pod);
    body = fixed(x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.ball(4.4).setTranslation(0, 9.5, 0), body);
    world.createCollider(RAPIER.ColliderDesc.cuboid(1.1, 0.8, 1.1).setTranslation(0, 1.4, 0), body);
  } else if (type === 'hedge') {
    // 青砖巷墙:迷宫墙 —— 灰砖墙体 + 瓦顶压檐,偶尔挂小招牌或红灯笼
    const w = opts.w || 6.8, d = opts.d || 1.2;
    const base = new THREE.Mesh(box, mat(def.color, { roughness: 0.95 }));
    base.scale.set(w, 1.8, d);
    base.position.y = 0.9;
    base.castShadow = true;
    const cap = new THREE.Mesh(box, mat(0x565a63, { roughness: 0.85 }));
    cap.scale.set(w + 0.35, 0.28, d + 0.55);
    cap.position.y = 1.95;
    cap.castShadow = true;
    group.add(base, cap);
    const deco = Math.random();
    if (deco < 0.28) {
      // 墙面小霓虹招牌
      const sign = new THREE.Mesh(box, neonMat(pick(NEON), 1.15));
      sign.scale.set(Math.min(w * 0.35, 2.2), 0.7, 0.1);
      const side = Math.random() < 0.5 ? 1 : -1;
      if (w > d) sign.position.set(rand(-w * 0.25, w * 0.25), 1.25, side * (d / 2 + 0.06));
      else sign.position.set(side * (d / 2 + 0.06), 1.25, rand(-d * 0.25, d * 0.25));
      if (w <= d) sign.rotation.y = Math.PI / 2;
      group.add(sign);
    } else if (deco < 0.5) {
      // 檐下红灯笼
      geoCache.lanternBall ||= new THREE.SphereGeometry(0.42, 12, 10);
      const lan = new THREE.Mesh(geoCache.lanternBall, neonMat(0xff3a2a, 1.3));
      lan.scale.set(0.6, 0.75, 0.6);
      lan.position.set(rand(-w * 0.3, w * 0.3), 1.55, 0);
      group.add(lan);
    }
    body = fixed(x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, 1.1, d / 2).setTranslation(0, 1.1, 0), body);
  } else if (type === 'house') {
    // 中式居民楼:一层木铺面 + 腰檐 + 二层米白墙木格窗 + 灰瓦坡顶
    // 30% 概率是双重檐"阁楼"变体;墙面垂直叠挂多块霓虹招牌(参考老街)
    geoCache.houseRoof ||= new THREE.ConeGeometry(5.6, 2.0, 4);
    geoCache.lanternBall ||= new THREE.SphereGeometry(0.42, 12, 10);
    const pavilion = Math.random() < 0.3;
    const wallMat = mat(pick([0xd8cfc0, 0xcfc5b2, 0xe0d8ca]), { roughness: 0.9 });
    const woodMat = mat(pick([0x5a3a28, 0x4e3222]), { roughness: 0.85 });
    const tileMat = mat(0x565a63, { roughness: 0.85 });

    // 一层:深色木铺面
    const floor1 = new THREE.Mesh(box, woodMat);
    floor1.scale.set(6.5, 2.3, 6.5); floor1.position.y = 1.15; floor1.castShadow = true;
    // 门与门头匾
    const door = new THREE.Mesh(box, mat(0x241610));
    door.scale.set(1.4, 1.9, 0.1); door.position.set(0, 0.95, 3.28);
    const plaque = new THREE.Mesh(box, neonMat(0xffd75e, 0.85));
    plaque.scale.set(2.0, 0.45, 0.1); plaque.position.set(0, 2.05, 3.3);
    // 腰檐(隔层瓦檐)
    const midEave = new THREE.Mesh(box, tileMat);
    midEave.scale.set(7.6, 0.22, 7.6); midEave.position.y = 2.45; midEave.castShadow = true;
    // 二层:米白墙
    const floor2 = new THREE.Mesh(box, wallMat);
    floor2.scale.set(6.0, 2.0, 6.0); floor2.position.y = 3.55; floor2.castShadow = true;
    group.add(floor1, door, plaque, midEave, floor2);
    // 二层木格窗(四面随机2~3面)
    for (const [wx, wz, ry] of [[0, 3.03, 0], [0, -3.03, 0], [3.03, 0, Math.PI / 2], [-3.03, 0, Math.PI / 2]]) {
      if (Math.random() < 0.3) continue;
      const lattice = new THREE.Mesh(box, woodMat);
      lattice.scale.set(2.6, 1.3, 0.12);
      lattice.position.set(wx, 3.55, wz);
      lattice.rotation.y = ry;
      const glow = new THREE.Mesh(box, mat(0xffc888, { emissive: 0xffa850, emissiveIntensity: 0.5 }));
      glow.scale.set(2.2, 1.0, 0.08);
      glow.position.copy(lattice.position);
      glow.rotation.y = ry;
      // 沿窗面法线略微外凸
      if (ry === 0) glow.position.z += Math.sign(wz) * 0.04;
      else glow.position.x += Math.sign(wx) * 0.04;
      group.add(lattice, glow);
    }

    let roofY = 4.55;
    if (pavilion) {
      // 阁楼变体:再加一层 + 双重檐
      const eave2 = new THREE.Mesh(box, tileMat);
      eave2.scale.set(7.0, 0.2, 7.0); eave2.position.y = 4.62; eave2.castShadow = true;
      const floor3 = new THREE.Mesh(box, wallMat);
      floor3.scale.set(4.6, 1.6, 4.6); floor3.position.y = 5.4; floor3.castShadow = true;
      group.add(eave2, floor3);
      roofY = 6.2;
    }
    // 灰瓦坡顶 + 正脊
    const roof = new THREE.Mesh(geoCache.houseRoof, tileMat);
    roof.position.y = roofY + 0.9;
    roof.rotation.y = Math.PI / 4;
    roof.scale.setScalar(pavilion ? 0.82 : 1);
    roof.castShadow = true;
    const ridge = new THREE.Mesh(box, mat(0x3c4048, { roughness: 0.8 }));
    ridge.scale.set(pavilion ? 3.6 : 4.4, 0.25, 0.4);
    ridge.position.y = roofY + 1.8;
    group.add(roof, ridge);
    // 檐角红灯笼一对
    for (const lx of [-3.2, 3.2]) {
      const lan = new THREE.Mesh(geoCache.lanternBall, neonMat(0xff3a2a, 1.3));
      lan.scale.set(0.65, 0.8, 0.65);
      lan.position.set(lx, 2.15, 3.4);
      group.add(lan);
    }
    // 垂直叠挂的霓虹招牌(2~4块,伸出墙面,高低错落 —— 老街的灵魂)
    const signCount = 2 + Math.floor(rand(3));
    for (let i = 0; i < signCount; i++) {
      const faceDir = pick([0, 1, 2, 3]); // +z -z +x -x
      const h = rand(1.4, 2.6);
      const signY = rand(1.6, 4.0);
      const outer = new THREE.Mesh(box, neonMat(pick(NEON), 1.25));
      outer.scale.set(0.12, h, 0.7);
      const inner = new THREE.Mesh(box, mat(0x14141e));
      inner.scale.set(0.16, h * 0.84, 0.55);
      const off = rand(-2.2, 2.2);
      let px = 0, pz = 0, ry = 0;
      if (faceDir === 0) { px = off; pz = 3.6; }
      else if (faceDir === 1) { px = off; pz = -3.6; }
      else if (faceDir === 2) { px = 3.6; pz = off; ry = Math.PI / 2; }
      else { px = -3.6; pz = off; ry = Math.PI / 2; }
      outer.position.set(px, signY, pz); outer.rotation.y = ry;
      inner.position.set(px, signY, pz); inner.rotation.y = ry;
      group.add(outer, inner);
    }
    group.rotation.y = Math.floor(rand(4)) * Math.PI / 2;
    body = fixed(x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.cuboid(3.25, 2, 3.25).setTranslation(0, 2, 0), body);
  } else if (type === 'arch') {
    // 牌坊:横跨主街的中式门楼(朱柱 + 额枋 + 瓦檐 + 霓虹匾)
    const pillarMat = mat(0x7a2018, { roughness: 0.8 });
    for (const px of [-4, 4]) {
      const pillar = new THREE.Mesh(box, pillarMat);
      pillar.scale.set(0.55, 5.2, 0.55); pillar.position.set(px, 2.6, 0); pillar.castShadow = true;
      const foot = new THREE.Mesh(box, mat(0x6a6e78, { roughness: 0.9 }));
      foot.scale.set(0.9, 0.5, 0.9); foot.position.set(px, 0.25, 0);
      group.add(pillar, foot);
    }
    const beam = new THREE.Mesh(box, pillarMat);
    beam.scale.set(9.6, 0.7, 0.6); beam.position.y = 5.3; beam.castShadow = true;
    const eave = new THREE.Mesh(box, mat(0x565a63, { roughness: 0.85 }));
    eave.scale.set(10.6, 0.28, 1.5); eave.position.y = 5.9; eave.castShadow = true;
    const ridge = new THREE.Mesh(box, mat(0x3c4048));
    ridge.scale.set(10.0, 0.22, 0.5); ridge.position.y = 6.15;
    const plaque = new THREE.Mesh(box, neonMat(0xffd75e, 1.2));
    plaque.scale.set(2.4, 0.8, 0.12); plaque.position.y = 4.6;
    group.add(beam, eave, ridge, plaque);
    for (const px of [-4, 4]) {
      geoCache.lanternBall ||= new THREE.SphereGeometry(0.42, 12, 10);
      const lan = new THREE.Mesh(geoCache.lanternBall, neonMat(0xff3a2a, 1.3));
      lan.scale.set(0.7, 0.85, 0.7); lan.position.set(px, 4.4, 0);
      group.add(lan);
    }
    body = fixed(x, 0, z);
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 2.6, 0.3).setTranslation(-4, 2.6, 0), body);
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 2.6, 0.3).setTranslation(4, 2.6, 0), body);
  } else if (type === 'cart') {
    // 悬浮板车:平板 + 底部悬浮光盘 + 尾箱
    const deck = new THREE.Mesh(box, mat(def.color, { metalness: 0.55, roughness: 0.4 }));
    deck.scale.set(2.4, 0.25, 1.4); deck.position.y = 0.15; deck.castShadow = true;
    const glow = new THREE.Mesh(box, neonMat(0x00e5ff, 1.2));
    glow.scale.set(2.0, 0.07, 1.1); glow.position.y = -0.05;
    const tail = new THREE.Mesh(box, mat(0x1c2030, { metalness: 0.4 }));
    tail.scale.set(0.6, 0.7, 1.2); tail.position.set(-0.8, 0.6, 0); tail.castShadow = true;
    const lamp = new THREE.Mesh(box, neonMat(0xff5a3a, 1.0));
    lamp.scale.set(0.08, 0.12, 0.5); lamp.position.set(1.2, 0.25, 0);
    group.add(deck, glow, tail, lamp);
    body = dyn(x, 1.0, z, 0.3);
    world.createCollider(RAPIER.ColliderDesc.ball(1.0).setDensity(0.6).setFriction(0.7).setRestitution(0.1), body);
  } else if (type === 'well') {
    // 冷却泵:泵体 + 发光冷却核心 + 输液管
    geoCache.pumpBody ||= new THREE.CylinderGeometry(1.15, 1.25, 1.2, 10);
    geoCache.pumpCore ||= new THREE.CylinderGeometry(0.5, 0.5, 1.5, 10);
    const m = new THREE.Mesh(geoCache.pumpBody, mat(def.color, { metalness: 0.6, roughness: 0.4 }));
    m.position.y = 0.6; m.castShadow = true;
    const core = new THREE.Mesh(geoCache.pumpCore, neonMat(0x2f9dff, 1.3));
    core.position.y = 0.75;
    const pipe = new THREE.Mesh(box, mat(0x1c2030, { metalness: 0.5 }));
    pipe.scale.set(1.8, 0.18, 0.18); pipe.position.set(0.9, 0.25, 0.4);
    const pipe2 = pipe.clone(); pipe2.rotation.y = Math.PI / 2; pipe2.position.set(-0.4, 0.25, -0.9);
    group.add(m, core, pipe, pipe2);
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
