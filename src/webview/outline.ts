export interface OutlineHeading {
  level: 1 | 2 | 3;
  text: string;
}

const FENCE_RE = /^(```|~~~)/;
const HEADING_RE = /^(#{1,3})\s+(.+?)\s*#*$/;

/**
 * body Markdown から h1〜h3 の見出しを文書順に抽出する純関数。
 * フェンス付きコードブロック内の `#` は見出しと見なさない。
 */
export function extractHeadings(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE_RE.test(line.trimStart())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = HEADING_RE.exec(line);
    if (match) {
      headings.push({ level: match[1].length as 1 | 2 | 3, text: match[2].trim() });
    }
  }
  return headings;
}
