import { readFileSync, lstatSync, realpathSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { evaluateBackport } from '../backport.mjs';

export const TARGET = '/evolution/node_modules/baileys/lib/Socket/messages-recv.js';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const CANDIDATE_HASH = '1117b1ee04314684d5706c5d11d167f7ed8be09f7307a83e30ce4a131c748e1e';
export const BASELINE_HASH = '8b9329ddf95fa7a1785826d8861af236f5f055ff22a5ed1ce52afdf9565d873e';

export function assertBuildOnly({ platform, env, argv }) {
  if (platform !== 'linux') throw new Error('LINUX_IMAGE_BUILD_REQUIRED');
  if (argv.length !== 1 || argv[0] !== '--apply-build') throw new Error('EXPLICIT_BUILD_ACTION_REQUIRED');
  if (env.STATUS_ACK_IMAGE_BUILD !== '1') throw new Error('BUILD_STAGE_REQUIRED');
  if (Object.keys(env).some(name => /^RAILWAY_|^DATABASE_|^CACHE_REDIS_URI$|^AUTHENTICATION_API_KEY$|^EVOLUTION_API_(KEY|URL)$/.test(name))) throw new Error('DEPLOYED_OR_CREDENTIALED_RUNTIME_REJECTED');
}

export function planPatch({ evolutionVersion, baileysVersion, source }) {
  if (evolutionVersion !== '2.3.7') throw new Error('EVOLUTION_VERSION_MISMATCH');
  if (baileysVersion !== '7.0.0-rc.9') throw new Error('BAILEYS_VERSION_MISMATCH');
  if (hash(source) === CANDIDATE_HASH) return { state: 'ALREADY_PATCHED', source: Buffer.from(source), originalSha256: BASELINE_HASH, sha256: CANDIDATE_HASH };
  const patch = evaluateBackport(Buffer.from(source).toString('utf8'), baileysVersion);
  if (patch.candidateSha256 !== CANDIDATE_HASH) throw new Error('CANDIDATE_HASH_MISMATCH');
  return { state: 'READY', source: Buffer.from(patch.candidate), originalSha256: patch.baselineSha256, sha256: patch.candidateSha256 };
}

// Explicit file port makes build failure and atomic replacement testable locally.
// The executable path always uses the fixed /evolution target; it accepts no path.
export function installWithPort(fs) {
  const target = TARGET;
  if (!fs.isRegularUnlinked(target) || fs.realpath(target) !== target) throw new Error('TARGET_LINK_OR_FILE_REJECTED');
  const plan = planPatch({
    evolutionVersion: JSON.parse(fs.read('/evolution/package.json')).version,
    baileysVersion: JSON.parse(fs.read('/evolution/node_modules/baileys/package.json')).version,
    source: fs.read(target)
  });
  if (plan.state === 'ALREADY_PATCHED') return { state: plan.state, sha256: plan.sha256, writes: 0 };
  const temporary = target + '.status-ack-build.tmp';
  if (fs.exists(temporary)) throw new Error('BUILD_TEMP_ALREADY_EXISTS');
  fs.writeExclusive(temporary, plan.source);
  if (hash(fs.read(temporary)) !== plan.sha256) throw new Error('BUILD_TEMP_READBACK_MISMATCH');
  fs.rename(temporary, target);
  if (hash(fs.read(target)) !== plan.sha256) throw new Error('BUILD_FINAL_READBACK_MISMATCH');
  return { state: 'PATCHED_AT_IMAGE_BUILD', originalSha256: plan.originalSha256, sha256: plan.sha256, writes: 1 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    assertBuildOnly({ platform: process.platform, env: process.env, argv: process.argv.slice(2) });
    const fs = {
      read: readFileSync,
      realpath: realpathSync,
      isRegularUnlinked: path => { const s = lstatSync(path); return s.isFile() && !s.isSymbolicLink() && s.nlink === 1; },
      exists: path => { try { lstatSync(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } },
      writeExclusive: (path, bytes) => writeFileSync(path, bytes, { flag: 'wx', mode: 0o644 }),
      rename: renameSync
    };
    console.log(JSON.stringify(installWithPort(fs)));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, productionAction: false }));
    process.exitCode = 1;
  }
}
