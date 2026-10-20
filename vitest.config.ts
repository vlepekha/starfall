import { defineConfig } from "vitest/config";

/**
 * Один конфіг на весь монорепозиторій.
 *
 * Пакети різні за середовищем: shared і server — це Node, клієнт
 * працює в браузері. Тому тести клієнта йдуть в jsdom-подібному
 * оточенні лише там, де це справді треба; решта — у Node, де швидше.
 */
export default defineConfig({
  test: {
    include: ["{shared,server,client}/test/**/*.test.ts"],
    environment: "node",
    // Playwright має власний запуск — Vitest не повинен його чіпати.
    exclude: ["**/node_modules/**", "e2e/**"],
    coverage: {
      provider: "v8",
      include: ["shared/src/**/*.ts"],
      // Межа з умови лаби. Нижче — збірка падає, а не «ну майже».
      thresholds: { lines: 85, functions: 85, statements: 85 },
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
