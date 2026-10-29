<script setup lang="ts">
/**
 * 役と遊び方（docs/SPEC.md §6 フェーズ 3.5）。種類ごとのタブで役を並べ、組み合わせの役は牌の絵で例を示す。
 * 遊び方（ランの流れ）、点数表、アイテムの説明もここに置く。
 */
import { computed, ref } from 'vue';
import {
  BOSSES,
  CHARMS,
  CONSUMABLES,
  DEFAULT_BASE_RULES,
  EQUIPMENT,
  MAX_CHARMS,
  MAX_CONSUMABLES,
  MODS,
  SELL_PRICES,
  modifiersFor,
  notenPenalty,
} from '@pujan/engine';
import { SCORE_TABLE, YAKU_TABS } from '@/lib/help';
import { GUIDE_PAGES } from '@/lib/tutorial';
import MjTile from '../MjTile.vue';
import SheetLayer from '../SheetLayer.vue';

const props = withDefaults(defineProps<{ initialTab?: string }>(), { initialTab: 'guide' });
const emit = defineEmits<{ close: []; openTutorial: [] }>();

const TABS = [
  { id: 'guide', label: '遊び方' },
  ...YAKU_TABS.map((t) => ({ id: t.id, label: t.label })),
  { id: 'score', label: '点数' },
  { id: 'items', label: 'アイテム' },
];
const tab = ref(props.initialTab);
const yakuTab = computed(() => YAKU_TABS.find((t) => t.id === tab.value));

/** アイテムの種類ごとの一覧。お守りはビルドの軸（docs/SPEC.md §4.5）の順にまとめる */
const plain = (list: readonly { name: string; description: string }[]) =>
  list.map((x) => ({ name: x.name, tag: '', description: x.description }));
const axisOrder = [...new Set(CHARMS.map((c) => c.axis))];
/** リーチ中も使える消耗品の名前（「延長札」） */
const riichiUsable = CONSUMABLES.filter((c) => c.usableInRiichi)
  .map((c) => c.name)
  .join('・');
const ITEM_SECTIONS = [
  {
    title: `お守り（${MAX_CHARMS}つまで。売ると祝儀${SELL_PRICES.charm}）`,
    rows: [...CHARMS]
      .sort((a, b) => axisOrder.indexOf(a.axis) - axisOrder.indexOf(b.axis))
      .map((c) => {
        // 役で解禁されるお守りは、その条件を説明に添える
        const description = c.unlockYaku ? `${c.description}（${c.unlockYaku}で和了るとショップに並ぶ）` : c.description;
        return { name: c.name, tag: c.axis, description };
      }),
  },
  { title: '設備（ずっと効く強化）', rows: plain(EQUIPMENT) },
  {
    title: `消耗品（${MAX_CONSUMABLES}つまで。局の中で1回使う。${riichiUsable}のほかはリーチ中は使えない。売ると祝儀${SELL_PRICES.consumable}）`,
    rows: plain(CONSUMABLES),
  },
  { title: '牌の改造（山の構成を変える。ランの間ずっと残る）', rows: plain(MODS) },
  { title: 'ボス（各場の4局目の縛り）', rows: plain(BOSSES) },
];

/** 流局の聴牌料と、親のノーテン罰符（本場なし） */
const tenpaiFee = modifiersFor(DEFAULT_BASE_RULES, { charms: [], equipment: [] }, null).tenpaiFee;
const helpGuides = GUIDE_PAGES.filter((g) => g.inHelp);
</script>

<template>
  <SheetLayer label="役と遊び方" dismissible @close="emit('close')">
    <h2>役と遊び方</h2>
    <div class="tabs" role="tablist" aria-label="ヘルプの種類">
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        role="tab"
        class="tab"
        :class="{ on: tab === t.id }"
        :aria-selected="tab === t.id"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <div role="tabpanel">
      <template v-if="tab === 'guide'">
        <section v-for="g in helpGuides" :key="g.title" class="guide">
          <h3>{{ g.title }}</h3>
          <p v-for="(text, i) in g.body" :key="i" class="note">{{ text }}</p>
        </section>
        <section class="guide">
          <h3>和了形</h3>
          <p class="note">
            手牌4枚とツモ牌、保留牌から5枚で和了ります。形は対子＋面子（順子か刻子）が基本で、特別な形の役もあります。役がなくても100点で和了れます。
          </p>
        </section>
        <button class="btn" type="button" @click="emit('openTutorial')">チュートリアルをもう一度</button>
      </template>

      <template v-else-if="yakuTab">
        <p v-if="yakuTab.note" class="note">{{ yakuTab.note }}</p>
        <div class="yaku-list">
          <div v-for="y in yakuTab.rows" :key="y.name" class="yaku">
            <div class="head">
              <b>{{ y.name }}</b><span class="han">{{ y.han }}</span>
            </div>
            <p class="note">{{ y.condition }}</p>
            <div v-if="y.example" class="tilesline" :aria-label="`${y.name}の例`">
              <MjTile v-for="(kind, i) in y.example" :key="i" :kind="kind" size="sm" />
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'score'">
        <div class="yakulist">
          <template v-for="[han, points] in SCORE_TABLE" :key="han">
            <span>{{ han }}</span><span>{{ points }}</span>
          </template>
        </div>
        <p class="note">
          点数には次の順で掛け合わせ・足し合わせます: 役の巻物のレベル（×1.5ずつ）→ 安手の美学（役なし×4）→ 親（×1.5）→ リーチ後の巡（＋100/巡）→ 本場（＋100/本場）。役満は重なれば倍数を足します。
        </p>
        <p class="note">
          流局時に聴牌していれば聴牌料{{ tenpaiFee }}点。親がノーテンで流局すると罰符{{ notenPenalty(0) }}点×（本場数＋1）。
        </p>
      </template>

      <template v-else-if="tab === 'items'">
        <p class="note">局が終わるたびにショップが開き、和了でもらった祝儀でアイテムを買えます。品替えは祝儀2。</p>
        <section v-for="sec in ITEM_SECTIONS" :key="sec.title" class="guide">
          <h3>{{ sec.title }}</h3>
          <div class="ref">
            <template v-for="r in sec.rows" :key="r.name">
              <span>{{ r.name }}</span><span class="h">{{ r.tag }}</span><span class="c">{{ r.description }}</span>
            </template>
          </div>
        </section>
        <section class="guide">
          <h3>役の巻物</h3>
          <p class="note">指定の役を含む和了の点数が×1.5になります。重ねがけできます（2本で×2.25）。</p>
          <p class="note">その役で一度和了ると、ショップに並ぶようになります。</p>
        </section>
        <section class="guide">
          <h3>組み合わせのヒント</h3>
          <p class="note">・速攻: 物置（保留枠＋1）や千里眼（ネクスト＋1）で早く和了り、安手の美学で役なしを4倍に。</p>
          <p class="note">・門前・リーチ: 黙聴や一発屋で、保留を使わずに翻を稼ぐ。</p>
          <p class="note">・役満: 写し（牌を5枚に）・抜き取りで山を偏らせ、化け猫（ドラが万能牌）で一発を狙う。</p>
          <p class="note">・親番: 親父の背中・居座りで、連荘するほど点数が伸びる。</p>
        </section>
      </template>
    </div>

    <button class="btn" type="button" @click="emit('close')">閉じる</button>
  </SheetLayer>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
}
.tab {
  flex: 0 0 auto;
  font: inherit;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.tab.on {
  background: var(--fg);
  color: var(--felt-dark);
  border-color: var(--fg);
  font-weight: 700;
}
.yaku-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.yaku {
  border-top: 1px solid var(--line);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.yaku .head {
  display: flex;
  justify-content: space-between;
}
.yaku .han {
  color: var(--gold);
  font-variant-numeric: tabular-nums;
}
.guide {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}
.guide h3 {
  margin: 0;
  font-size: 15px;
}
.tilesline {
  padding-bottom: 4px;
}
</style>
