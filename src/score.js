// ============================================================================
// 计分:
// - 破坏道具:小分 + 连锁倍率(上限 x4),同时给玩家转化【灵力】(结界的弹药)
// - 收服恶鬼:大头。单只分值递增(500, 700, 900...),血月期间 ×2
// - 误杀市民:-100
// ============================================================================
export class ScoreSystem {
  award(ctx, owner, base, chain, label, worldPos) {
    const mult = Math.min(1 + 0.5 * chain, 4);
    const pts = Math.round(base * mult);
    owner.score += pts;
    owner.stats.destroyed++;
    owner.stats.maxChain = Math.max(owner.stats.maxChain, chain);
    if (owner.isPlayer) {
      // 破坏 → 灵力:拆迁是收鬼的弹药
      if (owner.spirit !== undefined) owner.spirit = Math.min(owner.spirit + pts * 0.08, 100);
      const txt = chain > 0 ? `${label} +${pts} 连锁×${mult.toFixed(1)}` : `${label} +${pts}`;
      ctx.ui.popup(ctx, txt, worldPos, Math.min(chain, 3));
    }
  }

  captureBonus(ctx, owner, ghost) {
    owner.stats.kills++;
    let pts = 500 + (owner.stats.kills - 1) * 200;
    if (ctx.bloodMoon) pts *= 2;
    owner.score += pts;
    if (owner.isPlayer) {
      ctx.ui.popup(ctx, `收服 ${ghost.cname} +${pts}${ctx.bloodMoon ? ' 血月×2' : ''}`, ghost.pos, 3);
      ctx.ui.banner(`收服 ${ghost.cname}!(第 ${owner.stats.kills} 只)`);
    }
  }

  killBonus(ctx, owner, victim) {
    // 现在仅用于恶鬼击杀猎人的记录
    owner.score += 300;
    owner.stats.kills++;
  }

  penalty(ctx, owner, amount, label, worldPos) {
    owner.score = Math.max(0, owner.score - amount);
    if (owner.isPlayer) ctx.ui.popup(ctx, `${label} -${amount}`, worldPos, 'bad');
  }
}
