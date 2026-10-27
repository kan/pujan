<script setup lang="ts">
/** 役表 */
import { YAKU_TABLE } from '@/lib/labels';
import SheetLayer from '../SheetLayer.vue';

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <SheetLayer label="役表" dismissible @close="emit('close')">
    <h2>役表</h2>
    <div class="ref">
      <template v-for="[name, han, cond] in YAKU_TABLE" :key="name">
        <span>{{ name }}</span><span class="h">{{ han }}</span><span class="c">{{ cond }}</span>
      </template>
    </div>
    <p class="note">
      和了形は対子＋面子（順子・刻子）。役なしでも100点で和了れます。点数は100×2<sup>翻</sup>（4翻1,600点まで）、5翻満貫2,000、6〜7翻跳満3,000、8〜10翻倍満4,000、11〜12翻三倍満6,000、13翻以上は数え役満8,000点。役満は8,000点。1場は4局で、4局の合計が目標を超えると次の場へ。親の和了は1.5倍、和了後に連荘か和了やめを選べます。流局時に聴牌なら聴牌料200点。局の合間にショップで祝儀を使えます。
    </p>
    <button class="btn" type="button" @click="emit('close')">閉じる</button>
  </SheetLayer>
</template>
