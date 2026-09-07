# Contributing

kaku への貢献を歓迎します。issue も PR も日本語で構いません。

## 開発環境

```bash
npm install
npm run build          # dist/extension.cjs と dist/webview.js を生成
```

VS Code / Cursor でこのリポジトリを開き `F5` を押すと、拡張機能開発ホストが立ち上がります。そこで `.md` を開き、エディタ右上の鉛筆アイコン（または「kaku: 執筆モードで開く」）で動作を確認してください。

```bash
npm test               # vitest
npm run typecheck      # tsc --noEmit
```

PR を出す前にこの2つを通してください。

## 設計上、壊してはいけない約束

kaku の存在理由は「Markdown を壊さずに往復できる」ことです。次の3点に触れる変更は、テストを添えてください。

1. **frontmatter はバイト単位で保全する** — `src/frontmatter.ts` の `splitFrontmatter` が本文と frontmatter を分離し、frontmatter は一切再生成せずそのまま書き戻します。YAML としてパースし直さないのは、コメントやキー順序や引用符の形が変わってしまうためです。
2. **wikilink `[[...]]` を node 化しない** — `src/webview/wikilink-decoration.ts` は Decoration だけで見た目を作ります。ProseMirror の node にすると、シリアライズ時に記法が変質します。Obsidian の Vault と同じファイルを共有できることが前提です。
3. **開いただけでは書き込まない** — 実際に編集されたときにだけ保存します。ファイルを開いて閉じただけで diff が出る状態は不具合として扱います。

## コミットとPR

- コミットメッセージは Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` / `ci:`）で、英語で書いてください
- 1つの PR は1つの変更に絞ってください
- UI に関わる変更は、before / after のスクリーンショットか短い動画を添えてください（この拡張は見た目が機能なので、文章だけでは判断できません）

## バグ報告

再現に必要な Markdown を**そのまま**貼ってください（記法の問題であることが多く、要約されると再現できません）。あわせて次を書いてください。

- VS Code / Cursor のバージョン
- kaku のバージョン
- 期待した結果と実際の結果

## これから何をやるか

[ROADMAP.md](ROADMAP.md) に方針と順序を書いています。ここに載っていない提案も歓迎です — その場合は「何ができるようになるか」から書いてください。
