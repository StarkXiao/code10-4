/**
 * 修补后变化的量化口径。
 *
 * 「修补后变化」原本只有枚举与文字（痕迹等级、颜色、手感、尺寸偏移、体感备注），
 * 无法回答两个问题：
 *   1. 这次修补到底好不好、好多少？——折算成 0–100 的「修补效果分」；
 *   2. 返工之后比上一轮强了还是更差了？——按轮次做差分。
 *
 * 与 metrics.ts 一样，前后端共用这一份实现，
 * 避免「档案页显示一个分、导出的档案里又是另一个分」。
 */
import {
  COLOR_MATCH_LABEL,
  DRAPE_CHANGE_LABEL,
  STIFFNESS_LABEL,
  VISIBILITY_LABEL,
  type ColorMatch,
  type DrapeChange,
  type Stiffness,
  type Visibility,
} from './enums.js';

/** 痕迹等级（visibility）→ 基础分：越看不出越高 */
const VISIBILITY_SCORE: Record<Visibility, number> = {
  invisible: 100,
  slight: 80,
  noticeable: 45,
  obvious: 10,
};

/** 颜色匹配 → 基础分 */
const COLOR_SCORE: Record<ColorMatch, number> = {
  perfect: 100,
  close: 75,
  mismatch: 25,
};

/** 手感 → 基础分（更硬是负面的；更软多数情况下可接受，但不算完全无变化） */
const STIFFNESS_SCORE: Record<Stiffness, number> = {
  same: 100,
  softer: 85,
  stiffer: 40,
};

/** 垂坠感变化 → 基础分 */
const DRAPE_SCORE: Record<DrapeChange, number> = {
  none: 100,
  slight: 70,
  obvious: 30,
};

/** 尺寸偏移分档（毫米，取长/宽两个方向上偏移绝对值的较大者） */
const FIT_BANDS: ReadonlyArray<{ maxAbsMm: number; score: number; label: string }> = [
  { maxAbsMm: 2, score: 100, label: '几乎无偏移' },
  { maxAbsMm: 5, score: 85, label: '轻微偏移' },
  { maxAbsMm: 10, score: 65, label: '可察觉偏移' },
  { maxAbsMm: 20, score: 40, label: '明显偏移' },
  { maxAbsMm: Number.POSITIVE_INFINITY, score: 15, label: '严重偏移' },
];

/** 「外人看得出」额外扣分（痕迹维度内部惩罚，封顶不低于 0） */
const VISIBLE_OUTSIDE_PENALTY = 10;
/** 「影响活动」额外扣分（体感维度内部惩罚） */
const MOBILITY_PENALTY = 20;

/** 总分权重：痕迹 40%、尺寸 30%、体感 30%（尺寸未填时在已有维度间归一化） */
export const REPAIR_SCORE_WEIGHTS = { trace: 0.4, fit: 0.3, comfort: 0.3 } as const;

export type RepairScoreLevel = 'excellent' | 'good' | 'fair' | 'poor';

export const REPAIR_SCORE_LEVEL_LABEL: Record<RepairScoreLevel, string> = {
  excellent: '优秀',
  good: '良好',
  fair: '一般',
  poor: '较差',
};

export const REPAIR_SCORE_LEVEL_ADVICE: Record<RepairScoreLevel, string> = {
  excellent: '几乎无痕、尺寸手感都没变化，这种针法/用料组合值得下次复用。',
  good: '略有痕迹但不影响穿着，属于可接受的修补。',
  fair: '有可察觉的变化，建议下次调整针法或换更匹配的补丁布。',
  poor: '痕迹、尺寸或体感代价较大；若复发，优先换针法/换执行方再修。',
};

export interface RepairChangeScoreInput {
  visibility: Visibility | string;
  colorMatch: ColorMatch | string;
  dimensionChange?: { lengthMm: number; widthMm: number } | null;
  stiffness: Stiffness | string;
  drapeChange: DrapeChange | string;
  mobilityLimited?: boolean;
  visibleFromOutside?: boolean;
}

export interface RepairScoreFactor {
  key: 'trace' | 'fit' | 'comfort';
  label: string;
  /** 维度得分（0–100；尺寸未填时 fit 为 null，且不参与总分） */
  score: number | null;
  weight: number;
  detail: string;
}

export interface RepairChangeScore {
  score: number;
  level: RepairScoreLevel;
  advice: string;
  factors: RepairScoreFactor[];
  /** 三维度原始分，便于逐维度做轮次差分 */
  traceScore: number;
  fitScore: number | null;
  comfortScore: number;
  /** 尺寸偏移的绝对量（毫米，取两方向较大者）；未填尺寸为 null */
  maxOffsetMm: number | null;
}

export function repairScoreLevel(score: number): RepairScoreLevel {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

/** 尺寸偏移（mm，取长/宽两个方向绝对偏移的较大者） */
export function dimensionOffsetMm(dimensionChange?: { lengthMm: number; widthMm: number } | null): number | null {
  if (!dimensionChange) return null;
  const length = Math.abs(Number(dimensionChange.lengthMm) || 0);
  const width = Math.abs(Number(dimensionChange.widthMm) || 0);
  return Math.max(length, width);
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 把一次「修补后变化」折算成 0–100 的修补效果分。
 *
 * - 痕迹分：痕迹等级 70% + 颜色匹配 30%，「外人看得出」再扣 10；
 * - 尺寸分：按长/宽最大偏移量分档（未填尺寸则该维度不参与总分）；
 * - 体感分：手感 50% + 垂坠感 50%，「影响活动」再扣 20。
 */
export function scoreRepairChange(change: RepairChangeScoreInput): RepairChangeScore {
  const visibility = (change.visibility as Visibility) ?? 'obvious';
  const colorMatch = (change.colorMatch as ColorMatch) ?? 'mismatch';
  const stiffness = (change.stiffness as Stiffness) ?? 'stiffer';
  const drapeChange = (change.drapeChange as DrapeChange) ?? 'obvious';

  const traceBase =
    (VISIBILITY_SCORE[visibility] ?? 0) * 0.7 + (COLOR_SCORE[colorMatch] ?? 0) * 0.3;
  const traceScore = clampScore(traceBase - (change.visibleFromOutside ? VISIBLE_OUTSIDE_PENALTY : 0));

  const maxOffsetMm = dimensionOffsetMm(change.dimensionChange);
  const fitScore = maxOffsetMm === null ? null : clampScore(fitBand(maxOffsetMm).score);

  const comfortBase =
    (STIFFNESS_SCORE[stiffness] ?? 0) * 0.5 + (DRAPE_SCORE[drapeChange] ?? 0) * 0.5;
  const comfortScore = clampScore(comfortBase - (change.mobilityLimited ? MOBILITY_PENALTY : 0));

  // 尺寸未登记时，把 30% 权重按 4:3 归一到痕迹/体感上，而不是白送 30 分
  const weights =
    fitScore === null
      ? { trace: REPAIR_SCORE_WEIGHTS.trace / 0.7, fit: 0, comfort: REPAIR_SCORE_WEIGHTS.comfort / 0.7 }
      : REPAIR_SCORE_WEIGHTS;
  const score = clampScore(
    traceScore * weights.trace + (fitScore ?? 0) * weights.fit + comfortScore * weights.comfort,
  );

  const factors: RepairScoreFactor[] = [
    {
      key: 'trace',
      label: '痕迹',
      score: traceScore,
      weight: weights.trace,
      detail: `痕迹 ${VISIBILITY_LABEL[visibility] ?? visibility}（${VISIBILITY_SCORE[visibility] ?? 0}）×70% + 颜色 ${
        COLOR_MATCH_LABEL[colorMatch] ?? colorMatch
      }（${COLOR_SCORE[colorMatch] ?? 0}）×30%${change.visibleFromOutside ? ` − 外人看得出 ${VISIBLE_OUTSIDE_PENALTY}` : ''}`,
    },
    {
      key: 'fit',
      label: '尺寸',
      score: fitScore,
      weight: weights.fit,
      detail:
        maxOffsetMm === null
          ? '未登记尺寸偏移，该维度不参与总分'
          : `最大偏移 ${maxOffsetMm} mm（${fitBand(maxOffsetMm).label}），长 ${change.dimensionChange?.lengthMm ?? 0} × 宽 ${
              change.dimensionChange?.widthMm ?? 0
            } mm`,
    },
    {
      key: 'comfort',
      label: '体感',
      score: comfortScore,
      weight: weights.comfort,
      detail: `手感 ${STIFFNESS_LABEL[stiffness] ?? stiffness}（${STIFFNESS_SCORE[stiffness] ?? 0}）×50% + 垂坠 ${
        DRAPE_CHANGE_LABEL[drapeChange] ?? drapeChange
      }（${DRAPE_SCORE[drapeChange] ?? 0}）×50%${change.mobilityLimited ? ` − 影响活动 ${MOBILITY_PENALTY}` : ''}`,
    },
  ];

  const level = repairScoreLevel(score);
  return {
    score,
    level,
    advice: REPAIR_SCORE_LEVEL_ADVICE[level],
    factors,
    traceScore,
    fitScore,
    comfortScore,
    maxOffsetMm,
  };
}

function fitBand(maxAbsMm: number): { score: number; label: string } {
  return FIT_BANDS.find((band) => maxAbsMm <= band.maxAbsMm) ?? FIT_BANDS[FIT_BANDS.length - 1];
}

export interface RepairRoundScoreInput {
  repairId?: string;
  round: number;
  stitch?: string | null;
  finishedAt?: Date | string | null;
  status?: string | null;
  change: RepairChangeScoreInput | null | undefined;
}

export interface RepairRoundScore {
  repairId?: string;
  round: number;
  stitch: string | null;
  finishedAt: string | null;
  status: string | null;
  /** 该轮总分；变化未填写时为 null */
  score: number | null;
  level: RepairScoreLevel | null;
  traceScore: number | null;
  fitScore: number | null;
  comfortScore: number | null;
  maxOffsetMm: number | null;
}

export interface RepairRoundDelta {
  score: number | null;
  traceScore: number | null;
  fitScore: number | null;
  comfortScore: number | null;
  maxOffsetMm: number | null;
}

export interface RepairRoundComparison {
  rounds: RepairRoundScore[];
  /** 与上一轮（round − 1）的差分；正数表示变好（尺寸偏移为物理量，正数表示偏移增大） */
  deltas: Array<RepairRoundDelta | null>;
  /** 有分值的轮次数（变化已填写） */
  scoredCount: number;
  /** 分差最大的一轮（返工效果最显著）；不足两轮有分时为 null */
  bestImprovement: { round: number; scoreDelta: number } | null;
}

/**
 * 多轮修补对比：按轮次排序、逐轮打分，并给出与上一轮的差分。
 * 差分约定：各分值正数=变好；maxOffsetMm 是物理偏移量，正数=偏移变大（变差）。
 */
export function compareRepairRounds(rounds: RepairRoundScoreInput[]): RepairRoundComparison {
  const sorted = [...rounds].sort((a, b) => a.round - b.round);
  const scored: RepairRoundScore[] = sorted.map((r) => {
    const s = r.change ? scoreRepairChange(r.change) : null;
    return {
      repairId: r.repairId,
      round: r.round,
      stitch: r.stitch ?? null,
      finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
      status: r.status ?? null,
      score: s?.score ?? null,
      level: s?.level ?? null,
      traceScore: s?.traceScore ?? null,
      fitScore: s?.fitScore ?? null,
      comfortScore: s?.comfortScore ?? null,
      maxOffsetMm: s?.maxOffsetMm ?? null,
    };
  });

  let prev: RepairRoundScore | null = null;
  const deltas: Array<RepairRoundDelta | null> = [];
  for (const current of scored) {
    if (!prev || prev.score === null || current.score === null) {
      deltas.push(null);
    } else {
      deltas.push({
        score: diff(current.score, prev.score),
        traceScore: diff(current.traceScore, prev.traceScore),
        fitScore: diff(current.fitScore, prev.fitScore),
        comfortScore: diff(current.comfortScore, prev.comfortScore),
        // 偏移量差分保持「物理量」语义：后 − 前，正值表示偏移更大
        maxOffsetMm: diff(current.maxOffsetMm, prev.maxOffsetMm),
      });
    }
    prev = current;
  }

  let bestImprovement: { round: number; scoreDelta: number } | null = null;
  for (let i = 0; i < scored.length; i += 1) {
    const scoreDelta = deltas[i]?.score;
    if (scoreDelta === null || scoreDelta === undefined) continue;
    if (!bestImprovement || scoreDelta > bestImprovement.scoreDelta) {
      bestImprovement = { round: scored[i].round, scoreDelta };
    }
  }
  // 全部是退步或持平时不报「最佳改进」
  if (bestImprovement && bestImprovement.scoreDelta <= 0) bestImprovement = null;

  return {
    rounds: scored,
    deltas,
    scoredCount: scored.filter((r) => r.score !== null).length,
    bestImprovement,
  };
}

function diff(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 10) / 10;
}
