<script setup lang="ts">
import { computed } from 'vue';
import {
  compareRepairRounds,
  REPAIR_SCORE_LEVEL_LABEL,
  type RepairRoundScore,
  type RepairRoundScoreInput,
} from '@gml/shared';

const props = defineProps<{
  repairs: RepairRoundScoreInput[];
  /** 表格风格（档案页内嵌）或卡片风格（详情页） */
  variant?: 'table' | 'card';
}>();

const emit = defineEmits<{ (event: 'open', repairId: string): void }>();

const comparison = computed(() => compareRepairRounds(props.repairs));

function levelLabel(row: RepairRoundScore): string {
  return row.level ? REPAIR_SCORE_LEVEL_LABEL[row.level] : '';
}

function deltaText(value: number | null | undefined): { text: string; cls: string } {
  if (value === null || value === undefined) return { text: '—', cls: 'muted' };
  if (value === 0) return { text: '持平', cls: 'delta-flat' };
  return {
    text: `${value > 0 ? '+' : ''}${value}`,
    cls: value > 0 ? 'delta-up' : 'delta-down',
  };
}

/** 偏移量是物理量，正=变大（变差），与分值方向相反 */
function offsetDeltaText(value: number | null | undefined): { text: string; cls: string } {
  if (value === null || value === undefined) return { text: '—', cls: 'muted' };
  if (value === 0) return { text: '持平', cls: 'delta-flat' };
  return {
    text: `${value > 0 ? '+' : ''}${value} mm`,
    cls: value < 0 ? 'delta-up' : 'delta-down',
  };
}
</script>

<template>
  <div v-if="comparison.scoredCount > 0" class="repair-round-compare">
    <div v-if="comparison.scoredCount >= 2 && comparison.bestImprovement" class="repair-round-summary">
      <el-tag type="success" size="small">
        第 {{ comparison.bestImprovement.round }} 轮返工效果最明显：总分提升 +{{ comparison.bestImprovement.scoreDelta }}
      </el-tag>
    </div>
    <div v-else-if="comparison.scoredCount >= 2" class="repair-round-summary muted">
      后续轮次未带来总分提升，可考虑换针法或换执行方。
    </div>

    <el-table :data="comparison.rounds" size="small" :border="variant === 'card'">
      <el-table-column label="轮次" width="64">
        <template #default="{ row }">第 {{ row.round }} 轮</template>
      </el-table-column>
      <el-table-column label="针法" min-width="110">
        <template #default="{ row }">{{ row.stitch ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="总分" width="150">
        <template #default="{ $index, row }">
          <div v-if="row.score === null" class="muted">未填变化</div>
          <div v-else class="round-score-cell">
            <strong :class="`score-level-${row.level}`">{{ row.score }}</strong>
            <span class="muted" style="font-size: 11px">{{ levelLabel(row) }}</span>
            <span v-if="$index > 0" :class="deltaText(comparison.deltas[$index]?.score).cls" class="round-delta">
              {{ deltaText(comparison.deltas[$index]?.score).text }}
            </span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="痕迹" width="110">
        <template #default="{ $index, row }">
          <span v-if="row.traceScore === null" class="muted">—</span>
          <span v-else>
            {{ row.traceScore }}
            <span :class="deltaText(comparison.deltas[$index]?.traceScore).cls" class="round-delta">
              {{ deltaText(comparison.deltas[$index]?.traceScore).text }}
            </span>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="尺寸" width="120">
        <template #default="{ $index, row }">
          <span v-if="row.fitScore === null" class="muted">未填</span>
          <span v-else>
            {{ row.fitScore }}
            <span :class="deltaText(comparison.deltas[$index]?.fitScore).cls" class="round-delta">
              {{ deltaText(comparison.deltas[$index]?.fitScore).text }}
            </span>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="体感" width="110">
        <template #default="{ $index, row }">
          <span v-if="row.comfortScore === null" class="muted">—</span>
          <span v-else>
            {{ row.comfortScore }}
            <span :class="deltaText(comparison.deltas[$index]?.comfortScore).cls" class="round-delta">
              {{ deltaText(comparison.deltas[$index]?.comfortScore).text }}
            </span>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="最大偏移" width="120">
        <template #default="{ $index, row }">
          <span v-if="row.maxOffsetMm === null" class="muted">—</span>
          <span v-else>
            {{ row.maxOffsetMm }} mm
            <span :class="offsetDeltaText(comparison.deltas[$index]?.maxOffsetMm).cls" class="round-delta">
              {{ offsetDeltaText(comparison.deltas[$index]?.maxOffsetMm).text }}
            </span>
          </span>
        </template>
      </el-table-column>
      <el-table-column v-if="variant === 'card'" label="" width="70">
        <template #default="{ row }">
          <el-button
            v-if="row.repairId"
            link
            type="primary"
            size="small"
            @click="emit('open', row.repairId)"
          >
            查看
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.repair-round-compare {
  width: 100%;
}
.repair-round-summary {
  margin-bottom: 8px;
  font-size: 12px;
}
.round-score-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}
.round-delta {
  font-size: 11px;
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
  font-size: 11px;
}
.score-level-excellent {
  color: #67c23a;
}
.score-level-good {
  color: #409eff;
}
.score-level-fair {
  color: #e6a23c;
}
.score-level-poor {
  color: #f56c6c;
}
</style>
