<script setup lang="ts">
/**
 * 牌（docs/SPEC.md §2.1）。地の色・影・角丸は CSS（theme.css の .tile）、牌の面は SVG で描く。
 * 萬子は漢数字と赤い「萬」、筒子は青い円と数字、索子は緑の数字と「索」、白は青い枠、發は緑、中は赤。
 * 赤牌は数字を赤く、金牌は金色の地、万能牌は右上に「J」。
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

const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONORS = ['東', '南', '西', '北', '白', '發', '中'];

const face = computed(() => {
  const k = props.kind;
  if (k < 27) {
    const s = suit(k);
    return { type: (['man', 'pin', 'sou'] as const)[s], n: num(k) + 1 };
  }
  if (k === 31) return { type: 'haku' as const, n: 0 };
  return { type: 'honor' as const, n: 0, text: HONORS[k - 27], color: k === 32 ? 'sou' : k === 33 ? 'man' : 'ink' };
});

const classes = computed(() => [
  'tile',
  props.size,
  {
    aka: props.red,
    kin: props.gold,
    joker: props.joker,
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
    <svg viewBox="0 0 100 136" aria-hidden="true">
      <template v-if="face.type === 'man'">
        <text x="50" y="50" class="g big" :class="red ? 'c-man' : 'c-ink'">{{ KANJI[face.n - 1] }}</text>
        <text x="50" y="104" class="g sub c-man">萬</text>
      </template>
      <template v-else-if="face.type === 'pin'">
        <circle cx="50" cy="66" r="30" class="ring" :class="red ? 's-man' : 's-pin'" />
        <text x="50" y="68" class="g pin-n" :class="red ? 'c-man' : 'c-pin'">{{ face.n }}</text>
      </template>
      <template v-else-if="face.type === 'sou'">
        <text x="50" y="50" class="g big" :class="red ? 'c-man' : 'c-sou'">{{ face.n }}</text>
        <text x="50" y="104" class="g sub" :class="red ? 'c-man' : 'c-sou'">索</text>
      </template>
      <rect v-else-if="face.type === 'haku'" x="23" y="28" width="54" height="80" rx="5" class="haku" />
      <text v-else x="50" y="70" class="g honor" :class="`c-${face.color}`">{{ face.text }}</text>
    </svg>
  </component>
</template>

<style scoped>
svg {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}
.g {
  font-family: var(--f-tile);
  text-anchor: middle;
  dominant-baseline: central;
}
.big {
  font-size: 52px;
  font-weight: 800;
}
.sub {
  font-size: 30px;
  font-weight: 600;
}
.pin-n {
  font-size: 36px;
  font-weight: 800;
}
.honor {
  font-size: 62px;
  font-weight: 800;
}
.ring {
  fill: none;
  stroke-width: 6;
}
.haku {
  fill: none;
  stroke: #7b9cc4;
  stroke-width: 5;
}
.c-ink {
  fill: var(--ink);
}
.c-man {
  fill: var(--man);
}
.c-pin {
  fill: var(--pin);
}
.c-sou {
  fill: var(--sou);
}
.s-man {
  stroke: var(--man);
}
.s-pin {
  stroke: var(--pin);
}
</style>
