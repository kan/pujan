<script setup lang="ts">
/** 持ち物の一覧（お守り・設備・役の巻物のレベル・牌山）。局の画面・メニュー・ショップから開く */
import { computed } from 'vue';
import { MAX_CHARMS } from '@pujan/engine';
import { useGameStore } from '@/stores/game';
import { charmDef, equipDef, modifiedKinds } from '@/lib/labels';
import SheetLayer from '../SheetLayer.vue';
import WallGrid from '../WallGrid.vue';

const emit = defineEmits<{ close: [] }>();
const store = useGameStore();
const run = computed(() => store.run);
const charms = computed(() => run.value.charms.map(charmDef));
const equipment = computed(() => run.value.equipment.map(equipDef));
const levels = computed(() => Object.entries(run.value.yakuLevels));
const modded = computed(() => modifiedKinds(run.value).size > 0);
</script>

<template>
  <SheetLayer label="持ち物" dismissible @close="emit('close')">
    <h2>持ち物<span class="pts">祝儀 {{ run.money }}</span></h2>

    <section class="inv-sec" aria-label="お守り">
      <h3>お守り {{ charms.length }}/{{ MAX_CHARMS }}</h3>
      <div v-if="charms.length" class="ref">
        <template v-for="c in charms" :key="c.id">
          <span>{{ c.name }}</span><span class="h">{{ c.axis }}</span><span class="c">{{ c.description }}</span>
        </template>
      </div>
      <p v-else class="note">まだありません</p>
    </section>

    <section class="inv-sec" aria-label="設備">
      <h3>設備 {{ equipment.length }}</h3>
      <div v-if="equipment.length" class="ref">
        <template v-for="e in equipment" :key="e.id">
          <span>{{ e.name }}</span><span class="h" /><span class="c">{{ e.description }}</span>
        </template>
      </div>
      <p v-else class="note">まだありません</p>
    </section>

    <section v-if="levels.length" class="inv-sec" aria-label="役の巻物">
      <h3>役の巻物</h3>
      <div class="ref">
        <template v-for="[y, l] in levels" :key="y">
          <span>{{ y }}</span><span class="h">Lv{{ l }}</span><span class="c">点数×{{ +(1.5 ** l).toFixed(2) }}</span>
        </template>
      </div>
    </section>

    <section class="inv-sec" aria-label="牌山">
      <h3>牌山</h3>
      <p class="note">{{ modded ? '金の枠は牌の改造で変わった牌です。' : 'まだ改造していません。' }}</p>
      <WallGrid />
    </section>

    <button class="btn" type="button" @click="emit('close')">閉じる</button>
  </SheetLayer>
</template>

<style scoped>
.inv-sec {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.inv-sec h3 {
  margin: 0;
  font-size: 14px;
  color: var(--gold);
}
</style>
