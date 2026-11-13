import type { Logger } from "./log.ts";

/**
 * Обробники фатальних помилок процесу.
 *
 * Винесено з index.ts не заради краси: поки це лежало всередині
 * модуля-точки-входу, перевірити його було нічим — жоден тест не
 * виконує index.ts, а підробити `process.on` ззовні не вийде.
 * Тут же `exit` і `process` передаються аргументами, тож поведінку
 * видно тестам напряму.
 */
export interface FatalHandlerOptions {
  log: Logger;
  /** Підміняється в тестах; у житті — process.exit. */
  exit?: (code: number) => void;
  on?: (event: string, handler: (reason: unknown) => void) => void;
}

export function installFatalHandlers({
  log,
  exit = (code) => process.exit(code),
  on = (event, handler) => void process.on(event, handler),
}: FatalHandlerOptions): void {
  /**
   * Спокуса повісити порожній обробник і «працювати далі» — найгірше
   * з можливого: після необробленого винятку процес у невідомому
   * стані, і далі він обслуговує гравців навмання.
   *
   * Код виходу 1, а не 0: інакше хостинг вважатиме, що ми
   * завершилися штатно, і може не перезапустити.
   */
  on("uncaughtException", (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    log.fatal({ event: "uncaughtException", err: message, stack });
    // Логи pino пишуться синхронно в stdout, тож рядок уже назовні.
    exit(1);
  });

  /**
   * Відхилена обіцянка без catch — те саме за наслідками: десь
   * усередині щось не вдалося, і ми про це не дізналися вчасно.
   */
  on("unhandledRejection", (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    log.fatal({ event: "unhandledRejection", err: message, stack });
    exit(1);
  });
}
