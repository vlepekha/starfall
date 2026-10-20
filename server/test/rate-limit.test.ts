import { describe, expect, test } from "vitest";

/**
 * Token bucket у чистому вигляді — та сама логіка, що в ws-server.
 *
 * Винесена сюди навмисно: перевіряти обмежувач через справжній сокет
 * означало б перевіряти заразом мережу, таймери і ws. Тут — лише
 * арифметику, і вона або правильна, або ні.
 */
function createBucket(perSecond: number) {
  let tokens = perSecond;
  let lastRefill = 0;

  return {
    /** @returns true, якщо повідомлення дозволене */
    allow(nowMs: number): boolean {
      const elapsed = (nowMs - lastRefill) / 1000;
      lastRefill = nowMs;
      tokens = Math.min(perSecond, tokens + elapsed * perSecond);
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
    get available() {
      return tokens;
    },
  };
}

describe("token bucket", () => {
  test("пропускає рівно стільки, скільки токенів у відрі", () => {
    const bucket = createBucket(20);
    let allowed = 0;
    for (let i = 0; i < 50; i += 1) if (bucket.allow(0)) allowed += 1;
    expect(allowed).toBe(20);
  });

  test("токени поповнюються з часом", () => {
    const bucket = createBucket(20);
    for (let i = 0; i < 20; i += 1) bucket.allow(0);
    expect(bucket.allow(0)).toBe(false);
    // Через півсекунди має набігти 10 токенів.
    expect(bucket.allow(500)).toBe(true);
  });

  test("відро не переповнюється понад ліміт", () => {
    const bucket = createBucket(20);
    bucket.allow(0);
    bucket.allow(10_000); // десять секунд простою
    expect(bucket.available).toBeLessThanOrEqual(20);
  });

  test("рівний темп у межах ліміту проходить завжди", () => {
    const bucket = createBucket(30);
    let blocked = 0;
    // 30 повідомлень/с протягом 5 секунд — рівно межа.
    for (let i = 0; i < 150; i += 1) if (!bucket.allow(i * (1000 / 30))) blocked += 1;
    expect(blocked).toBe(0);
  });

  test("вікно-лічильник пропустив би подвійний сплеск, а відро — ні", () => {
    const bucket = createBucket(20);
    // Кінець першої секунди: 20 повідомлень.
    for (let i = 0; i < 20; i += 1) bucket.allow(999);
    // Початок другої: лічильник у вікні скинувся б, відро — ні.
    let allowed = 0;
    for (let i = 0; i < 20; i += 1) if (bucket.allow(1001)) allowed += 1;
    expect(allowed).toBeLessThan(5);
  });
});
