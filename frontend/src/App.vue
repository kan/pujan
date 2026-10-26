<script setup lang="ts">
/**
 * 仮の画面。engine とのつなぎを確かめるために、1 局を始めて手牌を表示するだけ。
 * 本来の画面はプロトタイプ（docs/prototype/puchi-mahjong.html）を移植する（docs/SPEC.md §6 フェーズ 2）。
 */
import { computed, ref } from 'vue';
import { beginKyoku, createRun, step, tileName, type KyokuState } from '@pujan/engine';

const { kyoku: first } = beginKyoku(createRun(Date.now()));
const kyoku = ref<KyokuState>(first);
const tiles = computed(() => [...kyoku.value.hand, ...kyoku.value.drawn]);

function discard(index: number) {
  const k = kyoku.value;
  if (k.result) return;
  kyoku.value =
    index < k.hand.length
      ? step(k, { type: 'discard', zone: 'hand', index })
      : step(k, { type: 'discard', zone: 'drawn', index: index - k.hand.length });
}
</script>

<template>
  <main class="placeholder">
    <h1>プチ麻雀</h1>
    <p>巡 {{ kyoku.turn }} / {{ kyoku.setup.mods.turns }}</p>
    <div class="hand">
      <button v-for="(t, i) in tiles" :key="t.id" type="button" @click="discard(i)">{{ tileName(t.kind) }}</button>
    </div>
    <p v-if="kyoku.win">和了れます: {{ kyoku.win.evaluation.yaku.map((y) => y.name).join('・') || '役なし' }}</p>
    <p v-if="kyoku.result">局が終わりました（{{ kyoku.result.type === 'win' ? '和了' : '流局' }}）</p>
  </main>
</template>

<style scoped>
.placeholder {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px 16px;
}
.hand {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.hand button {
  padding: 12px 8px;
  font: inherit;
}
</style>
