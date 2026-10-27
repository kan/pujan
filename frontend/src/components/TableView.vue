<script setup lang="ts">
/**
 * 局の画面（docs/SPEC.md §2.2）。プロトタイプの render() を上から順に写したもの。
 * ショップや和了のシートが開いている間も、直前の局を後ろに表示しておく。
 */
import { computed, ref } from 'vue';
import { MAX_CHARMS, bossOf, isDealerKyoku } from '@pujan/engine';
import { useGameStore } from '@/stores/game';
import { WIND_NAMES, bossDef, consumableDef, roundLabel } from '@/lib/labels';
import MjTile from './MjTile.vue';

const emit = defineEmits<{ openRef: []; openSettings: []; openInventory: []; openRanking: [] }>();
const store = useGameStore();
/** 河を広げて全部見せる */
const riverOpen = ref(false);

const run = computed(() => store.run);
const k = computed(() => store.shownKyoku);
const wind = computed(() => WIND_NAMES[run.value.wave]);
const round = computed(() => run.value.round);

const turnsLeft = computed(() => (k.value ? k.value.setup.mods.turns - k.value.turn : 0));
const boss = computed(() => {
  const id = bossOf(run.value);
  return id ? bossDef(id) : null;
});
const jokerDora = computed(() => !!k.value && k.value.setup.mods.doraMode !== 'normal');
const progress = computed(() => Math.max(0, Math.min(100, (round.value.score / round.value.target) * 100)));

const sel = computed(() => store.selection);
const isSel = (zone: string, index: number) => !!sel.value && sel.value.zone === zone && sel.value.index === index;
const usedIds = computed(() => store.winPreview?.tileIds ?? new Set<number>());

const nextMany = computed(() => store.nextTiles.length > 3);
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
      <h1>プチ麻雀</h1>
      <span class="spacer" />
      <button class="ghost" type="button" @click="emit('openRanking')">順位</button>
      <button class="ghost" type="button" @click="emit('openRef')">役表</button>
      <button class="ghost" type="button" @click="emit('openSettings')">設定</button>
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
          <template v-else>巡 <b>{{ k.turn }}</b>/{{ k.setup.mods.turns }}・残り{{ turnsLeft }}</template>
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
      <button class="c" type="button" @click="emit('openInventory')">
        お守り <b>{{ run.charms.length }}/{{ MAX_CHARMS }}</b>
      </button>
      <button
        v-for="(id, i) in run.consumables"
        :key="`${id}-${i}`"
        class="c use"
        type="button"
        :disabled="!store.consumableUsable(id)"
        @click="store.act({ type: 'useConsumable', index: i })"
      >
        {{ consumableDef(id).name }}
      </button>
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

    <div v-if="k" class="play">
      <div class="holdrow">
        <span v-if="k.hold.length" class="hg">
          <span class="hl">保留</span>
          <template v-for="(t, i) in k.hold" :key="i">
            <MjTile
              v-if="t"
              :kind="t.kind"
              :red="t.red"
              :gold="t.gold"
              :joker="store.jokerOf(t.kind)"
              size="md"
              button
              note="（保留）"
              :selected="isSel('hold', i)"
              :used="usedIds.has(t.id)"
              @click="store.tapTile('hold', i)"
            />
            <button
              v-else
              class="slot"
              :class="{ target: store.canHold }"
              type="button"
              aria-label="空きの保留枠"
              @click="store.tapSlot(i)"
            >
              空き
            </button>
          </template>
        </span>
        <span v-if="store.nextTiles.length" class="nextin" :class="{ many: nextMany }" aria-label="次にツモる牌（左から順）">
          <span class="nl">次</span>
          <template v-for="(t, i) in store.nextTiles" :key="t.id">
            <span v-if="i" class="arr" aria-hidden="true">←</span>
            <MjTile :kind="t.kind" :red="t.red" :gold="t.gold" :joker="store.jokerOf(t.kind)" :size="nextMany ? 'sm' : 'md'" />
          </template>
        </span>
      </div>
      <div class="handrow">
        <MjTile
          v-for="(t, i) in k.hand"
          :key="t.id"
          :kind="t.kind"
          :red="t.red"
          :gold="t.gold"
          :joker="store.jokerOf(t.kind)"
          button
          :selected="isSel('hand', i)"
          :used="usedIds.has(t.id)"
          @click="store.tapTile('hand', i)"
        />
        <template v-if="k.drawn.length">
          <span class="gap" />
          <MjTile
            v-for="(t, i) in k.drawn"
            :key="t.id"
            class="drawn"
            :kind="t.kind"
            :red="t.red"
            :gold="t.gold"
            :joker="store.jokerOf(t.kind)"
            button
            note="（ツモ）"
            :selected="isSel('drawn', i)"
            :used="usedIds.has(t.id)"
            @click="store.tapTile('drawn', i)"
          />
        </template>
      </div>
    </div>

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
