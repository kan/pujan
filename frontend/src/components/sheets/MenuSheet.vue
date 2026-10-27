<script setup lang="ts">
/**
 * メニュー（docs/SPEC.md §6 フェーズ 3.5。TAKO-SEN のメニューに倣う）。
 * プレイヤー名、ランキング、遊び方、役表、持ち物、新しいラン、このゲームについて。
 */
import { ref } from 'vue';
import { useAccountStore } from '@/stores/account';
import { portalUrl } from '@/lib/portal';
import NameForm from '../NameForm.vue';
import SheetLayer from '../SheetLayer.vue';

const emit = defineEmits<{
  close: [];
  open: [target: 'ranking' | 'help' | 'inventory' | 'about'];
  openTutorial: [];
  newRun: [];
}>();
const account = useAccountStore();

/** 名前の登録を開いている */
const naming = ref(false);
/** 新しいランを始めてよいか確かめている */
const confirmingNewRun = ref(false);
</script>

<template>
  <SheetLayer label="メニュー" dismissible @close="emit('close')">
    <h2>メニュー</h2>

    <section class="player">
      <template v-if="account.name">
        <span class="note">ランキングの名前</span>
        <b>{{ account.name }}</b>
      </template>
      <template v-else-if="!naming">
        <button class="btn" type="button" @click="naming = true">プレイヤー名を設定</button>
      </template>
      <NameForm v-else @registered="naming = false" />
      <a class="note link" :href="portalUrl('/account')" target="_blank" rel="noopener">
        アカウント（引き継ぎ・復旧コード・退会）は kan-game.app で
      </a>
    </section>

    <nav class="menu" aria-label="メニュー">
      <button class="btn" type="button" @click="emit('open', 'ranking')">今週のランキング</button>
      <button class="btn" type="button" @click="emit('openTutorial')">遊び方（チュートリアル）</button>
      <button class="btn" type="button" @click="emit('open', 'help')">役と遊び方</button>
      <button class="btn" type="button" @click="emit('open', 'inventory')">持ち物</button>
      <button v-if="!confirmingNewRun" class="btn" type="button" @click="confirmingNewRun = true">新しいランを始める</button>
      <div v-else class="confirm" role="group" aria-label="新しいランを始める">
        <p class="note warn">今のランをやめて、新しいランを始めますか？ 今のランはランキングに記録されません。</p>
        <div class="actions">
          <button class="btn" type="button" @click="confirmingNewRun = false">やめる</button>
          <button class="btn win" type="button" @click="emit('newRun')">新しいランを始める</button>
        </div>
      </div>
      <button class="btn" type="button" @click="emit('open', 'about')">プチ麻雀について</button>
    </nav>

    <button class="btn" type="button" @click="emit('close')">閉じる</button>
  </SheetLayer>
</template>

<style scoped>
.player {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 12px;
}
.player b {
  font-size: 17px;
}
.link {
  color: var(--muted);
}
.menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
