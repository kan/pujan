<script setup lang="ts">
/** ラン終了（docs/SPEC.md §2.3）。お題ごとに果たしたか、局ごとの記録、合計点・倍率・記録点、解禁、ランキングへの記録 */
import { computed } from 'vue';
import { anyMissionDone, runSummary } from '@pujan/engine';
import { useAccountStore } from '@/stores/account';
import { useGameStore } from '@/stores/game';
import { missionText, orasuRuleText, roundLabel, summaryText, timesLabel, unlockLines } from '@/lib/labels';
import SheetLayer from '../SheetLayer.vue';

const emit = defineEmits<{ openRanking: []; openFeedback: []; openMenu: []; newRun: [] }>();
const store = useGameStore();
const account = useAccountStore();
const run = computed(() => store.run);
const round = computed(() => run.value.round);
const summary = computed(() => runSummary(run.value));
const title = computed(() => (summary.value.cleared ? 'クリア' : 'ラン終了'));
/** お題は果たしたが、オーラスの和了の条件（段位の縛り）でクリアにならなかった */
const orasuFailed = computed(() => !summary.value.cleared && anyMissionDone(run.value));
const metCount = computed(() => summary.value.missions.filter((m) => m.met).length);
/** ランが終わって新しく解禁されたもの */
const unlocked = computed(() => (store.unlocks ? unlockLines(store.unlocks) : []));

/** 端末だけのランになった理由ごとの説明 */
const LOCAL_REASON_TEXT: Record<typeof account.localReason, string> = {
  locked: 'このランは、この端末だけで解禁した雀士・段位で始めたので、ランキングには載りません。',
  outdated: 'このランは、古い版の画面で始めたので、ランキングには載りません。再読み込みすると新しい版になります。',
  offline: 'このランは、始めたときにサーバーにつながらなかったので、ランキングには載りません。',
};

/** ランキングへの記録の様子 */
const submissionText = computed(() => {
  const s = account.submission;
  if (!s) return '';
  switch (s.status) {
    case 'local':
      return LOCAL_REASON_TEXT[account.localReason];
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
    <h2>{{ title }}<span class="pts">{{ summary.recordScore.toLocaleString() }}点</span></h2>
    <p v-if="orasuFailed" class="note">お題は果たしましたが、{{ orasuRuleText(run) }}。</p>
    <p v-else-if="summary.cleared" class="note">お題を{{ summary.missions.length }}つのうち{{ metCount }}つ果たしました。</p>
    <p v-else class="note">お題を1つも果たせませんでした。</p>
    <div class="yakulist">
      <template v-for="(m, i) in summary.missions" :key="`m${i}`">
        <span>{{ missionText(m) }}</span><span>{{ m.met ? '済' : '未' }}</span>
      </template>
    </div>
    <div class="yakulist">
      <template v-for="(e, i) in round.log" :key="i">
        <span>{{ roundLabel(e.kyoku, e.honba, false) }}　{{ e.label }}{{ e.dealer ? '（親）' : '' }}</span>
        <span>{{ e.points.toLocaleString() }}</span>
      </template>
    </div>
    <div class="yakulist">
      <span>4局の合計</span><span>{{ summary.totalScore.toLocaleString() }}</span>
      <template v-if="summary.cleared">
        <span>倍率（果たしたお題の合計）</span><span>{{ timesLabel(summary.times) }}</span>
      </template>
      <span>記録点</span><span>{{ summary.recordScore.toLocaleString() }}</span>
    </div>
    <section v-if="unlocked.length" class="unlocks" aria-label="解禁">
      <h3>解禁</h3>
      <ul>
        <li v-for="line in unlocked" :key="line">{{ line }}</li>
      </ul>
    </section>
    <p v-if="submissionText" class="note" role="status">{{ submissionText }}</p>
    <div class="actions">
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
