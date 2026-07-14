// ============================================================================
// 计分:直接破坏 x1,连锁破坏按深度加倍率(上限 x4)
// 计分规则本身把玩家推向"设计混乱"
// ============================================================================
export class ScoreSystem {
  award(ctx, owner, base, chain, label, worldPos) {
    const mult = Math.min(1 + 0.5 * chain, 4);
    const pts = Math.round(base * mult);
    owner.score += pts;
    owner.stats.destroyed++;
    owner.stats.maxChain = Math.max(owner.stats.maxChain, chain);
    if (owner.isPlayer) {
      const txt = chain > 0 ? `${label} +${pts} 连锁×${mult.toFixed(1)}` : `${label} +${pts}`;
      ctx.ui.popup(ctx, txt, worldPos, Math.min(chain, 3));
    }
  }

  killBonus(ctx, owner, victim) {
    owner.score += 300;
    owner.stats.kills++;
    if (owner.isPlayer) ctx.ui.popup(ctx, `击杀 ${victim.cname} +300`, victim.pos, 3);
  }
}
