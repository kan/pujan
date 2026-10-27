<script setup lang="ts">
/**
 * 週ごとのランキング（docs/SPEC.md §5.4）。突破した場の数 → 4 場の合計点の順。
 * 名前と公開への同意がないと載らないので、ここで名前を登録できる（kan/game docs/ID_DESIGN.md「名前」）。
 */
import { computed, onMounted, ref } from 'vue';
import { shiftDays, weekOf } from '@pujan/engine';
import type { WeeklyRanking } from '@/api/client';
import { useAccountStore } from '@/stores/account';
import { summaryText } from '@/lib/labels';
import SheetLayer from '../SheetLayer.vue';

const emit = defineEmits<{ close: [] }>();
const account = useAccountStore();

const ranking = ref<WeeklyRanking | null>(null);
const loading = ref(true);
/** 今週と、表示している週（月曜の日付）。読み込みに失敗しても、表示している週から前後へたどれる */
const thisWeek = weekOf(Date.now());
const week = ref(thisWeek);

async function load() {
  loading.value = true;
  ranking.value = await account.weeklyRanking(week.value);
  loading.value = false;
}
onMounted(load);

/** 「10月26日〜11月1日」 */
const weekLabel = computed(() => {
  const f = (s: string) => `${Number(s.slice(5, 7))}月${Number(s.slice(8, 10))}日`;
  return `${f(week.value)}〜${f(shiftDays(week.value, 6))}`;
});
const isThisWeek = computed(() => week.value >= thisWeek);

/** 前の週・次の週（「次の週」は今週では押せない） */
function go(weeks: number) {
  week.value = shiftDays(week.value, weeks * 7);
  void load();
}

const meListed = computed(() => !!ranking.value?.entries.some((e) => e.isMe));

/* 名前の登録 */
const nameInput = ref('');
const nameError = ref('');
const registering = ref(false);
const NAME_ERRORS: Record<string, string> = {
  name_taken: 'その名前はほかの人が使っています。',
  invalid_name: '名前は2〜20文字で、文字・数字・空白・「_」「-」・絵文字が使えます。',
  offline: 'サーバーにつながりません。あとでもう一度お試しください。',
};

async function register(value: string) {
  registering.value = true;
  nameError.value = '';
  const result = await account.registerName(value.trim());
  registering.value = false;
  if (result === 'ok') void load();
  else nameError.value = NAME_ERRORS[result] ?? '登録できませんでした。';
}
</script>

<template>
  <SheetLayer label="ランキング" dismissible @close="emit('close')">
    <h2>ランキング<span class="pts">{{ isThisWeek ? '今週' : '' }}</span></h2>
    <div class="actions">
      <button class="btn" type="button" :disabled="loading" @click="go(-1)">← 前の週</button>
      <button class="btn" type="button" :disabled="loading || isThisWeek" @click="go(1)">次の週 →</button>
    </div>
    <p class="note">{{ weekLabel }}（月曜に入れ替わります）。突破した場の数、4場の合計点の順です。</p>

    <p v-if="loading" class="note">読み込んでいます…</p>
    <p v-else-if="!ranking" class="note warn">サーバーにつながりません。</p>
    <template v-else>
      <p v-if="!ranking.entries.length" class="note">この週の記録はまだありません。</p>
      <div v-else class="yakulist ranking">
        <template v-for="(e, i) in ranking.entries" :key="i">
          <span :class="{ me: e.isMe }">{{ e.rank }}. {{ e.name }}</span>
          <span>{{ summaryText(e) }}</span>
        </template>
      </div>
      <p v-if="ranking.me && !meListed" class="note">
        あなたの記録: {{ summaryText(ranking.me) }}
        {{ ranking.me.rank ? `（${ranking.me.rank}位）` : '（名前を登録するとランキングに載ります）' }}
      </p>
    </template>

    <template v-if="account.name === null">
      <h3 class="subhead">ランキングに参加する</h3>
      <template v-if="account.kanGameName">
        <p class="note">
          kan-game.app の名前「{{ account.kanGameName }}」で、プチ麻雀のランキングに載ります。
        </p>
        <button class="btn win" type="button" :disabled="registering" @click="register(account.kanGameName!)">
          この名前で参加する
        </button>
      </template>
      <form v-else class="nameform" @submit.prevent="register(nameInput)">
        <p class="note">
          名前は kan-game.app のゲームで共通です。登録すると、プチ麻雀のランキングにこの名前で載ります。名前はあとから変えられません。
        </p>
        <input v-model="nameInput" type="text" maxlength="40" autocomplete="nickname" placeholder="名前（2〜20文字）" aria-label="名前" />
        <button class="btn win" type="submit" :disabled="registering || !nameInput.trim()">登録して参加する</button>
      </form>
      <p v-if="nameError" class="note warn" role="alert">{{ nameError }}</p>
    </template>

    <button class="btn" type="button" @click="emit('close')">閉じる</button>
  </SheetLayer>
</template>

<style scoped>
.ranking .me {
  color: var(--gold);
  font-weight: 700;
}
.subhead {
  margin: 4px 0 0;
  font-size: 15px;
}
.nameform {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nameform input {
  font: inherit;
  font-size: 16px;
  background: var(--felt-dark);
  color: var(--fg);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
}
</style>
