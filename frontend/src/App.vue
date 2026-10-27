<script setup lang="ts">
/**
 * 画面の組み立て。局の画面を常に出し、その上に今の状態に合うシートを 1 つ重ねる。
 * どのシートを出すかは engine の状態（局の結果、ランの段階）から決める。
 * 役表・設定・持ち物は、プレイヤーが開いたときだけ出す。
 */
import { computed, ref } from 'vue';
import { useAccountStore } from '@/stores/account';
import { useGameStore } from '@/stores/game';
import TableView from '@/components/TableView.vue';
import DrawSheet from '@/components/sheets/DrawSheet.vue';
import IntroSheet from '@/components/sheets/IntroSheet.vue';
import InventorySheet from '@/components/sheets/InventorySheet.vue';
import SettingsSheet from '@/components/sheets/SettingsSheet.vue';
import ShopSheet from '@/components/sheets/ShopSheet.vue';
import WaveSheet from '@/components/sheets/WaveSheet.vue';
import WinSheet from '@/components/sheets/WinSheet.vue';
import YakuSheet from '@/components/sheets/YakuSheet.vue';
import RankingSheet from '@/components/sheets/RankingSheet.vue';
import SheetLayer from '@/components/SheetLayer.vue';

const store = useGameStore();
const account = useAccountStore();
void store.init();
// オフラインの間に送れなかった記録を、つながったら送り直す
window.addEventListener('online', () => void account.flushPending());

type Panel = 'ref' | 'settings' | 'inventory' | 'ranking';
const panel = ref<Panel | null>(null);

const sheet = computed(() => {
  const { run, kyoku } = store.game;
  if (kyoku?.result) return kyoku.result.type === 'win' ? 'win' : 'draw';
  if (run.phase === 'over' || run.phase === 'cleared') return 'wave';
  if (run.phase === 'shop') return store.showWaveResult ? 'wave' : 'shop';
  return store.showIntro ? 'intro' : null;
});
</script>

<template>
  <TableView
    @open-ref="panel = 'ref'"
    @open-settings="panel = 'settings'"
    @open-inventory="panel = 'inventory'"
    @open-ranking="panel = 'ranking'"
  />

  <!-- 新しいランのシードをサーバーにもらっている間は、前のランを触らせない -->
  <SheetLayer v-if="store.starting" label="準備中">
    <p class="note">新しいランを準備しています…</p>
  </SheetLayer>
  <YakuSheet v-else-if="panel === 'ref'" @close="panel = null" />
  <RankingSheet v-else-if="panel === 'ranking'" @close="panel = null" />
  <SettingsSheet v-else-if="panel === 'settings'" @close="panel = null" />
  <InventorySheet v-else-if="panel === 'inventory'" @close="panel = null" />
  <WinSheet v-else-if="sheet === 'win'" />
  <DrawSheet v-else-if="sheet === 'draw'" />
  <WaveSheet v-else-if="sheet === 'wave'" @close="store.dismiss()" @open-ranking="panel = 'ranking'" />
  <ShopSheet v-else-if="sheet === 'shop'" />
  <IntroSheet v-else-if="sheet === 'intro'" />
</template>
