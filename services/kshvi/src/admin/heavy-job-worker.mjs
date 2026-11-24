import { copyFileSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

function cpuUsage() {
  const usage = process.cpuUsage();
  return { userMs: usage.user / 1000, systemMs: usage.system / 1000 };
}
const job = JSON.parse(process.argv[2]);
const operation = job.operation;
if (operation.kind === 'CPU_WORK') {
  let accumulator = 0;
  for (let index = 0; index < operation.iterations; index += 1) accumulator = (accumulator + index % 7) % 1_000_003;
  if (accumulator < 0) throw new Error('Недопустимый расчёт');
  process.send?.({ id: job.id, result: { pid: process.pid, iterations: operation.iterations, cpuUsage: cpuUsage() } });
  process.exit(0);
}
if (operation.kind === 'COPY_FILE') {
  copyFileSync(operation.source, operation.destination);
  process.send?.({ id: job.id, result: { pid: process.pid, bytes: statSync(operation.destination).size, cpuUsage: cpuUsage() } });
  process.exit(0);
}
if (operation.kind === 'DOMAIN_WORK') {
  const rows = JSON.parse(readFileSync(operation.inputPath, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('Доменный набор должен быть массивом записей');
  const hash = createHash('sha256');
  let checksum = 0;
  let previousSequence = 0;
  let orderingErrors = 0;
  for (const row of rows) {
    const text = JSON.stringify(row);
    hash.update(text);
    if (operation.domainKind === 'MASS_CALCULATION') {
      for (let index = 0; index < text.length * 20; index += 1) checksum = (checksum * 33 + text.charCodeAt(index % text.length)) >>> 0;
    } else if (operation.domainKind === 'REPLAY') {
      const sequence = Number(row.sequence);
      if (previousSequence && sequence < previousSequence) orderingErrors += 1;
      previousSequence = sequence;
      checksum = (checksum + sequence) >>> 0;
    } else {
      checksum = (checksum + text.length) >>> 0;
    }
  }
  process.send?.({
    id: job.id,
    result: {
      pid: process.pid, kind: operation.domainKind, rows: rows.length, sha256: hash.digest('hex'),
      checksum, orderingErrors, cpuUsage: cpuUsage(),
    },
  });
  process.exit(0);
}
throw new Error('Неподдерживаемая операция тяжёлого задания');
