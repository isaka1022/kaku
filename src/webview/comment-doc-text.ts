import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// doc.textBetween() は blockSeparator が PM pos に対応する実体を持たず逆変換できない上、
// ネストしたブロックの重複抑制も再現できずズレるため使わない。descendants() で自前に走査する。

export interface FlattenedDoc {
  /** doc 全体の可視テキスト。ブロック間は改行1文字で連結 */
  text: string;
  /** 可視テキストのオフセット → ProseMirror 位置。範囲外はクランプ */
  posAt(offset: number): number;
  /** ProseMirror 位置 → 可視テキストのオフセット。範囲外はクランプ */
  offsetAt(pos: number): number;
}

interface TextRun {
  offsetStart: number;
  posStart: number;
  length: number;
}

interface LineBreak {
  offset: number;
  pos: number;
}

export function flattenDoc(doc: ProseMirrorNode): FlattenedDoc {
  let text = '';
  const runs: TextRun[] = [];
  const breaks: LineBreak[] = [];

  doc.descendants((node, pos) => {
    if (node.isText) {
      const value = node.text ?? '';
      if (value.length > 0) {
        runs.push({ offsetStart: text.length, posStart: pos, length: value.length });
        text += value;
      }
      return;
    }
    if (node.isBlock && text.length > 0 && text[text.length - 1] !== '\n') {
      breaks.push({ offset: text.length, pos });
      text += '\n';
    }
  });

  function posAt(offset: number): number {
    const clamped = Math.max(0, Math.min(offset, text.length));
    for (const run of runs) {
      if (clamped >= run.offsetStart && clamped < run.offsetStart + run.length) {
        return run.posStart + (clamped - run.offsetStart);
      }
    }
    // ブロック境界のオフセットは、次ブロックの開始位置ではなく直前ブロックの末尾に寄せる。
    // 範囲の終端として使われるため、次ブロックへ食い込ませない。
    for (const run of runs) {
      if (clamped === run.offsetStart + run.length) {
        return run.posStart + run.length;
      }
    }
    for (const brk of breaks) {
      if (clamped === brk.offset) {
        return brk.pos;
      }
    }
    let bestPos = 0;
    for (const run of runs) {
      if (run.offsetStart <= clamped) {
        bestPos = Math.max(bestPos, run.posStart + run.length);
      }
    }
    return bestPos;
  }

  function offsetAt(pos: number): number {
    for (const run of runs) {
      if (pos >= run.posStart && pos < run.posStart + run.length) {
        return run.offsetStart + (pos - run.posStart);
      }
    }
    for (const brk of breaks) {
      if (pos === brk.pos) {
        return brk.offset;
      }
    }
    let bestOffset = 0;
    for (const run of runs) {
      if (run.posStart <= pos) {
        bestOffset = Math.max(bestOffset, run.offsetStart + run.length);
      }
    }
    return Math.min(bestOffset, text.length);
  }

  return { text, posAt, offsetAt };
}
