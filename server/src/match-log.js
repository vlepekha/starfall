import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Лог матчу у форматі NDJSON — один JSON-об'єкт на рядок.
 *
 * Чому саме NDJSON, а не один великий масив: такий файл можна читати
 * і писати потоково, не тримаючи цілого в пам'яті. Масив довелося б
 * спершу закрити дужкою, а при читанні — розібрати повністю.
 */
export function createEventTransform() {
  return new Transform({
    objectMode: true, // на вхід об'єкти, на вихід рядки
    transform(event, _encoding, callback) {
      try {
        callback(null, `${JSON.stringify({ t: Date.now(), ...event })}\n`);
      } catch (error) {
        // Помилка серіалізації не має вбивати процес — віддаємо її потоку.
        callback(error);
      }
    },
  });
}

/**
 * Писач логу однієї кімнати.
 *
 * Події йдуть у Transform, звідти у файл. Між ними працює backpressure:
 * якщо диск не встигає, write() повертає false, і pipeline сам пригальмує
 * джерело. Нам для цього не треба робити нічого — крім як не писати
 * у файл напряму в обхід потоку.
 */
export function createMatchLog(logDir, roomId) {
  const path = join(logDir, `${roomId}.ndjson`);
  const input = createEventTransform();
  const file = createWriteStream(path, { flags: "a" });

  // pipeline сам прибере обидва потоки, якщо щось зламається.
  const done = pipeline(input, file).catch((error) => {
    console.error(`[match-log] ${roomId}: ${error.message}`);
  });

  return {
    path,
    write(event) {
      // Якщо писач уже закритий — мовчки ігноруємо, це не привід падати.
      if (!input.writableEnded) input.write(event);
    },
    async close() {
      input.end();
      await done;
    },
  };
}

/**
 * Повтор матчу: файл віддається потоком, у пам'ять не читається.
 *
 * Саме тут видно різницю між readFile і createReadStream. readFile на
 * 40 МБ підніме rss на ті самі 40 МБ і триматиме їх, доки повільний
 * клієнт не дочитає. Потік тримає лише highWaterMark (64 КБ).
 */
export async function streamReplay(logDir, roomId, res) {
  const path = join(logDir, `${roomId}.ndjson`);
  const info = await stat(path).catch(() => null);
  if (!info) {
    res.statusCode = 404;
    res.end("no replay");
    return;
  }

  res.writeHead(200, {
    "content-type": "application/x-ndjson",
    "content-length": info.size,
  });
  // pipeline зв'язує читання з відповіддю: HTTP-відповідь теж потік,
  // і її backpressure автоматично гальмує читання з диска.
  await pipeline(createReadStream(path), res);
}
