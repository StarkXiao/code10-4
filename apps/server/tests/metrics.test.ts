import { describe, expect, it } from 'vitest';
import {
  compareRepairRounds,
  costPerWear,
  daysBetween,
  frequencyBand,
  healthScore,
  recurrenceRate,
  repairChangeScore,
  repairComfortScore,
  repairDimensionScore,
  repairLifespan,
  repairTraceScore,
  serviceDays,
  summarizeLifespans,
  wearFrequencyPerMonth,
  weightedWearCount,
} from '@gml/shared';

describe('统计口径（项目文档 13.1 / 13.3）', () => {
  it('天数按自然日计算，不受时分秒影响', () => {
    expect(daysBetween('2026-01-01T23:30:00Z', '2026-01-02T00:10:00Z')).toBe(1);
    expect(daysBetween('2026-01-02', '2026-01-01')).toBe(0);
  });

  it('服役天数含当天', () => {
    expect(serviceDays('2026-01-01', new Date('2026-01-01T12:00:00Z'))).toBe(1);
    expect(serviceDays('2026-01-01', new Date('2026-01-31T12:00:00Z'))).toBe(31);
  });

  it('加权穿着次数按时长档加权', () => {
    expect(
      weightedWearCount([{ session: 'full_day' }, { session: 'half_day' }, { session: 'brief' }]),
    ).toBeCloseTo(1.9, 4);
  });

  it('月均频率 = 次数 ÷ 服役月数，且分档符合阈值', () => {
    // 25 天里穿了 8 次 → 约 9.7 次/月 → 高频
    const perMonth = wearFrequencyPerMonth(8, '2026-08-15', new Date('2026-09-09T00:00:00Z'));
    expect(perMonth).toBeGreaterThanOrEqual(8);
    expect(frequencyBand(perMonth)).toBe('high');
    expect(frequencyBand(4)).toBe('medium');
    expect(frequencyBand(1.5)).toBe('low');
    expect(frequencyBand(0.2)).toBe('occasional');
  });

  it('每穿成本 = (购入价 + 修补费 + 耗材 − 残值) ÷ 穿着次数', () => {
    expect(costPerWear({ purchasePrice: 480, repairCost: 5, materialCost: 0, wearCount: 8 })).toBeCloseTo(60.63, 2);
    expect(costPerWear({ purchasePrice: 100, wearCount: 0 })).toBeNull();
  });

  it('修补寿命：复发即为观测样本，未复发为右删失且不混算平均', () => {
    const observed = repairLifespan({ finishedAt: '2026-01-01', nextDamageDetectedAt: '2026-03-01' });
    expect(observed.days).toBe(59);
    expect(observed.censored).toBe(false);

    const censored = repairLifespan({ finishedAt: '2026-01-01', today: new Date('2026-02-01T00:00:00Z') });
    expect(censored.censored).toBe(true);
    expect(censored.days).toBe(31);

    const summary = summarizeLifespans([observed, censored, { ...observed, days: 100 }]);
    expect(summary.observedCount).toBe(2);
    expect(summary.censoredCount).toBe(1);
    // 只对非删失样本取平均：(59 + 100) / 2
    expect(summary.averageDays).toBe(79.5);
  });

  it('复修率 = 复发次数 ÷ 已修补事件数', () => {
    expect(recurrenceRate(1, 2)).toBe(0.5);
    expect(recurrenceRate(1, 0)).toBe(0);
  });

  it('健康分四个分项各占 25 分，且分档建议正确', () => {
    const fresh = healthScore({ openDamageCount: 0, repairCount: 0, serviceDays: 10, perMonth: 0.5 });
    expect(fresh.score).toBe(100 - 0 - 0 - 0 - Math.round(0.1 * 25));
    expect(fresh.factors).toHaveLength(4);

    const worn = healthScore({ openDamageCount: 3, repairCount: 5, serviceDays: 1825, perMonth: 10 });
    expect(worn.score).toBe(0);
    expect(worn.level).toBe('retire');

    const mid = healthScore({ openDamageCount: 1, repairCount: 1, serviceDays: 300, perMonth: 4 });
    expect(mid.score).toBeGreaterThan(40);
    expect(mid.score).toBeLessThan(85);
    expect(mid.factors.map((f) => f.key)).toEqual(['damage', 'repair', 'service', 'wear']);
  });
});

describe('修补后变化评分', () => {
  it('无痕修复接近满分：完全看不出 + 无色差 + 无尺寸变化 + 手感垂坠不变', () => {
    const score = repairChangeScore({
      visibility: 'invisible',
      colorMatch: 'perfect',
      dimensionChange: { lengthMm: 0, widthMm: 0 },
      stiffness: 'same',
      drapeChange: 'none',
    });
    // trace=100, dimension=100, comfort=(85+100)/2=92.5 → 加权 = 97
    expect(score.total).toBe(97);
    expect(score.level).toBe('seamless');
    expect(score.factors.map((f) => f.key)).toEqual(['trace', 'dimension', 'comfort']);
  });

  it('痕迹分 = 痕迹等级 + 颜色修正 + 外人可见修正', () => {
    expect(repairTraceScore({ visibility: 'invisible', colorMatch: 'perfect' })).toBe(100);
    expect(repairTraceScore({ visibility: 'slight', colorMatch: 'close' })).toBe(70);
    // 较明显 50 + 明显色差 -25 - 外人可见 10 = 15
    expect(
      repairTraceScore({ visibility: 'noticeable', colorMatch: 'mismatch', visibleFromOutside: true }),
    ).toBe(15);
    // 不会扣成负数
    expect(
      repairTraceScore({ visibility: 'obvious', colorMatch: 'mismatch', visibleFromOutside: true }),
    ).toBe(0);
  });

  it('尺寸分按最大绝对偏移线性折算，正负方向同等对待', () => {
    expect(repairDimensionScore({ lengthMm: 0, widthMm: 0 })).toBe(100);
    expect(repairDimensionScore({ lengthMm: 10, widthMm: -4 })).toBe(80);
    expect(repairDimensionScore({ lengthMm: -25, widthMm: 0 })).toBe(50);
    expect(repairDimensionScore({ lengthMm: 60, widthMm: 0 })).toBe(0);
  });

  it('尺寸未填时该分项为 null，权重重新归一化，不被当成满分', () => {
    const noDimension = repairChangeScore({
      visibility: 'invisible',
      colorMatch: 'perfect',
      stiffness: 'same',
      drapeChange: 'none',
    });
    expect(noDimension.factors.find((f) => f.key === 'dimension')?.score).toBeNull();
    // 分项先取整：comfort 92.5→93；只剩 trace=100 与 comfort=93 按 40:40 加权 → 97
    expect(noDimension.total).toBe(97);
  });

  it('体感分 = 手感与垂坠感等权平均，影响活动再扣 30', () => {
    expect(repairComfortScore({ stiffness: 'same', drapeChange: 'none' })).toBe(93);
    // (55 + 40)/2 - 30 = 17.5 → 18
    expect(
      repairComfortScore({ stiffness: 'stiffer', drapeChange: 'obvious', mobilityLimited: true }),
    ).toBe(18);
  });

  it('分档边界：85/70/50', () => {
    const build = (total: ReturnType<typeof repairChangeScore>) => total.level;
    // trace=80(slight+perfect), comfort=93 → 无尺寸时 (80+93)/2 = 86.5 → 87 seamless
    expect(
      build(repairChangeScore({ visibility: 'slight', colorMatch: 'perfect', stiffness: 'same', drapeChange: 'none' })),
    ).toBe('seamless');
    // 最差组合落在 poor
    expect(
      build(
        repairChangeScore({
          visibility: 'obvious',
          colorMatch: 'mismatch',
          dimensionChange: { lengthMm: 40, widthMm: 40 },
          stiffness: 'stiffer',
          drapeChange: 'obvious',
          mobilityLimited: true,
        }),
      ),
    ).toBe('poor');
  });

  it('未知枚举取值按最差档处理，绝不静默当满分', () => {
    const score = repairChangeScore({
      visibility: 'weird',
      colorMatch: 'weird',
      stiffness: 'weird',
      drapeChange: 'weird',
    });
    expect(score.factors.find((f) => f.key === 'trace')?.score).toBe(0);
    expect(score.factors.find((f) => f.key === 'comfort')?.score).toBe(0);
    expect(score.total).toBe(0);
  });

  it('多轮对比按轮次排序给出 delta，正值=比上一已评分轮次更接近原状', () => {
    const s = (total: number) =>
      ({ ...repairChangeScore({ visibility: 'invisible', colorMatch: 'perfect', stiffness: 'same', drapeChange: 'none' }), total });
    const diffs = compareRepairRounds([
      { round: 3, score: s(90) },
      { round: 1, score: s(70) },
      { round: 2, score: null },
    ]);
    expect(diffs.map((d) => d.round)).toEqual([1, 2, 3]);
    expect(diffs[0].delta).toBeNull();
    expect(diffs[1].total).toBeNull();
    expect(diffs[1].delta).toBeNull();
    // 第 3 轮跨过未评分的第 2 轮，与第 1 轮对比
    expect(diffs[2].delta).toBe(20);
  });
});
