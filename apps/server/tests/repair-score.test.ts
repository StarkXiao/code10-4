import { describe, expect, it } from 'vitest';
import {
  REPAIR_SCORE_WEIGHTS,
  compareRepairRounds,
  dimensionOffsetMm,
  repairScoreLevel,
  scoreRepairChange,
  type RepairChangeScoreInput,
} from '@gml/shared';

const perfect: RepairChangeScoreInput = {
  visibility: 'invisible',
  colorMatch: 'perfect',
  dimensionChange: { lengthMm: 0, widthMm: 0 },
  stiffness: 'same',
  drapeChange: 'none',
};

const poor: RepairChangeScoreInput = {
  visibility: 'obvious',
  colorMatch: 'mismatch',
  dimensionChange: { lengthMm: -25, widthMm: 10 },
  stiffness: 'stiffer',
  drapeChange: 'obvious',
  mobilityLimited: true,
  visibleFromOutside: true,
};

describe('修补效果分（痕迹 / 尺寸 / 体感折算）', () => {
  it('完全无变化是 100 分（优秀）', () => {
    const result = scoreRepairChange(perfect);
    expect(result.score).toBe(100);
    expect(result.level).toBe('excellent');
    expect(result.traceScore).toBe(100);
    expect(result.fitScore).toBe(100);
    expect(result.comfortScore).toBe(100);
  });

  it('最差组合：痕迹、颜色、偏移、体感全部拉满扣减', () => {
    const result = scoreRepairChange(poor);
    // 痕迹：10×0.7 + 25×0.3 = 14.5 − 10（外人看得出）= 4.5 → 5
    expect(result.traceScore).toBe(5);
    // 最大偏移 25mm → 严重偏移 15
    expect(result.fitScore).toBe(15);
    expect(result.maxOffsetMm).toBe(25);
    // 体感：40×0.5 + 30×0.5 = 35 − 20（影响活动）= 15
    expect(result.comfortScore).toBe(15);
    // 总分：5×0.4 + 15×0.3 + 15×0.3 = 11 → 较差
    expect(result.score).toBe(11);
    expect(result.level).toBe('poor');
  });

  it('权重之和为 1，分档阈值正确', () => {
    expect(REPAIR_SCORE_WEIGHTS.trace + REPAIR_SCORE_WEIGHTS.fit + REPAIR_SCORE_WEIGHTS.comfort).toBeCloseTo(1);
    expect(repairScoreLevel(85)).toBe('excellent');
    expect(repairScoreLevel(84)).toBe('good');
    expect(repairScoreLevel(70)).toBe('good');
    expect(repairScoreLevel(69)).toBe('fair');
    expect(repairScoreLevel(50)).toBe('fair');
    expect(repairScoreLevel(49)).toBe('poor');
  });

  it('痕迹分 = 痕迹等级 70% + 颜色 30%，外人看得出再扣 10', () => {
    const slight = scoreRepairChange({
      ...perfect,
      visibility: 'slight',
      colorMatch: 'close',
    });
    // 80×0.7 + 75×0.3 = 78.5 → 79
    expect(slight.traceScore).toBe(79);

    const outside = scoreRepairChange({
      ...perfect,
      visibleFromOutside: true,
    });
    expect(outside.traceScore).toBe(90);
  });

  it('尺寸分按长/宽最大绝对偏移分档，负数（变小）与正数（变大）等价', () => {
    expect(dimensionOffsetMm({ lengthMm: -8, widthMm: 3 })).toBe(8);
    expect(scoreRepairChange({ ...perfect, dimensionChange: { lengthMm: 3, widthMm: -3 } }).fitScore).toBe(85);
    expect(scoreRepairChange({ ...perfect, dimensionChange: { lengthMm: 8, widthMm: 0 } }).fitScore).toBe(65);
    expect(scoreRepairChange({ ...perfect, dimensionChange: { lengthMm: 15, widthMm: 0 } }).fitScore).toBe(40);
    expect(scoreRepairChange({ ...perfect, dimensionChange: { lengthMm: 30, widthMm: 0 } }).fitScore).toBe(15);
  });

  it('未填尺寸时尺寸维度为 null，权重归一到痕迹与体感（不白送 30 分）', () => {
    const result = scoreRepairChange({
      visibility: 'obvious',
      colorMatch: 'mismatch',
      stiffness: 'same',
      drapeChange: 'none',
    });
    expect(result.fitScore).toBeNull();
    expect(result.maxOffsetMm).toBeNull();
    // 痕迹 14.5 → 15，体感 100；归一化权重 4/7 与 3/7
    const expected = Math.round(15 * (4 / 7) + 100 * (3 / 7));
    expect(result.score).toBe(expected);
    expect(result.factors.find((f) => f.key === 'fit')?.weight).toBe(0);
  });

  it('体感分 = 手感 50% + 垂坠 50%，影响活动再扣 20，且不低于 0', () => {
    const limited = scoreRepairChange({ ...perfect, mobilityLimited: true });
    expect(limited.comfortScore).toBe(80);
    const worst = scoreRepairChange({
      visibility: 'invisible',
      colorMatch: 'perfect',
      stiffness: 'stiffer',
      drapeChange: 'obvious',
      mobilityLimited: true,
    });
    // 35 − 20 = 15（不会被截到负数）
    expect(worst.comfortScore).toBe(15);
  });
});

describe('多轮修补对比', () => {
  it('按轮次排序并给出与上一轮的差分（正=变好）', () => {
    const comparison = compareRepairRounds([
      { repairId: 'r2', round: 2, stitch: '藏针缝', finishedAt: '2026-03-01', status: 'passed', change: perfect },
      { repairId: 'r1', round: 1, stitch: '贴布补丁', finishedAt: '2026-01-01', status: 'failed', change: poor },
    ]);
    expect(comparison.rounds.map((r) => r.round)).toEqual([1, 2]);
    expect(comparison.scoredCount).toBe(2);
    expect(comparison.deltas[0]).toBeNull();
    expect(comparison.deltas[1]!.score).toBe(100 - 11);
    expect(comparison.deltas[1]!.traceScore).toBe(100 - 5);
    // 偏移量是物理量：25mm → 0，差分为 −25（偏移减小，即变好）
    expect(comparison.deltas[1]!.maxOffsetMm).toBe(-25);
    expect(comparison.bestImprovement).toEqual({ round: 2, scoreDelta: 89 });
  });

  it('变化未填写的轮次没有分值，也不参与差分', () => {
    const comparison = compareRepairRounds([
      { round: 1, change: null },
      { round: 2, change: perfect },
      { round: 3, change: poor },
    ]);
    expect(comparison.scoredCount).toBe(2);
    expect(comparison.rounds[0].score).toBeNull();
    expect(comparison.deltas[1]).toBeNull(); // 上一轮无分
    expect(comparison.deltas[2]!.score).toBe(11 - 100);
    expect(comparison.bestImprovement).toBeNull(); // 全是退步
  });

  it('持平或退步不报最佳改进', () => {
    const hold = compareRepairRounds([
      { round: 1, change: perfect },
      { round: 2, change: perfect },
    ]);
    expect(hold.deltas[1]!.score).toBe(0);
    expect(hold.bestImprovement).toBeNull();
  });
});
