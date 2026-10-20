/**
 * Типізований доступ до DOM.
 *
 * `document.querySelector` повертає `Element | null`, тож майже кожне
 * звернення вимагало б приведення типу. Замість п'ятдесяти `as
 * HTMLInputElement` по коду — одне місце, де приведення робиться
 * під наглядом і одразу з перевіркою на null.
 */
export function el<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`елемент не знайдено: ${selector}`);
  // ЄДИНЕ приведення у клієнтському коді: далі типи виводяться самі.
  return found as T;
}

export const input = (selector: string, root?: ParentNode): HTMLInputElement =>
  el<HTMLInputElement>(selector, root);

export const button = (selector: string, root?: ParentNode): HTMLButtonElement =>
  el<HTMLButtonElement>(selector, root);

export const select = (selector: string, root?: ParentNode): HTMLSelectElement =>
  el<HTMLSelectElement>(selector, root);

export const canvas = (selector: string, root?: ParentNode): HTMLCanvasElement =>
  el<HTMLCanvasElement>(selector, root);
