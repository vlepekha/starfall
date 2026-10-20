/**
 * П'ять головоломок порядку виконання. Друкуються в консоль під час старту
 * (?puzzles=1 — тільки вони, без гри). Розбір кожної — у README.
 *
 * Усе навмисно без жодної затримки: питання не в тому, хто «швидший»,
 * а в тому, в яку чергу потрапляє колбек.
 */
const line = (puzzle: number, text: string): void => console.log(`[${puzzle}] ${text}`);

/** 1. Базовий порядок: синхронно → мікрозадачі → макрозадача. */
function puzzleOne(): void {
  line(1, "A sync");
  setTimeout(() => line(1, "D setTimeout"), 0);
  Promise.resolve().then(() => line(1, "C microtask"));
  line(1, "B sync");
}

/** 2. await — це .then: усе після нього потрапляє в мікрозадачу. */
async function puzzleTwo(): Promise<void> {
  line(2, "A sync (до await)");
  await null; // await навіть не-проміса все одно відкладає продовження
  line(2, "C після await — мікрозадача");
}

/** 3. setTimeout усередині .then: мікрозадача планує макрозадачу. */
function puzzleThree(): void {
  Promise.resolve()
    .then(() => {
      line(3, "B microtask");
      setTimeout(() => line(3, "E setTimeout з мікрозадачі"), 0);
    })
    .then(() => line(3, "C другий .then"));
  setTimeout(() => line(3, "D setTimeout з синхронного коду"), 0);
  line(3, "A sync");
}

/** 4. requestAnimationFrame: окрема фаза, не черга задач. */
function puzzleFour(): void {
  requestAnimationFrame(() => {
    line(4, "D rAF (перед малюванням)");
    Promise.resolve().then(() => line(4, "E мікрозадача всередині rAF"));
  });
  setTimeout(() => line(4, "C setTimeout 0"), 0);
  queueMicrotask(() => line(4, "B мікрозадача"));
  line(4, "A sync");
}

/**
 * 5. Черга мікрозадач спорожнюється ПОВНІСТЮ перед наступною задачею —
 *    навіть якщо мікрозадачі додають нові мікрозадачі.
 */
function puzzleFive(): void {
  setTimeout(() => line(5, "E setTimeout — останній"), 0);
  Promise.resolve().then(() => {
    line(5, "B мікрозадача 1");
    Promise.resolve().then(() => {
      line(5, "C мікрозадача 2 (створена з першої)");
      Promise.resolve().then(() => line(5, "D мікрозадача 3"));
    });
  });
  line(5, "A sync");
}

/**
 * Головоломки запускаються по черзі, а не всі разом: інакше їхні колбеки
 * перемішалися б в одних і тих самих чергах, і прочитати вивід було б
 * неможливо. Пауза між ними — два кадри, щоб напевно відпрацювали і
 * макрозадачі, і rAF попередньої.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))),
  );

export async function runPuzzles(): Promise<void> {
  console.log("=== головоломки порядку виконання ===");
  for (const puzzle of [puzzleOne, puzzleTwo, puzzleThree, puzzleFour, puzzleFive]) {
    void puzzle();
    await settle();
  }
  console.log("=== кінець ===");
}
