// バランス調整用のシミュレーション CLI（docs/SPEC.md §6 フェーズ 1）。
// エンジンを tsc でビルドした dist/sim.js を使う。`npm run sim -w engine -- <コマンド>` で動かす。
//
//   deal                      配牌 5 枚で形ができる確率（数え上げ）
//   target [オプション]        目標の形を狙う AI の、1 局での和了率
//     --games N   局数（既定 2000）     --seed N   シード（既定 1）
//     --hold N    保留枠（既定 3）      --next N   ネクスト（既定 2）
//     --turns N   巡数（既定 12）       --target 名前  1 つの形だけ測る
//   runs [オプション]          AI にランを遊ばせ、アイテムごとに進めた場を比べる
//     --runs N    アイテムごとのラン数（既定 100）  --seed N  シード（既定 1）
//     --items a,b アイテムの id（既定 all = お守りと設備をすべて）
//     --no-riichi 聴牌してもリーチしない
import { parseArgs } from 'node:util';
import { CHARMS, EQUIPMENT } from '../dist/items.js';
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
  console.log(`保留 ${rules.holdSlots}・ネクスト ${rules.next}・${rules.turns} 巡、${games} 局`);
  console.log('形\t和了率\t平均の巡');
  for (const name of names) {
    progress(`${name} …`);
    const r = simulateTarget({ target: name, games, seed, rules });
    progress('');
    console.log(`${name}\t${pct(r.rate)}\t${r.meanTurn.toFixed(1)}`);
  }
}

function runs() {
  const charmIds = CHARMS.map((c) => c.id);
  const equipIds = EQUIPMENT.map((e) => e.id);
  const ids = values.items === 'all' ? [...charmIds, ...equipIds] : values.items.split(',');
  const cases = [{ name: 'なし', charms: [], equipment: [] }];
  for (const id of ids) {
    const charm = CHARMS.find((c) => c.id === id);
    const equip = EQUIPMENT.find((e) => e.id === id);
    if (charm) cases.push({ name: charm.name, charms: [id], equipment: [] });
    // 前提の設備（猫に小判には化け猫）も一緒に持たせる
    else if (equip) cases.push({ name: equip.name, charms: [], equipment: equip.requires ? [equip.requires, id] : [id] });
    else throw new Error(`アイテム ${id} がない（お守り: ${charmIds.join(',')} / 設備: ${equipIds.join(',')}）`);
  }
  const opts = { runs: int('runs', 1), seed: int('seed'), riichi: !values['no-riichi'] };
  console.log(`アイテムごとに ${opts.runs} ラン（ショップでは何も買わない${opts.riichi ? '' : '、リーチしない'}）`);
  console.log('アイテム\t突破した場の平均\t差\t東/南/西/北で終了/全場クリア\t局の和了率');
  let baseline = 0;
  for (const c of cases) {
    progress(`${c.name} …`);
    const r = simulateRuns({ ...opts, charms: c.charms, equipment: c.equipment });
    progress('');
    if (c.name === 'なし') baseline = r.meanCleared;
    const diff = r.meanCleared - baseline;
    console.log(`${c.name}\t${r.meanCleared.toFixed(2)}\t${diff >= 0 ? '+' : ''}${diff.toFixed(2)}\t${r.reached.join('/')}\t${pct(r.winRate)}`);
  }
}

const commands = { deal, target, runs };
const command = commands[positionals[0]];
if (!command) {
  console.error(`使い方: npm run sim -w engine -- <${Object.keys(commands).join('|')}> [オプション]（オプションは scripts/sim.mjs の先頭を参照）`);
  process.exit(1);
}
command();
