import { describe, it, expect } from 'vitest';
import { splitFrontmatter, combineDocument } from '../src/frontmatter.js';

describe('splitFrontmatter', () => {
  it('frontmatter が無い場合は全体を body として返す', () => {
    const text = '# 見出し\n\n本文です。\n';
    const result = splitFrontmatter(text);
    expect(result.frontmatter).toBe('');
    expect(result.body).toBe(text);
  });

  it('通常の frontmatter を分割する', () => {
    const text = '---\ntitle: テスト\ntags:\n  - a\n---\n\n# 本文\n';
    const result = splitFrontmatter(text);
    expect(result.frontmatter).toBe('---\ntitle: テスト\ntags:\n  - a\n---\n');
    expect(result.body).toBe('\n# 本文\n');
  });

  it('本文コードフェンス内の --- を frontmatter と誤認しない', () => {
    const text = '本文の前置き\n\n```md\n---\nfoo: bar\n---\n```\n';
    const result = splitFrontmatter(text);
    expect(result.frontmatter).toBe('');
    expect(result.body).toBe(text);
  });

  it('frontmatter のみで本文が空', () => {
    const text = '---\ntitle: テスト\n---\n';
    const result = splitFrontmatter(text);
    expect(result.frontmatter).toBe('---\ntitle: テスト\n---\n');
    expect(result.body).toBe('');
  });

  it('閉じ区切りが EOF（末尾改行なし）でも分割する', () => {
    const text = '---\ntitle: テスト\n---';
    const result = splitFrontmatter(text);
    expect(result.frontmatter).toBe('---\ntitle: テスト\n---');
    expect(result.body).toBe('');
  });

  it('閉じ区切りが無ければ frontmatter とみなさない', () => {
    const text = '---\ntitle: 閉じない\n\n本文\n';
    const result = splitFrontmatter(text);
    expect(result.frontmatter).toBe('');
    expect(result.body).toBe(text);
  });

  it('combineDocument は分割前の文字列に戻す', () => {
    const text = '---\ntitle: テスト\n---\n\n# 本文\n';
    const { frontmatter, body } = splitFrontmatter(text);
    expect(combineDocument(frontmatter, body)).toBe(text);
  });
});
