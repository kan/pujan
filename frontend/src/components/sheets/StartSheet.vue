<script setup lang="ts">
/**
 * ランの準備（docs/SPEC.md §2.3・§4.6）。雀士と段位を選んで新しいランを始める。
 * まだ選べない雀士と段位は、解禁の条件を見せて選べなくする。
 */
import { computed, ref, watch } from 'vue';
import {
  CHARACTERS,
  DANS,
  characterUnlocked,
  clampChoice,
  makeStart,
  maxDan,
  runRulesFor,
  type CharacterId,
  type RunChoice,
} from '@pujan/engine';
import { useAccountStore } from '@/stores/account';
import { charmDef, equipDef } from '@/lib/labels';
import { browserStorage, loadChoice } from '@/lib/storage';
import CharacterIcon from '../CharacterIcon.vue';
import SheetLayer from '../SheetLayer.vue';

/** inProgress: 今のランがまだ終わっていない（やめることになると知らせる） */
const props = defineProps<{ inProgress: boolean }>();
const emit = defineEmits<{ close: []; start: [choice: RunChoice] }>();
const account = useAccountStore();

const top = computed(() => maxDan(account.progress));
const unlocked = (id: CharacterId) => characterUnlocked(account.progress, id);

// 前のランで選んだものをはじめから選んでおく（今は選べないものは選べる範囲に収める）。
// サーバーの解禁の状態があとから届いたら、まだ選び直していなければ収め直す
const saved = loadChoice(browserStorage());
const character = ref<CharacterId>('standard');
const dan = ref(0);
const touched = ref(false);
watch(
  () => account.progress,
  (p) => {
    if (touched.value) return;
    const c = clampChoice(p, saved);
    character.value = c.character;
    dan.value = c.dan;
  },
  { immediate: true },
);
function pick(c: Partial<RunChoice>) {
  touched.value = true;
  if (c.character) character.value = c.character;
  if (c.dan !== undefined) dan.value = c.dan;
}

/** サーバーの記録ではまだ選べない（端末だけのランで解禁した）ので、ランキングに載らない */
const notRanked = computed(() => {
  const sp = account.serverProgress;
  return !!sp && !makeStart(sp, character.value, dan.value);
});

/** 選んでいる雀士と段位で始めたときの条件 */
const rules = computed(() => runRulesFor({ character: character.value, dan: dan.value }));
const items = computed(() => [
  ...rules.value.charms.map((id) => charmDef(id).name),
  ...rules.value.equipment.map((id) => equipDef(id).name),
]);
</script>

<template>
  <SheetLayer label="ランの準備" dismissible @close="emit('close')">
    <h2>ランの準備</h2>

    <section aria-labelledby="start-character">
      <h3 id="start-character">雀士</h3>
      <div class="choices" role="radiogroup" aria-labelledby="start-character">
        <button
          v-for="c in CHARACTERS"
          :key="c.id"
          class="choice"
          type="button"
          role="radio"
          :aria-checked="character === c.id"
          :disabled="!unlocked(c.id)"
          :class="{ on: character === c.id }"
          @click="pick({ character: c.id })"
        >
          <CharacterIcon :id="c.id" :size="44" />
          <span class="text">
            <b>{{ c.name }}</b>
            <span v-if="unlocked(c.id)" class="note">{{ c.description }}</span>
            <span v-else class="note">🔒 {{ c.unlockText }}と解禁</span>
          </span>
        </button>
      </div>
    </section>

    <section aria-labelledby="start-dan">
      <h3 id="start-dan">段位</h3>
      <div class="dans" role="radiogroup" aria-labelledby="start-dan">
        <button
          v-for="d in DANS"
          :key="d.level"
          class="btn dan"
          type="button"
          role="radio"
          :aria-checked="dan === d.level"
          :disabled="d.level > top"
          :class="{ on: dan === d.level }"
          @click="pick({ dan: d.level })"
        >
          {{ d.level > top ? '🔒' : '' }}{{ d.name }}
        </button>
      </div>
      <ul class="note rules">
        <li v-for="d in DANS.slice(1, dan + 1)" :key="d.level">{{ d.name }}: {{ d.description }}</li>
        <li v-if="dan === 0">縛りなし。全場クリアすると次の段位を選べます</li>
      </ul>
    </section>

    <div class="yakulist">
      <span>場の目標点</span><span>{{ rules.targets.map((t) => t.toLocaleString()).join('・') }}</span>
      <span>保留・ネクスト</span><span>{{ rules.base.holdSlots }}枠・{{ rules.base.next }}枚</span>
      <span>1局の巡数</span><span>{{ rules.base.turns }}巡</span>
      <span>始めの祝儀</span><span>{{ rules.startMoney }}</span>
      <span>場を突破したときの祝儀</span><span>{{ rules.clearBonus }}＋利子など</span>
      <template v-if="items.length">
        <span>持ち物</span><span>{{ items.join('・') }}</span>
      </template>
    </div>

    <p v-if="notRanked" class="note warn">
      この雀士・段位はこの端末だけで解禁したものなので、このランはランキングに載りません。
    </p>
    <p v-if="props.inProgress" class="note warn">今のランはやめることになり、ランキングに記録されません。</p>
    <div class="actions">
      <button class="btn" type="button" @click="emit('close')">やめる</button>
      <button class="btn win" type="button" @click="emit('start', { character, dan })">始める</button>
    </div>
  </SheetLayer>
</template>

<style scoped>
h3 {
  margin: 0 0 6px;
  font-size: 14px;
  color: var(--muted);
}
.choices {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.choice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  text-align: left;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 8px;
  cursor: pointer;
}
.text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.choice b {
  font-size: 16px;
}
.choice:disabled .character-icon {
  filter: grayscale(1);
}
.choice.on,
.dan.on {
  border-color: var(--gold);
  color: var(--gold);
}
.choice:disabled,
.dan:disabled {
  opacity: 0.5;
  cursor: default;
}
.choice:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
.dans {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.rules {
  margin: 6px 0 0;
  padding-left: 18px;
}
</style>
