import { createProp, propPos } from './props.js';
import { rand, randInt, pick, clamp } from './util.js';

// ============================================================================
// 程序化村庄迷宫
// - DFS 生成迷宫,墙 = 树篱段(可烧穿/砸穿 → 迷宫连通性实时变化)
// - 木屋/水井/电灯柱/火药桶散布其间
// - 提供:圆形碰撞解算 + 基于格子的 BFS 导航(生物躲藏用)
// ============================================================================

export const COLS = 9, ROWS = 9, CELL = 22;
const ORIGIN_X = -(COLS * CELL) / 2;
const ORIGIN_Z = -(ROWS * CELL) / 2;

export class Village {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.village = this;
    // walls: key -> { hedgeIds:Set, open:boolean } ('e'=东墙,'s'=南墙)
    this.walls = new Map();
    this.hedgeWall = new Map();  // hedge propId -> wallKey
    this.obstacles = [];         // {t:'a',minx,maxx,minz,maxz,id} | {t:'c',x,z,r,id}
    this.generate();
  }

  wkey(cx, cz, dir) { return `${cx},${cz},${dir}`; }
  cellCenter(cx, cz) {
    return { x: ORIGIN_X + (cx + 0.5) * CELL, z: ORIGIN_Z + (cz + 0.5) * CELL };
  }
  worldToCell(x, z) {
    return {
      cx: clamp(Math.floor((x - ORIGIN_X) / CELL), 0, COLS - 1),
      cz: clamp(Math.floor((z - ORIGIN_Z) / CELL), 0, ROWS - 1),
    };
  }

  // ---------------------------------------------------------------------------
  generate() {
    const ctx = this.ctx;
    // 1) 全墙
    for (let cx = 0; cx < COLS; cx++) {
      for (let cz = 0; cz < ROWS; cz++) {
        if (cx < COLS - 1) this.walls.set(this.wkey(cx, cz, 'e'), { hedgeIds: new Set(), open: false });
        if (cz < ROWS - 1) this.walls.set(this.wkey(cx, cz, 's'), { hedgeIds: new Set(), open: false });
      }
    }
    // 2) DFS 打通生成树
    const visited = new Set();
    const stack = [[randInt(0, COLS - 1), randInt(0, ROWS - 1)]];
    visited.add(stack[0][0] + ',' + stack[0][1]);
    while (stack.length) {
      const [cx, cz] = stack[stack.length - 1];
      const opts = [];
      for (const [dx, dz, dir, ox, oz] of [[1, 0, 'e', 0, 0], [-1, 0, 'e', -1, 0], [0, 1, 's', 0, 0], [0, -1, 's', 0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nx >= COLS || nz < 0 || nz >= ROWS) continue;
        if (visited.has(nx + ',' + nz)) continue;
        opts.push([nx, nz, this.wkey(cx + ox, cz + oz, dir)]);
      }
      if (!opts.length) { stack.pop(); continue; }
      const [nx, nz, wk] = pick(opts);
      this.walls.get(wk).open = true;
      visited.add(nx + ',' + nz);
      stack.push([nx, nz]);
    }
    // 3) 额外打通 18% 制造环路(迷宫太死板不好玩)
    for (const w of this.walls.values()) {
      if (!w.open && Math.random() < 0.18) w.open = true;
    }

    // 4) 留在场上的墙 → 树篱段(每面墙3段,可被逐段破坏)
    for (const [key, w] of this.walls) {
      if (w.open) continue;
      const [cx, cz, dir] = key.split(',');
      const icx = +cx, icz = +cz;
      const segs = 3, segLen = CELL / segs - 0.8;
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
        w.hedgeIds.add(prop.id);
        this.hedgeWall.set(prop.id, key);
        this.addAABB(x, z, opts.w / 2 + 0.3, opts.d / 2 + 0.3, prop.id);
      }
    }
    // 5) 外圈围栏树篱(不可参与迷宫,只是边界)
    const half = (COLS * CELL) / 2;
    for (let i = 0; i < COLS; i++) {
      const c = ORIGIN_X + (i + 0.5) * CELL;
      for (const [x, z, o] of [
        [c, -half - 1, { w: CELL - 1, d: 1.2 }], [c, half + 1, { w: CELL - 1, d: 1.2 }],
        [-half - 1, c, { w: 1.2, d: CELL - 1 }], [half + 1, c, { w: 1.2, d: CELL - 1 }],
      ]) {
        const prop = createProp(ctx, 'hedge', x, z, o);
        this.addAABB(x, z, o.w / 2 + 0.3, o.d / 2 + 0.3, prop.id);
      }
    }

    // 6) 村庄内容
    const centerCx = Math.floor(COLS / 2), centerCz = Math.floor(ROWS / 2);
    const usedCells = new Set([centerCx + ',' + centerCz]);

    // 村庄广场:水井 + 热气球
    const cc = this.cellCenter(centerCx, centerCz);
    const wellP = createProp(ctx, 'well', cc.x - 5, cc.z + 4);
    this.addCircle(cc.x - 5, cc.z + 4, 1.6, wellP.id);
    const balP = createProp(ctx, 'balloon', cc.x + 3, cc.z - 3);
    this.addCircle(cc.x + 3, cc.z - 3, 1.8, balP.id);

    // 木屋 ~13 座
    for (let i = 0; i < 13; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const cx = randInt(0, COLS - 1), cz = randInt(0, ROWS - 1);
        if (usedCells.has(cx + ',' + cz)) continue;
        usedCells.add(cx + ',' + cz);
        const c = this.cellCenter(cx, cz);
        const hx = c.x + rand(-3, 3), hz = c.z + rand(-3, 3);
        const hp = createProp(ctx, 'house', hx, hz);
        this.addAABB(hx, hz, 3.6, 3.6, hp.id);
        break;
      }
    }

    // 牌坊:横跨主街(可撞碎,倒下的柱子是大型碎片)
    for (const az of [-44, 44]) {
      const arch = createProp(ctx, 'arch', 0, az);
      this.addCircle(-4, az, 0.6, arch.id);
      this.addCircle(4, az, 0.6, arch.id);
    }

    // 电灯柱:随机格子角落(带电 → 电系连锁)
    for (let i = 0; i < 12; i++) {
      const cx = randInt(0, COLS - 1), cz = randInt(0, ROWS - 1);
      const c = this.cellCenter(cx, cz);
      const x = c.x + pick([-1, 1]) * (CELL / 2 - 2.5);
      const z = c.z + pick([-1, 1]) * (CELL / 2 - 2.5);
      const p = createProp(ctx, 'pole', x, z);
      this.addCircle(x, z, 0.5, p.id);
    }

    // 其余散件:每个格子里丢一点生活气息
    for (let cx = 0; cx < COLS; cx++) {
      for (let cz = 0; cz < ROWS; cz++) {
        const c = this.cellCenter(cx, cz);
        const n = randInt(1, 3);
        for (let i = 0; i < n; i++) {
          const type = pick(['hay', 'cart', 'tank', 'fence', 'grass', 'grass', 'rock']);
          const x = c.x + rand(-7, 7), z = c.z + rand(-7, 7);
          createProp(ctx, type, x, z);
        }
      }
    }
    // 额外水井几口(灭火点)
    for (let i = 0; i < 3; i++) {
      const cx = randInt(0, COLS - 1), cz = randInt(0, ROWS - 1);
      const c = this.cellCenter(cx, cz);
      const x = c.x + rand(-5, 5), z = c.z + rand(-5, 5);
      const p = createProp(ctx, 'well', x, z);
      this.addCircle(x, z, 1.6, p.id);
    }
  }

  addAABB(x, z, hw, hd, id) {
    this.obstacles.push({ t: 'a', minx: x - hw, maxx: x + hw, minz: z - hd, maxz: z + hd, id });
  }
  addCircle(x, z, r, id) {
    this.obstacles.push({ t: 'c', x, z, r, id });
  }

  // 道具被摧毁 → 移除碰撞,更新迷宫连通性
  onDestroyed(prop) {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      if (this.obstacles[i].id === prop.id) this.obstacles.splice(i, 1);
    }
    const wk = this.hedgeWall.get(prop.id);
    if (wk) {
      const w = this.walls.get(wk);
      if (w) {
        w.hedgeIds.delete(prop.id);
        if (w.hedgeIds.size === 0) w.open = true; // 整面墙被清掉 → 导航可通行
      }
      this.hedgeWall.delete(prop.id);
    }
  }

  // 圆形碰撞解算(猎人和生物的移动用)
  resolveCircle(pos, r) {
    for (const o of this.obstacles) {
      if (o.t === 'a') {
        const nx = clamp(pos.x, o.minx, o.maxx);
        const nz = clamp(pos.z, o.minz, o.maxz);
        let dx = pos.x - nx, dz = pos.z - nz;
        let d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-6) {
          // 圆心在盒内:往最近的面推出去
          const pushL = pos.x - o.minx, pushR = o.maxx - pos.x;
          const pushT = pos.z - o.minz, pushB = o.maxz - pos.z;
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
        const dx = pos.x - o.x, dz = pos.z - o.z;
        const rr = r + o.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        pos.x = o.x + (dx / d) * rr;
        pos.z = o.z + (dz / d) * rr;
      }
    }
  }

  passable(cx, cz, dir) {
    // dir: 0=+x 1=-x 2=+z 3=-z
    let wk;
    if (dir === 0) wk = this.wkey(cx, cz, 'e');
    else if (dir === 1) wk = this.wkey(cx - 1, cz, 'e');
    else if (dir === 2) wk = this.wkey(cx, cz, 's');
    else wk = this.wkey(cx, cz - 1, 's');
    const w = this.walls.get(wk);
    return !w || w.open;
  }

  // 从某格出发的 BFS 距离场(生物逃跑/接近用)
  bfsFrom(cx, cz) {
    const dist = new Int16Array(COLS * ROWS).fill(-1);
    const qi = [cx + cz * COLS];
    dist[qi[0]] = 0;
    let head = 0;
    while (head < qi.length) {
      const cur = qi[head++];
      const ccx = cur % COLS, ccz = Math.floor(cur / COLS);
      const dirs = [[1, 0, 0], [-1, 0, 1], [0, 1, 2], [0, -1, 3]];
      for (const [dx, dz, dir] of dirs) {
        const nx = ccx + dx, nz = ccz + dz;
        if (nx < 0 || nx >= COLS || nz < 0 || nz >= ROWS) continue;
        const ni = nx + nz * COLS;
        if (dist[ni] >= 0) continue;
        if (!this.passable(ccx, ccz, dir)) continue;
        dist[ni] = dist[cur] + 1;
        qi.push(ni);
      }
    }
    return dist;
  }

  // 随机一个离某点足够远的格子(刷新生物用)
  farCell(fromX, fromZ, minDist = 4) {
    const { cx, cz } = this.worldToCell(fromX, fromZ);
    const dist = this.bfsFrom(cx, cz);
    const far = [];
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] >= minDist) far.push(i);
    }
    const i = far.length ? pick(far) : randInt(0, COLS * ROWS - 1);
    return this.cellCenter(i % COLS, Math.floor(i / COLS));
  }
}
