import { describe, it, expect } from 'vitest';
import { resolveAnchor, extractAnchor, DEFAULT_CONTEXT_CHARS } from '../src/comments/anchor.js';
import { parseSidecar, SidecarParseError, UnsupportedSidecarVersionError } from '../src/comments/schema.js';

describe('resolveAnchor', () => {
  it('一致が1件なら位置を返す', () => {
    const text = '吾輩は猫である。名前はまだ無い。';
    const quote = '名前はまだ無い';
    const start = text.indexOf(quote);
    const result = resolveAnchor(text, { quote, prefix: '猫である。', suffix: '。' });
    expect(result).toEqual({ start, end: start + quote.length });
  });

  it('一致が0件なら null', () => {
    const text = '吾輩は猫である。';
    const result = resolveAnchor(text, { quote: '存在しない文字列', prefix: '', suffix: '' });
    expect(result).toBeNull();
  });

  it('quote が空なら null', () => {
    const result = resolveAnchor('何かのテキスト', { quote: '', prefix: '', suffix: '' });
    expect(result).toBeNull();
  });

  it('同じ文字列が複数ある時に prefix・suffix で正しい方を選ぶ', () => {
    const text = '朝に猫が鳴いた。夜に猫が眠った。';
    const secondCatIndex = text.indexOf('猫', text.indexOf('猫') + 1);
    const anchor = extractAnchor(text, secondCatIndex, secondCatIndex + 1, 2);
    expect(anchor).toEqual({ quote: '猫', prefix: '夜に', suffix: 'が眠' });

    const result = resolveAnchor(text, anchor!);
    expect(result).toEqual({ start: secondCatIndex, end: secondCatIndex + 1 });
  });

  it('prefix と suffix が両方空でも複数一致時に落ちない', () => {
    const text = 'ののの';
    const result = resolveAnchor(text, { quote: 'の', prefix: '', suffix: '' });
    // 同点なら最初の一致を選ぶ（決定的であること）
    expect(result).toEqual({ start: 0, end: 1 });
  });
});

describe('extractAnchor', () => {
  it('通常ケースで prefix・suffix・quote を抽出する', () => {
    const text = 'これは前の文脈です。対象の一節。これは後の文脈です。';
    const start = text.indexOf('対象の一節');
    const end = start + '対象の一節'.length;
    const result = extractAnchor(text, start, end);
    expect(result).toEqual({
      quote: '対象の一節',
      prefix: text.slice(0, start),
      suffix: text.slice(end, end + DEFAULT_CONTEXT_CHARS),
    });
  });

  it('文書先頭では prefix が短く切れる', () => {
    const text = '対象の一節。これは後の文脈です。';
    const result = extractAnchor(text, 0, 5);
    expect(result?.prefix).toBe('');
    expect(result?.quote).toBe('対象の一節');
  });

  it('文書末尾では suffix が短く切れる', () => {
    const text = 'これは前の文脈です。対象の一節';
    const start = text.indexOf('対象の一節');
    const end = text.length;
    const result = extractAnchor(text, start, end);
    expect(result?.suffix).toBe('');
    expect(result?.quote).toBe('対象の一節');
  });

  it('空の選択範囲では null を返す', () => {
    const result = extractAnchor('何かのテキスト', 3, 3);
    expect(result).toBeNull();
  });
});

describe('extractAnchor と resolveAnchor の往復', () => {
  it('抽出した anchor から元の範囲を復元できる', () => {
    const text = 'これは前の文脈です。対象の一節。これは後の文脈です。';
    const start = text.indexOf('対象の一節');
    const end = start + '対象の一節'.length;
    const anchor = extractAnchor(text, start, end)!;
    expect(resolveAnchor(text, anchor)).toEqual({ start, end });
  });

  it('quote が文書中に複数出現しても元の範囲を復元できる', () => {
    const text = '朝に猫が鳴いた。昼に猫が寝た。夜に猫が眠った。';
    for (const needle of ['朝に猫が鳴いた', '昼に猫が寝た', '夜に猫が眠った']) {
      const start = text.indexOf(needle);
      const end = start + needle.length;
      const anchor = extractAnchor(text, start, end)!;
      expect(resolveAnchor(text, anchor)).toEqual({ start, end });
    }
  });

  it('あらゆる部分範囲について往復が成立する（重複出現を含む網羅チェック）', () => {
    const text = 'ののの猫と猫の猫。猫は猫。';
    for (let start = 0; start < text.length; start += 1) {
      for (let end = start + 1; end <= text.length; end += 1) {
        const anchor = extractAnchor(text, start, end, 3)!;
        expect(resolveAnchor(text, anchor)).toEqual({ start, end });
      }
    }
  });
});

describe('parseSidecar', () => {
  const validJson = JSON.stringify({
    version: 1,
    file: 'note.md',
    updatedAt: '2026-07-20T00:00:00.000Z',
    comments: [
      {
        id: 'c1',
        anchor: { quote: '一節', prefix: '前', suffix: '後' },
        body: '指摘内容',
        status: 'open',
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    ],
  });

  it('正常な JSON をパースできる', () => {
    const result = parseSidecar(validJson);
    expect(result.version).toBe(1);
    expect(result.file).toBe('note.md');
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].id).toBe('c1');
  });

  it('壊れた JSON では SidecarParseError を投げる', () => {
    expect(() => parseSidecar('{ not valid json')).toThrow(SidecarParseError);
  });

  it('未対応バージョンでは UnsupportedSidecarVersionError を投げる', () => {
    const raw = JSON.stringify({ version: 99, file: 'note.md', updatedAt: '', comments: [] });
    expect(() => parseSidecar(raw)).toThrow(UnsupportedSidecarVersionError);
    try {
      parseSidecar(raw);
    } catch (error) {
      expect((error as UnsupportedSidecarVersionError).version).toBe(99);
    }
  });

  it('comments が配列でない等の形状不正では SidecarParseError を投げる', () => {
    const raw = JSON.stringify({ version: 1, file: 'note.md', updatedAt: '', comments: 'not-an-array' });
    expect(() => parseSidecar(raw)).toThrow(SidecarParseError);
  });

  it('comment の必須フィールドが欠けていても SidecarParseError を投げる', () => {
    const raw = JSON.stringify({
      version: 1,
      file: 'note.md',
      updatedAt: '',
      comments: [{ id: 'c1', body: '本文だけで anchor が無い' }],
    });
    expect(() => parseSidecar(raw)).toThrow(SidecarParseError);
  });
});
