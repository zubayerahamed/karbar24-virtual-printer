import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { once } from 'node:events';
import { PrinterServer, MAX_JOB_BYTES } from '../src/core/printer-server.mjs';
import { buildTestReceipt } from '../src/core/test-receipt.mjs';
import { mergeSettings, receiptFileBase } from '../src/core/settings.mjs';

async function withServer(run) {
  let drawerOpen = false;
  const server = new PrinterServer({ getPaperDots: () => 576, isDrawerOpen: () => drawerOpen });
  await server.start({ host: '127.0.0.1', port: 0 });
  try {
    await run(server, server.server.address().port, (v) => (drawerOpen = v));
  } finally {
    await server.stop();
  }
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => resolve(socket));
    socket.once('error', reject);
  });
}

test('the test receipt arrives over TCP as one document that opens the drawer', async () => {
  await withServer(async (server, port) => {
    const docs = once(server, 'documents');
    const drawer = once(server, 'drawer');
    const socket = await connect(port);
    socket.end(buildTestReceipt({ paper: 80, when: new Date() }));
    const [[{ docs: received, raw }]] = await Promise.all([docs, drawer]);
    assert.equal(received.length, 1);
    assert.equal(received[0].drawerKick, true);
    assert.ok(received[0].blocks.some((b) => b.t === 'image'));
    assert.ok(raw.length > 100);
  });
});

test('a connect-and-hang-up probe makes no receipt', async () => {
  await withServer(async (server, port) => {
    let documents = 0;
    server.on('documents', () => documents++);
    (await connect(port)).end();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(documents, 0);
  });
});

test('a sender that keeps the connection open still gets its receipt after a pause', async () => {
  await withServer(async (server, port) => {
    const docs = once(server, 'documents');
    const socket = await connect(port);
    socket.write('hello\n');
    const [{ docs: received }] = await docs;
    assert.equal(received.length, 1);
    socket.destroy();
  });
});

test('status questions are answered while the connection is open', async () => {
  await withServer(async (_server, port, setDrawer) => {
    setDrawer(true);
    const socket = await connect(port);
    socket.write(Buffer.from([0x10, 0x04, 1]));
    const [reply] = await once(socket, 'data');
    assert.equal(reply[0], 0x16);
    socket.destroy();
  });
});

test('an oversized job is dropped and reported', async () => {
  await withServer(async (server, port) => {
    const rejected = once(server, 'rejected');
    const socket = await connect(port);
    socket.on('error', () => {});
    socket.write(Buffer.alloc(MAX_JOB_BYTES + 1, 0x41));
    const [{ reason }] = await rejected;
    assert.match(reason, /16 MB/);
  });
});

test('a port that is taken is reported with its code', async () => {
  await withServer(async (_server, port) => {
    const second = new PrinterServer({ getPaperDots: () => 576, isDrawerOpen: () => false });
    await assert.rejects(second.start({ host: '127.0.0.1', port }), { code: 'EADDRINUSE' });
  });
});

test('settings keep the old value when a change is invalid', () => {
  const base = { paper: 80, port: 9100, scope: 'local', autoCloseSeconds: 0, sound: true };
  assert.deepEqual(mergeSettings(base, { paper: 72, port: 70000, scope: 'world', autoCloseSeconds: 7, sound: 'x' }), base);
  assert.equal(mergeSettings(base, { paper: '58' }).paper, 58);
});

test('file names are sortable and safe', () => {
  assert.equal(receiptFileBase(new Date(2026, 10, 10, 14, 3, 5), 7), '2026-11-10_14-03-05_receipt-0007');
});
