import { copyFileSync, statSync } from 'node:fs';

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
throw new Error('Неподдерживаемая операция тяжёлого задания');
