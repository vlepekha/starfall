/**
 * Експеримент з лаби 2: чотири правила this — і найпоширеніший спосіб
 * їх порушити. Викликається один раз зі старту, друкує все в консоль.
 * Докладний розбір — у README, розділ «Баг із this».
 */
export function demonstrateThisBug(ship, world) {
  const out = [];
  const log = (line) => {
    out.push(line);
    console.log(line);
  };

  log("--- this: 4 правила ---");

  // 1. Виклик як метод: this — об'єкт зліва від крапки.
  const before = countBullets(world);
  ship.fire(world);
  log(`1. ship.fire(world)        -> працює, куль стало ${countBullets(world) - before}`);

  // 2. Вільний виклик: метод відірвали від об'єкта, this === undefined
  //    (модулі завжди в strict mode, тому не window, а саме undefined).
  const detached = ship.fire;
  try {
    detached(world);
    log("2. const f = ship.fire; f() -> несподівано спрацювало");
  } catch (error) {
    log(`2. const f = ship.fire; f() -> ${error.constructor.name}: ${error.message}`);
  }

  // 3. Явна прив'язка: call/apply/bind задають this вручну.
  const bound = ship.fire.bind(ship);
  bound(world);
  log("3. ship.fire.bind(ship)()  -> працює, this прив'язаний назавжди");

  // 4. Стрілка не має власного this — бере його з місця оголошення.
  const arrow = () => ship.fire(world);
  arrow();
  log("4. () => ship.fire(world)  -> працює, this взято із замикання");

  log("--- ланцюжок прототипів корабля ---");
  let proto = Object.getPrototypeOf(ship);
  const chain = ["Ship (екземпляр)"];
  while (proto) {
    chain.push(proto.constructor?.name ?? "null-prototype");
    proto = Object.getPrototypeOf(proto);
  }
  log(chain.join(" -> "));
  log(`ship instanceof Ship: ${ship.constructor.name === "Ship"}`);
  log(`власні ключі екземпляра: ${Object.keys(ship).join(", ")}`);
  log("методи (update, fire, damage) лежать у Ship.prototype, а не в екземплярі");

  return out;
}

function countBullets(world) {
  let n = 0;
  for (const _ of world.ofKind("bullet")) n += 1;
  return n;
}
