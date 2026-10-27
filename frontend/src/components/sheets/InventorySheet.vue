<script setup lang="ts">
/** 持ち物の一覧（お守り・設備・役の巻物のレベル・牌山の改造） */
import { computed } from 'vue';
import { ALL_KINDS, defaultComposition, tileName } from '@pujan/engine';
import { useGameStore } from '@/stores/game';
import { charmDef, compositionText, equipDef } from '@/lib/labels';
import SheetLayer from '../SheetLayer.vue';

const emit = defineEmits<{ close: [] }>();
const store = useGameStore();
const run = computed(() => store.run);
const charms = computed(() => run.value.charms.map(charmDef));
const equipment = computed(() => run.value.equipment.map(equipDef));
const levels = computed(() => Object.entries(run.value.yakuLevels));

/** ランを始めたときの山から変わった牌 */
const mods = computed(() => {
  const c = run.value.composition;
  const d = defaultComposition(run.value.base.redFives);
  return ALL_KINDS.filter((k) => c.count[k] !== d.count[k] || c.red[k] !== d.red[k] || c.gold[k] !== d.gold[k])
    .map((k) => `${tileName(k)} ${compositionText(c, k)}`)
    .join('、');
});
</script>

<template>
  <SheetLayer label="持ち物" dismissible @close="emit('close')">
    <h2>持ち物<span class="pts">祝儀 {{ run.money }}</span></h2>
    <div class="ref">
      <span v-if="!charms.length" class="c">お守りはまだありません</span>
      <template v-for="c in charms" :key="c.id">
        <span>{{ c.name }}</span><span class="h">{{ c.axis }}</span><span class="c">{{ c.description }}</span>
      </template>
      <template v-for="e in equipment" :key="e.id">
        <span>{{ e.name }}</span><span class="h">設備</span><span class="c">{{ e.description }}</span>
      </template>
      <template v-for="[y, l] in levels" :key="y">
        <span>{{ y }}</span><span class="h">Lv{{ l }}</span><span class="c">点数×{{ +(1.5 ** l).toFixed(2) }}</span>
      </template>
    </div>
    <p v-if="mods" class="note">牌山の改造：{{ mods }}</p>
    <button class="btn" type="button" @click="emit('close')">閉じる</button>
  </SheetLayer>
</template>
