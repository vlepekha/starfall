/**
 * Встановлення гри на телефон (PWA).
 *
 * Два окремі механізми, які легко переплутати:
 *   1. service worker — кеш оболонки, щоб гра відкривалася миттєво;
 *   2. beforeinstallprompt — пропозиція «додати на головний екран».
 *
 * Другий без першого браузер просто не покаже: щоб застосунок
 * вважався встановлюваним, потрібні манифест, service worker і https.
 */

export interface PwaHandle {
  /** Чи браузер готовий показати діалог установки саме зараз. */
  readonly canInstall: boolean;
  install(): Promise<"accepted" | "dismissed" | "unavailable">;
}

/** Подія нестандартна — у lib.dom її типу немає. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function setupPwa({
  onInstallable,
  onUpdated,
}: {
  onInstallable?: (available: boolean) => void;
  onUpdated?: () => void;
} = {}): PwaHandle {
  let deferred: BeforeInstallPromptEvent | null = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    /**
     * Браузер сам показав би підказку, але в невдалий момент —
     * наприклад, посеред матчу. Перехоплюємо й показуємо кнопку,
     * щоб гравець вирішив сам.
     */
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    onInstallable?.(true);
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    onInstallable?.(false);
  });

  /**
   * Реєструємо worker лише на зібраній сторінці.
   *
   * У розробці він тільки заважає: Vite і так роздає свіжі модулі,
   * а кеш worker'а показував би вчорашній код і з'їдав би години
   * на «чому моя зміна не застосувалася».
   */
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              // controller вже є => це оновлення, а не перша установка.
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                onUpdated?.();
              }
            });
          });
        })
        .catch(() => {
          // Відсутність кешу не ламає гру — вона просто вантажиться з мережі.
        });
    });
  }

  return {
    get canInstall(): boolean {
      return deferred !== null;
    },
    async install() {
      if (!deferred) return "unavailable";
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      onInstallable?.(false);
      return outcome;
    },
  };
}
