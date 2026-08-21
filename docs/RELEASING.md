# リリース手順

kaku は **VS Code Marketplace** と **Open VSX** の2つのレジストリに公開する。
どちらもタグ push で自動実行される（`.github/workflows/release.yml`）。

## 初回のみ必要な準備

### 1. publisher / namespace を作る

| レジストリ | 識別子 | 作成場所 |
|---|---|---|
| VS Code Marketplace | publisher `isaka1022` | <https://marketplace.visualstudio.com/manage/createpublisher> |
| Open VSX | namespace `isaka1022` | <https://open-vsx.org/user-settings/namespaces> |

Marketplace の publisher は Azure DevOps アカウントに紐づく。`package.json` の
`publisher` フィールドと完全に一致していないと publish が通らない。

### 2. トークンを取得する

**`VSCE_PAT`（Azure DevOps の Personal Access Token）**

<https://dev.azure.com> → 右上の User settings → Personal access tokens → New Token

- **Organization: `All accessible organizations`** — 特定の組織を選ぶと publish が
  401/403 で落ちる。vsce の公式ドキュメントに「よくある間違い」として明記されている
- **Scopes: `Marketplace` → `Manage`**
- 発行にあたって Azure DevOps の organization が最低1つ存在している必要がある

**`OVSX_PAT`（Open VSX）**

<https://open-vsx.org/user-settings/tokens> → Generate New Token

### 3. GitHub の Secrets に登録する

**必ず Web UI から入力する**: <https://github.com/isaka1022/kaku/settings/secrets/actions>

- `gh secret set VSCE_PAT --repo isaka1022/kaku` を**対話プロンプトが出ない環境**
  （エージェント経由の実行など）で叩くと、空の stdin が読まれて**空文字が登録され、
  成功したように見える**。実際に v0.1.0 のリリースはこれで2回失敗している
- `gh secret set NAME --body "$TOKEN"` も使わない。シェル履歴と実行ログに平文が残る
- 登録できているかは Actions のログで判定できる。`VSCE_PAT: ` と空で出ていたら未設定、
  `VSCE_PAT: ***` ならマスクされている＝設定済み

## リリースする

```bash
# 1. バージョンを上げる
#    package.json の "version" を編集し、CHANGELOG.md に節を追加する
git add package.json CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"
git push

# 2. タグを打つ（これが workflow のトリガー）
git tag vX.Y.Z
git push origin vX.Y.Z
```

## workflow の構造

```
package ──┬─→ vscode-marketplace
          └─→ open-vsx
```

`package` ジョブが `.vsix` を1度だけ作り artifact に上げる。2つの publish ジョブは
それを落として各レジストリへ送る。**2つのレジストリは独立**なので、片方の資格情報が
壊れていてももう片方は公開される。同じ artifact を配るので中身のずれも起きない。

## 失敗したときの対処

**資格情報を直しただけなら再実行で足りる**

```bash
gh run list --workflow release.yml --limit 5
gh run rerun <run-id> --failed
```

**タグを打ち直す**

```bash
git tag -d vX.Y.Z
git push origin :vX.Y.Z
git tag vX.Y.Z && git push origin vX.Y.Z
```

ただし**一度でもレジストリに通ったバージョンは上書きできない**。片方だけ公開に成功した
状態でやり直すと、成功した側が「既に存在する」で落ちる。その場合はバージョンを上げる。

**`TF400813: user 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' is not authorized`**

`VSCE_PAT` が空か無効。全ゼロの GUID は「誰としても認証されていない」を意味するので、
スコープや organization を疑う前にまず secret が空でないかを確認する。

**Open VSX の公開直後に API がまだ古いバージョンを返す**

数分のラグがある。ログに `🚀 Published isaka1022.kaku vX.Y.Z` が出ていれば成功している。

## 公開の確認

- Marketplace: <https://marketplace.visualstudio.com/items?itemName=isaka1022.kaku>
- Open VSX: <https://open-vsx.org/extension/isaka1022/kaku>
