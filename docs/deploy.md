# Деплой Starfall

Образ уже збирається й публікується автоматично за тегом `v*`:
`ghcr.io/vlepekha/starfall`. Лишається дати йому де працювати.

Нижче два варіанти. Обидва безкоштовні для такого навантаження і обидва
вміють WebSocket — це головна вимога, бо без `Upgrade` гра не працює
взагалі, хоч сторінка й відкриється.

---

## Варіант 1. Render (найменше кроків)

У репозиторії лежить [`render.yaml`](../render.yaml), тому налаштовувати
руками нічого не треба.

1. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**.
2. Обрати репозиторій `vlepekha/starfall`. Render прочитає `render.yaml`
   і запропонує створити сервіс `starfall`.
3. Він запитає значення для `ALLOWED_ORIGINS` (у файлі воно позначене
   `sync: false`, бо домен стає відомим лише зараз). Після першого
   деплою адреса виглядає так: `https://starfall-xxxx.onrender.com` —
   її і вписати.
4. Дочекатися деплою й відкрити `https://…onrender.com/health`.

Перевірка, що все справді працює:

```bash
curl -s https://ВАША-АДРЕСА/health      # ok: true, sha, env: production
curl -s -o /dev/null -w '%{http_code}\n' https://ВАША-АДРЕСА/ready   # 200
```

> **Про безкоштовний план Render.** Сервіс засинає після 15 хвилин без
> запитів, і перше пробудження триває близько півхвилини. Перед захистом
> варто відкрити адресу заздалегідь, щоб процес уже не спав.

---

## Варіант 2. Fly.io (не засинає)

У репозиторії лежить [`fly.toml`](../fly.toml) з уже вимкненим
автозасинанням — для гри це принципово.

```bash
brew install flyctl
flyctl auth signup          # або flyctl auth login
flyctl launch --copy-config --no-deploy
flyctl secrets set ALLOWED_ORIGINS=https://starfall.fly.dev
flyctl deploy
```

---

## Автоматичний деплой за тегом

Після того як сервіс існує, можна замкнути ланцюжок «тег → жива адреса».

| Де додати | Ім'я | Значення |
| --- | --- | --- |
| Settings → Secrets → Actions | `DEPLOY_HOOK_URL` | Render: Settings → **Deploy Hook**. Fly: окремий токен, див. нижче |
| Settings → Variables → Actions | `PUBLIC_URL` | `https://ваша-адреса` |

Після цього `git push origin v1.0.2` сам збере образ, покладе його в GHCR,
смикне хостинг і **перевірить**, що на живій адресі `/health` віддає той
самий SHA. Без останньої перевірки «задеплоїли» означало б лише
«надіслали запит» — а воно могло і не доїхати.

Якщо `DEPLOY_HOOK_URL` не заданий, крок деплою просто пропускається:
робочий процес не падає, і репозиторій лишається робочим у форку.

---

## Що перевірити після першого деплою

| Перевірка | Команда | Очікуване |
| --- | --- | --- |
| процес живий | `curl -s URL/health` | `ok: true`, `env: "production"` |
| SHA збігається з тегом | `curl -s URL/health \| jq -r .sha` | хеш коміту тега |
| готовність | `curl -s -o /dev/null -w '%{http_code}' URL/ready` | `200` |
| метрики | `curl -s URL/metrics \| head` | `starfall_up 1` |
| чужий Origin | див. нижче | `403` |
| сокет тільки через `wss` | відкрити гру, вкладка Network | `wss://…/ws` |

Перевірка Origin із термінала:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==" \
  -H "Origin: https://evil.example.net" \
  https://ВАША-АДРЕСА/ws
```

Має бути `403`. Якщо `101` — значить `ALLOWED_ORIGINS` не заданий, і сервер
пускає будь-кого. У production він із порожнім списком узагалі не
стартує, тому `403` тут — ознака, що змінна дійшла.

---

## Запасний план на день захисту

Якщо хостинг із якоїсь причини не піднявся, гру можна показати з власної
машини через тимчасовий тунель — акаунт для цього не потрібен:

```bash
brew install cloudflared
npm start                                   # сервер на 8080
cloudflared tunnel --url http://localhost:8080
```

Команда надрукує адресу виду `https://щось-випадкове.trycloudflare.com`.
Вона вже з `https`, тому клієнт сам обере `wss://`, і гравець із будь-якої
мережі зайде нормально. Не забути перед цим:

```bash
export ALLOWED_ORIGINS=https://щось-випадкове.trycloudflare.com
```

Чим це **не** є: постійним деплоєм. Адреса живе, поки запущена команда,
гра працює з вашого ноутбука, і трафік іде через вашу мережу. Для
демонстрації цього вистачає, для здачі «живої адреси» — ні.

---

## Чому не GitHub Pages

Pages віддає лише статику. Starfall — це процес, який рахує гру й тримає
WebSocket; від клієнта без сервера лишилося б порожнє лобі.
