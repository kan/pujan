/**
 * 感想（docs/SPEC.md フェーズ 4.5）の形。画面が作って送り、サーバーが形と長さを確かめて残す。
 */
import { ENGINE_VERSION, isFinished, type GameState } from './game.js';
import { missionText } from './mission.js';
import { KYOKU_COUNT, missionResultsOf, upcomingKyoku, type RunState } from './run.js';

/** 本文の長さの上限（文字数） */
export const FEEDBACK_MAX_LENGTH = 1000;

/** 感想に添える、送ったときのランの様子（サーバーでは確かめようがないので、参考の値として残す） */
export interface FeedbackContext {
  /** サーバーのランの ID（端末だけのランでは null） */
  runId: string | null;
  character: string;
  dan: number;
  /** 終えた局の数（0〜4。親の連荘の本場は数えない） */
  kyoku: number;
  /** お題と、果たしたか（「×1 和了 2 回（済）・×1.5 合計 5,000 点以上・×2 プチ四暗刻以上の役で和了る」） */
  missions: string;
  finished: boolean;
  /** お題を果たしてクリアしたか（ランが終わる前は null） */
  cleared: boolean | null;
  /** ここまでの合計点 */
  score: number;
  engineVersion: number;
  appVersion: string;
}

/** 終えた局の数（次に打つ局の番号と同じ。ランが終わっていれば 4） */
const kyokuDone = (run: RunState): number =>
  run.phase === 'over' || run.phase === 'cleared' ? KYOKU_COUNT : upcomingKyoku(run);

export function feedbackContext(game: GameState, runId: string | null, appVersion: string): FeedbackContext {
  const { run } = game;
  const finished = isFinished(game);
  return {
    runId,
    character: run.start.character,
    dan: run.start.dan,
    kyoku: kyokuDone(run),
    missions: missionResultsOf(run)
      .map((m) => `${missionText(m)}${m.met ? '（済）' : ''}`)
      .join('・'),
    finished,
    cleared: finished ? run.phase === 'cleared' : null,
    score: run.round.score,
    engineVersion: ENGINE_VERSION,
    appVersion,
  };
}
