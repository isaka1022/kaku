# kaku

Markdown を紙のような画面で書く、日本語執筆に最適化した WYSIWYG エディタ（Cursor / VS Code 拡張）。OSS・MIT。

- リポジトリ: https://github.com/isaka1022/kaku （public）
- Open VSX: https://open-vsx.org/extension/isaka1022/kaku （**公開先はここのみ**。Cursor が参照するレジストリ）
- VS Code Marketplace: **未公開**（方針として一旦なし。出すなら `scripts/publish.sh vsce` 分岐が使える）

## アーキテクチャ

- VS Code `CustomTextEditorProvider`（viewType `kaku.editor`, priority `option` = 既定エディタは奪わない）
- Tiptap v3（ProseMirror）+ tiptap-markdown で WYSIWYG ⇔ Markdown
- esbuild で2バンドル: `dist/extension.cjs`（node/cjs。`"type":"module"` なので **必ず .cjs**）+ `dist/webview.js`（browser/iife）
- Webview の DOM は `src/webview/main.ts` が `#app` に全構築（HTML↔JS の ID 契約を無くし、白画面バグを構造的に排除）
- 同期: open 時は絶対に書き込まない / 250ms debounce / IME composition 中は遅延 / frontmatter はバイト保存（`splitFrontmatter`）/ wikilink は node 化せず Decoration のみ

## 公開フロー（更新時）

1. コードを直す
2. **`package.json` の `version` を必ず上げる**（同一 version で vsix を再パッケージすると旧ファイル混在 → 白画面の温床）
3. `npm test && npm run typecheck`
4. `scripts/publish.sh ovsx` で Open VSX に publish（`npx vsce package` は無ければ自動実行）
5. 必要なら `gh release create vX.Y.Z kaku-X.Y.Z.vsix ...`

## シークレット

- publisher: `isaka1022`（拡張 ID = `isaka1022.kaku`）
- トークンは `~/.secrets/kaku/.env`（700/600・git 外）に `OVSX_PAT=` で保持。`scripts/publish.sh` が読む。**値は会話・ログ・git に出さない**
- Open VSX の PAT: https://open-vsx.org → Settings → Access Tokens（初回は Publisher Agreement 署名が必須）

## アイコン

`media/icon.png`（256px）。万年筆が墨色の「か」に続けて朱色の「く」を書いている途中のデザイン。元 SVG ハーネスはスクラッチパッドにあったもの（リポジトリには PNG のみ）。

## 注意

- `git` 履歴は squash 済み。試行錯誤コミットを force-push で畳んだ経緯あり
- publisher を旧 `amaino` から `isaka1022` に変更済み（v0.0.5〜）。手元に旧 `amaino.kaku` があれば別 ID なので要アンインストール
