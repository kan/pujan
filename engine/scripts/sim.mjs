// バランス調整用のシミュレーション CLI（docs/SPEC.md §6 フェーズ 1）。
// エンジンを tsc でビルドした dist/sim.js を使う。`npm run sim -w engine -- <コマンド>` で動かす。
//
//   deal                      配牌 5 枚で形ができる確率（数え上げ）
//   target [オプション]        目標の形を狙う AI の、1 局での和了率
//     --games N   局数（既定 2000）     --seed N   シード（既定 1）
//     --hold N    保留枠（既定 3）      --next N   ネクスト（既定 2）
//     --turns N   巡数（既定 12）       --target 名前  1 つの形だけ測る
//     --dye N     1 巡目に染め粉を使い、この色を残す（0 萬子・1 筒子・2 索子・3 字牌）
//   runs [オプション]          AI にランを遊ばせ、アイテムごとに進めた場を比べる
//     --runs N    アイテムごとのラン数（既定 100）  --seed N  シード（既定 1）
//     --items a,b アイテムの id（既定 all = お守りと設備をすべて）。牌の改造は「id:牌の番号」で、
//                 最初から当てておく（例: shu:13 は 5 筒を朱塗り。番号は tiles.ts。+ でつなぐと重ねる: utsushi:13+shu:13）
//     --no-riichi 聴牌してもリーチしない
//     --buy       ショップでお守りと設備を買う（祝儀が効くアイテム、金箔などを比べるとき）
//   starts [オプション]        AI にランを遊ばせ、雀士と段位ごとに進めた場を比べる（バランスの確認。SPEC フェーズ 4.5）
//     --runs N    組み合わせごとのラン数（既定 100）  --seed N  シード（既定 1）
//     --characters a,b  雀士の id（既定 all）        --dans 0,1  段位（既定 all）
//     --unlocked all|none  解禁済みの役（既定 all = 巻物とお守りがすべて並ぶ）
//     --no-buy    ショップで何も買わない（既定はお守りと設備を買う）  --no-riichi  リーチしない
//     --gacha     ショップで福引きを回せるなら回す（runs でも使える）
//     --rules holdSlots=1,next=4,turnsDelta=3  雀士の保留枠・ネクストを置き換え、巡数を増減する（runs でも使える）
//     --money N   始めの祝儀を上書きする（runs でも使える）
import { parseArgs } from 'node:util';
import { CHARMS, EQUIPMENT, MODS, SCROLL_YAKU, SOME_COLORS } from '../dist/items.js';
import { KIND_COUNT, tileName } from '../dist/tiles.js';
import { CHARACTERS, DANS } from '../dist/progression.js';
import { TARGET_NAMES, dealTable, simulateRuns, simulateTarget } from '../dist/sim.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    games: { type: 'string', default: '2000' },
    runs: { type: 'string', default: '100' },
    seed: { type: 'string', default: '1' },
    hold: { type: 'string', default: '3' },
    next: { type: 'string', default: '2' },
    turns: { type: 'string', default: '12' },
    target: { type: 'string' },
    items: { type: 'string', default: 'all' },
    'no-riichi': { type: 'boolean', default: false },
    characters: { type: 'string', default: 'all' },
    dans: { type: 'string', default: 'all' },
    unlocked: { type: 'string', default: 'all' },
    'no-buy': { type: 'boolean', default: false },
    rules: { type: 'string' },
    money: { type: 'string' },
    buy: { type: 'boolean', default: false },
    gacha: { type: 'boolean', default: false },
    dye: { type: 'string' },
  },
});

/** 整数のオプション。局数・ラン数のように 0 では割り算できないものは min を 1 にする */
const int = (name, min = 0) => {
  const n = Number(values[name]);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} は ${min} 以上の整数で指定する`);
  return n;
};
const pct = (p) => `${(p * 100).toFixed(1)}%`;
const progress = (msg) => process.stderr.write(`\r${msg}\x1b[K`);

function deal() {
  console.log('形\t確率\t1/N');
  for (const r of dealTable()) console.log(`${r.name}\t${(r.p * 100).toFixed(4)}%\t1/${Math.round(1 / r.p).toLocaleString('ja-JP')}`);
}

function target() {
  const rules = { holdSlots: int('hold'), next: int('next'), turns: int('turns') };
  const names = values.target ? [values.target] : TARGET_NAMES;
  for (const n of names) if (!TARGET_NAMES.includes(n)) throw new Error(`--target は ${TARGET_NAMES.join('・')} のどれか`);
  const games = int('games', 1);
  const seed = int('seed');
  const dye = values.dye === undefined ? undefined : int('dye');
  if (dye !== undefined && dye >= SOME_COLORS.length) {
    throw new Error(`--dye は 0〜${SOME_COLORS.length - 1}（${SOME_COLORS.join('・')}）`);
  }
  console.log(`保留 ${rules.holdSlots}・ネクスト ${rules.next}・${rules.turns} 巡、${games} 局${dye === undefined ? '' : `、1 巡目に染め粉（${SOME_COLORS[dye]}）`}`);
  console.log('形\t和了率\t平均の巡');
  for (const name of names) {
    progress(`${name} …`);
    const r = simulateTarget({ target: name, games, seed, rules, dye });
    progress('');
    console.log(`${name}\t${pct(r.rate)}\t${r.meanTurn.toFixed(1)}`);
  }
}

/**
 * 雀士の始めの条件の上書き（--rules holdSlots=1,next=4,turnsDelta=3 / --money 4）。条件を変えたときの強さを比べる。
 * 保留枠とネクストは置き換え、巡数は増減（段位と雀士の巡数の増減を残す）
 */
function startOverrides() {
  const rules = values.rules
    ? Object.fromEntries(
        values.rules.split(',').map((kv) => {
          const [k, v] = kv.split('=');
          const ok = ['holdSlots', 'next'].includes(k) ? /^\d+$/.test(v ?? '') : k === 'turnsDelta' && /^-?\d+$/.test(v ?? '');
          if (!ok) throw new Error(`--rules の ${kv} が読めない（holdSlots・next=数、turnsDelta=増減）`);
          return [k, Number(v)];
        }),
      )
    : undefined;
  const money = values.money === undefined ? undefined : int('money');
  if (rules || money !== undefined) console.log(`始めの条件の上書き: ${values.rules ?? ''}${money === undefined ? '' : ` 祝儀=${money}`}`);
  return { rules, money };
}

function runs() {
  const charmIds = CHARMS.map((c) => c.id);
  const equipIds = EQUIPMENT.map((e) => e.id);
  const ids = values.items === 'all' ? [...charmIds, ...equipIds] : values.items.split(',');
  // 持たせないものの欄は省く（simulateRuns が空として扱う）
  const cases = [{ name: 'なし' }];
  for (const id of ids) {
    if (id.includes(':')) {
      // 牌の改造（+ でつなぐと順に重ねる）
      const mods = id.split('+').map((part) => {
        const [modId, kind] = part.split(':');
        const def = MODS.find((m) => m.id === modId);
        if (!def || !/^\d+$/.test(kind) || Number(kind) >= KIND_COUNT) throw new Error(`牌の改造 ${part} が読めない（${MODS.map((m) => m.id).join(',')}:牌の番号）`);
        return { id: modId, kind: Number(kind), label: `${def.name}(${tileName(Number(kind))})` };
      });
      cases.push({ name: mods.map((m) => m.label).join('+'), mods });
      continue;
    }
    const charm = CHARMS.find((c) => c.id === id);
    const equip = EQUIPMENT.find((e) => e.id === id);
    if (charm) cases.push({ name: charm.name, charms: [id] });
    // 前提の設備（猫に小判には化け猫）も一緒に持たせる
    else if (equip) cases.push({ name: equip.name, equipment: equip.requires ? [equip.requires, id] : [id] });
    else throw new Error(`アイテム ${id} がない（お守り: ${charmIds.join(',')} / 設備: ${equipIds.join(',')}）`);
  }
  const opts = { runs: int('runs', 1), seed: int('seed'), riichi: !values['no-riichi'], buy: values.buy, gacha: values.gacha, ...startOverrides() };
  console.log(
    `アイテムごとに ${opts.runs} ラン（${opts.buy ? 'ショップでお守りと設備を買う' : 'ショップでは何も買わない'}${opts.gacha ? '、福引きを回す' : ''}${opts.riichi ? '' : '、リーチしない'}）`,
  );
  console.log('アイテム\t突破した場の平均\t差\t東/南/西/北で終了/全場クリア\t局の和了率');
  let baseline = 0;
  for (const c of cases) {
    progress(`${c.name} …`);
    const r = simulateRuns({ ...opts, charms: c.charms, equipment: c.equipment, mods: c.mods });
    progress('');
    if (c.name === 'なし') baseline = r.meanCleared;
    const diff = r.meanCleared - baseline;
    console.log(`${c.name}\t${r.meanCleared.toFixed(2)}\t${diff >= 0 ? '+' : ''}${diff.toFixed(2)}\t${r.reached.join('/')}\t${pct(r.winRate)}`);
  }
}

function starts() {
  const characters = values.characters === 'all' ? CHARACTERS.map((c) => c.id) : values.characters.split(',');
  const dans = values.dans === 'all' ? DANS.map((d) => d.level) : values.dans.split(',').map(Number);
  // 解禁済みの役: all は巻物・お守りがすべて並ぶ（遊び込んだ人）、none は何も並ばない（始めたばかりの人）
  const unlockedYaku = values.unlocked === 'all' ? [...SCROLL_YAKU] : [];
  const opts = { runs: int('runs', 1), seed: int('seed'), riichi: !values['no-riichi'], buy: !values['no-buy'], gacha: values.gacha, ...startOverrides() };
  console.log(
    `雀士と段位ごとに ${opts.runs} ラン（${opts.buy ? 'ショップでお守りと設備を買う' : 'ショップでは何も買わない'}${opts.gacha ? '、福引きを回す' : ''}、解禁 ${values.unlocked}）`,
  );
  console.log('雀士\t段位\t突破した場の平均\t東/南/西/北で終了/全場クリア\t全場クリア率\t局の和了率');
  for (const character of characters) {
    const name = CHARACTERS.find((c) => c.id === character)?.name;
    if (!name) throw new Error(`雀士 ${character} がない（${CHARACTERS.map((c) => c.id).join(',')}）`);
    for (const dan of dans) {
      if (!DANS[dan]) throw new Error(`段位 ${dan} がない（0〜${DANS.length - 1}）`);
      progress(`${name}・${DANS[dan].name} …`);
      const r = simulateRuns({ ...opts, start: { character, dan, unlockedYaku } });
      progress('');
      const cleared = r.reached[r.reached.length - 1] / r.runs;
      console.log(`${name}\t${DANS[dan].name}\t${r.meanCleared.toFixed(2)}\t${r.reached.join('/')}\t${pct(cleared)}\t${pct(r.winRate)}`);
    }
  }
}

const commands = { deal, target, runs, starts };
const command = commands[positionals[0]];
if (!command) {
  console.error(`使い方: npm run sim -w engine -- <${Object.keys(commands).join('|')}> [オプション]（オプションは scripts/sim.mjs の先頭を参照）`);
  process.exit(1);
}
command();
