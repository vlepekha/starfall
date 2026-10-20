import { type InputState, TICK_DT, type Vector2 } from "@starfall/shared";

/**
 * Звірка, винесена в чисту функцію.
 *
 * Раніше вона жила всередині netcode і дотягувалася до світу, сокета
 * й статистики — перевірити її можна було лише запустивши гру. Тепер
 * це функція без побічних ефектів: даєш стан сервера, непідтверджені
 * input і спосіб зробити крок — отримуєш новий стан і поправку.
 */

export interface ShipSnapshot {
  readonly pos: Vector2;
  readonly vel: Vector2;
  readonly angle: number;
}

export interface PendingInput {
  readonly seq: number;
  readonly input: InputState;
}

export interface ReconcileArgs<T extends ShipSnapshot> {
  /** Те, що клієнт малював до приходу знімка. */
  predicted: T;
  /** Авторитетний стан із сервера. */
  authoritative: ShipSnapshot;
  /** Усі надіслані input із їхніми номерами. */
  pending: readonly PendingInput[];
  /** Номер останнього input, який сервер підтвердив. */
  ackSeq: number;
  /** Один крок симуляції — та сама функція, що й на сервері. */
  step: (state: ShipSnapshot, input: InputState, dt: number) => T;
  dt?: number;
}

export interface ReconcileResult<T extends ShipSnapshot> {
  /** Стан після перегравання непідтверджених input. */
  state: T;
  /** Скільки input лишилося непідтвердженими. */
  replayed: number;
  /** Наскільки звірка посунула корабель — це і є «поправка». */
  correction: Vector2;
}

export function reconcile<T extends ShipSnapshot>({
  predicted,
  authoritative,
  pending,
  ackSeq,
  step,
  dt = TICK_DT,
}: ReconcileArgs<T>): ReconcileResult<T> {
  // Беремо лише те, чого сервер ще не бачив: решта вже врахована
  // в авторитетному стані, і програвати її вдруге означало б
  // зарахувати ті самі натискання двічі.
  const unacked = pending.filter((item) => item.seq > ackSeq);

  let state = authoritative as T;
  for (const item of unacked) state = step(state, item.input, dt);

  return {
    state,
    replayed: unacked.length,
    correction: predicted.pos.sub(state.pos),
  };
}
