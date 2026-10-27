<script setup lang="ts">
/**
 * 局の手元: 保留枠とネクスト、手牌とツモ牌（docs/SPEC.md §2.2 の 7・8）。
 * 局の画面（TableView）とチュートリアル（TutorialView）で同じものを使う。どの牌を選んでいるか、タップで何をするかは
 * 呼び出し側が決める（ここは表示とタップの通知だけ）。
 */
import { computed } from 'vue';
import { allTiles, isJoker, visibleNext, type Kind, type KyokuState, type Zone } from '@pujan/engine';
import MjTile from './MjTile.vue';

const props = defineProps<{
  kyoku: KyokuState;
  selection: { zone: Zone; index: number } | null;
  /** 和了に使う牌の id（金の枠） */
  usedIds: ReadonlySet<number>;
  /** 選んでいる牌を保留できる（空き枠を金にする） */
  canHold: boolean;
  /** 次に押すところを光らせる（チュートリアル）。牌の種類か、空き枠 */
  pulse?: { tile: Kind } | { slot: true } | null;
}>();
const emit = defineEmits<{ tapTile: [zone: Zone, index: number]; tapSlot: [slot: number] }>();

const nextTiles = computed(() => visibleNext(props.kyoku));
const nextMany = computed(() => nextTiles.value.length > 3);
const isSel = (zone: Zone, index: number) => props.selection?.zone === zone && props.selection.index === index;
const joker = (kind: number) => isJoker(props.kyoku, kind);
/** 光らせる牌か（同じ種類が複数あれば最初の 1 枚だけ） */
const pulseTileId = computed(() => {
  const p = props.pulse;
  if (!p || !('tile' in p)) return null;
  return allTiles(props.kyoku).find((t) => t.kind === p.tile)?.id ?? null;
});
const pulseSlot = computed(() => !!props.pulse && 'slot' in props.pulse);
</script>

<template>
  <div class="play">
    <div class="holdrow">
      <span v-if="kyoku.hold.length" class="hg">
        <span class="hl">保留</span>
        <template v-for="(t, i) in kyoku.hold" :key="i">
          <MjTile
            v-if="t"
            :kind="t.kind"
            :red="t.red"
            :gold="t.gold"
            :joker="joker(t.kind)"
            size="md"
            button
            note="（保留）"
            :class="{ pulse: t.id === pulseTileId }"
            :selected="isSel('hold', i)"
            :used="usedIds.has(t.id)"
            @click="emit('tapTile', 'hold', i)"
          />
          <button
            v-else
            class="slot"
            :class="{ target: canHold, pulse: pulseSlot && i === kyoku.hold.indexOf(null) }"
            type="button"
            aria-label="空きの保留枠"
            @click="emit('tapSlot', i)"
          >
            空き
          </button>
        </template>
      </span>
      <span v-if="nextTiles.length" class="nextin" :class="{ many: nextMany }" aria-label="次にツモる牌（左から順）">
        <span class="nl">次</span>
        <template v-for="(t, i) in nextTiles" :key="t.id">
          <span v-if="i" class="arr" aria-hidden="true">←</span>
          <MjTile :kind="t.kind" :red="t.red" :gold="t.gold" :joker="joker(t.kind)" :size="nextMany ? 'sm' : 'md'" />
        </template>
      </span>
    </div>
    <div class="handrow">
      <MjTile
        v-for="(t, i) in kyoku.hand"
        :key="t.id"
        :kind="t.kind"
        :red="t.red"
        :gold="t.gold"
        :joker="joker(t.kind)"
        button
        :class="{ pulse: t.id === pulseTileId }"
        :selected="isSel('hand', i)"
        :used="usedIds.has(t.id)"
        @click="emit('tapTile', 'hand', i)"
      />
      <template v-if="kyoku.drawn.length">
        <span class="gap" />
        <MjTile
          v-for="(t, i) in kyoku.drawn"
          :key="t.id"
          class="drawn"
          :class="{ pulse: t.id === pulseTileId }"
          :kind="t.kind"
          :red="t.red"
          :gold="t.gold"
          :joker="joker(t.kind)"
          button
          note="（ツモ）"
          :selected="isSel('drawn', i)"
          :used="usedIds.has(t.id)"
          @click="emit('tapTile', 'drawn', i)"
        />
      </template>
    </div>
  </div>
</template>
