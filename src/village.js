import * as THREE from 'three';
import { createProp } from './props.js';
import { rand, randInt, pick, clamp } from './util.js';
import { TOON } from './toon.js';

// ============================================================================
// 程序化赛博中式街区
// 五类 zone,每区有各自的轮廓剪影 + 开阔度 + 结构风格:
//   old        窄巷老居民区 —— 缺角细长、高墙密巷,蜈蚣精主场
//   temple     庙宇祠堂区   —— 圆形院坝、火盆阵、最开阔,鬼火群主场
//   market     霓虹商业街   —— 密集方块群、招牌货摊,纸傀儡主场
//   canal      河道水巷     —— L 形水湾、桥/护栏,水鬼主场
//   industrial 工业机房区   —— 十字机房臂、电缆/电源簇,雷鬼主场
// ============================================================================

export const COLS = 9, ROWS = 9, CELL = 22;
const ORIGIN_X = -(COLS * CELL) / 2;
const ORIGIN_Z = -(ROWS * CELL) / 2;

export const ZONES = {
  old:        { name: '窄巷老居民区', color: 0xc9b69a, resident: 'dragon' },
  temple:     { name: '庙宇祠堂区',   color: 0xd0a26a, resident: 'spheres' },
  market:     { name: '霓虹商业街',   color: 0xd0a2c8, resident: 'guardian' },
  canal:      { name: '河道水巷',     color: 0x8fb8c8, resident: 'water' },
  industrial: { name: '工业机房区',   color: 0xa0a8b2, resident: 'thunder' },
  plaza:      { name: '中央灯笼广场', color: 0xe4c0a2, resident: null },
};

// 每区柔和地面色晕(叠在橙色主地面上,不覆盖,无格线)
const ZONE_TINT = {
  old: 0xffb27a, temple: 0xff7a5a, market: 0xff3ea5,
  canal: 0x3ec8ff, industrial: 0x7f9dc8, plaza: 0xffd27a,
};

// 四个角落的局部坐标系:local (lx,lz)∈0..3,(0,0)=贴近中心的内角。
// 世界格 cx=bx+sx*lx, cz=bz+sz*lz  ⇒  逆映射 lx=(cx-bx)*sx, lz=(cz-bz)*sz(sx/sz=±1)。
const CORNERS = [
  { name: 'TL', bx: 3, sx: -1, bz: 3, sz: -1 }, // cx≤3,cz≤3
  { name: 'TR', bx: 5, sx: 1, bz: 3, sz: -1 },  // cx≥5,cz≤3
  { name: 'BL', bx: 3, sx: -1, bz: 5, sz: 1 },  // cx≤3,cz≥5
  { name: 'BR', bx: 5, sx: 1, bz: 5, sz: 1 },   // cx≥5,cz≥5
];
// 各区在"局部坐标"里的缺角掩码(与所在角落无关,随排列旋转到实际角)
const LOCAL_VOID = {
  old: new Set(['3,3', '2,3', '3,2']),                 // 外角缺一块 → 细长
  temple: new Set(['0,0', '3,0', '0,3', '3,3']),        // 四角都缺 → 圆
  market: new Set(['3,3']),                             // 外角缺一格
  canal: new Set(['2,2', '3,2', '2,3', '3,3']),         // 外 2×2 缺 → L 形水湾
};
const CORNER_TYPES = ['old', 'temple', 'market', 'canal']; // 参与每局随机换角的四区

// 共享径向 alpha 贴图:中心实、边缘透 —— 铺在格中央晕成一片,不产生硬边
let _tintTex = null;
function zoneTintTexture() {
  if (_tintTex) return _tintTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _tintTex = new THREE.CanvasTexture(cv);
  _tintTex.colorSpace = THREE.SRGBColorSpace;
  return _tintTex;
}

// 各区地表贴片纹理(叠在橙底上,透明留白处露出橙色)
const _decalTex = {};
function decalTexture(kind) {
  if (_decalTex[kind]) return _decalTex[kind];
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  if (kind === 'grating') {
    // 工业金属格栅:深底 + 亮网格 + 铆钉
    g.fillStyle = 'rgba(30,34,40,0.85)'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(150,170,190,0.55)'; g.lineWidth = 2;
    for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
    g.fillStyle = 'rgba(200,210,220,0.5)';
    for (let x = 8; x < 128; x += 16) for (let y = 8; y < 128; y += 16) { g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
  } else if (kind === 'hazard') {
    // 黄黑警示斜条
    g.fillStyle = '#141210'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#ffd21a';
    for (let i = -128; i < 128; i += 36) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 18, 0); g.lineTo(i + 18 + 128, 128); g.lineTo(i + 128, 128); g.closePath(); g.fill(); }
  } else if (kind === 'wet') {
    // 湿渍反光:柔和深蓝径向
    const grd = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grd.addColorStop(0, 'rgba(120,200,230,0.5)');
    grd.addColorStop(0.5, 'rgba(30,90,120,0.4)');
    grd.addColorStop(1, 'rgba(20,50,70,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  } else if (kind === 'scuff') {
    // 老街磨损:深色斑驳
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(30,26,22,${rand(0.05, 0.2)})`;
      g.beginPath(); g.ellipse(rand(0, 128), rand(0, 128), rand(4, 22), rand(3, 14), rand(3), 0, Math.PI * 2); g.fill();
    }
  } else if (kind === 'stone') {
    // 庙区中轴石板道:浅色错缝石板
    g.fillStyle = 'rgba(210,196,168,0.85)'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(120,108,88,0.5)'; g.lineWidth = 3;
    let row = 0;
    for (let y = 0; y < 128; y += 32) {
      const off = (row++ % 2) * 32;
      for (let x = -32; x < 160; x += 64) g.strokeRect(x + off, y, 62, 30);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  _decalTex[kind] = tex;
  return tex;
}

export class Village {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.village = this;
    this.walls = new Map();
    this.hedgeWall = new Map();
    this.obstacles = [];
    this.waterRects = [];
    this.zoneCells = new Map();
    this.zoneEntries = new Map();
    this.zoneLandmarks = new Map();
    this.powerNodes = [];
    this.bridges = [];
    this.activeCells = new Set();
    // 本局随机把四个角区分配到四个角(industrial 十字 / plaza 中心 固定不变)
    this.cornerAssign = CORNER_TYPES.slice();
    for (let i = this.cornerAssign.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cornerAssign[i], this.cornerAssign[j]] = [this.cornerAssign[j], this.cornerAssign[i]];
    }
    this.generate();
  }

  // 角落索引 0..3(TL/TR/BL/BR),非角落(十字/中心)返回 -1
  cornerIndexForCell(cx, cz) {
    if (cx === 4 || cz === 4) return -1;
    if (cx <= 3 && cz <= 3) return 0;
    if (cx >= 5 && cz <= 3) return 1;
    if (cx <= 3 && cz >= 5) return 2;
    if (cx >= 5 && cz >= 5) return 3;
    return -1;
  }
  // 世界格 → 局部 (lx,lz);非角落返回 null
  localOf(cx, cz) {
    const ci = this.cornerIndexForCell(cx, cz);
    if (ci < 0) return null;
    const f = CORNERS[ci];
    return { ci, lx: (cx - f.bx) * f.sx, lz: (cz - f.bz) * f.sz };
  }

  wkey(cx, cz, dir) { return `${cx},${cz},${dir}`; }
  ckey(cx, cz) { return `${cx},${cz}`; }
  cellCenter(cx, cz) {
    return { x: ORIGIN_X + (cx + 0.5) * CELL, z: ORIGIN_Z + (cz + 0.5) * CELL };
  }
  worldToCell(x, z) {
    return {
      cx: clamp(Math.floor((x - ORIGIN_X) / CELL), 0, COLS - 1),
      cz: clamp(Math.floor((z - ORIGIN_Z) / CELL), 0, ROWS - 1),
    };
  }
  zoneKeyForCell(cx, cz) {
    if (cx === 4 && cz === 4) return 'plaza';
    const ci = this.cornerIndexForCell(cx, cz);
    if (ci < 0) return 'industrial';
    return this.cornerAssign[ci]; // 本局该角落分到哪个区
  }

  // 每区剪影:用局部缺角掩码 + 角落变换,保留贴近中心的内圈以维持连通。
  isVoidCell(cx, cz) {
    const lo = this.localOf(cx, cz);
    if (!lo) return false; // industrial / plaza 永远保留(连通骨架)
    const type = this.cornerAssign[lo.ci];
    const mask = LOCAL_VOID[type];
    return mask ? mask.has(lo.lx + ',' + lo.lz) : false;
  }

  // 从某角落中心指向地图中心(广场)的单位方向 —— 用于让庙门/河口/大庙都朝中心
  inwardDir(x, z) {
    const L = Math.hypot(x, z) || 1;
    return { x: -x / L, z: -z / L };
  }
  isActive(cx, cz) {
    if (cx < 0 || cx >= COLS || cz < 0 || cz >= ROWS) return false;
    return this.activeCells.has(this.ckey(cx, cz));
  }

  zoneAt(posOrX, zMaybe) {
    const x = typeof posOrX === 'number' ? posOrX : posOrX.x;
    const z = typeof posOrX === 'number' ? zMaybe : posOrX.z;
    const { cx, cz } = this.worldToCell(x, z);
    const key = this.zoneKeyForCell(cx, cz);
    return { key, ...ZONES[key], cx, cz };
  }
  zoneOfCell(cx, cz) { const key = this.zoneKeyForCell(cx, cz); return { key, ...ZONES[key] }; }

  generate() {
    this.buildZoneIndex();
    this.computeTempleGeometry();
    this.createZoneTints();
    this.buildMazeWalls();
    this.createWallProps();
    this.createBoundaryWalls();
    this.populateZones();
    this.createTempleRingWall();
    this.tightenOldAlleys();
    this.decorateWater();
    this.createZoneGroundDecals(); // 放在最后:此时 waterRects/templeCenter 已就绪(修好湿渍贴片)
  }

  // 庙区圆心 + 半径:整个庙区就是这个圆,弧墙是它唯一的围合,内部不再有直墙穿插
  computeTempleGeometry() {
    const cells = this.zoneEntries.get('temple');
    if (!cells.length) { this.templeCenter = null; return; }
    let sx = 0, sz = 0;
    for (const c of cells) { sx += c.x; sz += c.z; }
    this.templeCenter = { x: sx / cells.length, z: sz / cells.length };
    this.templeR = CELL * 1.78;
  }

  buildZoneIndex() {
    for (const k of Object.keys(ZONES)) {
      this.zoneEntries.set(k, []);
      this.zoneLandmarks.set(k, []);
    }
    for (let cx = 0; cx < COLS; cx++) {
      for (let cz = 0; cz < ROWS; cz++) {
        if (this.isVoidCell(cx, cz)) continue;
        const key = this.zoneKeyForCell(cx, cz);
        const c = this.cellCenter(cx, cz);
        const cell = { cx, cz, x: c.x, z: c.z, key };
        this.activeCells.add(this.ckey(cx, cz));
        this.zoneCells.set(this.ckey(cx, cz), cell);
        this.zoneEntries.get(key).push(cell);
      }
    }
  }

  createGroundDecal(x, z, w, d, tex, opacity, rotZ = 0) {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.set(-Math.PI / 2, 0, rotZ);
    m.position.set(x, 0.033, z);
    this.ctx.three.scene.add(m);
  }

  createNeonStreak(x, z, w, d, color, rotZ = 0) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.set(-Math.PI / 2, 0, rotZ);
    m.position.set(x, 0.034, z);
    this.ctx.three.scene.add(m);
  }

  // 每区地表贴片:强化"看一眼就知道在哪"与"踩上去的质感"
  createZoneGroundDecals() {
    for (const cell of this.zoneCells.values()) {
      if (cell.key === 'industrial') {
        this.createGroundDecal(cell.x, cell.z, CELL * 0.82, CELL * 0.82, decalTexture('grating'), 0.5);
        if ((cell.cx + cell.cz) % 2 === 0) this.createGroundDecal(cell.x, cell.z, CELL * 0.72, 2.6, decalTexture('hazard'), 0.55, cell.cx % 2 ? Math.PI / 2 : 0);
      } else if (cell.key === 'old') {
        for (let i = 0; i < 2; i++) this.createGroundDecal(cell.x + rand(-4, 4), cell.z + rand(-4, 4), rand(6, 10), rand(6, 10), decalTexture('scuff'), 0.5, rand(0, 3));
      } else if (cell.key === 'market') {
        for (let i = 0; i < 3; i++) this.createNeonStreak(cell.x + rand(-7, 7), cell.z + rand(-7, 7), rand(3, 7), rand(0.5, 1.0), pick([0x00e5ff, 0xff2d95, 0xffd75e]), pick([0, Math.PI / 2]));
      }
    }
    // 庙区大庙前的中轴石板道(朝中心/入口,引导视线)
    if (this.templeCenter) {
      const cxw = this.templeCenter.x, czw = this.templeCenter.z;
      const inw = this.inwardDir(cxw, czw);
      this.createGroundDecal(cxw + inw.x * this.templeR * 0.32, czw + inw.z * this.templeR * 0.32, 4.8, this.templeR * 1.6, decalTexture('stone'), 0.72, Math.atan2(inw.x, inw.z));
    }
    // 河道岸边湿渍反光
    for (const r of this.waterRects) {
      this.createGroundDecal(r.x, r.z, r.hw * 2 + 3.5, r.hd * 2 + 3.5, decalTexture('wet'), 0.4);
    }
  }

  createZoneTints() {
    const tex = zoneTintTexture();
    for (const cell of this.zoneCells.values()) {
      const color = ZONE_TINT[cell.key] ?? 0xffd27a;
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color, transparent: true, opacity: 0.17, depthWrite: false,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 1.04, CELL * 1.04), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cell.x, 0.03, cell.z);
      this.ctx.three.scene.add(m);
    }
  }

  neighborInDir(cx, cz, dir) {
    // 0:+x  1:-x  2:+z  3:-z
    if (dir === 0) return [cx + 1, cz, this.wkey(cx, cz, 'e')];
    if (dir === 1) return [cx - 1, cz, this.wkey(cx - 1, cz, 'e')];
    if (dir === 2) return [cx, cz + 1, this.wkey(cx, cz, 's')];
    return [cx, cz - 1, this.wkey(cx, cz - 1, 's')];
  }

  buildMazeWalls() {
    // 只在两个 active 格之间建可开合的内墙
    for (let cx = 0; cx < COLS; cx++) {
      for (let cz = 0; cz < ROWS; cz++) {
        if (!this.isActive(cx, cz)) continue;
        if (this.isActive(cx + 1, cz)) this.walls.set(this.wkey(cx, cz, 'e'), { hedgeIds: new Set(), open: false });
        if (this.isActive(cx, cz + 1)) this.walls.set(this.wkey(cx, cz, 's'), { hedgeIds: new Set(), open: false });
      }
    }

    // DFS 生成树:保证所有 active 格连通(从中央广场出发)
    // 区内优先:先走完同区再跨区,使每条跨区边界的骨架只穿越一次 → "几道门"
    const visited = new Set();
    const stack = [[4, 4]];
    visited.add('4,4');
    while (stack.length) {
      const [cx, cz] = stack[stack.length - 1];
      const zc = this.zoneKeyForCell(cx, cz);
      const same = [], cross = [];
      for (let dir = 0; dir < 4; dir++) {
        const [nx, nz, wk] = this.neighborInDir(cx, cz, dir);
        if (!this.isActive(nx, nz) || visited.has(nx + ',' + nz)) continue;
        if (!this.walls.has(wk)) continue;
        (this.zoneKeyForCell(nx, nz) === zc ? same : cross).push([nx, nz, wk]);
      }
      const opts = same.length ? same : cross; // 同区没得走了才跨区
      if (!opts.length) { stack.pop(); continue; }
      const [nx, nz, wk] = pick(opts);
      const w = this.walls.get(wk);
      w.open = true; w.tree = true; // 标记为生成树骨架:连通性所系,拼接时不可关
      visited.add(nx + ',' + nz);
      stack.push([nx, nz]);
    }

    // 按街区特征额外"开洞"(只开不关,绝不破坏连通):老区几乎不开=最窄,庙区几乎全开=最空
    for (const [wk, w] of this.walls) {
      if (w.open) continue;
      const [cxS, czS, dir] = wk.split(',');
      const cx = +cxS, cz = +czS;
      const z1 = this.zoneKeyForCell(cx, cz);
      const z2 = dir === 'e' ? this.zoneKeyForCell(cx + 1, cz) : this.zoneKeyForCell(cx, cz + 1);
      const p = Math.max(this.loopChance(z1), this.loopChance(z2));
      if (Math.random() < p) w.open = true;
    }

    // 庙区强制打通成院坝(两侧都是 temple 的内墙全开)
    for (const [wk, w] of this.walls) {
      if (w.open) continue;
      const [cxS, czS, dir] = wk.split(',');
      const cx = +cxS, cz = +czS;
      const z1 = this.zoneKeyForCell(cx, cz);
      const z2 = dir === 'e' ? this.zoneKeyForCell(cx + 1, cz) : this.zoneKeyForCell(cx, cz + 1);
      if (z1 === 'temple' && z2 === 'temple') w.open = true;
    }

    this.assembleSeams();
  }

  // 拼接每局变:跨街区边界只保留"几道门"(DFS 骨架必留=保证连通,多余的裁掉),
  // 门的位置随本局 DFS/裁剪结果变化 → 每次从不同口进出各区。
  assembleSeams() {
    const groups = new Map(); // "A|B" → [wallKey]
    for (const [wk] of this.walls) {
      const [cxS, czS, dir] = wk.split(',');
      const cx = +cxS, cz = +czS;
      const z1 = this.zoneKeyForCell(cx, cz);
      const z2 = dir === 'e' ? this.zoneKeyForCell(cx + 1, cz) : this.zoneKeyForCell(cx, cz + 1);
      if (z1 === z2) continue; // 只处理跨区边界
      const gk = [z1, z2].sort().join('|');
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(wk);
    }
    for (const [, wks] of groups) {
      const treeOpen = wks.filter((wk) => this.walls.get(wk).tree && this.walls.get(wk).open);
      const extraOpen = wks.filter((wk) => this.walls.get(wk).open && !this.walls.get(wk).tree);
      const budget = 1 + (Math.random() < 0.5 ? 1 : 0);       // 本组总门数目标 1~2
      const keepExtra = Math.max(0, budget - treeOpen.length); // 骨架门必留,其余补到预算
      for (let i = extraOpen.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [extraOpen[i], extraOpen[j]] = [extraOpen[j], extraOpen[i]];
      }
      extraOpen.forEach((wk, i) => { this.walls.get(wk).open = i < keepExtra; });
      // 该边界一个门都没有(连通经由别处)但预算想要门 → 随机开一个,增加变化
      if (treeOpen.length === 0 && keepExtra > 0 && extraOpen.length === 0 && wks.length) {
        this.walls.get(pick(wks)).open = true;
      }
    }
  }

  loopChance(zoneKey) {
    return ({ old: 0.0, temple: 0.9, market: 0.35, canal: 0.45, industrial: 0.22, plaza: 0.9 })[zoneKey] ?? 0.18;
  }

  createWallProps() {
    const ctx = this.ctx;
    for (const [key, w] of this.walls) {
      if (w.open) continue;
      const [cx, cz, dir] = key.split(',');
      const icx = +cx, icz = +cz;
      const zoneKey = this.zoneKeyForCell(icx, icz);
      const segs = zoneKey === 'old' ? 4 : 3;
      const segLen = CELL / segs - 0.8;
      for (let s = 0; s < segs; s++) {
        const off = (s + 0.5) * (CELL / segs);
        let x, z, opts;
        if (dir === 'e') {
          x = ORIGIN_X + (icx + 1) * CELL;
          z = ORIGIN_Z + icz * CELL + off;
          opts = { w: 1.2, d: segLen };
        } else {
          x = ORIGIN_X + icx * CELL + off;
          z = ORIGIN_Z + (icz + 1) * CELL;
          opts = { w: segLen, d: 1.2 };
        }
        const prop = createProp(ctx, 'hedge', x, z, opts);
        prop.zoneKey = zoneKey;
        w.hedgeIds.add(prop.id);
        this.hedgeWall.set(prop.id, key);
        this.addAABB(x, z, opts.w / 2 + 0.3, opts.d / 2 + 0.3, prop.id);
      }
    }
  }

  // 沿不规则轮廓造周界墙:每个 active 格,凡邻格是 void/越界的边都封墙
  createBoundaryWalls() {
    for (const cell of this.zoneCells.values()) {
      const { cx, cz } = cell;
      // 庙区不造直边界墙 —— 由弧形围墙独家围合,避免直墙插进大圆穿模
      if (cell.key === 'temple') continue;
      if (!this.isActive(cx + 1, cz)) this.putBoundaryWall(cx, cz, 'e');
      if (!this.isActive(cx - 1, cz)) this.putBoundaryWall(cx, cz, 'w');
      if (!this.isActive(cx, cz + 1)) this.putBoundaryWall(cx, cz, 's');
      if (!this.isActive(cx, cz - 1)) this.putBoundaryWall(cx, cz, 'n');
    }
  }

  putBoundaryWall(cx, cz, side) {
    const ctx = this.ctx;
    const zoneKey = this.zoneKeyForCell(cx, cz);
    const segs = zoneKey === 'old' ? 4 : 3;
    const segLen = CELL / segs - 0.8;
    const vertical = side === 'e' || side === 'w';
    for (let s = 0; s < segs; s++) {
      const off = (s + 0.5) * (CELL / segs);
      let x, z, opts;
      if (vertical) {
        x = ORIGIN_X + (cx + (side === 'e' ? 1 : 0)) * CELL;
        z = ORIGIN_Z + cz * CELL + off;
        opts = { w: 1.2, d: segLen };
      } else {
        x = ORIGIN_X + cx * CELL + off;
        z = ORIGIN_Z + (cz + (side === 's' ? 1 : 0)) * CELL;
        opts = { w: segLen, d: 1.2 };
      }
      const prop = createProp(ctx, 'hedge', x, z, opts);
      prop.zoneKey = zoneKey;
      this.addAABB(x, z, opts.w / 2 + 0.3, opts.d / 2 + 0.3, prop.id);
    }
  }

  populateZones() {
    const ctx = this.ctx;
    const center = this.cellCenter(4, 4);
    const pump = createProp(ctx, 'well', center.x - 5, center.z + 4); this.addCircle(center.x - 5, center.z + 4, 1.6, pump.id);
    const lantern = createProp(ctx, 'balloon', center.x + 3, center.z - 3); this.addCircle(center.x + 3, center.z - 3, 1.8, lantern.id);

    this.populateOld();
    this.populateTemple();
    this.populateMarket();
    this.populateCanal();
    this.populateIndustrial();
  }

  put(type, x, z, zoneKey, obstacle = null, opts = {}) {
    const p = createProp(this.ctx, type, x, z, opts);
    p.zoneKey = zoneKey;
    if (obstacle === 'circle') this.addCircle(x, z, opts.r ?? 1.5, p.id);
    if (obstacle === 'aabb') this.addAABB(x, z, opts.hw ?? 3.6, opts.hd ?? 3.6, p.id);
    return p;
  }
  jitterCell(cell, r = 6) { return { x: cell.x + rand(-r, r), z: cell.z + rand(-r, r) }; }

  addLandmark(zoneKey, x, z, data = {}) {
    this.zoneLandmarks.get(zoneKey).push({ x, z, ...data });
  }

  // 立式霓虹招牌:立杆 + 横臂 + 双面发光牌面(落地,不再悬浮)
  addSign(x, z, color = null, rot = 0) {
    const emis = color ?? pick([0x00e5ff, 0xff2d95, 0xffd75e, 0x7cffb0, 0xff5a3a]);
    const g = new THREE.Group();
    const poleMat = TOON({ color: 0x1a1d28, roughness: 0.5 });
    const signW = rand(1.8, 3.2), signH = rand(0.7, 1.4);
    const topY = rand(3.0, 4.2);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, topY, 8), poleMat);
    pole.position.y = topY / 2; pole.castShadow = true;
    const footing = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.3, 8), poleMat);
    footing.position.y = 0.15;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), poleMat);
    arm.position.set(0, topY, 0.4);

    const back = new THREE.Mesh(new THREE.BoxGeometry(signW + 0.18, signH + 0.18, 0.14), TOON({ color: 0x0a0a12, roughness: 0.6 }));
    const face = new THREE.Mesh(new THREE.BoxGeometry(signW, signH, 0.06), TOON({ color: 0x090911, emissive: emis, emissiveIntensity: 1.5 }));
    face.position.z = 0.09;
    const faceBack = face.clone(); faceBack.position.z = -0.09; // 双面
    const panel = new THREE.Group();
    panel.add(back, face, faceBack);
    panel.position.set(0, topY, 0.75);
    panel.castShadow = true;

    g.add(pole, footing, arm, panel);
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    this.ctx.three.scene.add(g);
    this.addCircle(x, z, 0.4, -1); // 杆底碰撞
    return g;
  }

  addIncenseStand(x, z) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.2, 8), TOON({ color: 0x5c4432, roughness: 0.85 }));
    base.position.set(x, 0.6, z);
    base.castShadow = true;
    this.ctx.three.scene.add(base);
    for (let i = 0; i < 5; i++) {
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), TOON({ color: 0x24180f, emissive: 0xff7a3a, emissiveIntensity: 0.35 }));
      stick.position.set(x + rand(-0.22, 0.22), 1.25, z + rand(-0.22, 0.22));
      this.ctx.three.scene.add(stick);
    }
  }

  // 拱桥面高度剖面(alongNorm ∈ [-1,1]):驼峰形,中间高两端落地
  static bridgeDeckY(alongNorm, base, rise) {
    const t = clamp(alongNorm, -1, 1);
    return base + rise * Math.cos(t * Math.PI / 2);
  }

  // 拱桥:一整块平滑驼峰桥身(ExtrudeGeometry)+ 望柱护栏 + 桥头灯,
  // 并登记 footprint 供 bridgeHeightAt() 让玩家真的"走上桥面"
  addBridge(x, z, horizontal = true) {
    const half = 6.4, width = 3.4, base = 0.18, rise = 1.15;
    const STEPS = 24;

    // 侧剖面(u=沿跨度, y=高) → 拉伸成整块桥身
    const shape = new THREE.Shape();
    shape.moveTo(-half, 0);
    shape.lineTo(-half, Village.bridgeDeckY(-1, base, rise));
    for (let i = 1; i < STEPS; i++) {
      const u = -half + (i / (STEPS - 1)) * (half * 2);
      shape.lineTo(u, Village.bridgeDeckY(u / half, base, rise));
    }
    shape.lineTo(half, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    geo.translate(0, 0, -width / 2); // 沿宽度居中
    const deckMat = TOON({ color: 0x8a7358, roughness: 0.85 });
    const deck = new THREE.Mesh(geo, deckMat);
    deck.castShadow = deck.receiveShadow = true;
    deck.position.set(x, 0, z);
    if (!horizontal) deck.rotation.y = Math.PI / 2; // 竖桥:跨度转到 Z
    this.ctx.three.scene.add(deck);

    // 望柱护栏(沿驼峰起伏的一排小柱,两侧)
    const railMat = TOON({ color: 0x50412e, roughness: 0.8 });
    const posts = 7;
    for (let i = 0; i < posts; i++) {
      const u = -half + 0.6 + (i / (posts - 1)) * (half * 2 - 1.2);
      const y = Village.bridgeDeckY(u / half, base, rise);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), railMat);
        const ax = horizontal ? x + u : x + side * (width / 2 - 0.1);
        const az = horizontal ? z + side * (width / 2 - 0.1) : z + u;
        post.position.set(ax, y + 0.3, az);
        this.ctx.three.scene.add(post);
      }
    }
    // 桥头灯笼柱 + 碰撞(4 角小圆,不封桥面通道)
    for (const e of [-1, 1]) {
      for (const side of [-1, 1]) {
        const px = horizontal ? x + e * (half - 0.2) : x + side * (width / 2 + 0.1);
        const pz = horizontal ? z + side * (width / 2 + 0.1) : z + e * (half - 0.2);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 1.7, 8), railMat);
        post.position.set(px, 0.85, pz);
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8),
          TOON({ color: 0x2a0a06, emissive: 0xff5a2a, emissiveIntensity: 1.2 }));
        lantern.position.set(px, 1.8, pz);
        this.ctx.three.scene.add(post, lantern);
        this.addCircle(px, pz, 0.5, -1);
      }
    }

    this.bridges.push({ x, z, horizontal, half, halfWidth: width / 2, base, rise });
  }

  // 玩家/生物踩在桥上的抬升高度(不在桥面则 0)
  bridgeHeightAt(px, pz) {
    let h = 0;
    for (const b of this.bridges) {
      const along = b.horizontal ? px - b.x : pz - b.z;
      const across = b.horizontal ? pz - b.z : px - b.x;
      if (Math.abs(along) > b.half || Math.abs(across) > b.halfWidth) continue;
      const y = Village.bridgeDeckY(along / b.half, b.base, b.rise);
      if (y > h) h = y;
    }
    return h;
  }

  // 路边小商铺/摊位:木台 + 立柱 + 条纹遮阳篷 + 台面货品(实体挡路,不可破坏)
  addStall(x, z, rot = 0) {
    const g = new THREE.Group();
    const wood = TOON({ color: pick([0x5a3a28, 0x4e3222, 0x6a4630]), roughness: 0.85 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.2), wood);
    counter.position.y = 0.45; counter.castShadow = true;
    g.add(counter);
    for (const px of [-1.05, 1.05]) {
      for (const pz of [-0.5, 0.5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.12), wood);
        post.position.set(px, 0.95, pz);
        g.add(post);
      }
    }
    const awnColor = pick([0xff5a3a, 0x00e5ff, 0xffd75e, 0xff2d95, 0x7cffb0]);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 1.7),
      TOON({ color: awnColor, emissive: awnColor, emissiveIntensity: 0.45, roughness: 0.6 }));
    awning.position.set(0, 1.9, -0.15); awning.rotation.x = -0.22; awning.castShadow = true;
    g.add(awning);
    // 台面小货品(发光小方块)
    for (let i = 0; i < 3; i++) {
      const good = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3),
        TOON({ color: 0x111119, emissive: pick([0x00e5ff, 0xff2d95, 0xffd75e]), emissiveIntensity: 0.8 }));
      good.position.set(rand(-0.8, 0.8), 1.05, rand(-0.35, 0.35));
      g.add(good);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    this.ctx.three.scene.add(g);
    this.addAABB(x, z, 1.3, 0.75, -1);
  }

  addCable(x, z, len, horizontal = true) {
    const cable = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? len : 0.14, 0.08, horizontal ? 0.14 : len), TOON({ color: 0x05080c, emissive: 0x286fc8, emissiveIntensity: 0.45 }));
    cable.position.set(x, 0.12, z);
    this.ctx.three.scene.add(cable);
  }

  addCanalPatch(x, z, hw, hd) {
    // 水面略低 + 沿长边石砌驳岸(高出水面)→ 城区内河道的下陷感
    const waterMat = TOON({ color: 0x0f5066, emissive: 0x1bc8ff, emissiveIntensity: 0.4, transparent: true, opacity: 0.92 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, hd * 2), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, 0.04, z);
    this.ctx.three.scene.add(water);
    this.waterRects.push({ x, z, hw, hd });

    const curbMat = TOON({ color: 0x484f57, roughness: 0.92 });
    const H = 0.6, t = 0.5, longX = hw >= hd;
    if (longX) {
      for (const s of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + t, H, t), curbMat);
        c.position.set(x, H / 2, z + s * (hd + t / 2)); c.castShadow = true;
        this.ctx.three.scene.add(c);
      }
    } else {
      for (const s of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(t, H, hd * 2 + t), curbMat);
        c.position.set(x + s * (hw + t / 2), H / 2, z); c.castShadow = true;
        this.ctx.three.scene.add(c);
      }
    }
  }

  populateOld() {
    // 缺角细长 + 高墙密巷:房屋堆边角,巷心留空给蜈蚣直冲
    for (const cell of this.zoneEntries.get('old')) {
      const corners = [[-6.5, -6.2], [6.5, -6.2], [-6.5, 6.2], [6.5, 6.2]];
      const pickA = pick(corners);
      const pickB = pick(corners.filter((c) => c !== pickA));
      this.put('house', cell.x + pickA[0], cell.z + pickA[1], 'old', 'aabb', { hw: 3.5, hd: 3.5 });
      if (Math.random() < 0.7) this.put('house', cell.x + pickB[0] * 0.82, cell.z + pickB[1] * 0.82, 'old', 'aabb', { hw: 3.3, hd: 3.3 });
      for (let i = 0; i < randInt(3, 6); i++) {
        const edge = pick([[rand(-8.5, 8.5), -8.6], [rand(-8.5, 8.5), 8.6], [-8.6, rand(-8.5, 8.5)], [8.6, rand(-8.5, 8.5)]]);
        this.put(pick(['hay', 'cart', 'grass', 'rock', 'fence']), cell.x + edge[0], cell.z + edge[1], 'old');
      }
      if (Math.random() < 0.55) this.addSign(cell.x + rand(-6, 6), cell.z + rand(-6, 6), 0xff6a2a, pick([0, Math.PI / 2]));
    }
  }

  populateTemple() {
    // 圆形院坝:正中一座大庙,四周火盆围成祭祀阵,朝广场一侧立牌坊做山门
    if (!this.templeCenter) return;
    const cxw = this.templeCenter.x, czw = this.templeCenter.z, R = this.templeR;
    this.addGrandTemple(cxw, czw);

    // 火盆环(围着大庙,给鬼火群"吞火壮大"的舞台)
    const bn = 10, br = R * 0.5;
    for (let i = 0; i < bn; i++) {
      const a = (i / bn) * Math.PI * 2;
      this.put('brazier', cxw + Math.cos(a) * br, czw + Math.sin(a) * br, 'temple', 'circle', { r: 0.8 });
    }
    // 外圈几只香炉点缀
    const inN = 6, ir = R * 0.72;
    for (let i = 0; i < inN; i++) {
      const a = (i / inN) * Math.PI * 2 + 0.3;
      if (Math.random() < 0.6) this.addIncenseStand(cxw + Math.cos(a) * ir, czw + Math.sin(a) * ir);
    }
    // 山门牌坊立在朝中心的门洞前(与弧墙开口、大庙正面同一条轴)
    const inw = this.inwardDir(cxw, czw);
    this.put('arch', cxw + inw.x * R * 0.84, czw + inw.z * R * 0.84, 'temple', 'circle', { r: 0.8 });
  }

  // 大庙:石台基 + 朱柱前廊 + 主殿 + 双重歇山瓦顶 + 匾额灯笼(整体实体挡路)
  addGrandTemple(x, z) {
    const g = new THREE.Group();
    const stone = TOON({ color: 0x6a6e78, roughness: 0.9 });
    const wall = TOON({ color: 0xb43226, roughness: 0.85 });
    const wood = TOON({ color: 0x7a2018, roughness: 0.8 });
    const tile = TOON({ color: 0x3c4048, roughness: 0.8 });
    const box = new THREE.BoxGeometry(1, 1, 1);

    const base = new THREE.Mesh(box, stone); base.scale.set(15, 1.2, 12); base.position.y = 0.6; base.castShadow = base.receiveShadow = true; g.add(base);
    const step = new THREE.Mesh(box, stone); step.scale.set(6, 0.5, 2.2); step.position.set(0, 0.25, 7); g.add(step);
    const hall = new THREE.Mesh(box, wall); hall.scale.set(11, 5.2, 8); hall.position.y = 3.8; hall.castShadow = true; g.add(hall);
    // 前廊朱柱
    for (const px of [-4.5, -1.5, 1.5, 4.5]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 5.2, 10), wood);
      col.position.set(px, 3.8, 4.4); col.castShadow = true; g.add(col);
    }
    // 匾额 + 门
    const door = new THREE.Mesh(box, TOON({ color: 0x241610 })); door.scale.set(2.6, 3.4, 0.3); door.position.set(0, 2.9, 4.05); g.add(door);
    const plaque = new THREE.Mesh(box, TOON({ color: 0xffd75e, emissive: 0xffab3a, emissiveIntensity: 0.9 })); plaque.scale.set(3.4, 1.0, 0.2); plaque.position.set(0, 5.6, 4.15); g.add(plaque);
    // 双重歇山顶(两层四角锥瓦顶 + 正脊)
    for (const [ry, sc, ty] of [[6.6, 1.0, 0], [9.2, 0.66, 1]]) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(10.5 * sc, 3.0, 4), tile);
      roof.position.y = ry + 1.5; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.82); roof.castShadow = true; g.add(roof);
      if (ty === 0) { const mid = new THREE.Mesh(box, wall); mid.scale.set(8, 2.0, 5.5); mid.position.y = 8.0; g.add(mid); }
    }
    const ridge = new THREE.Mesh(box, TOON({ color: 0x2a2c33 })); ridge.scale.set(9.5, 0.5, 0.6); ridge.position.y = 8.1; g.add(ridge);
    // 檐角红灯笼
    for (const lx of [-6.5, 6.5]) {
      const lan = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), TOON({ color: 0x2a0a06, emissive: 0xff3a2a, emissiveIntensity: 1.3 }));
      lan.scale.y = 1.2; lan.position.set(lx, 6.4, 4.2); g.add(lan);
    }

    g.position.set(x, 0, z);
    const inw = this.inwardDir(x, z);
    g.rotation.y = Math.atan2(inw.x, inw.z); // 正面朝向地图中心(玩家来的方向)
    this.ctx.three.scene.add(g);
    this.addAABB(x, z, 6.2, 5.0, -1);
  }

  populateMarket() {
    // 商业街:两侧成排小商铺(固定摊位)+ 街心移动摊位(可魅化板车)+ 密集招牌
    for (const cell of this.zoneEntries.get('market')) {
      // 沿一条轴排开一列固定摊位,朝向街心 → "沿街店铺"感
      const alongZ = Math.random() < 0.5;
      const laneSide = pick([-1, 1]);
      const stallN = randInt(2, 3);
      for (let i = 0; i < stallN; i++) {
        const t = (i + 0.5) / stallN;
        if (alongZ) {
          const sz = cell.z - 8.5 + t * 17;
          this.addStall(cell.x + laneSide * 6.5, sz, laneSide > 0 ? -Math.PI / 2 : Math.PI / 2);
        } else {
          const sx = cell.x - 8.5 + t * 17;
          this.addStall(sx, cell.z + laneSide * 6.5, laneSide > 0 ? Math.PI : 0);
        }
      }
      // 对面偶尔再来一间小商铺
      if (Math.random() < 0.6) {
        if (alongZ) this.addStall(cell.x - laneSide * 6.5, cell.z + rand(-6, 6), laneSide > 0 ? Math.PI / 2 : -Math.PI / 2);
        else this.addStall(cell.x + rand(-6, 6), cell.z - laneSide * 6.5, laneSide > 0 ? 0 : Math.PI);
      }
      // 街心移动摊位(板车,可被魅化/推走)
      for (let i = 0; i < randInt(3, 5); i++) {
        const p = this.jitterCell(cell, 5.5);
        this.put(pick(['cart', 'cart', 'hay', 'tank', 'grass']), p.x, p.z, 'market');
      }
      // 沿街边立招牌(带杆,朝向街心)
      for (let i = 0; i < randInt(3, 4); i++) {
        const edge = pick([[rand(-8, 8), -8.8], [rand(-8, 8), 8.8], [-8.8, rand(-8, 8)], [8.8, rand(-8, 8)]]);
        this.addSign(cell.x + edge[0], cell.z + edge[1], null, Math.atan2(-edge[0], -edge[1]));
      }
      if (Math.random() < 0.7) { const p = this.jitterCell(cell, 8.5); this.put('pole', p.x, p.z, 'market', 'circle', { r: 0.5 }); }
    }
  }

  populateCanal() {
    // L 形水湾:沿保留的内圈(局部内行 lz=0 / 内列 lx=0)铺主水道,桥/护栏门控移动
    for (const cell of this.zoneEntries.get('canal')) {
      const lo = this.localOf(cell.cx, cell.cz);
      const mainH = lo && lo.lz === 0; // 内行 → 世界横向水道
      const mainV = lo && lo.lx === 0; // 内列 → 世界纵向水道
      if (mainH && mainV) this.addCanalPatch(cell.x, cell.z, CELL * 0.5, CELL * 0.5);
      else if (mainH) this.addCanalPatch(cell.x, cell.z, CELL * 0.5, 4.4);
      else if (mainV) this.addCanalPatch(cell.x, cell.z, 4.4, CELL * 0.5);
      else if (Math.random() < 0.55) this.addCanalPatch(cell.x, cell.z, 3.6, 3.6);

      if (mainH) this.addBridge(cell.x, cell.z, false);      // 桥横跨横向水道
      else if (mainV) this.addBridge(cell.x, cell.z, true);  // 桥横跨纵向水道

      for (const side of [-1, 1]) {
        this.put('fence', cell.x + side * rand(5, 7.5), cell.z + rand(-7.5, 7.5), 'canal');
      }
      if (Math.random() < 0.8) {
        const p = this.jitterCell(cell, 7);
        const prop = this.put('well', p.x, p.z, 'canal', 'circle', { r: 1.6 });
        this.addLandmark('canal', p.x, p.z, { propId: prop.id });
      }
      for (let i = 0; i < randInt(1, 3); i++) {
        const p = this.jitterCell(cell, 8);
        this.put(pick(['cart', 'grass', 'rock']), p.x, p.z, 'canal');
      }
    }
  }

  populateIndustrial() {
    // 十字机房臂:电缆骨架 + 电源节点簇(灯柱/电罐/冷却泵)
    for (const cell of this.zoneEntries.get('industrial')) {
      this.addCable(cell.x, cell.z, CELL * 0.96, cell.cz % 2 === 0);
      this.addCable(cell.x, cell.z, CELL * 0.7, !(cell.cx % 2 === 0));
      const anchors = [[-6.2, -6.2], [6.2, -6.2], [-6.2, 6.2], [6.2, 6.2], [0, 0]];
      for (const [ox, oz] of anchors) {
        const type = pick(['pole', 'tank', 'well', 'pole']);
        const x = cell.x + ox + rand(-0.8, 0.8);
        const z = cell.z + oz + rand(-0.8, 0.8);
        const obs = type === 'pole' || type === 'well' ? 'circle' : null;
        const prop = this.put(type, x, z, 'industrial', obs, type === 'pole' ? { r: 0.5 } : { r: 1.6 });
        if (type === 'pole' || type === 'tank') this.powerNodes.push({ x, z, propId: prop.id });
      }
      for (let i = 0; i < randInt(2, 4); i++) {
        const p = this.jitterCell(cell, 8.8);
        this.put(pick(['fence', 'rock', 'cart', 'tank']), p.x, p.z, 'industrial');
      }
      for (let i = 0; i < randInt(1, 2); i++) this.addSign(cell.x + rand(-7.5, 7.5), cell.z + rand(-7.5, 7.5), 0x7ab8ff, pick([0, Math.PI / 2]));
    }
  }

  isWater(pos) {
    return this.waterRects.some(r => Math.abs(pos.x - r.x) <= r.hw && Math.abs(pos.z - r.z) <= r.hd);
  }

  // 街区行走手感:speedMul 速度倍率 / accelMul 加速(操控跟手度)/ slippery 打滑
  terrainAt(pos) {
    const { cx, cz } = this.worldToCell(pos.x, pos.z);
    const key = this.zoneKeyForCell(cx, cz);
    let m;
    switch (key) {
      case 'temple':     m = { speedMul: 1.12, accelMul: 1.3, slippery: false }; break; // 院坝开阔跟手最快
      case 'old':        m = { speedMul: 0.92, accelMul: 0.85, slippery: false }; break; // 窄巷黏滞
      case 'market':     m = { speedMul: 0.9, accelMul: 1.0, slippery: false }; break;   // 拥挤(主要靠几何)
      case 'canal':      m = { speedMul: 0.9, accelMul: 0.7, slippery: true }; break;    // 湿滑
      case 'industrial': m = { speedMul: 1.0, accelMul: 1.15, slippery: false }; break;  // 金属地稳
      default:           m = { speedMul: 1.0, accelMul: 1.0, slippery: false };          // plaza
    }
    m.tag = key;
    if (this.isWater(pos)) { m.speedMul = 0.68; m.accelMul = 0.55; m.slippery = true; m.tag = 'water'; } // 涉水拖沓
    return m;
  }

  nearestWater(pos) {
    let best = null, bd = Infinity;
    for (const r of this.waterRects) {
      const dx = clamp(pos.x, r.x - r.hw, r.x + r.hw) - pos.x;
      const dz = clamp(pos.z, r.z - r.hd, r.z + r.hd) - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = { x: clamp(pos.x, r.x - r.hw, r.x + r.hw), z: clamp(pos.z, r.z - r.hd, r.z + r.hd) }; }
    }
    return best;
  }

  nearestDryLand(pos) {
    const { cx, cz } = this.worldToCell(pos.x, pos.z);
    let best = null, bd = Infinity;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const nx = clamp(cx + ox, 0, COLS - 1), nz = clamp(cz + oz, 0, ROWS - 1);
        if (!this.isActive(nx, nz)) continue;
        const c = this.cellCenter(nx, nz);
        for (const [jx, jz] of [[0, 0], [-7, -7], [7, -7], [-7, 7], [7, 7], [-9, 0], [9, 0], [0, -9], [0, 9]]) {
          const p = { x: c.x + jx, z: c.z + jz };
          if (this.isWater(p)) continue;
          const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
          if (d < bd) { bd = d; best = p; }
        }
      }
    }
    return best || this.cellCenter(4, 4);
  }

  nearestPowerNode(pos) {
    let best = null, bd = Infinity;
    for (const n of this.powerNodes) {
      const d = (n.x - pos.x) ** 2 + (n.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  addAABB(x, z, hw, hd, id) { this.obstacles.push({ t: 'a', minx: x - hw, maxx: x + hw, minz: z - hd, maxz: z + hd, id }); }
  addCircle(x, z, r, id) { this.obstacles.push({ t: 'c', x, z, r, id }); }

  onDestroyed(prop) {
    for (let i = this.obstacles.length - 1; i >= 0; i--) if (this.obstacles[i].id === prop.id) this.obstacles.splice(i, 1);
    const wk = this.hedgeWall.get(prop.id);
    if (wk) {
      const w = this.walls.get(wk);
      if (w) { w.hedgeIds.delete(prop.id); if (w.hedgeIds.size === 0) w.open = true; }
      this.hedgeWall.delete(prop.id);
    }
    for (let i = this.powerNodes.length - 1; i >= 0; i--) if (this.powerNodes[i].propId === prop.id) this.powerNodes.splice(i, 1);
  }

  resolveCircle(pos, r) {
    for (const o of this.obstacles) {
      if (o.t === 'a') {
        const nx = clamp(pos.x, o.minx, o.maxx), nz = clamp(pos.z, o.minz, o.maxz);
        const dx = pos.x - nx, dz = pos.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-6) {
          const pushL = pos.x - o.minx, pushR = o.maxx - pos.x, pushT = pos.z - o.minz, pushB = o.maxz - pos.z;
          const m = Math.min(pushL, pushR, pushT, pushB);
          if (m === pushL) pos.x = o.minx - r;
          else if (m === pushR) pos.x = o.maxx + r;
          else if (m === pushT) pos.z = o.minz - r;
          else pos.z = o.maxz + r;
        } else {
          const d = Math.sqrt(d2);
          pos.x = nx + (dx / d) * r;
          pos.z = nz + (dz / d) * r;
        }
      } else {
        const dx = pos.x - o.x, dz = pos.z - o.z, rr = r + o.r, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        pos.x = o.x + (dx / d) * rr;
        pos.z = o.z + (dz / d) * rr;
      }
    }
  }

  passable(cx, cz, dir) {
    const [nx, nz, wk] = this.neighborInDir(cx, cz, dir);
    if (!this.isActive(nx, nz)) return false; // void/越界不可通行
    const w = this.walls.get(wk);
    return !w || w.open;
  }

  bfsFrom(cx, cz) {
    const dist = new Int16Array(COLS * ROWS).fill(-1);
    if (!this.isActive(cx, cz)) return dist;
    const qi = [cx + cz * COLS]; dist[qi[0]] = 0;
    let head = 0;
    while (head < qi.length) {
      const cur = qi[head++], ccx = cur % COLS, ccz = Math.floor(cur / COLS);
      for (let dir = 0; dir < 4; dir++) {
        if (!this.passable(ccx, ccz, dir)) continue;
        const [nx, nz] = this.neighborInDir(ccx, ccz, dir);
        const ni = nx + nz * COLS;
        if (dist[ni] >= 0) continue;
        dist[ni] = dist[cur] + 1; qi.push(ni);
      }
    }
    return dist;
  }

  farCell(fromX, fromZ, minDist = 4, zoneKey = null) {
    const { cx, cz } = this.worldToCell(fromX, fromZ);
    const dist = this.bfsFrom(cx, cz);
    const candidates = [];
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] < minDist) continue;
      const x = i % COLS, z = Math.floor(i / COLS);
      const cell = this.zoneCells.get(this.ckey(x, z));
      if (!cell) continue; // void 格无 cell
      if (zoneKey && cell.key !== zoneKey) continue;
      candidates.push(cell);
    }
    const cell = candidates.length ? pick(candidates) : pick(this.zoneEntries.get(zoneKey || 'plaza')) || pick([...this.zoneCells.values()]);
    return { x: cell.x + rand(-5, 5), z: cell.z + rand(-5, 5) };
  }

  spawnPointForKind(kind) {
    if (kind === 'water') {
      const n = pick(this.zoneLandmarks.get('canal'));
      if (n) return { x: n.x + rand(-2, 2), z: n.z + rand(-2, 2) };
      const w = this.nearestWater({ x: 0, z: 0 });
      if (w) return w;
    }
    if (kind === 'thunder') {
      const n = this.powerNodes.length ? pick(this.powerNodes) : this.nearestPowerNode({ x: 0, z: 0 });
      if (n) return { x: n.x + rand(-2, 2), z: n.z + rand(-2, 2) };
    }
    const map = { dragon: 'old', spheres: 'temple', guardian: 'market', water: 'canal', thunder: 'industrial' };
    return this.farCell(this.ctx.player?.pos.x ?? 0, this.ctx.player?.pos.z ?? 0, 3, map[kind]);
  }

  // 庙区外侧一圈真正的弧形围墙:用开口圆柱壳(连续曲面),只封朝外侧,朝广场留门
  createTempleRingWall() {
    if (!this.templeCenter) return;
    const cxw = this.templeCenter.x, czw = this.templeCenter.z;
    // 墙体中心朝"外"(远离地图中心),开口即朝中心/广场 —— 换到任何角都对准入口
    const aCenter = Math.atan2(czw, cxw); // a 约定:点=(cos,sin),(cxw,czw) 即朝外方向
    const coverHalf = 1.95;            // 覆盖弧半角(rad),留出朝中心约 130° 门洞
    const R = this.templeR;
    const H = 2.8;

    // THREE 圆柱顶点用 x=R*sinθ, z=R*cosθ ⇒ 我的 a 约定下 θ = π/2 - a
    const thetaStart = Math.PI / 2 - (aCenter + coverHalf);
    const thetaLength = coverHalf * 2;
    const wallMat = TOON({ color: 0x8a2018, roughness: 0.8, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, H, 96, 1, true, thetaStart, thetaLength), wallMat);
    wall.position.set(cxw, H / 2, czw);
    wall.castShadow = wall.receiveShadow = true;
    this.ctx.three.scene.add(wall);
    // 顶部瓦檐压边(略大半径的薄弧壳)
    const capMat = TOON({ color: 0x3c4048, roughness: 0.85, side: THREE.DoubleSide });
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.25, R + 0.25, 0.4, 96, 1, true, thetaStart, thetaLength), capMat);
    cap.position.set(cxw, H + 0.1, czw);
    this.ctx.three.scene.add(cap);

    // 碰撞:沿同一弧线密排小圆(与视觉曲面同心,玩家/生物撞得到)
    const step = 2.0 / R;
    for (let a = aCenter - coverHalf; a <= aCenter + coverHalf; a += step) {
      this.addCircle(cxw + Math.cos(a) * R, czw + Math.sin(a) * R, 1.1, -1);
    }
  }

  // 老居民区:巷内插入短墙桩 + L 形拐角 + 巷心矮桩,切成更窄更错综的支巷(可撞碎)
  oldStub(x, z, w, d) {
    const prop = createProp(this.ctx, 'hedge', x, z, { w, d });
    prop.zoneKey = 'old';
    this.addAABB(x, z, w / 2 + 0.3, d / 2 + 0.3, prop.id);
  }
  tightenOldAlleys() {
    for (const cell of this.zoneEntries.get('old')) {
      const stubs = randInt(2, 3);
      for (let k = 0; k < stubs; k++) {
        const len = CELL * rand(0.34, 0.46);
        const x = cell.x + rand(-6.5, 6.5);
        const z = cell.z + rand(-6.5, 6.5);
        if (Math.random() < 0.4) {
          // L 形拐角:一竖一横交于一角,制造回折
          this.oldStub(x, z, 1.0, len);
          this.oldStub(x + pick([-1, 1]) * (len / 2), z - len / 2, len, 1.0);
        } else if (Math.random() < 0.5) {
          this.oldStub(x, z, 1.0, len); // 竖桩
        } else {
          this.oldStub(x, z, len, 1.0); // 横桩
        }
      }
      // 巷心矮桩(水泥墩)逼玩家绕行
      if (Math.random() < 0.5) this.put('rock', cell.x + rand(-5, 5), cell.z + rand(-5, 5), 'old');
    }
  }

  // 河道装饰:水面波纹条 + 岸边石块 + 芦苇丛,让水渠更像"河"
  decorateWater() {
    const rippleMat = new THREE.MeshBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: 0.2, depthWrite: false });
    const stoneMat = TOON({ color: 0x4a5158, roughness: 0.95 });
    const reedMat = TOON({ color: 0x3f6f4a, roughness: 0.8 });
    for (const r of this.waterRects) {
      const long = r.hw >= r.hd;
      // 波纹条:沿长轴的细长半透明亮条
      for (let i = 0; i < 3; i++) {
        const w = long ? r.hw * (1.0 + rand(0, 0.4)) : r.hw * 0.5;
        const d = long ? r.hd * 0.16 : r.hd * (1.0 + rand(0, 0.4));
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, d * 2), rippleMat);
        strip.rotation.x = -Math.PI / 2;
        strip.position.set(r.x + rand(-r.hw * 0.4, r.hw * 0.4), 0.09, r.z + rand(-r.hd * 0.4, r.hd * 0.4));
        this.ctx.three.scene.add(strip);
      }
      // 岸边石块 + 芦苇:沿矩形四边随机点
      for (let i = 0; i < 7; i++) {
        const onX = Math.random() < 0.5;
        const ex = onX ? rand(-r.hw, r.hw) : pick([-1, 1]) * r.hw;
        const ez = onX ? pick([-1, 1]) * r.hd : rand(-r.hd, r.hd);
        const x = r.x + ex, z = r.z + ez;
        if (Math.random() < 0.6) {
          const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.35, 0.8), 0), stoneMat);
          stone.position.set(x, 0.16, z); stone.rotation.set(rand(3), rand(3), rand(3)); stone.castShadow = true;
          this.ctx.three.scene.add(stone);
        } else {
          for (let b = 0; b < 4; b++) {
            const reed = new THREE.Mesh(new THREE.ConeGeometry(0.06, rand(0.9, 1.6), 5), reedMat);
            reed.position.set(x + rand(-0.35, 0.35), 0.7, z + rand(-0.35, 0.35));
            reed.rotation.z = rand(-0.25, 0.25);
            this.ctx.three.scene.add(reed);
          }
        }
      }
    }
  }
}
