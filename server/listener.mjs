// The server's socket (ADR 0016). Without a certificate it is a plain HTTP server, as always. With
// one (--tls-cert/--tls-key), one port speaks both: the first byte of a connection tells a TLS
// handshake (0x16) from plain HTTP. HTTPS is for the network (a team town, --host); plain HTTP is
// kept for this computer's own clients (the hook forwarder, the CLI, a local browser), which never
// leave the machine, and refused from anywhere else so nothing crosses the network in clear.
// "This computer" means a loopback peer, or a peer whose address is the one it connected to (a
// local client of a server bound to a network address with --host).
//
// The inner HTTP and HTTPS servers never listen themselves: they are told they are listening so
// that Node starts their request time limits and connection tracking, and every raw socket is
// tracked here too, so stopping the server ends all of them.
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { Duplex } from 'node:stream';
import { createSecureContext } from 'node:tls';

/** The first byte of a TLS record that carries a handshake. */
const TLS_HANDSHAKE = 0x16;
/** How long a new connection may stay silent before its first byte decides where it goes. */
const FIRST_BYTE_MS = 10_000;
/** How long a TLS handshake may take. */
const HANDSHAKE_MS = 10_000;
/** How long a refused peer has to read the refusal before the socket is closed. */
const REFUSAL_MS = 2_000;
const REFUSAL = 'This town only answers over https:// from other computers.\n';
const PLAIN_REFUSED = `HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(REFUSAL)}\r\n\r\n${REFUSAL}`;

/**
 * @typedef {object} Listener
 * @property {import('node:net').Server} front  what listens on the port
 * @property {boolean} tls
 * @property {() => void} closeIdle   ends keep-alive connections that are not in use
 * @property {() => void} closeAll    ends every connection
 */

/**
 * Checks a certificate and its key before the server starts (a mismatch fails here, not on the
 * first connection).
 * @param {{ cert: Buffer|string, key: Buffer|string }} tls
 */
export function checkTls(tls) {
  createSecureContext({ cert: tls.cert, key: tls.key });
}

/**
 * @param {import('node:http').RequestListener} onRequest
 * @param {(req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void} onUpgrade
 * @param {{ cert: Buffer|string, key: Buffer|string }|null} tls
 * @returns {Listener}
 */
export function createListener(onRequest, onUpgrade, tls) {
  const plain = prepare(createHttpServer(onRequest), onUpgrade);
  if (!tls) {
    return { front: plain, tls: false, closeIdle: () => plain.closeIdleConnections(), closeAll: () => plain.closeAllConnections() };
  }
  const secure = prepare(createHttpsServer({ cert: tls.cert, key: tls.key, minVersion: 'TLSv1.2', handshakeTimeout: HANDSHAKE_MS }, onRequest), onUpgrade);
  /** Every raw connection, whichever server it went to. @type {Set<import('node:net').Socket>} */
  const sockets = new Set();
  const front = createNetServer({ pauseOnConnect: true }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.setTimeout(FIRST_BYTE_MS, () => socket.destroy());
    // No encoding is set, so the socket delivers Buffers.
    socket.once('data', (/** @type {Buffer} */ chunk) => {
      socket.setTimeout(0);
      socket.pause();
      if (chunk[0] === TLS_HANDSHAKE) {
        // TLS reads a socket's handle directly, past anything put back with unshift, so the
        // handshake's first bytes are replayed through a stream of its own.
        secure.emit('connection', replaying(socket, chunk));
        return;
      }
      socket.unshift(chunk);
      if (isSameMachine(socket)) {
        plain.emit('connection', socket);
      } else {
        socket.end(PLAIN_REFUSED);
        setTimeout(() => socket.destroy(), REFUSAL_MS).unref();
      }
      socket.resume();
    });
    socket.resume();
  });
  // Time limits and connection tracking start when a Node HTTP server hears it is listening.
  front.once('listening', () => {
    plain.emit('listening');
    secure.emit('listening');
  });
  front.once('close', () => {
    plain.close();
    secure.close();
  });
  return {
    front,
    tls: true,
    closeIdle: () => {
      plain.closeIdleConnections();
      secure.closeIdleConnections();
    },
    closeAll: () => {
      plain.closeAllConnections();
      secure.closeAllConnections();
      for (const socket of sockets) socket.destroy();
    },
  };
}

/**
 * A stream that yields `first`, then whatever the socket receives, and writes to the socket.
 * @param {import('node:net').Socket} socket
 * @param {Buffer} first
 * @returns {Duplex}
 */
function replaying(socket, first) {
  const stream = new Duplex({
    read: () => socket.resume(),
    write: (chunk, encoding, callback) => socket.write(chunk, encoding, callback),
    final: (callback) => socket.end(callback),
    destroy: (error, callback) => {
      socket.destroy(error ?? undefined);
      callback(error);
    },
  });
  stream.push(first);
  socket.on('data', (data) => {
    if (!stream.push(data)) socket.pause();
  });
  socket.on('end', () => stream.push(null));
  socket.on('close', () => stream.destroy());
  socket.resume();
  return stream;
}

/**
 * Upgrades and request time limits. Bodies are small; a slow upload is not a real client. Held
 * hook responses are not affected: these limits cover receiving the request, not answering it.
 * @template {import('node:http').Server} S
 * @param {S} server
 * @param {(req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void} onUpgrade
 * @returns {S}
 */
function prepare(server, onUpgrade) {
  server.on('upgrade', onUpgrade);
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}

/**
 * True for a peer on this computer (127.0.0.0/8, ::1, and IPv4 loopback seen through IPv6).
 * @param {string|undefined} address
 * @returns {boolean}
 */
export function isLoopbackAddress(address) {
  if (!address) return false;
  const bare = unmapped(address);
  return bare === '::1' || /^127(?:\.\d{1,3}){3}$/.test(bare);
}

/**
 * True for a connection from this computer: a loopback peer, or one that connected from the very
 * address it connected to (a local client of a server bound to a network address).
 * @param {{ remoteAddress?: string, localAddress?: string }} socket
 * @returns {boolean}
 */
export function isSameMachine({ remoteAddress, localAddress }) {
  if (isLoopbackAddress(remoteAddress)) return true;
  return Boolean(remoteAddress && localAddress && unmapped(remoteAddress) === unmapped(localAddress));
}

/** @param {string} address */
function unmapped(address) {
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}
