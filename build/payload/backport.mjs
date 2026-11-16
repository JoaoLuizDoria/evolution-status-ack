import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const sourceLock = Object.freeze(JSON.parse(readFileSync(new URL('./sources.lock.json', import.meta.url))));
export const sha256 = value => createHash('sha256').update(value).digest('hex');

// Pure, fail-closed source transformation. Not an installer or production hook.
export function evaluateBackport(source, version = sourceLock.version) {
  if (version !== '7.0.0-rc.9') throw new Error('UNSUPPORTED_BAILEYS_VERSION');
  if (sha256(source) !== sourceLock.baselineFileSha256) throw new Error('BASELINE_HASH_MISMATCH');
  const edits = [
    [
      '    const makeOfflineNodeProcessor = () => {',
      `    // Isolated rc.9 backport of the status-ACK proposal; not upstream-released.
    const handleStatus = async (node) => {
        try {
            await sendMessageAck(node);
        }
        catch (error) {
            onUnexpectedError(error, 'acking status stanza');
        }
    };
    const makeOfflineNodeProcessor = () => {`
    ],
    [
      "            ['notification', handleNotification]\n",
      "            ['notification', handleNotification],\n            ['status', handleStatus]\n"
    ],
    [
      "    ws.on('CB:ack,class:message', (node) => {",
      `    ws.on('CB:status', async (node) => {
        await processNode('status', node, 'acking status stanza', handleStatus).catch(error =>
            onUnexpectedError(error, 'acking status stanza'));
    });
    ws.on('CB:ack,class:message', (node) => {`
    ]
  ];
  let candidate = source;
  for (const [before, after] of edits) {
    if (candidate.split(before).length !== 2) throw new Error('PATCH_ANCHOR_NOT_UNIQUE');
    candidate = candidate.replace(before, after);
  }
  let reversed = candidate;
  for (const [before, after] of [...edits].reverse()) {
    if (reversed.split(after).length !== 2) throw new Error('REVERSE_ANCHOR_NOT_UNIQUE');
    reversed = reversed.replace(after, before);
  }
  if (reversed !== source) throw new Error('UNEXPECTED_SOURCE_CHANGE');
  return { candidate, baselineSha256: sha256(source), candidateSha256: sha256(candidate), edits: edits.length };
}
