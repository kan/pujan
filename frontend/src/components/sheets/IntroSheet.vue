<script setup lang="ts">
/** 場の開始（docs/SPEC.md §2.3）。目標点、親番の局、オーラスのボス */
import { computed } from 'vue';
import { useGameStore } from '@/stores/game';
import { WIND_NAMES, bossDef, orasuRuleText, startLabel } from '@/lib/labels';
import CharacterIcon from '../CharacterIcon.vue';
import SheetLayer from '../SheetLayer.vue';

const store = useGameStore();
const wind = computed(() => WIND_NAMES[store.run.wave]);
const round = computed(() => store.run.round);
const boss = computed(() => bossDef(round.value.boss));
const orasuRule = computed(() => orasuRuleText(store.run));
</script>

<template>
  <SheetLayer :label="`${wind}場`">
    <h2>{{ wind }}場<span class="pts">目標 {{ round.target.toLocaleString() }}点</span></h2>
    <div class="yakulist">
      <span>雀士・段位</span>
      <span><CharacterIcon :id="store.run.start.character" :size="22" /> {{ startLabel(store.run.start) }}</span>
      <span>親番</span><span>{{ wind }}{{ round.dealer + 1 }}局</span>
      <span>オーラスのボス</span><span>{{ boss.name }}</span>
    </div>
    <p class="note">
      {{ wind }}4局は「{{ boss.name }}」：{{ boss.description }}。4局の合計で目標点を超えると次の場へ進めます。
      <template v-if="orasuRule">この段位では、{{ orasuRule }}。</template>
      オーラスで和了ると、景品を1つもらえます。
    </p>
    <button class="btn win" type="button" @click="store.dismiss()">{{ wind }}1局を始める</button>
  </SheetLayer>
</template>
