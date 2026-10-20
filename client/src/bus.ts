/**
 * Шина подій гри.
 *
 * Сенс у напрямку залежностей: sim/ нічого не знає ні про звук, ні про HUD.
 * Він лише кидає події в шину. Хто на них підписався — його не стосується.
 * Приберіть audio.js з проєкту — симуляція не помітить.
 *
 * EventTarget узятий не для краси: це рідний браузерний механізм із
 * готовим removeEventListener і, головне, з підтримкою AbortSignal —
 * усі підписки знімаються одним abort(), без ручного обліку.
 */
import { onCustom } from "./events.ts";

export class GameBus extends EventTarget {
  emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** @returns функція відписки */
  on(
    type: string,
    handler: (detail: unknown, event: CustomEvent<unknown>) => void,
    options: AddEventListenerOptions = {},
  ): () => void {
    return onCustom<unknown>(this, type, handler, options);
  }
}
