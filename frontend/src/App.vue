<script setup lang="ts">
/**
 * 画面の組み立て。局の画面を常に出し、その上に今の状態に合うシートを 1 つ重ねる。
 * どのシートを出すかは engine の状態（局の結果、ランの段階）から決める。
 * メニュー・役と遊び方・持ち物・ランキングなどは、プレイヤーが開いたときだけ出す。
 * 初めて開いたときは、チュートリアルを見るかどうかを聞く。
 */
import { computed, ref } from 'vue';
import { isFinished, type RunChoice } from '@pujan/engine';
import { useAccountStore } from '@/stores/account';
import { useGameStore } from '@/stores/game';
import { browserStorage, loadRunLog, loadTutorialSeen, saveTutorialSeen } from '@/lib/storage';
import TableView from '@/components/TableView.vue';
import TutorialView from '@/components/TutorialView.vue';
import SheetLayer from '@/components/SheetLayer.vue';
import AboutSheet from '@/components/sheets/AboutSheet.vue';
import DrawSheet from '@/components/sheets/DrawSheet.vue';
import FeedbackSheet from '@/components/sheets/FeedbackSheet.vue';
import HelpSheet from '@/components/sheets/HelpSheet.vue';
import IntroSheet from '@/components/sheets/IntroSheet.vue';
import InventorySheet from '@/components/sheets/InventorySheet.vue';
import MenuSheet from '@/components/sheets/MenuSheet.vue';
import RankingSheet from '@/components/sheets/RankingSheet.vue';
import ShopSheet from '@/components/sheets/ShopSheet.vue';
import StartSheet from '@/components/sheets/StartSheet.vue';
import WaveSheet from '@/components/sheets/WaveSheet.vue';
import WinSheet from '@/components/sheets/WinSheet.vue';

const store = useGameStore();
const account = useAccountStore();
void store.init();
// オフラインの間に送れなかった記録を、つながったら送り直す
window.addEventListener('online', () => void account.flushPending());

type Panel = 'menu' | 'help' | 'inventory' | 'ranking' | 'about' | 'start' | 'feedback';
const panel = ref<Panel | null>(null);

/** 役と遊び方を開くタブ（ヘッダーの「役」は役のタブ、メニューからは遊び方のタブ） */
const helpTab = ref('guide');
function openHelp(tab: string) {
  helpTab.value = tab;
  panel.value = 'help';
}

const storage = browserStorage();
/**
 * チュートリアル。初めて開いたときは、見るかどうかを聞いてから始める。
 * チュートリアルができる前から遊んでいた人（保存したランがある）には聞かない
 */
// 保存先が使えない環境では「見た」ことを覚えられず毎回聞くことになるので、聞かない（メニューから開ける）
const firstVisit = !!storage && !loadTutorialSeen(storage) && !loadRunLog(storage);
const tutorial = ref<{ firstVisit: boolean } | null>(firstVisit ? { firstVisit: true } : null);

function openTutorial() {
  panel.value = null;
  tutorial.value = { firstVisit: false };
}

function closeTutorial() {
  tutorial.value = null;
  saveTutorialSeen(storage);
}

async function newRun(choice: RunChoice) {
  panel.value = null;
  await store.startRun(choice);
}

const sheet = computed(() => {
  const { run, kyoku } = store.game;
  if (kyoku?.result) return kyoku.result.type === 'win' ? 'win' : 'draw';
  if (run.phase === 'over' || run.phase === 'cleared') return 'wave';
  if (run.phase === 'shop') return store.showWaveResult ? 'wave' : 'shop';
  return store.showIntro ? 'intro' : null;
});
</script>

<template>
  <TableView @open-help="openHelp('low')" @open-menu="panel = 'menu'" @open-inventory="panel = 'inventory'" />

  <!--
    チュートリアルを開いている間は、ほかのシートを出さない（シートは開いたときに自分へフォーカスを移すので、
    全画面のチュートリアルからフォーカスを奪ってしまう）。
    新しいランのシードをサーバーにもらっている間は、前のランを触らせない
  -->
  <template v-if="tutorial" />
  <SheetLayer v-else-if="store.starting" label="準備中">
    <p class="note">新しいランを準備しています…</p>
  </SheetLayer>
  <MenuSheet
    v-else-if="panel === 'menu'"
    @close="panel = null"
    @open="(t) => (t === 'help' ? openHelp('guide') : (panel = t))"
    @open-tutorial="openTutorial"
    @new-run="panel = 'start'"
  />
  <StartSheet v-else-if="panel === 'start'" :in-progress="!isFinished(store.game)" @close="panel = null" @start="newRun" />
  <HelpSheet v-else-if="panel === 'help'" :initial-tab="helpTab" @close="panel = null" @open-tutorial="openTutorial" />
  <RankingSheet v-else-if="panel === 'ranking'" @close="panel = null" />
  <InventorySheet v-else-if="panel === 'inventory'" @close="panel = null" />
  <AboutSheet v-else-if="panel === 'about'" @close="panel = null" />
  <FeedbackSheet v-else-if="panel === 'feedback'" @close="panel = null" />
  <WinSheet v-else-if="sheet === 'win'" />
  <DrawSheet v-else-if="sheet === 'draw'" />
  <WaveSheet
    v-else-if="sheet === 'wave'"
    @close="store.dismiss()"
    @open-ranking="panel = 'ranking'"
    @open-feedback="panel = 'feedback'"
    @open-menu="panel = 'menu'"
    @new-run="panel = 'start'"
  />
  <ShopSheet v-else-if="sheet === 'shop'" />
  <IntroSheet v-else-if="sheet === 'intro'" />

  <TutorialView v-if="tutorial" :first-visit="tutorial.firstVisit" @close="closeTutorial" />
</template>
