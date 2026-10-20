/**
 * createInput() — приклад замикання.
 * Набір натиснутих клавіш живе всередині функції: жоден інший модуль
 * не має до нього доступу, тільки через повернені методи.
 */
import type { InputState } from "@starfall/shared";
import { onKey } from "./events.ts";

export interface InputApi {
  snapshot(): InputState & { firePressed: boolean };
  isDown(action: string): boolean;
  justPressed(action: string): boolean;
  endStep(): void;
  dispose(): void;
}

const DEFAULT_BINDINGS: Record<string, string> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "thrust",
  KeyW: "thrust",
  ArrowDown: "brake",
  KeyS: "brake",
  Space: "fire",
  KeyV: "debug",
};

export function createInput(
  target: EventTarget = window,
  bindings: Record<string, string> = DEFAULT_BINDINGS,
): InputApi {
  const pressed = new Set<string>();

  /**
   * Клавіші, натиснуті саме на цьому кроці симуляції.
   * Потрібні для дій-подій (перемкнути, вистрілити разово) на відміну
   * від дій-станів (тримаю тягу). Браузер шле keydown повторно, поки
   * клавішу тримають, тому «вперше» визначаємо самі.
   */
  const fresh = new Set<string>();

  const onKeyDown = (event: KeyboardEvent): void => {
    const action = bindings[event.code];
    if (!action) return;
    event.preventDefault();
    if (!pressed.has(action)) fresh.add(action);
    pressed.add(action);
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    const action = bindings[event.code];
    if (!action) return;
    event.preventDefault();
    pressed.delete(action);
  };

  // Якщо вкладка втратила фокус — клавіші "залипнуть" назавжди без цього.
  const onBlur = () => {
    pressed.clear();
    fresh.clear();
  };

  const offDown = onKey(target, "keydown", onKeyDown);
  const offUp = onKey(target, "keyup", onKeyUp);
  target.addEventListener("blur", onBlur);

  return {
    /** Знімок стану для одного кроку симуляції (простий незмінний об'єкт). */
    snapshot() {
      return {
        left: pressed.has("left"),
        right: pressed.has("right"),
        thrust: pressed.has("thrust"),
        brake: pressed.has("brake"),
        fire: pressed.has("fire"),
        firePressed: fresh.has("fire"),
      };
    },

    /** Клавіша зараз утримується. */
    isDown(action: string) {
      return pressed.has(action);
    },

    /** Клавішу натиснули саме на цьому кроці (одне спрацювання на натискання). */
    justPressed(action: string) {
      return fresh.has(action);
    },

    /**
     * Викликається в кінці кожного кроку симуляції: «свіжі» натискання
     * живуть рівно один крок. Якщо забути — justPressed залипне назавжди.
     */
    endStep() {
      fresh.clear();
    },
    dispose() {
      offDown();
      offUp();
      target.removeEventListener("blur", onBlur);
      pressed.clear();
      fresh.clear();
    },
  };
}
