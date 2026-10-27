<script setup lang="ts">
/**
 * 感想を送る（docs/SPEC.md フェーズ 4.5）。メニューとラン終了の画面から開く。
 * 本文に、今のランの雀士・段位・進み具合・版を添える（送る前に何を添えるかを見せる）
 */
import { computed, ref } from 'vue';
import { FEEDBACK_MAX_LENGTH, feedbackContext } from '@pujan/engine';
import { api, ApiError } from '@/api/client';
import { contextText } from '@/lib/feedback';
import { useGameStore } from '@/stores/game';
import SheetLayer from '../SheetLayer.vue';

const emit = defineEmits<{ close: [] }>();
const store = useGameStore();

const body = ref('');
const status = ref<'editing' | 'sending' | 'sent'>('editing');
const error = ref('');

// 開いたときのランの様子を添える（書いている間に局が進んでも変えない）
const context = feedbackContext(store.game, store.runId, __APP_VERSION__);
const contextLine = contextText(context);

const length = computed(() => body.value.trim().length);
const canSend = computed(() => status.value === 'editing' && length.value > 0 && length.value <= FEEDBACK_MAX_LENGTH);

async function send() {
  if (!canSend.value) return;
  status.value = 'sending';
  error.value = '';
  try {
    await api.sendFeedback(body.value.trim(), context);
    status.value = 'sent';
  } catch (e) {
    status.value = 'editing';
    const code = e instanceof ApiError ? e.code : 'error';
    error.value =
      code === 'too_many'
        ? '続けて送れるのは1時間に5件までです。しばらくしてから送ってください。'
        : code === 'offline'
          ? 'サーバーにつながりません。つながってから送ってください（書いた文はこのまま残ります）。'
          : '送れませんでした。もう一度送ってください。';
  }
}
</script>

<template>
  <SheetLayer label="感想を送る" dismissible @close="emit('close')">
    <h2>感想を送る</h2>
    <template v-if="status !== 'sent'">
      <p class="note">
        遊んでみて楽しかったところ、分かりにくかったところ、難しすぎる・易しすぎるところなどを教えてください。返信はしていません。
      </p>
      <textarea v-model="body" rows="6" :maxlength="FEEDBACK_MAX_LENGTH" placeholder="感想を書く" aria-label="感想" />
      <p class="note count" :class="{ warn: length > FEEDBACK_MAX_LENGTH }">{{ length }} / {{ FEEDBACK_MAX_LENGTH }}</p>
      <p class="note">一緒に送るもの: {{ contextLine }}</p>
      <p v-if="error" class="note warn" role="alert">{{ error }}</p>
      <div class="actions">
        <button class="btn" type="button" @click="emit('close')">やめる</button>
        <button class="btn win" type="button" :disabled="!canSend" @click="send">
          {{ status === 'sending' ? '送っています…' : '送る' }}
        </button>
      </div>
    </template>
    <template v-else>
      <p class="note" role="status">送りました。ありがとうございます。</p>
      <button class="btn" type="button" @click="emit('close')">閉じる</button>
    </template>
  </SheetLayer>
</template>

<style scoped>
textarea {
  width: 100%;
  padding: 8px 10px;
  font: inherit;
  font-size: 16px;
  color: var(--fg);
  background: var(--felt-dark);
  border: 1px solid var(--line);
  border-radius: 8px;
  resize: vertical;
}
textarea:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 1px;
}
.count {
  text-align: right;
}
</style>
