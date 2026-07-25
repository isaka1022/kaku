# kaku

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/isaka1022.kaku?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=isaka1022.kaku)
[![Open VSX](https://img.shields.io/open-vsx/v/isaka1022/kaku?label=Open%20VSX)](https://open-vsx.org/extension/isaka1022/kaku)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Markdown を、Cursor / VS Code の中で紙のような画面で執筆するための WYSIWYG エディタ拡張です。装飾を削ぎ落としたフラットな白い紙面と、選択時にだけ浮かぶバブルツールバーで、日本語のブログ・書籍の執筆に集中できます。frontmatter・チェックボックス・テーブル・コードフェンス、さらに wikilink `[[...]]` などの記法を壊さずに往復できることを最優先に設計しています。

![kaku screenshot](https://raw.githubusercontent.com/isaka1022/kaku/main/docs/screenshot.png)

## インストール

拡張機能ビューで **「kaku」** を検索してインストールします。

- **VS Code**: [Marketplace](https://marketplace.visualstudio.com/items?itemName=isaka1022.kaku) から。または `code --install-extension isaka1022.kaku`
- **Cursor / VSCodium**: [Open VSX](https://open-vsx.org/extension/isaka1022/kaku) から（これらは MS の公式 Marketplace を使えないため）

<details>
<summary>ローカル vsix からインストール（開発版）</summary>

```bash
npm install
npm run build
npx @vscode/vsce package   # kaku-x.y.z.vsix を生成
```

生成された `.vsix` を導入します（コマンドパレット → "Extensions: Install from VSIX..." で `.vsix` を選択）。

</details>

## 使い方

1. `.md` ファイルを開く（通常のテキストエディタが既定のまま。kaku は既定エディタを奪いません）。
2. エディタ右上の **鉛筆アイコン**、またはコマンドパレットの **「kaku: 執筆モードで開く」** で、現在の `.md` が kaku エディタで再オープンされます。

> **Cursor をお使いの場合**: Cursor 2.1 以降はエディタ右上のボタンが既定で「…」（その他の操作）メニューに畳まれます。「…」→「Configure Icon Visibility」で「kaku: 執筆モードで開く」にチェックすると、鉛筆アイコンが常時表示されます（1回だけの設定）。

ファイルを kaku で開いただけでは何も書き込みません。実際に本文を編集したときにだけ、frontmatter をバイト単位で保全したまま保存されます。Obsidian などの wikilink を使うツールと Vault / リポジトリを共有していても安全に使えます。

## 執筆を助ける機能

- **アウトライン**: 画面が十分広い（幅 960px 以上）とき、左端に見出し（h1〜h3）の一覧を表示します。クリックでその見出しへジャンプします。
- **スラッシュコマンド**: 空の行で `/` を入力するとブロック挿入メニューが開きます。↑↓ で選択、Enter で確定、Escape で解除。
- **＋ メニュー**: 空の行の左に出る「＋」からも同じブロックを挿入できます。
- **文字数**: 右下に「1,234字（原稿用紙 3.2枚）」を常時表示します。
- **コメント注釈**: テキストを選択してバブルメニューからコメントを付けられます。ハイライトのクリックで内容確認・解決、「コメント (n)」ボタンで一覧パネルを開閉。コメントは本文の Markdown には一切書き込まず、隣に置かれるサイドカーファイル `<ファイル名>.md.comments.json` に保存されます（本文編集後もアンカーが前後の文脈から位置を追従します）。サイドカーは「kaku: コメントファイルを開く」で確認できます。

## 設定

| 設定キー | 既定 | 説明 |
| --- | --- | --- |
| `kaku.typeface` | `gothic` | 本文の書体。`gothic`（ゴシック / Hiragino Sans 系）または `mincho`（明朝 / Hiragino Mincho 系）。 |
| `kaku.comments.contextChars` | `40` | コメントのアンカーとして保存する前後の文脈の文字数。 |

## 開発

```bash
npm run build       # esbuild で dist/extension.cjs と dist/webview.js を生成
npm run watch       # 変更監視ビルド
npm run typecheck   # tsc --noEmit（strict）
npm run test        # vitest（frontmatter 分割・アウトライン抽出・Markdown ラウンドトリップ）
```
