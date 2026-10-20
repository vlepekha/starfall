/**
 * Керовані збої для «галереї збоїв» у README.
 *
 * Вмикаються через ?fail=... — на реальне завантаження не впливають,
 * поки параметра немає. Потрібні, щоб показати, що гра не падає,
 * а не розповідати про це словами.
 */
export const FAILURES = {
  none: "без збоїв",
  "sprite-404": "спрайта немає на сервері (404)",
  timeout: "мережа не відповідає (таймаут)",
  abort: "гравець перервав завантаження",
  "broken-json": "маніфест побитий (невалідний JSON)",
  "flaky-5xx": "сервер віддає 500 перші дві спроби",
};

export function activeFailure(search = window.location.search) {
  const value = new URLSearchParams(search).get("fail");
  return value && value in FAILURES ? value : "none";
}

/**
 * Підміна URL під конкретний збій. Усе відбувається на рівні адреси,
 * тому самі завантажувачі про експеримент не знають нічого.
 */
export function corrupt(url, failure) {
  switch (failure) {
    case "sprite-404":
      return url.endsWith("ships.png") ? "/assets/ships-missing.png" : url;
    case "timeout":
      return url.endsWith("asteroids.png") ? `${url}?delay=8000` : url;
    case "abort":
      // Щоб було що переривати: на localhost усе встигає за мілісекунди,
      // тож навмисно сповільнюємо кожен файл.
      return `${url}?delay=1500`;
    case "broken-json":
      return url.endsWith("arena.json") ? "/api/broken-json" : url;
    case "flaky-5xx":
      return url.endsWith("bullets.png") ? `${url}?flaky=2` : url;
    default:
      return url;
  }
}
