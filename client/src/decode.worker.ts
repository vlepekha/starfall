/**
 * Воркер-кандидат: розбір знімків у окремому потоці.
 *
 * Ідея експерименту — зняти з головного потоку розбір 30 бінарних
 * знімків за секунду. Воркер отримує ArrayBuffer, розбирає його
 * і повертає назад лише кількість сутностей: повертати сам знімок
 * означало б structuredClone на кожен кадр, а це і є те, що ми
 * намагаємося прибрати.
 */
import { decodeSnapshot } from "@starfall/shared/protocol";

interface Job {
  id: number;
  bytes: ArrayBuffer;
}

self.onmessage = (event: MessageEvent<Job>) => {
  const { id, bytes } = event.data;
  const snapshot = decodeSnapshot(bytes);
  self.postMessage({ id, entities: snapshot?.entities.length ?? 0 });
};
