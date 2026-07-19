#!/usr/bin/env bash
# kaku を Open VSX と VS Code Marketplace に公開する。
# トークンは ~/.secrets/kaku/.env（git外・600）から読む。会話やログに値を出さない。
#
#   scripts/publish.sh           # 両方に publish
#   scripts/publish.sh ovsx      # Open VSX だけ
#   scripts/publish.sh vsce      # Marketplace だけ
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HOME/.secrets/kaku/.env"
TARGET="${1:-both}"

[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE がありません"; exit 1; }
set -a; . "$ENV_FILE"; set +a

cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
VSIX="kaku-${VERSION}.vsix"
[ -f "$VSIX" ] || npx vsce package

publish_ovsx() {
  [ -n "${OVSX_PAT:-}" ] || { echo "SKIP ovsx: OVSX_PAT 未設定"; return; }
  echo "→ Open VSX に publish ($VSIX)"
  npx ovsx create-namespace isaka1022 -p "$OVSX_PAT" 2>/dev/null || true
  npx ovsx publish "$VSIX" -p "$OVSX_PAT"
}

publish_vsce() {
  [ -n "${VSCE_PAT:-}" ] || { echo "SKIP vsce: VSCE_PAT 未設定"; return; }
  echo "→ VS Code Marketplace に publish ($VSIX)"
  npx vsce publish --packagePath "$VSIX" -p "$VSCE_PAT"
}

case "$TARGET" in
  ovsx) publish_ovsx ;;
  vsce) publish_vsce ;;
  both) publish_ovsx; publish_vsce ;;
  *) echo "usage: publish.sh [ovsx|vsce|both]"; exit 1 ;;
esac
echo "DONE"
