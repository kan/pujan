<script setup lang="ts">
/** 和了（docs/SPEC.md §2.3）。和了牌、点数の内訳、祝儀。親の和了では「和了やめ」「連荘する」を選ぶ */
import { computed } from 'vue';
import { allTiles, byKind, doraOf, isDealerKyoku, moneyForWin, notenPenalty, tileName } from '@pujan/engine';
import { useGameStore } from '@/stores/game';
import { settleLabel } from '@/lib/labels';
import MjTile from '../MjTile.vue';
import SheetLayer from '../SheetLayer.vue';

const store = useGameStore();
const k = computed(() => store.kyoku!);
const result = computed(() => {
  const r = k.value.result;
  if (r?.type !== 'win') throw new Error('not a win');
  return r;
});
/** 和了に使った牌。万能牌は当てはめた後の種類にして（wild）、その種類の順に並べる */
const tiles = computed(() => {
  const used = new Set(result.value.win.tileIds);
  const jokerAs = new Map(result.value.win.jokers.map((j) => [j.id, j.kind]));
  return allTiles(k.value)
    .filter((t) => used.has(t.id))
    .map((t) => {
      const as = jokerAs.get(t.id);
      // 赤と金は牌そのものに付く（赤の翻・金牌の祝儀に数える）ので、当てはめたあとも残す
      return as === undefined ? { ...t, wild: false } : { ...t, kind: as, wild: true };
    })
    .sort(byKind);
});
const dealer = computed(() => isDealerKyoku(store.run));
const honba = computed(() => store.run.round.honba);
const ura = computed(() =>
  result.value.ura.map((t) => ({ tile: t, dora: tileName(doraOf(t.kind)) })),
);
</script>

<template>
  <SheetLayer label="和了">
    <h2>和了<span class="pts">+{{ result.score.points.toLocaleString() }}点</span></h2>
    <div class="tilesline">
      <MjTile v-for="t in tiles" :key="t.id" :kind="t.kind" :red="t.red" :gold="t.gold" :wild="t.wild" size="md" />
    </div>
    <div class="yakulist">
      <template v-for="(l, i) in result.score.lines" :key="i">
        <span>{{ l.label }}</span><span>{{ l.value }}</span>
      </template>
      <span>祝儀</span><span>+{{ moneyForWin(result) }}</span>
    </div>
    <p v-if="k.riichi" class="note">
      <template v-if="ura.length">
        裏ドラ表示
        <template v-for="(u, i) in ura" :key="u.tile.id">
          <template v-if="i">、</template>
          <MjTile :kind="u.tile.kind" size="sm" /> → {{ u.dora }}
        </template>
        。
      </template>
      リーチ棒{{ k.riichi.stick }}点は戻ります。
    </p>
    <template v-if="dealer">
      <p class="note">
        親の和了です。連荘すると{{ honba + 1 }}本場になります。流局すると親は流れ、ノーテンなら罰符{{ notenPenalty(honba + 1) }}点です。
      </p>
      <div class="actions">
        <button class="btn" type="button" @click="store.act({ type: 'settle', renchan: false })">和了やめ</button>
        <button class="btn win" type="button" @click="store.act({ type: 'settle', renchan: true })">連荘する</button>
      </div>
    </template>
    <button v-else class="btn win" type="button" @click="store.act({ type: 'settle' })">
      {{ settleLabel(store.run) }}
    </button>
  </SheetLayer>
</template>
