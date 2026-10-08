import { startMockServer } from './mock';

const port = Number(process.argv[2] ?? process.env.PORT ?? 1234);
await startMockServer(port, '127.0.0.1', 25);
console.log(`Подставная модель штаба: http://localhost:${port}/v1 (для проверки стенда без LM Studio; Ctrl+C — остановить)`);
