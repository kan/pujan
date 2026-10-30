<script setup lang="ts">
/**
 * ショップ（docs/SPEC.md §2.3、§4.4）。品物 3 つ、品替え、持っているお守りと消耗品の売却。
 * 買えるかどうかは engine の buyBlocker に聞き、買えない理由を案内する。
 * 牌の改造を買うときは、対象の牌を選ぶ画面に切り替える。
 */
import { computed, ref } from 'vue';
import {
  ALL_KINDS,
  GACHA,
  MAX_CHARMS,
  MAX_CONSUMABLES,
  REROLL_PRICE,
  SELL_PRICES,
  buyBlocker,
  canGacha,
  canModify,
  gachaRefund,
  hasGacha,
  innateCharms,
  type BuyBlocker,
  type GameAction,
  type Kind,
} from '@pujan/engine';
import { useGameStore } from '@/stores/game';
import { OFFER_KIND_LABEL } from '@pujan/engine';
import { GACHA_TEXT, charmDef, charmSlotText, compositionText, consumableDef, equipDef, modifiedKinds, offerText, receivedText } from '@/lib/labels';
import MjTile from '../MjTile.vue';
import SheetLayer from '../SheetLayer.vue';

const emit = defineEmits<{ openInventory: [] }>();
const store = useGameStore();
const run = computed(() => store.run);
const offers = computed(() =>
  (run.value.shop ?? []).map((o, i) => ({ ...o, ...offerText(o, run.value.yakuLevels), blocker: buyBlocker(run.value, i) })),
);
/** 直前に買えなかった理由の案内 */
const notice = ref('');
const NOTICES: Partial<Record<BuyBlocker, string>> = {
  charmsFull: `お守りは${MAX_CHARMS}つまでです。どれかを売ってから買ってください。`,
  consumablesFull: `消耗品は${MAX_CONSUMABLES}つまでです。どれかを売ってから買ってください。`,
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

const gachaOk = computed(() => canGacha(run.value));
/** 雀士の固有のお守り */
const innate = computed(() => innateCharms(run.value));
/** 福引きで当たった品の名前と説明。役の巻物はもう受け取ったので、受け取る前のレベルから名前を作る */
const prize = computed(() => {
  const p = run.value.gacha?.prize;
  return p ? { ...p, ...receivedText(p, run.value.yakuLevels) } : null;
});
/** 直前のオーラスの和了でもらった品 */
const orasuPrize = computed(() => {
  const p = run.value.orasuPrize;
  return p ? { ...p, ...receivedText(p, run.value.yakuLevels) } : null;
});

const comp = computed(() => run.value.composition);
const modified = computed(() => modifiedKinds(run.value));
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
        :class="{ changed: modified.has(k) }"
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
    <p v-if="orasuPrize" class="note">
      オーラスの和了の褒美に、{{ OFFER_KIND_LABEL[orasuPrize.kind] }}「{{ orasuPrize.name }}」をもらいました（{{ orasuPrize.description }}）。
    </p>
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
    <div v-if="hasGacha(run)" class="card gacha">
      <div class="ct">
        <span class="ty">福引き</span>
        <b v-if="!run.gacha">何が当たるかはお楽しみ</b>
        <b v-else-if="prize">当たり！ {{ OFFER_KIND_LABEL[prize.kind] }}「{{ prize.name }}」</b>
        <b v-else>はずれ</b>
      </div>
      <p v-if="!run.gacha">
        {{ GACHA_TEXT }}。ショップごとに1回。
        <template v-if="run.gachaTickets">福引き券 {{ run.gachaTickets }}枚（先に使う）</template>
      </p>
      <p v-else-if="prize">{{ prize.description }}</p>
      <p v-else>{{ run.gacha.ticket ? '福引き券で回したので、祝儀は戻りません。' : `祝儀${gachaRefund(run.gacha)}が戻りました。` }}</p>
      <button
        class="btn"
        :class="{ buy: gachaOk }"
        type="button"
        :disabled="!gachaOk"
        @click="act({ type: 'gacha' })"
      >
        {{ run.gacha ? '回した' : run.gachaTickets ? '券で回す' : `回す ${GACHA.price}` }}
      </button>
    </div>
    <div class="actions">
      <button class="btn" type="button" :disabled="run.money < REROLL_PRICE" @click="act({ type: 'reroll' })">
        品替え {{ REROLL_PRICE }}
      </button>
      <button class="btn win" type="button" @click="act({ type: 'leave' })">次へ</button>
    </div>
    <p class="note">
      {{ charmSlotText(run) }} ・ 消耗品 {{ run.consumables.length }}/{{ MAX_CONSUMABLES }} ・ 設備
      {{ equipNames }}
    </p>
    <!-- 牌の改造を買う前に、今の牌山を確かめられるように（閉じるとショップに戻る） -->
    <button class="ghost" type="button" aria-haspopup="dialog" @click="emit('openInventory')">持ち物と牌山を見る</button>
    <div v-if="innate.length || run.charms.length || run.consumables.length" class="owns">
      <!-- 固有のお守りは売れないので、売るボタンを出さない -->
      <span v-for="id in innate" :key="`innate-${id}`" class="own">
        <b>{{ charmDef(id).name }}</b>
        <small>固有のお守り（枠に数えず、売れない）: {{ charmDef(id).description }}</small>
      </span>
      <span v-for="(id, i) in run.charms" :key="`charm-${id}-${i}`" class="own">
        <b>{{ charmDef(id).name }}</b>
        <small>お守り: {{ charmDef(id).description }}</small>
        <button class="ghost" type="button" @click="act({ type: 'sell', index: i })">売る +{{ SELL_PRICES.charm }}</button>
      </span>
      <span v-for="(id, i) in run.consumables" :key="`consumable-${id}-${i}`" class="own">
        <b>{{ consumableDef(id).name }}</b>
        <small>消耗品: {{ consumableDef(id).description }}</small>
        <button class="ghost" type="button" @click="act({ type: 'sellConsumable', index: i })">
          売る +{{ SELL_PRICES.consumable }}
        </button>
      </span>
    </div>
  </SheetLayer>
</template>
