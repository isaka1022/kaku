import type { CommentAnchor } from './schema.js';

export const DEFAULT_CONTEXT_CHARS = 40;

function findAllOccurrences(text: string, quote: string): number[] {
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const idx = text.indexOf(quote, from);
    if (idx === -1) break;
    positions.push(idx);
    from = idx + 1;
  }
  return positions;
}

function commonSuffixLength(a: string, b: string): number {
  let length = 0;
  while (
    length < a.length &&
    length < b.length &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

function commonPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) {
    length += 1;
  }
  return length;
}

export function resolveAnchor(
  text: string,
  anchor: CommentAnchor
): { start: number; end: number } | null {
  if (anchor.quote === '') return null;

  const candidates = findAllOccurrences(text, anchor.quote);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const start = candidates[0];
    return { start, end: start + anchor.quote.length };
  }

  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < candidates.length; i += 1) {
    const start = candidates[i];
    const end = start + anchor.quote.length;
    const score =
      commonSuffixLength(anchor.prefix, text.slice(0, start)) +
      commonPrefixLength(anchor.suffix, text.slice(end));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  const start = candidates[bestIndex];
  return { start, end: start + anchor.quote.length };
}

export function extractAnchor(
  text: string,
  start: number,
  end: number,
  contextChars: number = DEFAULT_CONTEXT_CHARS
): CommentAnchor | null {
  const quote = text.slice(start, end);
  if (quote === '') return null;

  return {
    quote,
    prefix: text.slice(Math.max(0, start - contextChars), start),
    suffix: text.slice(end, end + contextChars),
  };
}
