<script setup lang="ts">
/** 場の結果（docs/SPEC.md §2.3）。突破（祝儀の内訳）・ラン終了・全場クリア。局ごとの記録を並べる */
import { computed } from 'vue';
import { useGameStore } from '@/stores/game';
import { WIND_NAMES, roundLabel } from '@/lib/labels';
import SheetLayer from '../SheetLayer.vue';

const emit = defineEmits<{ close: [] }>();
const store = useGameStore();
const run = computed(() => store.run);
const wind = computed(() => WIND_NAMES[run.value.wave]);
const round = computed(() => run.value.round);
const title = computed(() =>
  run.value.phase === 'over' ? 'ラン終了' : run.value.phase === 'cleared' ? '全場クリア' : `${wind.value}場 突破`,
);
// 突破したとき（全場クリアを含む）の祝儀の内訳。ラン終了では出さない
const bonus = computed(() => (run.value.phase === 'over' ? null : run.value.lastWaveBonus));
</script>

<template>
  <SheetLayer :label="title">
    <h2>{{ title }}<span class="pts">{{ round.score.toLocaleString() }}点</span></h2>
    <p v-if="run.phase === 'over'" class="note">
      {{ wind }}場の目標 {{ round.target.toLocaleString() }}点に届きませんでした。
    </p>
    <p v-else-if="run.phase === 'cleared'" class="note">東南西北の4場をすべて突破しました。</p>
    <div class="yakulist">
      <template v-for="(e, i) in round.log" :key="i">
        <span>{{ roundLabel(run.wave, e.kyoku, e.honba, false) }}　{{ e.label }}{{ e.dealer ? '（親）' : '' }}</span>
        <span>{{ e.points.toLocaleString() }}</span>
      </template>
    </div>
    <div v-if="bonus" class="yakulist">
      <span>突破の祝儀</span><span>+{{ bonus.clear }}</span>
      <span>利子（5ごとに1、最大5）</span><span>+{{ bonus.interest }}</span>
      <span>目標超過</span><span>+{{ bonus.over }}</span>
    </div>
    <button v-if="run.phase === 'shop'" class="btn win" type="button" @click="emit('close')">ショップへ</button>
    <button v-else class="btn win" type="button" @click="store.startRun()">新しいラン</button>
  </SheetLayer>
</template>
