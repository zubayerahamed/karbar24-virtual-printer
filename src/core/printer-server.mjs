/**
 * The pretend printer on the network: a raw TCP listener, the same thing a LAN thermal printer has on port 9100.
 * One connection is one stream of printer commands. Documents are handed over when the sender hangs up, or after a
 * short silence for senders that keep the connection open.
 */
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { EscPosDecoder } from './escpos-decoder.mjs';

export const MAX_JOB_BYTES = 16 * 1024 * 1024;
const MAX_CONNECTIONS = 16;
const IDLE_FLUSH_MS = 1500;
const SOCKET_TIMEOUT_MS = 120_000;

/**
 * Events: `receiving` (first bytes of a job), `documents` ({docs, raw, remote}), `idle` (bytes came but nothing
 * printable), `drawer` ({remote}), `rejected` ({reason, remote}).
 */
export class PrinterServer extends EventEmitter {
  /** @param {{getPaperDots: () => number, isDrawerOpen: () => boolean}} options */
  constructor({ getPaperDots, isDrawerOpen }) {
    super();
    this.getPaperDots = getPaperDots;
    this.isDrawerOpen = isDrawerOpen;
    this.server = null;
    this.sockets = new Set();
  }

  /** Starts listening. Rejects with the socket error (`code` EADDRINUSE when another app has the port). */
  start({ host, port }) {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.accept(socket));
      server.maxConnections = MAX_CONNECTIONS;
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        server.on('error', (error) => this.emit('rejected', { reason: error.message, remote: null }));
        this.server = server;
        resolve();
      });
    });
  }

  /** Stops listening and hangs up on anyone connected, like switching the printer off. */
  stop() {
    return new Promise((resolve) => {
      for (const socket of this.sockets) socket.destroy();
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  accept(socket) {
    this.sockets.add(socket);
    const remote = (socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const chunks = [];
    let received = 0;
    let idleTimer = null;
    let announced = false;

    const decoder = new EscPosDecoder({
      paperDots: this.getPaperDots(),
      isDrawerOpen: this.isDrawerOpen,
      onReply: (bytes) => {
        if (!socket.destroyed) socket.write(bytes);
      },
      onDrawer: () => this.emit('drawer', { remote }),
    });

    const flush = () => {
      clearTimeout(idleTimer);
      const hadBytes = announced;
      announced = false;
      const docs = decoder.takeDocuments();
      const raw = Buffer.concat(chunks);
      chunks.length = 0;
      if (docs.length) this.emit('documents', { docs, raw, remote });
      else if (hadBytes) this.emit('idle');
    };

    socket.setTimeout(SOCKET_TIMEOUT_MS, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_JOB_BYTES) {
        this.emit('rejected', { reason: 'The print job was larger than 16 MB, so it was dropped.', remote });
        chunks.length = 0;
        decoder.takeDocuments();
        socket.destroy();
        return;
      }
      if (!announced) {
        announced = true;
        this.emit('receiving');
      }
      chunks.push(chunk);
      decoder.feed(chunk);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(flush, IDLE_FLUSH_MS);
    });
    socket.on('close', () => {
      this.sockets.delete(socket);
      flush();
    });
  }
}
