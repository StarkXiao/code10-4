<script setup lang="ts">
import { computed } from 'vue';
import { compareRepairRounds, repairChangeScore, VERDICT_LABEL, type Verdict } from '@gml/shared';
import type { RepairRow } from '../types';

/**
 * 多轮修补差异对比（衣物档案页）。
 * 只有 ≥2 轮填了「修补后变化」才有可比性；未填的轮次照常列出但不参与评分链。
 */
const props = defineProps<{ repairs: RepairRow[] }>();

const emit = defineEmits<{ (e: 'open', repairId: string): void }>();

const repairByRound = computed(() => new Map(props.repairs.map((r) => [r.round, r])));

const compared = computed(() =>
  compareRepairRounds(
    props.repairs.map((r) => ({
      round: r.round,
      score: r.change ? repairChangeScore(r.change) : null,
    })),
  ),
);

const scoredCount = computed(() => compared.value.filter((r) => r.total !== null).length);
const visible = computed(() => scoredCount.value >= 2);

function factorOf(round: number, key: 'trace' | 'dimension' | 'comfort'): number | null {
  const row = compared.value.find((r) => r.round === round);
  return row?.factors.find((f) => f.key === key)?.score ?? null;
}

function lastVerdict(round: number): string | null {
  const repair = repairByRound.value.get(round);
  const review = repair?.reviews.at(-1);
  return review ? VERDICT_LABEL[review.verdict as Verdict] : null;
}

function deltaClass(delta: number | null): string {
  if (delta === null) return '';
  if (delta > 0) return 'delta-up';
  if (delta < 0) return 'delta-down';
  return 'delta-flat';
}

const barColor = (value: number | null): string => {
  if (value === null) return '#c0c4cc';
  if (value >= 85) return '#67c23a';
  if (value >= 70) return '#e6a23c';
  return '#f56c6c';
};
</script>

<template>
  <div v-if="visible" class="rounds-compare">
    <div class="muted compare-hint">
      多轮修补量化对比：分值越高越接近修补前原状；
      <span class="delta-up">▲</span> 表示比上一已评分轮次改善，<span class="delta-down">▼</span> 表示退步（跳过未填变化的轮次）。
    </div>
    <table class="compare-table">
      <thead>
        <tr>
          <th>轮次</th>
          <th>针法 / 日期</th>
          <th class="num-col">变化总分</th>
          <th class="num-col">痕迹</th>
          <th class="num-col">尺寸</th>
          <th class="num-col">体感</th>
          <th>复检</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in compared" :key="row.round">
          <td><strong>第 {{ row.round }} 轮</strong></td>
          <td>
            <a class="link" @click="emit('open', repairByRound.get(row.round)!.id)">
              {{ repairByRound.get(row.round)!.stitch.name }}
            </a>
            <div class="muted" style="font-size: 12px">{{ repairByRound.get(row.round)!.finishedAt.slice(0, 10) }}</div>
          </td>
          <td class="num-col">
            <template v-if="row.total !== null">
              <span class="score-num" :style="{ color: barColor(row.total) }">{{ row.total }}</span>
              <span v-if="row.delta !== null" class="delta" :class="deltaClass(row.delta)">
                {{ row.delta > 0 ? `▲${row.delta}` : row.delta < 0 ? `▼${Math.abs(row.delta)}` : '＝' }}
              </span>
            </template>
            <span v-else class="muted">—</span>
          </td>
          <td v-for="key in (['trace', 'dimension', 'comfort'] as const)" :key="key" class="num-col">
            <template v-if="factorOf(row.round, key) !== null">
              <div class="mini-bar">
                <div
                  class="mini-bar-fill"
                  :style="{ width: `${factorOf(row.round, key)}%`, background: barColor(factorOf(row.round, key)) }"
                />
              </div>
              <span class="mini-bar-num">{{ factorOf(row.round, key) }}</span>
            </template>
            <span v-else class="muted">—</span>
          </td>
          <td>
            <span v-if="lastVerdict(row.round)" class="muted" style="font-size: 12px">{{ lastVerdict(row.round) }}</span>
            <span v-else class="muted">—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.rounds-compare {
  margin-top: 10px;
  padding: 10px 12px;
  background: #f7f9fc;
  border-radius: 6px;
}
.compare-hint {
  font-size: 12px;
  margin-bottom: 8px;
}
.compare-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.compare-table th,
.compare-table td {
  padding: 6px 8px;
  text-align: left;
  vertical-align: middle;
}
.compare-table th {
  color: #909399;
  font-weight: 500;
  border-bottom: 1px solid #e4e7ed;
}
.num-col {
  width: 110px;
  white-space: nowrap;
}
.score-num {
  font-weight: 700;
  font-size: 15px;
}
.delta {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 600;
}
.delta-up {
  color: #67c23a;
}
.delta-down {
  color: #f56c6c;
}
.delta-flat {
  color: #909399;
}
.mini-bar {
  display: inline-block;
  width: 56px;
  height: 6px;
  background: #e4e7ed;
  border-radius: 3px;
  overflow: hidden;
  vertical-align: middle;
}
.mini-bar-fill {
  height: 100%;
  border-radius: 3px;
}
.mini-bar-num {
  margin-left: 4px;
  font-size: 12px;
  color: #606266;
}
.link {
  color: var(--el-color-primary);
  cursor: pointer;
}
</style>
