<script setup lang="ts">
/**
 * 局の画面（docs/SPEC.md §2.2）。プロトタイプの render() を上から順に写したもの。
 * ショップや和了のシートが開いている間も、直前の局を後ろに表示しておく。
 */
import { computed, ref, watch } from 'vue';
import { MAX_CHARMS, SOME_COLORS, bossOf, isDealerKyoku, turnLimit, type ConsumableId } from '@pujan/engine';
import { useGameStore } from '@/stores/game';
import { WIND_NAMES, bossDef, consumableDef, modifiedKinds, roundLabel } from '@/lib/labels';
import HandArea from './HandArea.vue';
import MjTile from './MjTile.vue';

const emit = defineEmits<{ openHelp: []; openMenu: []; openInventory: [] }>();
const store = useGameStore();
/** 河を広げて全部見せる */
const riverOpen = ref(false);

const run = computed(() => store.run);
const k = computed(() => store.shownKyoku);
const wind = computed(() => WIND_NAMES[run.value.wave]);
const round = computed(() => run.value.round);
/** 牌山を改造した（持ち物のボタンに印を出す） */
const modded = computed(() => modifiedKinds(run.value).size > 0);

const turnsLeft = computed(() => (k.value ? turnLimit(k.value) - k.value.turn : 0));

/** 色を選んでいる染め粉の番号（持ち物の消耗品の何番目か） */
const dyeIndex = ref<number | null>(null);
/** 色の選択を出す（局が進んで染め粉が使えなくなったら閉じる） */
const pickingDye = computed(
  () => dyeIndex.value !== null && run.value.consumables[dyeIndex.value] === 'some' && store.consumableUsable('some'),
);

// 局が進んだら（打牌・和了・次の局）色の選択を閉じる。開いたままだと、次に使えるときに勝手に出てくる
watch(
  () => store.kyoku,
  () => (dyeIndex.value = null),
);

function tapConsumable(id: ConsumableId, index: number) {
  if (id === 'some') {
    dyeIndex.value = dyeIndex.value === index ? null : index;
    return;
  }
  dyeIndex.value = null;
  store.act({ type: 'useConsumable', index });
}

function useDye(color: number) {
  if (dyeIndex.value === null) return;
  store.act({ type: 'useConsumable', index: dyeIndex.value, color });
  dyeIndex.value = null;
}
const boss = computed(() => {
  const id = bossOf(run.value);
  return id ? bossDef(id) : null;
});
const jokerDora = computed(() => !!k.value && k.value.setup.mods.doraMode !== 'normal');
const progress = computed(() => Math.max(0, Math.min(100, (round.value.score / round.value.target) * 100)));

const sel = computed(() => store.selection);
const usedIds = computed(() => store.winPreview?.tileIds ?? new Set<number>());

/** 操作ボタンが 1 つでも出ている */
const hasAction = computed(() => store.canRedealNow || store.canHold || store.canRiichiSelected || !!store.winPreview);

/** 中央の案内の文 */
const hint = computed(() => {
  const kk = k.value;
  if (!kk || !store.acting) return '';
  if (kk.riichi) return 'リーチ中：ツモ切りのみ。ネクストは見えません';
  if (sel.value?.zone === 'hold') return 'もう一度タップで捨てる。空いた枠にツモ牌が入ります';
  if (sel.value) return `もう一度タップで捨てる${kk.hold.includes(null) ? '／空き枠をタップで保留' : ''}`;
  return '';
});
</script>

<template>
  <div class="app">
    <header>
      <h1>プチ麻雀<span class="beta" title="β版">β</span></h1>
      <span class="spacer" />
      <button class="ghost" type="button" @click="emit('openHelp')">役</button>
      <button class="ghost" type="button" aria-haspopup="dialog" @click="emit('openMenu')">メニュー</button>
    </header>

    <section class="band" aria-label="局の状況">
      <div class="segs">
        <span
          v-for="i in 4"
          :key="i"
          class="seg"
          :class="{ cur: i - 1 === round.kyoku, done: i - 1 < round.kyoku }"
        >
          {{ wind }}{{ i }}
          <span v-if="i - 1 === round.dealer" class="oya">親</span>
          <span v-if="i === 4" class="boss">ボス</span>
        </span>
      </div>
      <div class="nums">
        <span class="rd">{{ roundLabel(run.wave, round.kyoku, round.honba, isDealerKyoku(run)) }}</span>
        <span v-if="k" class="tn" :class="{ last: turnsLeft === 0, low: turnsLeft > 0 && turnsLeft <= 3 }">
          <template v-if="turnsLeft === 0"><b>最終巡</b></template>
          <template v-else>巡 <b>{{ k.turn }}</b>/{{ turnLimit(k) }}・残り{{ turnsLeft }}</template>
        </span>
        <span class="sc">{{ round.score.toLocaleString() }}<small> / {{ round.target.toLocaleString() }}</small></span>
      </div>
      <div class="bar"><i :style="{ width: `${progress}%` }" /></div>
    </section>

    <div v-if="k" class="info">
      <span v-if="k.riichi" class="badge">リーチ</span>
      <span v-if="boss" class="c boss" :title="boss.description">ボス <b>{{ boss.name }}</b></span>
      <span v-for="(ind, i) in k.indicators" :key="ind.id" class="c">
        <MjTile :kind="ind.kind" :red="ind.red" :gold="ind.gold" size="sm" />→<MjTile
          :kind="k.doraKinds[i]"
          :joker="store.jokerOf(k.doraKinds[i])"
          size="sm"
        />
        <b>{{ jokerDora ? '万能牌' : 'ドラ' }}</b>
      </span>
      <span class="c">自風 <MjTile :kind="k.setup.seat" size="sm" /></span>
    </div>

    <div class="info inv">
      <span class="c money">祝儀 <b>{{ run.money }}</b></span>
      <!-- 設備と牌山もここから見るので、お守りの数だけでなく「持ち物」と書く -->
      <button class="c" type="button" aria-haspopup="dialog" @click="emit('openInventory')">
        持ち物 <b>{{ run.charms.length }}/{{ MAX_CHARMS }}</b>
        <span v-if="run.equipment.length" class="sub">設備{{ run.equipment.length }}</span>
        <span v-if="modded" class="sub">改造</span>
      </button>
      <button
        v-for="(id, i) in run.consumables"
        :key="`${id}-${i}`"
        class="c use"
        :class="{ on: pickingDye && dyeIndex === i }"
        type="button"
        :title="consumableDef(id).description"
        :disabled="!store.consumableUsable(id)"
        @click="tapConsumable(id, i)"
      >
        {{ consumableDef(id).name }}
      </button>
    </div>
    <div v-if="pickingDye" class="info inv dye" role="group" aria-label="染め粉で残す色">
      <span>残す色</span>
      <button v-for="(name, color) in SOME_COLORS" :key="name" class="c use" type="button" @click="useDye(color)">
        {{ name }}
      </button>
      <button class="c" type="button" @click="dyeIndex = null">やめる</button>
    </div>

    <button
      v-if="k"
      class="river"
      :class="{ open: riverOpen }"
      type="button"
      :aria-label="`河 ${k.river.length}枚（タップで開閉）`"
      :aria-expanded="riverOpen"
      @click="riverOpen = !riverOpen"
    >
      <span class="rl">河 {{ k.river.length }}</span>
      <span class="rt">
        <template v-if="k.river.length">
          <MjTile v-for="t in k.river" :key="t.id" :kind="t.kind" :red="t.red" :gold="t.gold" size="xs" />
        </template>
        <span v-else class="empty">まだ捨て牌はありません</span>
      </span>
    </button>

    <div class="stage">
      <div class="callout" :class="{ win: store.winPreview }" aria-live="polite">
        <template v-if="store.winPreview">
          <span class="msg">和了れます</span>
          <span class="yk">{{ store.winPreview.names.join('・') }}</span>
          <span class="pt">{{ store.winPreview.points.toLocaleString() }}点</span>
          <span v-if="store.winPreview.jokerKinds.length" class="msg jk">
            万能牌は
            <MjTile v-for="(kind, i) in store.winPreview.jokerKinds" :key="i" :kind="kind" size="xs" />
            として
          </span>
        </template>
        <template v-else>
          <span v-if="hint" class="msg">{{ hint }}</span>
          <template v-if="store.waitsInfo.length">
            <span v-if="!k?.riichi" class="msg">待ち</span>
            <div class="waits">
              <span v-for="w in store.waitsInfo" :key="w.kind" class="w" :class="{ dead: !w.remaining }">
                <MjTile :kind="w.kind" :joker="store.jokerOf(w.kind)" size="sm" />残{{ w.remaining }}
              </span>
            </div>
          </template>
        </template>
      </div>
    </div>

    <HandArea
      v-if="k"
      :kyoku="k"
      :selection="store.selection"
      :used-ids="usedIds"
      :can-hold="store.canHold"
      @tap-tile="store.tapTile"
      @tap-slot="store.tapSlot"
    />

    <div class="actions">
      <template v-if="store.acting">
        <button v-if="store.canRedealNow" class="btn" type="button" @click="store.act({ type: 'redeal' })">配牌を引き直す</button>
        <button v-if="store.canHold" class="btn" type="button" @click="store.holdSelected()">保留</button>
        <button v-if="store.canRiichiSelected" class="btn riichi" type="button" @click="store.riichiSelected()">リーチ</button>
        <button v-if="store.winPreview" class="btn win wide" type="button" @click="store.act({ type: 'tsumo' })">
          和了 {{ store.winPreview.points.toLocaleString() }}
        </button>
        <span v-if="!hasAction" class="idle">捨てる牌を選んでください</span>
      </template>
    </div>
  </div>
</template>
