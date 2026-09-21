<script setup lang="ts">
import { computed } from 'vue';
import {
  repairChangeScore,
  type RepairChangeScore,
  type RepairChangeScoreLevel,
} from '@gml/shared';
import type { RepairChange } from '../types';

const props = defineProps<{ change: RepairChange | null | undefined; withLabel?: boolean }>();

const score = computed<RepairChangeScore | null>(() => (props.change ? repairChangeScore(props.change) : null));

const tagType = computed<'' | 'success' | 'warning' | 'danger'>(() => {
  const level = score.value?.level;
  if (level === 'seamless') return 'success';
  if (level === 'acceptable') return '';
  if (level === 'degraded') return 'warning';
  return 'danger';
});

const factorColor = (value: number | null): string => {
  if (value === null) return '#909399';
  if (value >= 85) return '#67c23a';
  if (value >= 70) return '#e6a23c';
  return '#f56c6c';
};
</script>

<template>
  <el-popover v-if="score" placement="top" :width="260" trigger="hover">
    <template #reference>
      <el-tag size="small" :type="tagType" effect="light" style="cursor: default">
        变化分 {{ score.total }}
        <span v-if="withLabel"> · {{ score.levelLabel }}</span>
      </el-tag>
    </template>
    <div style="font-weight: 600; margin-bottom: 6px">修补后变化评分 · {{ score.total }} 分（{{ score.levelLabel }}）</div>
    <div v-for="factor in score.factors" :key="factor.key" style="margin-bottom: 6px">
      <div style="display: flex; justify-content: space-between; font-size: 12px">
        <span>{{ factor.label }}</span>
        <span :style="{ color: factorColor(factor.score) }">{{ factor.score ?? '未填' }}</span>
      </div>
      <el-progress
        :percentage="factor.score ?? 0"
        :show-text="false"
        :stroke-width="6"
        :color="factorColor(factor.score)"
      />
      <div class="muted" style="font-size: 11px">{{ factor.detail }}</div>
    </div>
    <div class="muted" style="font-size: 11px; margin-top: 4px">分值越高越接近修补前原状</div>
  </el-popover>
  <el-tag v-else size="small" type="warning">变化未填</el-tag>
</template>
