// プレイの集計と感想の一覧（docs/SPEC.md フェーズ 4.5）。D1 を wrangler d1 execute で読む（書き込みはしない）。
// 操作ログの再生と数え方は engine/src/stats.ts。集計は個人が分かる形では出さない。
//
//   npm run stats -w backend -- [--env local|dev|production] [--version N]   プレイの集計（既定は今のルールの版）
//   npm run stats -w backend -- feedback [--env ...] [--limit N]      新しい順の感想（既定 30 件）
//
// --env の既定は local（ローカルの D1）。dev・production はリモートの D1 を読む
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ENGINE_VERSION, WIND_NAMES, aggregate, analyzeRun, startLabel } from '../../engine/dist/index.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    env: { type: 'string', default: 'local' },
    limit: { type: 'string', default: '30' },
    version: { type: 'string' },
  },
});

if (!['local', 'dev', 'production'].includes(values.env)) throw new Error('--env は local・dev・production のどれか');
const target = values.env === 'local' ? ['--local'] : ['--remote', '--env', values.env];

/**
 * SQL を 1 つ実行して行を返す（値は SQL に埋め込まない。ここの SQL は固定の文だけ）。
 * リモートの D1 はときどき一時的なエラー（Cloudflare の API の 7403 など）を返すので、1 回だけやり直す
 */
function query(sql) {
  try {
    return queryOnce(sql);
  } catch {
    console.error('D1 への問い合わせに失敗したので、もう一度試します');
    return queryOnce(sql);
  }
}

function queryOnce(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', ...target, '--json', '--command', sql], {
    // wrangler.jsonc のある backend で動かす（どこから呼んでも同じ D1 を読む）
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(out)[0].results;
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '-');
const table = (title, header, rows) => {
  console.log(`\n## ${title}`);
  console.log(header.join('\t'));
  for (const r of rows) console.log(r.join('\t'));
};

/**
 * 行を PAGE 件ずつ読む（1 回の応答が大きくなりすぎないように）。sql は rowid を返し、`rowid > ?` の条件と並びを持たない文。
 * 埋め込むのは前のページの rowid（数）だけ
 */
const PAGE = 200;
function* pages(sql) {
  for (let after = 0; ; ) {
    const rows = query(`${sql} AND rowid > ${Number(after)} ORDER BY rowid LIMIT ${PAGE}`);
    yield* rows;
    if (rows.length < PAGE) return;
    after = rows[rows.length - 1].rowid;
  }
}

function stats() {
  const version = values.version === undefined ? ENGINE_VERSION : Number(values.version);
  if (!Number.isInteger(version) || version < 1) throw new Error('--version は 1 以上の整数');
  // 終わっていないランのうち、その ID のいちばん新しいもの以外は、始めて捨てたラン
  const [counts] = query(`
    SELECT COUNT(*) AS started,
      COALESCE(SUM(finished_at IS NOT NULL), 0) AS finished,
      COALESCE(SUM(finished_at IS NULL AND n > 1), 0) AS abandoned,
      COUNT(DISTINCT account_id) AS players
    FROM (SELECT finished_at, account_id,
            ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY started_at DESC, id DESC) AS n
          FROM runs WHERE engine_version = ${version})`);
  // 記録したときに数えた結果（stats）を使う。ないもの（数えるようになる前のラン）は、今の版なら操作ログを再生する
  const analyzed = [];
  for (const r of pages(`SELECT rowid, stats FROM runs WHERE finished_at IS NOT NULL AND engine_version = ${version}`)) {
    if (r.stats) analyzed.push(JSON.parse(r.stats));
  }
  if (version === ENGINE_VERSION) {
    const old = `SELECT rowid, log FROM runs WHERE finished_at IS NOT NULL AND stats IS NULL AND log IS NOT NULL AND engine_version = ${version}`;
    for (const r of pages(old)) {
      const s = analyzeRun(JSON.parse(r.log));
      if (s) analyzed.push(s);
    }
  }
  const t = aggregate(analyzed);

  console.log(`# プレイの集計（${values.env}、ルールの版 ${version}${version === ENGINE_VERSION ? '（今の版）' : ''}）`);
  console.log(`始めたラン ${counts.started}・終わったラン ${counts.finished}・捨てたラン ${counts.abandoned}・遊んだ ID ${counts.players}`);
  console.log(`集計したラン ${t.runs}（数えた結果も操作ログもない・再生できないもの ${counts.finished - t.runs} を除く）`);

  table(
    '雀士と段位',
    ['雀士・段位', 'ラン', '全場クリア', 'クリア率', '突破した場の平均'],
    Object.entries(t.byStart)
      .sort((a, b) => b[1].runs - a[1].runs)
      .map(([k, s]) => [k, s.runs, s.cleared, pct(s.cleared, s.runs), (s.waves / s.runs).toFixed(2)]),
  );
  table('負けた場', ['場', 'ラン', '割合'], WIND_NAMES.map((w, i) => [w, t.lostAt[i], pct(t.lostAt[i], t.runs)]));
  table(
    '負けた場のボス',
    ['ボス', 'ラン'],
    Object.entries(t.lostBoss).sort((a, b) => b[1] - a[1]),
  );
  console.log(`\n## 局\n局 ${t.kyoku}・和了 ${t.wins}・和了率 ${pct(t.wins, t.kyoku)}`);
  table(
    '和了の役',
    ['役', '和了', '和了のうち'],
    Object.entries(t.yaku)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => [k, n, pct(n, t.wins)]),
  );
  table(
    'ショップの品',
    ['品', '並んだ', '買われた', '買われた割合'],
    Object.entries(t.shop)
      .sort((a, b) => b[1].bought / b[1].shown - a[1].bought / a[1].shown)
      .map(([k, s]) => [k, s.shown, s.bought, pct(s.bought, s.shown)]),
  );
  const gachaTotal = Object.values(t.gacha).reduce((a, n) => a + n, 0);
  table(
    `福引きの景品（${gachaTotal} 回）`,
    ['景品', '回', '割合'],
    Object.entries(t.gacha)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => [k, n, pct(n, gachaTotal)]),
  );
}

function feedback() {
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit は 1〜1000 の整数');
  const [{ total }] = query('SELECT COUNT(*) AS total FROM feedback');
  // ID は全部は出さない。どの感想が同じ人のものかは、ID の先頭 8 文字で見分ける（実行をまたいでも同じ）
  const rows = query(`
    SELECT created_at, body, character, dan, wave, finished, score, engine_version, app_version,
      substr(account_id, 1, 8) AS who
    FROM feedback ORDER BY created_at DESC LIMIT ${limit}`);
  console.log(`# 感想（${values.env}、全 ${total} 件のうち新しい ${rows.length} 件）`);
  for (const r of rows) {
    const when = new Date(r.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    console.log(`\n--- ${when}（送った人 ${r.who}、${runText(r)}、版 ${r.app_version ?? '-'}／ルール ${r.engine_version ?? '-'}）`);
    console.log(r.body);
  }
}

/** 感想に添えられたランの様子（項目が欠けていれば、分かるところだけ） */
function runText(r) {
  const parts = [];
  if (r.character !== null && r.dan !== null) parts.push(startLabel(r));
  if (r.wave !== null && r.finished !== null) {
    if (r.finished) parts.push(r.wave >= WIND_NAMES.length ? '全場クリア' : `${r.wave}場突破で終了`);
    else parts.push(`${WIND_NAMES[r.wave] ?? r.wave}場`);
  }
  if (r.score !== null) parts.push(`${r.score}点`);
  return parts.length ? parts.join('・') : 'ランの様子なし';
}

const commands = { stats, feedback };
const command = commands[positionals[0] ?? 'stats'];
if (!command) {
  console.error('使い方: npm run stats -w backend -- [stats|feedback] [--env local|dev|production] [--limit N]');
  process.exit(1);
}
command();
