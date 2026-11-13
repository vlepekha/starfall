#!/bin/bash
# Вписує живу адресу в README і комітить. Запуск:
#   ./scripts/set-public-url.sh https://starfall-xxxx.onrender.com
set -euo pipefail

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "вкажіть адресу: ./scripts/set-public-url.sh https://starfall-xxxx.onrender.com" >&2
  exit 1
fi
URL="${URL%/}"   # слеш у кінці зіпсував би посилання в README

cd "$(dirname "$0")/.."

# Перевіряємо, що адреса жива й це справді наш сервер, ПЕРЕД тим як
# писати її в README: інакше там легко лишиться помилка в домені.
echo "перевіряю $URL/health …"
SHA=$(curl -fsS --max-time 60 "$URL/health" | python3 -c "import sys,json;print(json.load(sys.stdin)['sha'])")
echo "відповідає, SHA збірки: $SHA"

python3 - "$URL" <<'PY'
import re, sys
url = sys.argv[1]
s = open("README.md").read()
s = s.replace(
    "**Грати:** <!-- PUBLIC_URL --> `https://…` — адреса з'являється тут після",
    f"**Грати:** <!-- PUBLIC_URL --> **{url}** — адреса жива. Нижче — як саме",
)
# Прибираємо решту абзацу-заглушки, якщо він ще на місці.
s = s.replace(
    """того, як образ розгорнуть на хостингу. Усе для цього готове: образ
публікується автоматично й лежить у GHCR, конфіги хостингів — у репозиторії,
покрокова інструкція — в [`docs/deploy.md`](docs/deploy.md).""",
    """вона туди потрапила: образ публікується автоматично за тегом `v*` і лежить
у GHCR, конфіги хостингів — у репозиторії, інструкція — в
[`docs/deploy.md`](docs/deploy.md).""",
)
open("README.md", "w").write(s)
PY

git add README.md
git commit -m "README: жива адреса $URL"
git push
echo "готово — адреса в README і запушена"
