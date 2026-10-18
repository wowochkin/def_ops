/**
 * Отложенная синхронизация до «карта успокоилась» (idle): сколько бы раз ни просили, пока ждём, — один обработчик
 * (при проигрывании хода наложения меняются каждые несколько процентов — десяток ожидающих обработчиков не копится).
 */
export function idleOnce(map: { once(ev: 'idle', cb: () => void): unknown }, run: () => void): () => void {
  let waiting = false;
  return () => {
    if (waiting) return;
    waiting = true;
    map.once('idle', () => { waiting = false; run(); });
  };
}
