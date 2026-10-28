<script setup lang="ts">
/**
 * 牌山の一覧（docs/SPEC.md §2.3「持ち物」）。34 種の牌に、山にある枚数・赤・金を添えて並べる。
 * 牌の改造で変わった牌は金の枠で、山から抜いた牌は薄く示す
 */
import { computed } from 'vue';
import { ALL_KINDS } from '@pujan/engine';
import { useGameStore } from '@/stores/game';
import { compositionText, modifiedKinds } from '@/lib/labels';
import MjTile from './MjTile.vue';

const store = useGameStore();
const comp = computed(() => store.run.composition);
const modified = computed(() => modifiedKinds(store.run));
</script>

<template>
  <!-- 名前は置いている節（持ち物の「牌山」）が持つので、ここには付けない -->
  <ul class="picker wall">
    <li
      v-for="k in ALL_KINDS"
      :key="k"
      class="pick"
      :class="{ changed: modified.has(k), gone: comp.count[k] === 0 }"
    >
      <MjTile :kind="k" :red="comp.red[k] > 0" :gold="comp.gold[k] > 0" size="sm" :note="modified.has(k) ? '（改造）' : ''" />
      <small>{{ compositionText(comp, k) }}</small>
    </li>
  </ul>
</template>

<style scoped>
.wall {
  list-style: none;
  margin: 0;
  padding: 0;
}
.wall .pick {
  cursor: default;
}
</style>
