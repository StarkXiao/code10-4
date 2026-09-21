/**
 * 指标口径（项目文档 13.1 / 13.3）。
 * 前后端共用这一份实现，避免"图表一套算法、接口另一套算法"。
 */
import {
  type WearFrequencyBand,
  type WearSession,
  WEAR_SESSION_WEIGHT,
  type Season,
  type Visibility,
  type ColorMatch,
  type Stiffness,
  type DrapeChange,
} from './enums.js';

export const MS_PER_DAY = 86_400_000;
export const DAYS_PER_MONTH = 30.44;

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function startOfDay(value: Date | string): Date {
  const d = toDate(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 两个日期之间的整天数（含边界修正，永不为负） */
export function daysBetween(from: Date | string, to: Date | string): number {
  const a = startOfDay(from).getTime();
  const b = startOfDay(to).getTime();
  return Math.max(0, Math.round((b - a) / MS_PER_DAY));
}

export function monthsBetween(from: Date | string, to: Date | string): number {
  const a = toDate(from);
  const b = toDate(to);
  const months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  const dayFraction = (b.getUTCDate() - a.getUTCDate()) / DAYS_PER_MONTH;
  return Math.max((months + dayFraction) / 1, 0);
}

/** 服役天数：首次穿着到今天的自然日跨度（含当天） */
export function serviceDays(firstWearDate: Date | string | null | undefined, today = new Date()): number {
  const start = firstWearDate ? firstWearDate : today;
  return daysBetween(start, today) + 1;
}

export function weightedWearCount(logs: Array<{ session: WearSession }>): number {
  return round2(logs.reduce((sum, log) => sum + (WEAR_SESSION_WEIGHT[log.session] ?? 0.7), 0));
}

/** 月均穿着频次 = 穿着次数 ÷ max(服役月数, 1) */
export function wearFrequencyPerMonth(
  wearCount: number,
  firstWearDate: Date | string | null | undefined,
  today = new Date(),
): number {
  const months = Math.max(monthsBetween(firstWearDate ? firstWearDate : today, today), 1);
  return round2(wearCount / months);
}

export function frequencyBand(perMonth: number): WearFrequencyBand {
  if (perMonth >= 8) return 'high';
  if (perMonth >= 3) return 'medium';
  if (perMonth >= 1) return 'low';
  return 'occasional';
}

export interface CostBreakdown {
  purchasePrice?: number | null;
  repairCost?: number | null;
  materialCost?: number | null;
  residualValue?: number | null;
  wearCount: number;
}

/** 每穿成本 = (购入价 + 修补费 + 耗材估值 − 残值) ÷ 穿着次数 */
export function costPerWear(input: CostBreakdown): number | null {
  if (!input.wearCount || input.wearCount <= 0) return null;
  const total =
    num(input.purchasePrice) + num(input.repairCost) + num(input.materialCost) - num(input.residualValue);
  return round2(Math.max(total, 0) / input.wearCount);
}

export function annualizedCost(costPerWearValue: number | null, perMonth: number): number | null {
  if (costPerWearValue === null) return null;
  return round2(costPerWearValue * perMonth * 12);
}

export interface LifespanInput {
  finishedAt: Date | string;
  /** 下一次同部位同类型破损的发现日期；null 表示尚未复发 */
  nextDamageDetectedAt?: Date | string | null;
  /** 该区间内的穿着次数（可选，用于"按穿着次数"口径） */
  wearsInRange?: number | null;
  today?: Date;
}

export interface LifespanResult {
  days: number;
  censored: boolean;
  wears: number | null;
}

/**
 * 修补寿命。未复发时为右删失，只能记为 "≥ N 天"，
 * 统计平均值时必须单独列示（项目文档 13.1）。
 */
export function repairLifespan(input: LifespanInput): LifespanResult {
  const today = input.today ?? new Date();
  const censored = !input.nextDamageDetectedAt;
  const end = input.nextDamageDetectedAt ?? today;
  return {
    days: daysBetween(input.finishedAt, end),
    censored,
    wears: input.wearsInRange ?? null,
  };
}

/** 复修率 = 复发次数 ÷ 已修补破损事件数 */
export function recurrenceRate(recurrenceCount: number, repairedEventCount: number): number {
  if (repairedEventCount <= 0) return 0;
  return round4(recurrenceCount / repairedEventCount);
}

export interface HealthScoreInput {
  openDamageCount: number;
  repairCount: number;
  serviceDays: number;
  perMonth: number;
}

export interface HealthScoreFactor {
  key: 'damage' | 'repair' | 'service' | 'wear';
  label: string;
  ratio: number;
  weight: number;
  penalty: number;
  detail: string;
}

export interface HealthScoreResult {
  score: number;
  level: 'good' | 'attention' | 'concern' | 'retire';
  advice: string;
  factors: HealthScoreFactor[];
}

const HEALTH_LEVELS: Array<{ min: number; level: HealthScoreResult['level']; advice: string }> = [
  { min: 85, level: 'good', advice: '状态良好，正常穿着，按季检查即可。' },
  { min: 65, level: 'attention', advice: '注意：对高频磨损部位做预防性加固（肘部/膝部/袖口贴衬）。' },
  { min: 40, level: 'concern', advice: '需要关注：优先修补，减少高强度穿着场景。' },
  { min: 0, level: 'retire', advice: '建议评估退役：考虑改抹布 / 捐赠 / 改制 / 回收。' },
];

/** 健康分 = 100 − Σ(分项权重 × 归一化分项值)，见项目文档 13.3 */
export function healthScore(input: HealthScoreInput): HealthScoreResult {
  const damageRatio = clamp01(input.openDamageCount / 3);
  const repairRatio = clamp01(input.repairCount / 5);
  const serviceRatio = clamp01(input.serviceDays / 1825);
  const wearRatio = wearIntensityRatio(input.perMonth);

  const factors: HealthScoreFactor[] = [
    {
      key: 'damage',
      label: '破损密度',
      ratio: round4(damageRatio),
      weight: 25,
      penalty: round2(damageRatio * 25),
      detail: `未终结破损 ${input.openDamageCount} 个（满分阈值 3 个）`,
    },
    {
      key: 'repair',
      label: '修补密度',
      ratio: round4(repairRatio),
      weight: 25,
      penalty: round2(repairRatio * 25),
      detail: `累计修补 ${input.repairCount} 次（满分阈值 5 次）`,
    },
    {
      key: 'service',
      label: '服役时长',
      ratio: round4(serviceRatio),
      weight: 25,
      penalty: round2(serviceRatio * 25),
      detail: `已服役 ${input.serviceDays} 天（满分阈值 1825 天）`,
    },
    {
      key: 'wear',
      label: '穿着强度',
      ratio: round4(wearRatio),
      weight: 25,
      penalty: round2(wearRatio * 25),
      detail: `月均穿着 ${input.perMonth} 次`,
    },
  ];

  const score = Math.max(0, Math.min(100, Math.round(100 - factors.reduce((s, f) => s + f.penalty, 0))));
  const level = HEALTH_LEVELS.find((l) => score >= l.min)!;
  return { score, level: level.level, advice: level.advice, factors };
}

function wearIntensityRatio(perMonth: number): number {
  if (perMonth >= 8) return 1;
  if (perMonth >= 3) return 0.6;
  if (perMonth >= 1) return 0.3;
  return 0.1;
}

/** 由月份推断季节（北半球），用于穿着记录的 season_snapshot */
export function seasonOfMonth(month1to12: number): Season {
  if (month1to12 >= 3 && month1to12 <= 5) return 'spring';
  if (month1to12 >= 6 && month1to12 <= 8) return 'summer';
  if (month1to12 >= 9 && month1to12 <= 11) return 'autumn';
  return 'winter';
}

export function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 内部使用：对外统一由 geometry.ts 导出 clamp01，避免 index 重复导出 */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** 加权平均（按权重列，权重全为 0 时退化为算术平均） */
export function weightedAverage(items: Array<{ value: number; weight: number }>): number | null {
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  if (items.length === 0) return null;
  if (totalWeight <= 0) {
    return round2(items.reduce((s, i) => s + i.value, 0) / items.length);
  }
  return round2(items.reduce((s, i) => s + i.value * i.weight, 0) / totalWeight);
}

/**
 * 右删失样本的聚合：只对非删失样本取平均，
 * 并把删失样本单独报出来（禁止混算）。
 */
export function summarizeLifespans(samples: LifespanResult[]): {
  averageDays: number | null;
  censoredCount: number;
  observedCount: number;
  minObservedDays: number | null;
} {
  const observed = samples.filter((s) => !s.censored);
  const averageDays = observed.length
    ? round2(observed.reduce((sum, s) => sum + s.days, 0) / observed.length)
    : null;
  return {
    averageDays,
    censoredCount: samples.length - observed.length,
    observedCount: observed.length,
    minObservedDays: observed.length ? Math.min(...observed.map((s) => s.days)) : null,
  };
}

// ----------------------------------------------------------------
// 修补后变化评分（项目文档 13.1 的延伸口径：把主观记录折算成可比分值）
//
// 三个分项均为 0–100，越高代表越接近修补前原状；总分按权重加权，
// 尺寸未填时该分项不参与，权重重新归一化（避免"没量尺寸"被当成满分）。

/** 痕迹分基础值：外观痕迹等级 */
const VISIBILITY_SCORE: Record<Visibility, number> = {
  invisible: 100,
  slight: 80,
  noticeable: 50,
  obvious: 20,
};

/** 颜色匹配修正：只减不加，色差是痕迹的一部分 */
const COLOR_MATCH_MODIFIER: Record<ColorMatch, number> = {
  perfect: 0,
  close: -10,
  mismatch: -25,
};

/** 手感基础值：轻微变软通常无感，变硬才会硌 */
const STIFFNESS_SCORE: Record<Stiffness, number> = {
  softer: 100,
  same: 85,
  stiffer: 55,
};

/** 垂坠感变化基础值 */
const DRAPE_SCORE: Record<DrapeChange, number> = {
  none: 100,
  slight: 75,
  obvious: 40,
};

/** 影响活动（举手/弯腰受限）对体感分的额外扣减 */
const MOBILITY_LIMITED_PENALTY = 30;
/** 修补痕迹外人一眼看得出对痕迹分的额外扣减 */
const VISIBLE_OUTSIDE_PENALTY = 10;

/** 尺寸每偏移 1mm 扣 2 分：0mm=100，10mm=80，25mm=50，≥50mm=0 */
const DIMENSION_POINTS_PER_MM = 2;

/** 分项权重：痕迹与体感各 40，尺寸 20（未填时归零重算） */
export const REPAIR_CHANGE_FACTOR_WEIGHT = {
  trace: 40,
  dimension: 20,
  comfort: 40,
} as const;

export type RepairChangeScoreLevel = 'seamless' | 'acceptable' | 'degraded' | 'poor';

export const REPAIR_CHANGE_LEVEL_LABEL: Record<RepairChangeScoreLevel, string> = {
  seamless: '几乎无感',
  acceptable: '可接受',
  degraded: '明显折损',
  poor: '难以接受',
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

export interface RepairChangeScoreFactor {
  key: 'trace' | 'dimension' | 'comfort';
  label: string;
  /** 0–100；尺寸未填时为 null，不参与加权 */
  score: number | null;
  weight: number;
  detail: string;
}

export interface RepairChangeScore {
  total: number;
  level: RepairChangeScoreLevel;
  levelLabel: string;
  factors: RepairChangeScoreFactor[];
}

function repairChangeLevel(score: number): RepairChangeScoreLevel {
  if (score >= 85) return 'seamless';
  if (score >= 70) return 'acceptable';
  if (score >= 50) return 'degraded';
  return 'poor';
}

/** 痕迹分：痕迹等级 + 颜色匹配修正 + 外人可见修正，夹到 0–100 */
export function repairTraceScore(
  input: Pick<RepairChangeScoreInput, 'visibility' | 'colorMatch' | 'visibleFromOutside'>,
): number {
  const base = VISIBILITY_SCORE[input.visibility as Visibility] ?? 0;
  const color = COLOR_MATCH_MODIFIER[input.colorMatch as ColorMatch] ?? COLOR_MATCH_MODIFIER.mismatch;
  const outside = input.visibleFromOutside ? VISIBLE_OUTSIDE_PENALTY : 0;
  return clampScore(base + color - outside);
}

/**
 * 尺寸分：取长/宽两个方向上最大绝对偏移线性折算。
 * 偏移不分正负（缩小与放大多半一样不舒服）；未填尺寸返回 null。
 */
export function repairDimensionScore(
  dimensionChange: { lengthMm: number; widthMm: number } | null | undefined,
): number | null {
  if (!dimensionChange) return null;
  const lengthMm = Number.isFinite(dimensionChange.lengthMm) ? dimensionChange.lengthMm : 0;
  const widthMm = Number.isFinite(dimensionChange.widthMm) ? dimensionChange.widthMm : 0;
  const maxOffset = Math.max(Math.abs(lengthMm), Math.abs(widthMm));
  return clampScore(100 - maxOffset * DIMENSION_POINTS_PER_MM);
}

/** 体感分：手感与垂坠感等权平均，影响活动再扣分 */
export function repairComfortScore(
  input: Pick<RepairChangeScoreInput, 'stiffness' | 'drapeChange' | 'mobilityLimited'>,
): number {
  const stiffness = STIFFNESS_SCORE[input.stiffness as Stiffness] ?? 0;
  const drape = DRAPE_SCORE[input.drapeChange as DrapeChange] ?? 0;
  const mobility = input.mobilityLimited ? MOBILITY_LIMITED_PENALTY : 0;
  return clampScore((stiffness + drape) / 2 - mobility);
}

/**
 * 修补后变化评分。输入字段用宽松类型（兼容接口返回的 string），
 * 但枚举口径仍以 enums.ts 为唯一真相：未知取值按最差档处理，绝不静默当满分。
 */
export function repairChangeScore(input: RepairChangeScoreInput): RepairChangeScore {
  const trace = repairTraceScore(input);
  const dimension = repairDimensionScore(input.dimensionChange ?? null);
  const comfort = repairComfortScore(input);

  const maxOffset =
    input.dimensionChange
      ? Math.max(Math.abs(input.dimensionChange.lengthMm || 0), Math.abs(input.dimensionChange.widthMm || 0))
      : null;

  const factors: RepairChangeScoreFactor[] = [
    {
      key: 'trace',
      label: '痕迹',
      score: trace,
      weight: REPAIR_CHANGE_FACTOR_WEIGHT.trace,
      detail: input.visibleFromOutside ? '痕迹等级 + 颜色匹配 − 外人可见' : '痕迹等级 + 颜色匹配',
    },
    {
      key: 'dimension',
      label: '尺寸',
      score: dimension,
      weight: REPAIR_CHANGE_FACTOR_WEIGHT.dimension,
      detail: maxOffset === null ? '未量尺寸，不计入' : `最大偏移 ${round2(maxOffset)} mm（每 mm 扣 ${DIMENSION_POINTS_PER_MM} 分）`,
    },
    {
      key: 'comfort',
      label: '体感',
      score: comfort,
      weight: REPAIR_CHANGE_FACTOR_WEIGHT.comfort,
      detail: input.mobilityLimited ? '手感 + 垂坠感 − 影响活动' : '手感 + 垂坠感',
    },
  ];

  const total =
    weightedAverage(
      factors
        .filter((f) => f.score !== null)
        .map((f) => ({ value: f.score as number, weight: f.weight })),
    ) ?? 0;
  const score = Math.round(total);
  const level = repairChangeLevel(score);
  return { total: score, level, levelLabel: REPAIR_CHANGE_LEVEL_LABEL[level], factors };
}

export interface RepairRoundInput {
  round: number;
  /** 未填写「修补后变化」时为 null，该轮不评分且不切断对比链 */
  score: RepairChangeScore | null;
}

export interface ComparedRepairRound {
  round: number;
  total: number | null;
  level: RepairChangeScoreLevel | null;
  levelLabel: string | null;
  factors: RepairChangeScoreFactor[];
  /** 相对上一**已评分**轮次的总分差；正值=比上次更接近原状 */
  delta: number | null;
}

/**
 * 多轮修补对比：按轮次升序，补上每轮总分相对上一轮的差值。
 * 未评分轮次（变化未填）给 null 且不切断对比链——下一条已评分轮次
 * 仍与最近的已评分轮次比较，否则"第 2 轮忘填"会让第 3 轮失去参照。
 */
export function compareRepairRounds<T extends RepairRoundInput>(rounds: readonly T[]): Array<T & ComparedRepairRound> {
  const sorted = [...rounds].sort((a, b) => a.round - b.round);
  let lastScored: { total: number } | null = null;
  return sorted.map((row) => {
    const delta = row.score && lastScored ? row.score.total - lastScored.total : null;
    const extra: ComparedRepairRound = {
      round: row.round,
      total: row.score?.total ?? null,
      level: row.score?.level ?? null,
      levelLabel: row.score?.levelLabel ?? null,
      factors: row.score?.factors ?? [],
      delta,
    };
    if (row.score) lastScored = { total: row.score.total };
    return { ...row, ...extra };
  });
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(100, Math.max(0, n)));
}
