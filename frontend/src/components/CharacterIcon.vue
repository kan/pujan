<script setup lang="ts">
/** 雀士の絵（public/characters/<id>.svg）。名前は横に文字で出すので、絵は読み上げない */
withDefaults(defineProps<{ id: string; size?: number }>(), { size: 28 });
</script>

<template>
  <img class="character-icon" :src="`/characters/${id}.svg`" :width="size" :height="size" alt="" />
</template>

<style scoped>
.character-icon {
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
