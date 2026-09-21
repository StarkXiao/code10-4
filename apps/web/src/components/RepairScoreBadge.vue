<script setup lang="ts">
import { computed } from 'vue';
import {
  REPAIR_SCORE_LEVEL_LABEL,
  scoreRepairChange,
  type RepairChangeScore,
  type RepairChangeScoreInput,
} from '@gml/shared';

const props = defineProps<{
  change: RepairChangeScoreInput | null | undefined;
  /** 显示模式：badge 紧凑标签；card 分项卡片；mini 仅数字 */
  mode?: 'badge' | 'card' | 'mini';
}>();

const result = computed<RepairChangeScore | null>(() =>
  props.change ? scoreRepairChange(props.change) : null,
);

const tagType = computed<'success' | 'primary' | 'warning' | 'danger' | 'info'>(() => {
  switch (result.value?.level) {
    case 'excellent':
      return 'success';
    case 'good':
      return 'primary';
    case 'fair':
      return 'warning';
    case 'poor':
      return 'danger';
    default:
      return 'info';
  }
});

const scoreColor = computed(() => {
  switch (result.value?.level) {
    case 'excellent':
      return '#67c23a';
    case 'good':
      return '#409eff';
    case 'fair':
      return '#e6a23c';
    case 'poor':
      return '#f56c6c';
    default:
      return '#909399';
  }
});

function levelLabel(): string {
  return result.value ? REPAIR_SCORE_LEVEL_LABEL[result.value.level] : '';
}
</script>

<template>
  <span v-if="!result" class="repair-score-empty">
    <el-tag v-if="mode !== 'mini'" size="small" type="warning">未评分</el-tag>
    <span v-else class="muted">—</span>
  </span>

  <span v-else-if="mode === 'mini'" class="repair-score-mini">
    <span :style="{ color: scoreColor, fontWeight: 700 }">{{ result.score }}</span>
  </span>

  <div v-else-if="mode === 'card'" class="repair-score-card">
    <div class="repair-score-head">
      <div class="repair-score-total">
        <span class="repair-score-number" :style="{ color: scoreColor }">{{ result.score }}</span>
        <span class="repair-score-unit">/100</span>
        <el-tag :type="tagType" size="small" style="margin-left: 8px">
          {{ levelLabel() }}
        </el-tag>
      </div>
      <div class="muted repair-score-advice">{{ result.advice }}</div>
    </div>
    <div class="repair-score-factors">
      <div v-for="factor in result.factors" :key="factor.key" class="repair-score-factor">
        <div class="repair-score-factor-head">
          <span>{{ factor.label }}</span>
          <span class="mono" :style="{ color: factor.score === null ? '#909399' : scoreColor }">
            {{ factor.score === null ? '未填' : factor.score }}
          </span>
        </div>
        <el-progress
          :percentage="factor.score ?? 0"
          :stroke-width="8"
          :show-text="false"
          :color="factor.score === null ? '#c0c4cc' : scoreColor"
        />
        <div class="muted repair-score-factor-detail">{{ factor.detail }}</div>
      </div>
    </div>
  </div>

  <el-tag v-else :type="tagType" size="small" effect="light">
    修补效果 {{ result.score }}
    <span class="muted" style="margin-left: 2px">· {{ levelLabel() }}</span>
  </el-tag>
</template>

<style scoped>
.repair-score-card {
  display: grid;
  gap: 12px;
}
.repair-score-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
}
.repair-score-total {
  display: flex;
  align-items: center;
}
.repair-score-number {
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
}
.repair-score-unit {
  color: #909399;
  font-size: 12px;
  margin-left: 2px;
}
.repair-score-advice {
  font-size: 12px;
  flex-basis: 100%;
}
.repair-score-factors {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.repair-score-factor-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 2px;
}
.repair-score-factor-detail {
  font-size: 11px;
  margin-top: 2px;
  line-height: 1.4;
}
@media (max-width: 640px) {
  .repair-score-factors {
    grid-template-columns: 1fr;
  }
}
</style>
