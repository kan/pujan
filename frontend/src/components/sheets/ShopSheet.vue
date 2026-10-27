<script setup lang="ts">
/**
 * ショップ（docs/SPEC.md §2.3、§4.4）。品物 3 つ、品替え、持っているお守りの売却。
 * 買えるかどうかは engine の buyBlocker に聞き、買えない理由を案内する。
 * 牌の改造を買うときは、対象の牌を選ぶ画面に切り替える。
 */
import { computed, ref } from 'vue';
import {
  ALL_KINDS,
  MAX_CHARMS,
  MAX_CONSUMABLES,
  REROLL_PRICE,
  SELL_PRICE,
  buyBlocker,
  canModify,
  type BuyBlocker,
  type GameAction,
  type Kind,
} from '@pujan/engine';
import { useGameStore } from '@/stores/game';
import { OFFER_KIND_LABEL } from '@pujan/engine';
import { charmDef, compositionText, equipDef, offerText } from '@/lib/labels';
import MjTile from '../MjTile.vue';
import SheetLayer from '../SheetLayer.vue';

const store = useGameStore();
const run = computed(() => store.run);
const offers = computed(() =>
  (run.value.shop ?? []).map((o, i) => ({ ...o, ...offerText(o, run.value.yakuLevels), blocker: buyBlocker(run.value, i) })),
);
/** 直前に買えなかった理由の案内 */
const notice = ref('');
const NOTICES: Partial<Record<BuyBlocker, string>> = {
  charmsFull: `お守りは${MAX_CHARMS}つまでです。どれかを売ってから買ってください。`,
  consumablesFull: `消耗品は${MAX_CONSUMABLES}つまでしか持てません。`,
};

/** 牌の改造で対象を選んでいる品物の番号 */
const picking = ref<number | null>(null);
const pickingOffer = computed(() => {
  const o = picking.value === null ? undefined : offers.value[picking.value];
  return o?.kind === 'mod' ? o : null;
});

function act(action: GameAction) {
  notice.value = '';
  store.act(action);
}

function buy(index: number) {
  const o = offers.value[index];
  if (o.blocker) {
    notice.value = NOTICES[o.blocker] ?? '';
    return;
  }
  if (o.kind === 'mod') picking.value = index;
  else act({ type: 'buy', index });
}

function pick(kind: Kind) {
  if (picking.value === null) return;
  act({ type: 'buy', index: picking.value, target: kind });
  picking.value = null;
}

const comp = computed(() => run.value.composition);
const equipNames = computed(() => run.value.equipment.map((id) => equipDef(id).name).join('、') || 'なし');
</script>

<template>
  <SheetLayer v-if="pickingOffer" :label="pickingOffer.name">
    <h2>{{ pickingOffer.name }}</h2>
    <p class="note">{{ pickingOffer.description }}。対象の牌を選んでください（祝儀{{ pickingOffer.price }}）。</p>
    <div class="picker">
      <button
        v-for="k in ALL_KINDS"
        :key="k"
        class="pick"
        type="button"
        :disabled="!canModify(comp, pickingOffer.id, k)"
        @click="pick(k)"
      >
        <MjTile :kind="k" :red="comp.red[k] > 0 && pickingOffer.id === 'shu'" size="sm" />
        <small>{{ compositionText(comp, k) }}</small>
      </button>
    </div>
    <button class="btn" type="button" @click="picking = null">やめる</button>
  </SheetLayer>

  <SheetLayer v-else label="ショップ">
    <h2>ショップ<span class="pts">祝儀 {{ run.money }}</span></h2>
    <p v-if="notice" class="note warn" role="alert">{{ notice }}</p>
    <div class="cards">
      <div v-for="(o, i) in offers" :key="i" class="card" :class="{ sold: o.sold }">
        <div class="ct">
          <span class="ty">{{ OFFER_KIND_LABEL[o.kind] }}</span><b>{{ o.name }}</b>
        </div>
        <p>{{ o.description }}</p>
        <!-- 枠がいっぱいのときは押せるようにしておき、押したら理由を案内する -->
        <button
          class="btn"
          :class="{ buy: !o.sold }"
          type="button"
          :disabled="o.blocker === 'sold' || o.blocker === 'money'"
          @click="buy(i)"
        >
          {{ o.sold ? '購入済み' : `買う ${o.price}` }}
        </button>
      </div>
    </div>
    <div class="actions">
      <button class="btn" type="button" :disabled="run.money < REROLL_PRICE" @click="act({ type: 'reroll' })">
        品替え {{ REROLL_PRICE }}
      </button>
      <button class="btn win" type="button" @click="act({ type: 'leave' })">次へ</button>
    </div>
    <p class="note">
      お守り {{ run.charms.length }}/{{ MAX_CHARMS }} ・ 消耗品 {{ run.consumables.length }}/{{ MAX_CONSUMABLES }} ・ 設備
      {{ equipNames }}
    </p>
    <div v-if="run.charms.length" class="owns">
      <span v-for="(id, i) in run.charms" :key="`${id}-${i}`" class="own">
        <b>{{ charmDef(id).name }}</b>
        <small>{{ charmDef(id).description }}</small>
        <button class="ghost" type="button" @click="act({ type: 'sell', index: i })">売る +{{ SELL_PRICE }}</button>
      </span>
    </div>
  </SheetLayer>
</template>
