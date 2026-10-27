<script setup lang="ts">
/**
 * 牌（docs/SPEC.md §2.1）。地の色・影・角丸は CSS（theme.css の .tile）、面の絵は公開素材の SVG
 * （public/tiles/。出典とライセンスは public/tiles/README.md）。
 * 赤の 5 は素材の赤牌の絵を使う。朱塗りで赤くなった 5 以外の牌は、素材に赤版がないので左上に赤い印を付ける。
 * 金牌は金色の地、万能牌は右上に「J」。
 */
import { computed } from 'vue';
import { num, suit, tileName, type Kind } from '@pujan/engine';

const props = withDefaults(
  defineProps<{
    kind: Kind;
    red?: boolean;
    gold?: boolean;
    joker?: boolean;
    /** 大きさ。省略時は手牌の大きさ */
    size?: 'md' | 'sm' | 'xs';
    /** ボタンにする（タップで選ぶ牌） */
    button?: boolean;
    selected?: boolean;
    /** 和了に使う牌（金の枠） */
    used?: boolean;
    /** 読み上げに足す言葉（「保留」など） */
    note?: string;
  }>(),
  { size: undefined, note: '' },
);

defineEmits<{ click: [] }>();

const SUITS = ['Man', 'Pin', 'Sou'];
const HONORS = ['Ton', 'Nan', 'Shaa', 'Pei', 'Haku', 'Hatsu', 'Chun'];

/** 素材に赤版がある（各色の 5） */
const redArt = computed(() => props.red && props.kind < 27 && num(props.kind) === 4);

const src = computed(() => {
  const k = props.kind;
  const name = k < 27 ? `${SUITS[suit(k)]}${num(k) + 1}${redArt.value ? '-Dora' : ''}` : HONORS[k - 27];
  return `/tiles/${name}.svg`;
});

const classes = computed(() => [
  'tile',
  props.size,
  {
    kin: props.gold,
    joker: props.joker,
    akamark: props.red && !redArt.value,
    sel: props.selected,
    used: props.used,
  },
]);

const label = computed(() => `${tileName(props.kind)}${props.red ? '（赤）' : ''}${props.gold ? '（金）' : ''}${props.note}`);
</script>

<template>
  <component
    :is="button ? 'button' : 'span'"
    :class="classes"
    :type="button ? 'button' : undefined"
    :aria-label="label"
    :role="button ? undefined : 'img'"
    @click="button && $emit('click')"
  >
    <img :src="src" alt="" aria-hidden="true" draggable="false" />
  </component>
</template>

<style scoped>
img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* 素材の絵柄は牌の面いっぱいに描かれているので、縁の内側に収める */
  padding: 6%;
  box-sizing: border-box;
  pointer-events: none;
  user-select: none;
}
</style>
