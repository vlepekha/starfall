/**
 * Branded-типи: числа, які не можна переплутати.
 *
 * `EntityId`, `Tick` і `Seq` — усі в рантаймі звичайні number. Але для
 * компілятора це різні типи, тож передати номер кроку туди, де чекають
 * id сутності, не вийде. Саме такі помилки найважче ловити очима:
 * обидва аргументи числа, обидва виглядають правдоподібно.
 */
declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type EntityId = Brand<number, "EntityId">;
export type Tick = Brand<number, "Tick">;
export type Seq = Brand<number, "Seq">;
export type Millis = Brand<number, "Millis">;

/**
 * ЄДИНЕ приведення типу в усьому shared/.
 *
 * Бренд існує тільки для компілятора, тож зняти його якось треба —
 * але рівно в одному місці, під наглядом. Усі конструктори нижче
 * проходять через цю функцію, і більше `as` у пакеті немає.
 */
const brandNumber = <T extends number>(value: number): T => value as unknown as T;

export const entityId = (value: number): EntityId => brandNumber<EntityId>(value);
export const tick = (value: number): Tick => brandNumber<Tick>(value);
export const seq = (value: number): Seq => brandNumber<Seq>(value);
export const millis = (value: number): Millis => brandNumber<Millis>(value);

/** Знімок стану кнопок за один крок. Усе readonly: його ніхто не править. */
export interface InputState {
  readonly left: boolean;
  readonly right: boolean;
  readonly thrust: boolean;
  readonly brake: boolean;
  readonly fire: boolean;
}

export type EntityKind = "ship" | "bullet" | "asteroid" | "pickup" | "explosion";

/**
 * Вичерпність switch: якщо з'явиться новий варіант об'єднання і для нього
 * не буде гілки, аргумент перестане бути never — і tsc не збереться.
 * Дешевий спосіб не забути жодне місце при додаванні типу повідомлення.
 */
export function assertNever(value: never, context = "неочікуване значення"): never {
  throw new Error(`${context}: ${JSON.stringify(value)}`);
}
