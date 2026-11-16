import { EventEmitter } from 'node:events';

const state = globalThis[Symbol.for('status-ack-lab-state')];
if (!state) throw new Error('ISOLATED_WEBSOCKET_STATE_REQUIRED');

// The only mocked dependency in the real-socket integration. No ws/open event,
// network connection, handshake, QR, account login or message delivery occurs.
export class WebSocketClient extends EventEmitter {
  isOpen = true;
  isClosed = false;
  isClosing = false;
  isConnecting = false;
  connect() { state.mockConnects++; }
  close() { this.isOpen = false; this.isClosed = true; }
  send(bytes, cb) {
    state.attempts++;
    if (state.failNext) {
      state.failNext = false;
      cb?.(new Error('FICTITIOUS_SEND_FAILURE'));
      return true;
    }
    state.frames.push(Buffer.from(bytes));
    cb?.();
    return true;
  }
}
