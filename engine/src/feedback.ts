/**
 * 感想（docs/SPEC.md フェーズ 4.5）の形。画面が作って送り、サーバーが形と長さを確かめて残す。
 */
import { ENGINE_VERSION, isFinished, type GameState } from './game.js';
import { runSummary } from './run.js';

/** 本文の長さの上限（文字数） */
export const FEEDBACK_MAX_LENGTH = 1000;

/** 感想に添える、送ったときのランの様子（サーバーでは確かめようがないので、参考の値として残す） */
export interface FeedbackContext {
  /** サーバーのランの ID（端末だけのランでは null） */
  runId: string | null;
  character: string;
  dan: number;
  /** 突破した場の数（0〜4。進めているランでは、今の場の番号と同じ） */
  wave: number;
  finished: boolean;
  /** 進めている場の点数（場を突破した直後のショップでは次の場の 0）。ランが終わっていれば合計点 */
  score: number;
  engineVersion: number;
  appVersion: string;
}

export function feedbackContext(game: GameState, runId: string | null, appVersion: string): FeedbackContext {
  const { run } = game;
  const summary = isFinished(game) ? runSummary(run) : null;
  // 場を突破した直後のショップでは、run.wave はまだ突破した場のまま（ショップを出ると次の場に進む）。
  // 突破した場の数は、終わった場の点数の数（waveScores）で数える
  const cleared = run.waveScores.length;
  const betweenWaves = run.phase === 'shop' && run.afterShop === 'nextWave';
  return {
    runId,
    character: run.start.character,
    dan: run.start.dan,
    wave: summary ? summary.wavesCleared : cleared,
    finished: !!summary,
    score: summary ? summary.totalScore : betweenWaves ? 0 : run.round.score,
    engineVersion: ENGINE_VERSION,
    appVersion,
  };
}
