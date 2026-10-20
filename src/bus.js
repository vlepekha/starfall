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
export class GameBus extends EventTarget {
  /** @param {string} type — "fired" | "hit" | "exploded" | ... */
  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /**
   * @param {string} type
   * @param {(detail: object, event: CustomEvent) => void} handler
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {() => void} функція відписки
   */
  on(type, handler, options = {}) {
    const listener = (event) => handler(event.detail, event);
    this.addEventListener(type, listener, options);
    return () => this.removeEventListener(type, listener);
  }
}
