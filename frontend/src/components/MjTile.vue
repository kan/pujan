<script setup lang="ts">
/**
 * 牌（docs/SPEC.md §2.1）。地の色・影・角丸は CSS（theme.css の .tile）、面の絵は公開素材の SVG
 * （public/tiles/。出典とライセンスは public/tiles/README.md）。
 * 赤の 5 は素材の赤牌の絵を使う。朱塗りで赤くなった 5 以外の牌は、素材に赤版がないので左上に赤い印を付ける。
 * 金牌は金色の地。万能牌は面全体を専用の絵柄（薄紫の地に金の星）にし、元の牌を右下に小さく添える。
 */
import { computed } from 'vue';
import { num, suit, tileName, type Kind } from '@pujan/engine';

const props = withDefaults(
  defineProps<{
    kind: Kind;
    red?: boolean;
    gold?: boolean;
    joker?: boolean;
    /** 和了で万能牌を当てはめた牌。kind は当てはめた後の種類で、右下に小さな星を付ける */
    wild?: boolean;
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

/** 万能牌の星（viewBox 0 0 30 40 の中、中心 15,17） */
const STAR = 'M15 6 L17.7 13.28 L25.46 13.6 L19.37 18.42 L21.47 25.9 L15 21.6 L8.53 25.9 L10.63 18.42 L4.54 13.6 L12.3 13.28 Z';

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
    joker: props.joker || props.wild,
    akamark: props.red && !redArt.value,
    sel: props.selected,
    used: props.used,
  },
]);

const label = computed(
  () =>
    `${tileName(props.kind)}${props.joker ? '（万能牌）' : props.wild ? '（万能牌を当てはめた）' : ''}${props.red ? '（赤）' : ''}${props.gold ? '（金）' : ''}${props.note}`,
);
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
    <template v-if="joker">
      <svg class="jface" viewBox="0 0 30 40" aria-hidden="true">
        <path
          :d="STAR"
          fill="#e2b13c"
          stroke="#b8322a"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
      </svg>
      <img class="jorig" :src="src" alt="" aria-hidden="true" draggable="false" />
    </template>
    <template v-else>
      <img :src="src" alt="" aria-hidden="true" draggable="false" />
      <svg v-if="wild" class="wstar" viewBox="3 4 24 23" aria-hidden="true">
        <path :d="STAR" fill="#e2b13c" stroke="#b8322a" stroke-width="1.6" stroke-linejoin="round" />
      </svg>
    </template>
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
/* 万能牌の星。面の上寄りに置く（右下の先は元の牌 .jorig に少し隠れる） */
.jface {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
/* 万能牌を当てはめた牌の印。右下に小さな星 */
.wstar {
  position: absolute;
  right: 4%;
  bottom: 3%;
  width: 38%;
  height: auto;
  pointer-events: none;
}
/* 万能牌の元の牌。右下に小さく */
img.jorig {
  position: absolute;
  right: 6%;
  bottom: 4%;
  width: 40%;
  height: auto;
  padding: 4% 3%;
  background: #fffaf0;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
}
</style>
