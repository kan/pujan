<script setup lang="ts">
/** 流局（docs/SPEC.md §2.3）。聴牌料・親のノーテン罰符・リーチ棒の没収 */
import { computed } from 'vue';
import { TENPAI_MONEY, isDealerKyoku } from '@pujan/engine';
import { useGameStore } from '@/stores/game';
import { settleLabel } from '@/lib/labels';
import SheetLayer from '../SheetLayer.vue';

const store = useGameStore();
const result = computed(() => {
  const r = store.kyoku?.result;
  if (r?.type !== 'draw') throw new Error('not a draw');
  return r;
});
// 見出しは聴牌料と罰符だけ（プロトタイプと同じ）。リーチ棒の没収は下の行に分けて出す
const delta = computed(() => result.value.fee - result.value.penalty);
const deltaText = computed(() => `${delta.value > 0 ? '+' : delta.value < 0 ? '−' : '±'}${Math.abs(delta.value)}点`);
const message = computed(() => {
  const r = result.value;
  const dealer = isDealerKyoku(store.run);
  if (dealer && r.tenpai) return '親の聴牌です。聴牌では連荘しないので、聴牌料を受け取って親が流れます。';
  if (dealer) return `親のノーテン流局です。罰符${r.penalty}点を払い、親が流れます。`;
  return r.tenpai ? `聴牌していたので、聴牌料と祝儀${TENPAI_MONEY}が入ります。` : 'ノーテンのため0点です。';
});
</script>

<template>
  <SheetLayer label="流局">
    <h2>流局<span class="pts">{{ deltaText }}</span></h2>
    <p class="note">{{ message }}</p>
    <p v-if="result.stickLost" class="note">リーチ棒{{ result.stickLost }}点は没収です。</p>
    <p v-else-if="store.kyoku?.riichi" class="note">平常心で、リーチ棒{{ store.kyoku.riichi.stick }}点は戻ります。</p>
    <button class="btn win" type="button" @click="store.act({ type: 'settle' })">{{ settleLabel(store.run) }}</button>
  </SheetLayer>
</template>
