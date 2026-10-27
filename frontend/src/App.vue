<script setup lang="ts">
/**
 * 画面の組み立て。局の画面を常に出し、その上に今の状態に合うシートを 1 つ重ねる。
 * どのシートを出すかは engine の状態（局の結果、ランの段階）から決める。
 * 役表・設定・持ち物は、プレイヤーが開いたときだけ出す。
 */
import { computed, ref } from 'vue';
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

const store = useGameStore();
store.init();

type Panel = 'ref' | 'settings' | 'inventory';
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
  <TableView @open-ref="panel = 'ref'" @open-settings="panel = 'settings'" @open-inventory="panel = 'inventory'" />

  <YakuSheet v-if="panel === 'ref'" @close="panel = null" />
  <SettingsSheet v-else-if="panel === 'settings'" @close="panel = null" />
  <InventorySheet v-else-if="panel === 'inventory'" @close="panel = null" />
  <WinSheet v-else-if="sheet === 'win'" />
  <DrawSheet v-else-if="sheet === 'draw'" />
  <WaveSheet v-else-if="sheet === 'wave'" @close="store.dismiss()" />
  <ShopSheet v-else-if="sheet === 'shop'" />
  <IntroSheet v-else-if="sheet === 'intro'" />
</template>
