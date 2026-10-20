/**
 * Типізовані слухачі подій.
 *
 * DOM віддає `Event`, а нам майже завжди потрібен `CustomEvent<T>` або
 * `KeyboardEvent`. Без цього файлу кожне звернення до `event.detail`
 * вимагало б власного приведення типу — їх набиралося два десятки.
 * Тут воно одне, під наглядом, і далі типи виводяться самі.
 */

/** Підписка на CustomEvent із відомою формою detail. */
export function onCustom<T>(
  target: EventTarget,
  type: string,
  handler: (detail: T, event: CustomEvent<T>) => void,
  options?: AddEventListenerOptions,
): () => void {
  const listener = (event: Event): void => {
    // ЄДИНЕ приведення для всіх подій у клієнті.
    const custom = event as CustomEvent<T>;
    handler(custom.detail, custom);
  };
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener);
}

/** Підписка на події клавіатури. */
export function onKey(
  target: EventTarget,
  type: "keydown" | "keyup",
  handler: (event: KeyboardEvent) => void,
): () => void {
  const listener = (event: Event): void => {
    if (event instanceof KeyboardEvent) handler(event);
  };
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}
