<script setup lang="ts">
/**
 * 下から出るシート（和了・流局・ショップ・役表など）。dismissible なら外側のタップと Esc で閉じる。
 * 開いたらシートにフォーカスを移し、Tab でシートの外へ出ないようにする。
 */
import { nextTick, onMounted, ref } from 'vue';
import { trapDialogFocus } from '@/lib/dialog';

const props = defineProps<{ label: string; dismissible?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const sheet = ref<HTMLElement>();

onMounted(async () => {
  await nextTick();
  // 最初のボタンではなくシート自体に移す（読み上げが見出しから始まるように）
  sheet.value?.focus();
});

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.dismissible) emit('close');
  else trapDialogFocus(e, sheet.value);
}
</script>

<template>
  <div class="veil" @click.self="dismissible && emit('close')" @keydown="onKeydown">
    <div ref="sheet" class="sheet" role="dialog" aria-modal="true" :aria-label="label" tabindex="-1">
      <slot />
    </div>
  </div>
</template>
