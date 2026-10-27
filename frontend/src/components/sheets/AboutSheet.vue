<script setup lang="ts">
/**
 * プチ麻雀について: ゲームの説明、β版の説明と集める情報（docs/SPEC.md フェーズ 4.5）、kan-game.app へのリンク、
 * 使っている素材と書体のライセンス、版
 */
import { ENGINE_VERSION } from '@pujan/engine';
import { portalUrl } from '@/lib/portal';
import SheetLayer from '../SheetLayer.vue';

const emit = defineEmits<{ close: [] }>();
const APP_VERSION = __APP_VERSION__;
</script>

<template>
  <SheetLayer label="プチ麻雀について" dismissible @close="emit('close')">
    <h2>プチ麻雀について</h2>
    <p class="note">
      手牌を5枚（対子＋面子）に縮めた麻雀を、ローグライトとして遊ぶゲームです。東南西北の4つの場を、アイテムを集めながら勝ち抜きます。
    </p>
    <section class="about">
      <h3>β版について</h3>
      <p class="note">
        プチ麻雀はβ版です。遊んだ感想をもとに、ルール・数値・画面を変えていきます。感想はメニューの「感想を送る」から送れます。
      </p>
      <p class="note">
        β版の間は、ルールを変えたときに、進めている途中のランが続きから遊べなくなることがあります（開き直すと新しいランが始まります）。解禁した雀士・段位・役はそのまま残ります。
      </p>
    </section>
    <section class="about">
      <h3>集める情報</h3>
      <p class="note">
        ランキングに載るランでは、ランの記録（雀士・段位・成績・操作の記録）をサーバーに残し、ゲームの調整のために集計します。集計では個人が分かる形にはしません。
      </p>
      <p class="note">
        感想を送ると、本文と、送ったときのランの雀士・段位・成績・ゲームの版を残します。kan-game.app で退会すると、これらはすべて消えます。
      </p>
    </section>
    <section class="about">
      <h3>kan-game.app</h3>
      <p class="note">
        プチ麻雀は <a :href="portalUrl('/')" target="_blank" rel="noopener">kan-game.app</a> のゲームの1つです。プレイヤー名とアカウントは kan-game.app のゲームで共通です。
      </p>
      <p class="note">
        <a :href="portalUrl('/terms')" target="_blank" rel="noopener">利用規約</a>・
        <a :href="portalUrl('/privacy')" target="_blank" rel="noopener">プライバシーポリシー</a>
      </p>
    </section>
    <section class="about">
      <h3>素材と書体</h3>
      <p class="note">
        牌の絵: <a href="https://github.com/FluffyStuff/riichi-mahjong-tiles" target="_blank" rel="noopener">FluffyStuff/riichi-mahjong-tiles</a>（CC0 1.0、パブリックドメイン）
      </p>
      <p class="note">
        書体: Shippori Mincho B1・Zen Kaku Gothic New（Google Fonts。SIL Open Font License 1.1）
      </p>
    </section>
    <p class="note version">版 {{ APP_VERSION }}（ルール {{ ENGINE_VERSION }}）</p>
    <button class="btn" type="button" @click="emit('close')">閉じる</button>
  </SheetLayer>
</template>

<style scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.about h3 {
  margin: 0;
  font-size: 15px;
}
a {
  color: var(--gold);
}
.version {
  text-align: right;
}
</style>
