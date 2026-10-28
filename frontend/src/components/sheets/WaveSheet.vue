<script setup lang="ts">
/** 場の結果（docs/SPEC.md §2.3）。突破（祝儀の内訳）・ラン終了・全場クリア。局ごとの記録を並べる */
import { computed } from 'vue';
import { useAccountStore } from '@/stores/account';
import { useGameStore } from '@/stores/game';
import { WIND_NAMES, roundLabel, summaryText, unlockLines } from '@/lib/labels';
import SheetLayer from '../SheetLayer.vue';

const emit = defineEmits<{ close: []; openRanking: []; openFeedback: []; openMenu: []; newRun: [] }>();
const store = useGameStore();
const account = useAccountStore();
const run = computed(() => store.run);
const wind = computed(() => WIND_NAMES[run.value.wave]);
const round = computed(() => run.value.round);
const title = computed(() =>
  run.value.phase === 'over' ? 'ラン終了' : run.value.phase === 'cleared' ? '全場クリア' : `${wind.value}場 突破`,
);
// 突破したとき（全場クリアを含む）の祝儀の内訳。ラン終了では出さない
const bonus = computed(() => (run.value.phase === 'over' ? null : run.value.lastWaveBonus));
/** ランが終わって新しく解禁されたもの */
const unlocked = computed(() => (store.unlocks && run.value.phase !== 'shop' ? unlockLines(store.unlocks) : []));

/** ランが終わったときの、ランキングへの記録の様子 */
const submissionText = computed(() => {
  const s = account.submission;
  if (!s || run.value.phase === 'shop') return '';
  switch (s.status) {
    case 'local':
      return account.localReason === 'locked'
        ? 'このランは、この端末だけで解禁した雀士・段位で始めたので、ランキングには載りません。'
        : 'このランは、始めたときにサーバーにつながらなかったので、ランキングには載りません。';
    case 'sending':
      return '記録を送っています…';
    case 'recorded':
      return s.result.best
        ? `今週の最高記録として記録しました（${summaryText(s.result)}）。`
        : `記録しました（${summaryText(s.result)}）。今週の最高記録は更新していません。`;
    case 'queued':
      return '記録を送れませんでした。次に開いたときに送り直します。';
    case 'rejected':
      // あとから新しいランを始めると、前のランは消える（not_found）か記録できない（superseded）
      return s.code === 'superseded' || s.code === 'not_found'
        ? 'このランは記録できません（あとから新しいランを始めたため）。'
        : '記録を受け付けてもらえませんでした。';
  }
});
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
    <section v-if="unlocked.length" class="unlocks" aria-label="解禁">
      <h3>解禁</h3>
      <ul>
        <li v-for="line in unlocked" :key="line">{{ line }}</li>
      </ul>
    </section>
    <p v-if="submissionText" class="note" role="status">{{ submissionText }}</p>
    <button v-if="run.phase === 'shop'" class="btn win" type="button" @click="emit('close')">ショップへ</button>
    <div v-else class="actions">
      <button class="btn" type="button" @click="emit('openRanking')">ランキング</button>
      <button class="btn" type="button" @click="emit('openFeedback')">感想</button>
      <!-- この画面はヘッダーを覆うので、メニューへはここから開く（閉じるとこの画面に戻る） -->
      <button class="btn" type="button" aria-haspopup="dialog" @click="emit('openMenu')">メニュー</button>
      <button class="btn win" type="button" @click="emit('newRun')">新しいラン</button>
    </div>
  </SheetLayer>
</template>

<style scoped>
.unlocks {
  border: 1px solid var(--gold);
  border-radius: 8px;
  padding: 8px 12px;
}
.unlocks h3 {
  margin: 0 0 4px;
  font-size: 14px;
  color: var(--gold);
}
.unlocks ul {
  margin: 0;
  padding-left: 18px;
}
</style>
