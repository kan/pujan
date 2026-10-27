<script setup lang="ts">
/**
 * ルール設定（基本ルールの調整用）。適用すると新しいランを始める。
 * プロトタイプにあった「テスト用：祝儀＋20」は、操作ログで再生できない操作なので置かない。
 */
import { reactive } from 'vue';
import { DEFAULT_BASE_RULES, WAVE_TARGETS, type BaseRules } from '@pujan/engine';
import { useGameStore } from '@/stores/game';
import { WIND_NAMES, rulesText } from '@/lib/labels';
import SheetLayer from '../SheetLayer.vue';

const emit = defineEmits<{ close: [] }>();
const store = useGameStore();
const form = reactive<BaseRules>({ ...store.rules });
/** 「東1,000・南2,000・…」 */
const targets = WAVE_TARGETS.map((t, i) => `${WIND_NAMES[i]}${t.toLocaleString()}`).join('・');

function applyRules() {
  store.applyRules({ ...form });
  emit('close');
}
</script>

<template>
  <SheetLayer label="ルール設定" dismissible @close="emit('close')">
    <h2>ルール設定</h2>
    <div class="settings">
      <label for="cTurns">巡数</label>
      <select id="cTurns" v-model.number="form.turns">
        <option v-for="n in [8, 12, 16, 20]" :key="n" :value="n">{{ n }}巡</option>
      </select>
      <label for="cHold">保留枠</label>
      <select id="cHold" v-model.number="form.holdSlots">
        <option v-for="n in [0, 1, 2, 3]" :key="n" :value="n">{{ n }}枠</option>
      </select>
      <label for="cNext">ネクスト</label>
      <select id="cNext" v-model.number="form.next">
        <option v-for="n in [0, 1, 2]" :key="n" :value="n">{{ n ? `${n}枚先まで見える` : '見えない' }}</option>
      </select>
      <label for="cAka">赤牌</label>
      <select id="cAka" v-model="form.redFives">
        <option :value="true">あり（各色の5に1枚、1枚1翻）</option>
        <option :value="false">なし</option>
      </select>
      <label for="cHaitei">海底</label>
      <select id="cHaitei" v-model="form.haitei">
        <option :value="true">あり（最終巡のツモ和了で1翻）</option>
        <option :value="false">なし</option>
      </select>
    </div>
    <p class="note">
      基本ルールの調整用です。適用すると新しいランを始めます。既定のルール（{{ rulesText(DEFAULT_BASE_RULES) }}）から変えたランは、ランキングに載りません。場の目標点は{{ targets }}点です。
    </p>
    <button class="btn win" type="button" @click="applyRules">適用して新しいラン</button>
    <button class="btn" type="button" @click="emit('close')">閉じる</button>
  </SheetLayer>
</template>
