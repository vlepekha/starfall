import type { EntityKind } from "../types.ts";
import type { Behavior, Entity, WorldLike } from "./entity.ts";
import { Vector2 } from "./vector.ts";

/**
 * Поведінки — composition над Entity. Кожна нічого не знає ні про клас
 * сутності, ні про інші поведінки.
 */

export interface TtlBehavior extends Behavior {
  readonly remaining: number;
}

/** Час життя: через ttl секунд сутність помирає сама. */
export function ttl(seconds: number): TtlBehavior {
  let remaining = seconds;
  return {
    name: "ttl",
    get remaining() {
      return remaining;
    },
    update(entity: Entity, dt: number) {
      remaining -= dt;
      if (remaining <= 0) entity.kill();
    },
  };
}

export interface HomingOptions {
  targetKind: EntityKind;
  turnRate?: number;
  range?: number;
}

/** Самонаведення: довертає швидкість до найближчої цілі заданого виду. */
export function homing({
  targetKind,
  turnRate = Math.PI * 1.2,
  range = 420,
}: HomingOptions): Behavior {
  return {
    name: "homing",
    update(entity: Entity, dt: number, world: WorldLike) {
      const target = world.nearestOfKind(targetKind, entity.pos, range);
      if (!target) return;

      const desired = entity.pos.shortestDeltaTo(target.pos).angle;
      const current = entity.vel.angle;

      // Найкоротший кутовий шлях: без цього розворот ішов би «довгою дорогою».
      let delta = desired - current;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;

      const step = Math.sign(delta) * Math.min(Math.abs(delta), turnRate * dt);
      entity.vel = Vector2.fromAngle(current + step, entity.vel.length);
      entity.angle = entity.vel.angle;
    },
  };
}

export interface PickupBehavior extends Behavior {
  readonly label: string;
  apply(ship: ShipLike, world: WorldLike): void;
}

/** Те мінімальне, що потрібно ефекту бонуса від корабля. */
export interface ShipLike {
  heal(amount: number): number;
  homingShots?: number;
}

export function pickup({
  effect,
  label,
}: {
  effect: (ship: ShipLike, world: WorldLike) => void;
  label: string;
}): PickupBehavior {
  return {
    name: "pickup",
    label,
    apply(ship, world) {
      effect(ship, world);
    },
    update(entity: Entity, dt: number) {
      // Легке «дихання» для рендера — на симуляцію не впливає.
      entity.phase = (entity.phase ?? 0) + dt;
    },
  };
}

/** Повільне обертання — суто візуальне, для астероїдів. */
export function spin(radiansPerSecond: number): Behavior {
  return {
    name: "spin",
    update(entity: Entity, dt: number) {
      entity.angle += radiansPerSecond * dt;
    },
  };
}

export function findBehavior(entity: Entity, name: string): Behavior | null {
  return entity.behaviors.find((behavior) => behavior.name === name) ?? null;
}

/**
 * Звуження типу замість приведення: перевіряємо наявність apply()
 * і компілятор далі сам знає, що це PickupBehavior.
 */
export function isPickupBehavior(behavior: Behavior | null): behavior is PickupBehavior {
  return behavior !== null && "apply" in behavior && typeof behavior.apply === "function";
}
