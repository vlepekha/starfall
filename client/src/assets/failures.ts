/**
 * Керовані збої для «галереї збоїв» у README.
 *
 * Вмикаються через ?fail=... — на реальне завантаження не впливають,
 * поки параметра немає. Потрібні, щоб показати, що гра не падає,
 * а не розповідати про це словами.
 */
export type FailureMode = (typeof FAILURE_MODES)[number];

export const FAILURES: Record<FailureMode, string> = {
  none: "без збоїв",
  "sprite-404": "спрайта немає на сервері (404)",
  timeout: "мережа не відповідає (таймаут)",
  abort: "гравець перервав завантаження",
  "broken-json": "маніфест побитий (невалідний JSON)",
  "flaky-5xx": "сервер віддає 500 перші дві спроби",
};

/** Список режимів — джерело правди і для типу, і для перевірки. */
export const FAILURE_MODES = [
  "none",
  "sprite-404",
  "timeout",
  "abort",
  "broken-json",
  "flaky-5xx",
] as const;

export function activeFailure(search: string = window.location.search): FailureMode {
  const value = new URLSearchParams(search).get("fail");
  // find повертає вже FailureMode — приведення не потрібне.
  return FAILURE_MODES.find((mode) => mode === value) ?? "none";
}

/**
 * Підміна URL під конкретний збій. Усе відбувається на рівні адреси,
 * тому самі завантажувачі про експеримент не знають нічого.
 */
export function corrupt(url: string, failure: FailureMode): string {
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
