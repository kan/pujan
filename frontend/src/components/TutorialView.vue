<script setup lang="ts">
/**
 * チュートリアル（docs/SPEC.md §6 フェーズ 3.5）。TAKO-SEN のチュートリアルと同じく、言われた操作を実際にしてもらい、
 * できたら次の段階へ進む。練習の局は山の並びを決めてある（lib/tutorial.ts）。和了ったあとはランの流れを説明する。
 * 初めて開いたとき（firstVisit）は、見るかどうかを先に聞く。
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { isActing, step, type KyokuMove, type Zone } from '@pujan/engine';
import { GUIDE_PAGES, PLAY_STEPS, isExpectedMove, kindAt, nextTarget, tutorialKyoku } from '@/lib/tutorial';
import { winPreviewOf } from '@/lib/win-preview';
import { trapDialogFocus } from '@/lib/dialog';
import HandArea from './HandArea.vue';

const props = defineProps<{ firstVisit: boolean }>();
const emit = defineEmits<{ close: [] }>();

type Phase = 'intro' | 'play' | 'guide';
const phase = ref<Phase>(props.firstVisit ? 'intro' : 'play');
const k = ref(tutorialKyoku());
const stepIndex = ref(0);
const page = ref(0);
const hint = ref('');
const selection = ref<{ zone: Zone; index: number } | null>({ zone: 'drawn', index: 0 });
const root = ref<HTMLElement>();

onMounted(async () => {
  await nextTick();
  root.value?.focus();
});

const current = computed(() => PLAY_STEPS[stepIndex.value]);
const acting = computed(() => isActing(k.value));
/** 今のツモで和了れるときの役と点数（局の画面と同じもの） */
const win = computed(() => winPreviewOf(k.value));
const usedIds = computed(() => win.value?.tileIds ?? new Set<number>());

/** 次に押すところ（光らせる）。牌を選ぶと、次に押すところへ移る */
const target = computed(() => nextTarget(current.value, kindAt(k.value, selection.value)));
const pulse = computed(() => ('button' in target.value ? null : target.value));
const canHold = computed(() => acting.value && !!selection.value && selection.value.zone !== 'hold' && k.value.hold.includes(null));

/** 言われた操作なら局を進めて次の段階へ。違えば案内を出す */
function attempt(move: KyokuMove) {
  if (!isExpectedMove(current.value, move, k.value)) {
    hint.value = current.value.hint;
    return;
  }
  hint.value = '';
  k.value = step(k.value, move);
  selection.value = isActing(k.value) ? { zone: 'drawn', index: 0 } : null;
  if (stepIndex.value < PLAY_STEPS.length - 1) stepIndex.value++;
  else phase.value = 'guide';
}

function tapTile(zone: Zone, index: number) {
  if (!acting.value) return;
  const sel = selection.value;
  if (sel?.zone === zone && sel.index === index) attempt({ type: 'discard', zone, index });
  else selection.value = { zone, index };
}

function tapSlot(slot: number) {
  const sel = selection.value;
  // canHold は sel が手牌かツモ牌であることも見ている（ここでは型を絞るために書く）
  if (canHold.value && sel && sel.zone !== 'hold') attempt({ type: 'hold', zone: sel.zone, index: sel.index, slot });
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
  else trapDialogFocus(e, root.value);
}
</script>

<template>
  <div ref="root" class="tutorial" role="dialog" aria-modal="true" aria-label="チュートリアル" tabindex="-1" @keydown="onKeydown">
    <div class="app">
      <header>
        <h1>遊び方</h1>
        <span v-if="phase === 'play'" class="progress">{{ stepIndex + 1 }} / {{ PLAY_STEPS.length }}</span>
        <span v-else-if="phase === 'guide'" class="progress">説明 {{ page + 1 }} / {{ GUIDE_PAGES.length }}</span>
        <span class="spacer" />
        <button v-if="phase !== 'intro'" class="ghost" type="button" @click="emit('close')">閉じる</button>
      </header>

      <template v-if="phase === 'intro'">
        <section class="lesson">
          <h2>チュートリアルを見ますか？</h2>
          <p>
            Pu-Jan は、手牌を5枚（対子＋面子）に縮めた麻雀です。練習の局で、牌の捨て方・保留・ネクスト・和了を実際に試してから、ランの流れを説明します（3分ほど）。
          </p>
          <p class="note">あとで見るときは、メニューの「遊び方（チュートリアル）」から開けます。</p>
        </section>
        <span class="stage" />
        <div class="actions">
          <button class="btn" type="button" @click="emit('close')">あとで</button>
          <button class="btn win" type="button" @click="phase = 'play'">見る</button>
        </div>
      </template>

      <template v-else-if="phase === 'play'">
        <section class="lesson" aria-live="polite">
          <h2>{{ current.title }}</h2>
          <p>{{ current.instruction }}</p>
          <p v-if="hint" class="note warn" role="alert">{{ hint }}</p>
        </section>
        <div class="stage">
          <div v-if="win" class="callout win">
            <span class="msg">和了れます</span>
            <span class="yk">{{ win.names.join('・') }}</span>
            <span class="pt">{{ win.points.toLocaleString() }}点</span>
          </div>
        </div>
        <HandArea
          :kyoku="k"
          :selection="selection"
          :used-ids="usedIds"
          :can-hold="canHold"
          :pulse="pulse"
          @tap-tile="tapTile"
          @tap-slot="tapSlot"
        />
        <div class="actions">
          <!-- 「保留」ボタンは保留の段階だけ出す（ほかの段階では押す必要がなく、紛らわしい） -->
          <button
            v-if="canHold && current.action === 'hold'"
            class="btn"
            :class="{ pulse: 'slot' in target }"
            type="button"
            @click="tapSlot(k.hold.indexOf(null))"
          >
            保留
          </button>
          <button
            v-if="win"
            class="btn win wide"
            :class="{ pulse: 'button' in target }"
            type="button"
            @click="attempt({ type: 'tsumo' })"
          >
            和了 {{ win.points.toLocaleString() }}
          </button>
        </div>
      </template>

      <template v-else>
        <section class="lesson">
          <h2>{{ GUIDE_PAGES[page].title }}</h2>
          <p v-for="(text, i) in GUIDE_PAGES[page].body" :key="i">{{ text }}</p>
        </section>
        <span class="stage" />
        <div class="actions">
          <button class="btn" type="button" :disabled="page === 0" @click="page--">戻る</button>
          <button v-if="page < GUIDE_PAGES.length - 1" class="btn win" type="button" @click="page++">次へ</button>
          <button v-else class="btn win" type="button" @click="emit('close')">遊び始める</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tutorial {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: radial-gradient(120% 80% at 50% 30%, #245442 0%, var(--felt) 45%, var(--felt-dark) 100%);
  background-color: var(--felt);
  overflow: auto;
}
.progress {
  font-size: 12px;
  color: var(--muted);
}
.lesson {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lesson h2 {
  font-family: var(--f-tile);
  font-size: 20px;
  margin: 0;
  letter-spacing: 0.06em;
}
.lesson p {
  margin: 0;
  line-height: 1.7;
  font-size: 14px;
}
</style>
