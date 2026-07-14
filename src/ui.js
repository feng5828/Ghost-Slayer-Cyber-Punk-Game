import * as THREE from 'three';

// ============================================================================
// DOM UI:菜单 / HUD / 弹分 / 结算
// ============================================================================

const CREATURE_INFO = [
  {
    kind: 'dragon', name: '红龙', color: '#e2493b',
    desc: '身体就是武器。冲刺(左键/空格)撞碎一切。破坏越多,身体越长。',
  },
  {
    kind: 'spheres', name: '金属球群', color: '#cfd6de',
    desc: '按数学阵型运转的球群。左键按住=钻头突刺,右键按住=环形绞盘。吞噬碎片成长。',
  },
  {
    kind: 'guardian', name: '守护者', color: '#ecd9a0',
    desc: '不直接破坏。左键按住凝视魅化道具为仆从,右键令全体仆从导弹突击。',
  },
];
const MODE_INFO = [
  { id: 'score', name: '拆迁计时赛 · 3分钟' },
  { id: 'brawl', name: '大乱斗 · 毁掉其余生物' },
];
const HINTS = {
  dragon: 'WASD 移动<br>左键/空格 冲刺撞击<br>高速掠过即可破坏',
  spheres: 'WASD 移动<br>左键按住 钻头突刺(朝鼠标)<br>右键按住 环形绞盘',
  guardian: 'WASD 移动<br>左键按住 凝视魅化(鼠标指向道具)<br>右键 仆从导弹突击',
};

export class UI {
  constructor() {
    this.el = (id) => document.getElementById(id);
    this._bannerT = null;
    this._camera = null;
  }

  // ---------- 主菜单 ----------
  showMenu(onStart) {
    const menu = this.el('menu');
    menu.style.display = 'flex';
    let mode = null, kind = null;

    const modesBox = this.el('modes');
    modesBox.innerHTML = '';
    for (const m of MODE_INFO) {
      const d = document.createElement('div');
      d.className = 'mode';
      d.textContent = m.name;
      d.onclick = () => {
        mode = m.id;
        modesBox.querySelectorAll('.mode').forEach((x) => x.classList.remove('sel'));
        d.classList.add('sel');
        refresh();
      };
      modesBox.appendChild(d);
    }

    const cardsBox = this.el('cards');
    cardsBox.innerHTML = '';
    for (const c of CREATURE_INFO) {
      const d = document.createElement('div');
      d.className = 'card';
      d.innerHTML = `<div class="cname" style="color:${c.color}">${c.name}</div><div class="cdesc">${c.desc}</div>`;
      d.onclick = () => {
        kind = c.kind;
        cardsBox.querySelectorAll('.card').forEach((x) => x.classList.remove('sel'));
        d.classList.add('sel');
        refresh();
      };
      cardsBox.appendChild(d);
    }

    const btn = this.el('startbtn');
    const refresh = () => { btn.disabled = !(mode && kind); };
    btn.onclick = () => {
      if (mode && kind) {
        menu.style.display = 'none';
        onStart({ mode, kind });
      }
    };
  }

  // ---------- HUD ----------
  startHud(ctx) {
    this._camera = ctx.three.camera;
    this.el('hud').style.display = 'block';
    this.el('hint').innerHTML = HINTS[ctx.player.kind];
    this.el('hpbar').querySelector('.label').textContent = '';
  }

  updateHud(ctx) {
    // 计时
    const remain = Math.max(0, ctx.matchDuration - ctx.matchTime);
    const mm = Math.floor(remain / 60), ss = Math.floor(remain % 60);
    const timer = this.el('timer');
    timer.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    timer.classList.toggle('danger', remain < 30 || ctx.zone.active);

    // 记分板
    const rows = [...ctx.creatures]
      .sort((a, b) => b.score - a.score)
      .map((c) => {
        const dead = c.alive ? '' : ' ✝';
        const me = c.isPlayer ? ' (你)' : '';
        return `<div class="row${c.isPlayer ? ' me' : ''}">${c.cname}${me}${dead} · ${c.score}</div>`;
      })
      .join('');
    this.el('scoreboard').innerHTML = rows;

    // 血条
    const p = ctx.player;
    const hp = this.el('hpbar');
    if (p.alive) {
      hp.querySelector('.val').textContent = p.hpText();
      hp.style.color = p.hpRatio() < 0.3 ? '#ff5040' : '#e8e8e8';
    } else {
      hp.querySelector('.val').textContent = '已被摧毁 · 观战中';
      hp.style.color = '#888';
    }
  }

  banner(text) {
    const b = this.el('banner');
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.remove('show'), 2600);
  }

  zoneWarn(on) {
    if (on && !this._zoneWarned) {
      this._zoneWarned = true;
      this.banner('你在结界之外!快回到圈内!');
      setTimeout(() => (this._zoneWarned = false), 4000);
    }
  }

  // 世界坐标弹分
  popup(ctx, text, worldPos, level = 0) {
    const v = new THREE.Vector3(worldPos.x, (worldPos.y || 0) + 2, worldPos.z).project(ctx.three.camera);
    if (v.z > 1) return;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const d = document.createElement('div');
    d.className = `popup c${level}`;
    d.textContent = text;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    this.el('popups').appendChild(d);
    d.addEventListener('animationend', () => d.remove());
  }

  // 守护者魅化进度环(跟随鼠标)
  charmRing(input, progress) {
    const ring = this.el('charmring');
    if (!input || progress <= 0) { ring.style.display = 'none'; return; }
    ring.style.display = 'block';
    ring.style.left = `${input.mouseX ?? window.innerWidth / 2}px`;
    ring.style.top = `${input.mouseY ?? window.innerHeight / 2}px`;
    ring.style.background = `conic-gradient(#7ac8ff ${progress * 360}deg, transparent 0deg)`;
  }

  // ---------- 结算 ----------
  showEnd(ctx, config) {
    this.el('hud').style.display = 'none';
    const end = this.el('end');
    end.style.display = 'flex';

    const sorted = [...ctx.creatures].sort((a, b) => {
      if (ctx.mode === 'brawl' && a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.score - a.score;
    });
    const winner = sorted[0];
    this.el('endtitle').textContent =
      winner.isPlayer ? '你 赢 了' : `${winner.cname} 获胜`;

    this.el('rankings').innerHTML = sorted
      .map((c, i) => {
        const cls = i === 0 ? 'winner' : '';
        const me = c.isPlayer ? ' (你)' : '';
        const dead = c.alive ? '' : ' ✝';
        return `<div class="${cls}">${i + 1}. ${c.cname}${me}${dead} —— ${c.score} 分</div>`;
      })
      .join('');

    const p = ctx.player;
    this.el('endsub').textContent =
      `破坏 ${p.stats.destroyed} 个 · 最深连锁 ${p.stats.maxChain} 层 · 击杀 ${p.stats.kills}`;

    this.el('againbtn').onclick = () => {
      sessionStorage.setItem('gm_config', JSON.stringify(config));
      location.reload();
    };
    this.el('menubtn').onclick = () => {
      sessionStorage.removeItem('gm_config');
      location.reload();
    };
  }
}
