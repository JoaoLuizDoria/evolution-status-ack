import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

if (process.env.LAB_STATUS_ACK_ISOLATED !== 'true' || process.platform !== 'linux') throw new Error('ISOLATED_LINUX_ONLY');
const state = { frames: [], attempts: 0, mockConnects: 0, networkAttempts: 0, failNext: false };
globalThis[Symbol.for('status-ack-lab-state')] = state;
const deny = () => { state.networkAttempts++; throw new Error('REAL_NETWORK_FORBIDDEN'); };
net.Socket.prototype.connect = deny;
net.connect = net.createConnection = tls.connect = deny;
dns.lookup = dns.resolve = deny;
http.request = http.get = https.request = https.get = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
const fakeSource = readFileSync(new URL('./fake-websocket.mjs', import.meta.url), 'utf8');
let replacements = 0;
registerHooks({ load(url, context, nextLoad) {
  if (url === 'file:///evolution/node_modules/baileys/lib/Socket/Client/websocket.js') {
    replacements++;
    return { format: 'module', source: fakeSource, shortCircuit: true };
  }
  return nextLoad(url, context);
} });
const baileys = await import(pathToFileURL('/evolution/node_modules/baileys/lib/index.js').href);
const { decodeBinaryNode } = await import(pathToFileURL('/evolution/node_modules/baileys/lib/WABinary/index.js').href);
const { NOISE_WA_HEADER } = await import(pathToFileURL('/evolution/node_modules/baileys/lib/Defaults/index.js').href);
const { default: pino } = await import(pathToFileURL('/evolution/node_modules/pino/pino.js').href);
const baseline = process.env.LAB_EXPECT_STATUS === 'absent';
const clients = [];
const immediate = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i++) await immediate(); };

function makeClient(ignore = () => false) {
  const logs = [];
  const logger = pino({ level: 'debug' }, { write: line => logs.push(JSON.parse(line)) });
  const creds = baileys.initAuthCreds();
  creds.me = { id: '1000000000:1@s.whatsapp.net', name: 'Fictitious Lab' };
  const keys = new Map();
  const client = baileys.default({
    ...baileys.DEFAULT_CONNECTION_CONFIG, logger, auth: {
      creds, keys: {
        get: async (type, ids) => Object.fromEntries(ids.map(id => [id, keys.get(type + ':' + id)])),
        set: async data => { for (const [type, values] of Object.entries(data)) for (const [id, value] of Object.entries(values)) keys.set(type + ':' + id, value); }
      }
    },
    printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false,
    fireInitQueries: false, shouldIgnoreJid: ignore, connectTimeoutMs: 500,
    keepAliveIntervalMs: 60000, defaultQueryTimeoutMs: 500
  });
  clients.push(client);
  return { client, logs };
}

const status = (id, attrs = {}) => ({ tag: 'status', attrs: { id, from: '1000000001@s.whatsapp.net', type: 'media', ...attrs } });
async function dispatch(client, node) {
  for (const listener of client.ws.listeners('CB:' + node.tag)) await listener(node);
  await settle();
}
async function decodeFrame(frame) {
  let offset = frame.subarray(0, NOISE_WA_HEADER.length).equals(NOISE_WA_HEADER) ? NOISE_WA_HEADER.length : 0;
  const length = frame.readUIntBE(offset, 3); offset += 3;
  assert.equal(frame.length - offset, length, 'real noise frame length');
  return decodeBinaryNode(frame.subarray(offset));
}
const sentNodes = async from => Promise.all(state.frames.slice(from).map(decodeFrame));

test('exact image loads the real Baileys/socket/protobuf/crypto graph with one mocked transport', () => {
  assert.equal(replacements, 1);
  assert.equal(typeof baileys.initAuthCreds, 'function');
  assert.equal(state.networkAttempts, 0);
});

if (baseline) {
  test('negative control in the image: no listener and no encoded ACK', async () => {
    const { client } = makeClient(); const from = state.frames.length;
    await dispatch(client, status('FICTITIOUS-BASELINE'));
    assert.equal(client.ws.listenerCount('CB:status'), 0);
    assert.equal(state.frames.length, from);
  });
} else {
  for (const type of ['text', 'media']) test(`real encoder produces a ${type} status ACK frame`, async () => {
    const { client } = makeClient(); const from = state.frames.length;
    await dispatch(client, status('FICTITIOUS-' + type, { type }));
    const nodes = await sentNodes(from);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].tag, 'ack');
    assert.deepEqual(nodes[0].attrs, { id: 'FICTITIOUS-' + type, to: '1000000001@s.whatsapp.net', class: 'status', type });
  });
  test('real encoder preserves participant/recipient with no NACK', async () => {
    const { client } = makeClient(); const from = state.frames.length;
    await dispatch(client, status('FICTITIOUS-ROUTING', { participant: '1000000002@s.whatsapp.net', recipient: '1000000003@s.whatsapp.net' }));
    const [ack] = await sentNodes(from);
    assert.equal(ack.attrs.participant, '1000000002@s.whatsapp.net');
    assert.equal(ack.attrs.recipient, '1000000003@s.whatsapp.net');
    assert.equal(ack.attrs.error, undefined);
  });
  test('ignored-JID setting does not suppress the protocol ACK or mark a message read', async () => {
    const { client } = makeClient(() => true); const from = state.frames.length;
    await dispatch(client, status('FICTITIOUS-IGNORED'));
    const nodes = await sentNodes(from);
    assert.deepEqual(nodes.map(x => x.tag), ['ack']);
    assert.equal(nodes[0].attrs.class, 'status');
  });
  test('real offline queue acknowledges 30 statuses in FIFO order', async () => {
    const { client } = makeClient(); const from = state.frames.length;
    for (let i = 0; i < 30; i++) client.ws.emit('CB:status', status('FICTITIOUS-FIFO-' + i, { offline: 'true' }));
    await settle();
    const nodes = await sentNodes(from);
    assert.deepEqual(nodes.map(x => x.attrs.id), Array.from({ length: 30 }, (_, i) => 'FICTITIOUS-FIFO-' + i));
  });
  test('transport failure is reported once and later offline work still executes', async () => {
    const { client, logs } = makeClient(); const from = state.frames.length; const attempts = state.attempts;
    state.failNext = true;
    await dispatch(client, status('FICTITIOUS-FAILED', { offline: 'true' }));
    await dispatch(client, status('FICTITIOUS-AFTER-FAIL', { offline: 'true' }));
    const nodes = await sentNodes(from);
    assert.deepEqual(nodes.map(x => x.attrs.id), ['FICTITIOUS-AFTER-FAIL']);
    assert.equal(state.attempts - attempts, 2);
    assert.equal(logs.filter(x => x.msg === "unexpected error in 'acking status stanza'").length, 1);
  });
  test('re-delivery only emits protocol ACKs, not outgoing user messages', async () => {
    const { client } = makeClient(); const from = state.frames.length;
    await dispatch(client, status('FICTITIOUS-REDELIVERY')); await dispatch(client, status('FICTITIOUS-REDELIVERY'));
    const nodes = await sentNodes(from);
    assert.deepEqual(nodes.map(x => x.tag), ['ack', 'ack']);
  });
  test('new ephemeral client needs no file/session/database and registers one handler', async () => {
    const { client } = makeClient();
    assert.equal(client.ws.listenerCount('CB:status'), 1);
    assert.equal(client.authState.creds.me.id, '1000000000:1@s.whatsapp.net');
  });
}

after(async () => {
  for (const client of clients) client.end(new Error('Isolated evaluation complete'));
  await settle();
  assert.equal(state.networkAttempts, 0, 'no physical network attempt');
  assert.equal(clients.every(client => client.ws.isClosed), true);
  const resources = process.getActiveResourcesInfo();
  assert.equal(resources.some(name => /TCPConnectWrap|TCPSocketWrap|UDPWrap|TLSWrap/.test(name)), false);
  console.log('STATUS_ACK_LAB_RESOURCES ' + JSON.stringify({ resources, networkAttempts: state.networkAttempts, fakeSocketsClosed: clients.length }));
});
