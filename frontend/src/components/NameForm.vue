<script setup lang="ts">
/**
 * ランキングに出す名前の登録と、プチ麻雀での公開への同意（kan/game docs/ID_DESIGN.md「名前」）。
 * 名前は kan-game.app 全体で 1 つ。ほかのゲームで登録済みなら、同意だけを求める。
 */
import { ref } from 'vue';
import { useAccountStore } from '@/stores/account';

const emit = defineEmits<{ registered: [] }>();
const account = useAccountStore();

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
  if (result === 'ok') emit('registered');
  else nameError.value = NAME_ERRORS[result] ?? '登録できませんでした。';
}
</script>

<template>
  <div class="nameform">
    <h3 class="subhead">ランキングに参加する</h3>
    <template v-if="account.kanGameName">
      <p class="note">kan-game.app の名前「{{ account.kanGameName }}」で、プチ麻雀のランキングに載ります。</p>
      <button class="btn win" type="button" :disabled="registering" @click="register(account.kanGameName!)">
        この名前で参加する
      </button>
    </template>
    <form v-else @submit.prevent="register(nameInput)">
      <p class="note">
        名前は kan-game.app のゲームで共通です。登録すると、プチ麻雀のランキングにこの名前で載ります。名前はあとから変えられません。
      </p>
      <input v-model="nameInput" type="text" maxlength="40" autocomplete="nickname" placeholder="名前（2〜20文字）" aria-label="名前" />
      <button class="btn win" type="submit" :disabled="registering || !nameInput.trim()">登録して参加する</button>
    </form>
    <p v-if="nameError" class="note warn" role="alert">{{ nameError }}</p>
  </div>
</template>

<style scoped>
.nameform,
.nameform form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.subhead {
  margin: 4px 0 0;
  font-size: 15px;
}
input {
  font: inherit;
  font-size: 16px;
  background: var(--felt-dark);
  color: var(--fg);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
}
</style>
