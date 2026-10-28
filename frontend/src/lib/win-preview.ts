import { finalizeContext, finalizeScore, isActing, type Kind, type KyokuState } from '@pujan/engine';

/** 今のツモで和了れるときの役と点数（親・本場などを掛けたあと）。局の画面とチュートリアルで使う */
export interface WinPreview {
  /** 役の名前（ボーナスの翻を含む。役がなければ「役なし」） */
  names: string[];
  points: number;
  /** 和了に使う牌の id（金の枠） */
  tileIds: ReadonlySet<number>;
  /** 和了に使う万能牌を当てはめた種類 */
  jokerKinds: Kind[];
}

export function winPreviewOf(k: KyokuState | null): WinPreview | null {
  if (!k?.win || !isActing(k)) return null;
  const score = finalizeScore(k.win.evaluation, finalizeContext(k));
  return {
    names: score.lines.filter((l) => l.kind === 'yaku').map((l) => l.label),
    points: score.points,
    tileIds: new Set(k.win.tileIds),
    jokerKinds: k.win.jokers.map((j) => j.kind),
  };
}
