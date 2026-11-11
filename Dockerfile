# syntax=docker/dockerfile:1

###############################################################################
# Етап 1 — збірка.
#
# Тут є все: dev-залежності, Vite, TypeScript. Усе це важить сотні
# мегабайтів і не потрібне в рантаймі ані секунди. Саме тому етапів два:
# у фінальний образ переїжджають лише результати, а не інструменти.
###############################################################################
FROM node:25-alpine AS build

WORKDIR /app

# Спершу тільки маніфести. Поки package*.json не змінилися, Docker бере
# шар із npm ci з кешу — а це найдовший крок збірки. Якби ми копіювали
# весь код одразу, будь-яка правка в коді перевстановлювала б залежності.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/

RUN npm ci

COPY . .

# Клієнт збирається в client/dist — саме його віддає сервер.
RUN npm run build

# Другий npm ci, уже без dev-залежностей: node_modules з етапу збірки
# містить Vite, Biome, Playwright і Vitest. Переносити їх у фінальний
# образ — це +300 МБ заради нічого.
RUN npm ci --omit=dev

###############################################################################
# Етап 2 — рантайм.
#
# Node 25 запускає .ts напряму (стирання типів), тому компілювати
# сервер не треба: беремо вихідні файли.
###############################################################################
FROM node:25-alpine AS runtime

# tini — крихітний init. Без нього node стає процесом №1 і НЕ отримує
# типової обробки сигналів: у деяких середовищах SIGTERM до нього
# просто не доходить, і контейнер завжди вбивається через таймаут.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    LOG_DIR=/app/logs \
    CLIENT_DIR=/app/client/dist

WORKDIR /app

# node — користувач, який уже є в офіційному образі (uid 1000).
# Від root процес не запускаємо: якщо в сервері знайдуть діру, вона
# не має одразу давати права на весь контейнер.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/client/dist ./client/dist

RUN mkdir -p /app/logs && chown -R node:node /app/logs

USER node
EXPOSE 8080

# SHA збірки: підставляється з CI і видно в /health. Єдиний спосіб
# з вулиці перевірити, що розгорнутий саме той тег, який зібрали.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA

# Перевірка здоров'я всередині образу: оркестратор дізнається про
# зависання, навіть якщо процес формально живий.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]

# Саме node і файл, а не "npm start".
#
# npm запускає сервер дочірнім процесом і сигнали йому не передає:
# при docker stop SIGTERM отримує npm, Node про зупинку не дізнається
# і за 10 секунд контейнер убиває SIGKILL. Усе акуратне завершення
# з цієї лаби в такому разі просто не виконується.
CMD ["node", "server/src/index.ts"]
