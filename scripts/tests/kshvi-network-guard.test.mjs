import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import net from 'node:net';
import { installNetworkGuard, isLoopbackHost } from '../kshvi-network-guard.mjs';

test('разрешает только loopback и блокирует fetch и socket наружу', async () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('192.0.2.1'), false);
  const server = createServer((_request, response) => response.end('ok'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const restore = installNetworkGuard();
  try {
    const local = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(await local.text(), 'ok');
    await assert.rejects(fetch('https://example.com/'), /KSHVI_EXTERNAL_NETWORK/);
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '192.0.2.1', port: 80 });
      socket.on('error', error => {
        try { assert.match(error.message, /KSHVI_EXTERNAL_NETWORK/); resolve(); } catch (cause) { reject(cause); }
      });
      socket.on('connect', () => reject(new Error('Внешний socket не должен подключаться')));
    });
  } finally {
    restore();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
