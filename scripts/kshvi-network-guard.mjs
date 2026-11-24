import dns from 'node:dns';
import net from 'node:net';

export function isLoopbackHost(host) {
  const normalized = String(host ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

function externalError(target) {
  const error = new Error(`KSHVI_EXTERNAL_NETWORK: запрещено подключение ${target}`);
  error.code = 'KSHVI_EXTERNAL_NETWORK';
  return error;
}

function connectionHost(args) {
  const options = args[0];
  return typeof options === 'object' && options ? options.host : typeof args[1] === 'string' ? args[1] : undefined;
}
function connectionPath(args) {
  const options = args[0];
  return typeof options === 'object' && options ? options.path : typeof options === 'string' ? options : undefined;
}
function forbiddenConnection(args) {
  const host = connectionHost(args);
  const socketPath = connectionPath(args);
  return host && !isLoopbackHost(host) && !(typeof socketPath === 'string' && socketPath.startsWith('/'));
}
function rejectedSocket() {
  const socket = new net.Socket();
  queueMicrotask(() => socket.emit('error', externalError('внешний адрес')));
  return socket;
}

export function installNetworkGuard() {
  const originalFetch = globalThis.fetch;
  const originalConnect = net.Socket.prototype.connect;
  const originalNetConnect = net.connect;
  const originalCreateConnection = net.createConnection;
  const originalLookup = dns.lookup;
  globalThis.fetch = async (input, init) => {
    const raw = typeof input === 'string' || input instanceof URL ? input : input.url;
    const url = new URL(raw);
    if (['http:', 'https:'].includes(url.protocol) && !isLoopbackHost(url.hostname)) throw externalError(url.host);
    return originalFetch(input, init);
  };
  net.Socket.prototype.connect = function guardedConnect(...args) {
    if (forbiddenConnection(args)) {
      queueMicrotask(() => this.emit('error', externalError(connectionHost(args))));
      return this;
    }
    return originalConnect.apply(this, args);
  };
  net.connect = (...args) => forbiddenConnection(args) ? rejectedSocket() : originalNetConnect(...args);
  net.createConnection = (...args) => forbiddenConnection(args) ? rejectedSocket() : originalCreateConnection(...args);
  dns.lookup = function guardedLookup(hostname, ...args) {
    if (!isLoopbackHost(hostname)) {
      const callback = args.at(-1);
      queueMicrotask(() => callback(externalError(hostname)));
      return;
    }
    return originalLookup.call(this, hostname, ...args);
  };
  return () => {
    globalThis.fetch = originalFetch;
    net.Socket.prototype.connect = originalConnect;
    net.connect = originalNetConnect;
    net.createConnection = originalCreateConnection;
    dns.lookup = originalLookup;
  };
}

if (process.env.KSHVI_OFFLINE === '1' || process.env.KSHVI_NETWORK_GUARD === '1') installNetworkGuard();
