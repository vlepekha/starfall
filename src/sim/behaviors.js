import { Vector2 } from "./vector.js";

/**
 * Поведінки — це composition над Entity.
 *
 * Кожна поведінка: об'єкт з update(entity, dt, world). Вони нічого не знають
 * одна про одну й нічого не знають про клас сутності, до якої причеплені.
 * Саме тому homing однаково працює і на кулі, і на астероїді — хоча це
 * різні класи, які НЕ мають спільного предка крім Entity.
 *
 * Альтернатива через успадкування розібрана в README (розділ «Дизайн-запис»).
 */

/** Час життя: через ttl секунд сутність помирає сама. */
export function ttl(seconds) {
  let remaining = seconds;
  return {
    name: "ttl",
    get remaining() {
      return remaining;
    },
    update(entity, dt) {
      remaining -= dt;
      if (remaining <= 0) entity.kill();
    },
  };
}

/**
 * Самонаведення. Шукає найближчу ціль заданого виду й плавно довертає
 * швидкість у її бік, зберігаючи модуль швидкості.
 *
 * turnRate — радіан за секунду; range — радіус захоплення.
 */
export function homing({ targetKind, turnRate = Math.PI * 1.2, range = 420 }) {
  return {
    name: "homing",
    target: null,
    update(entity, dt, world) {
      const target = world.nearestOfKind(targetKind, entity.pos, range);
      this.target = target;
      if (!target) return;

      const desired = entity.pos.shortestDeltaTo(target.pos).angle;
      const current = entity.vel.angle;

      // Найкоротший кутовий шлях: без цього сутність розвертатиметься
      // «довгою дорогою» через 359°.
      let delta = desired - current;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;

      const step = Math.sign(delta) * Math.min(Math.abs(delta), turnRate * dt);
      entity.vel = Vector2.fromAngle(current + step, entity.vel.length);
      entity.angle = entity.vel.angle;
    },
  };
}

/**
 * Підбиране: стоїть на місці, має радіус і ефект. Не корабель, не куля,
 * не перешкода — у дереві класів це було б окреме відгалуження, а тут
 * просто поведінка плюс правило зіткнення.
 */
export function pickup({ effect, label }) {
  return {
    name: "pickup",
    label,
    apply(ship, world) {
      effect(ship, world);
    },
    update(entity, dt) {
      // Легке «дихання» для рендера — на симуляцію не впливає.
      entity.phase = (entity.phase ?? 0) + dt;
    },
  };
}

/** Повільне обертання — суто візуальне, для астероїдів. */
export function spin(radiansPerSecond) {
  return {
    name: "spin",
    update(entity, dt) {
      entity.angle += radiansPerSecond * dt;
    },
  };
}

/** Знайти поведінку за іменем (null, якщо її немає). */
export function findBehavior(entity, name) {
  return entity.behaviors.find((behavior) => behavior.name === name) ?? null;
}
