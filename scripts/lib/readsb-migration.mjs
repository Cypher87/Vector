import { parseEnv } from 'node:util';
import { posix } from 'node:path';

export const ownedHistory = '/var/lib/readsb/vector-history';
export const configPath = '/etc/vector/vector.env';

export function dataDirectory(value) {
  if (typeof value !== 'string' || !/^\/[a-zA-Z0-9_./-]+$/.test(value) || posix.normalize(value) !== value
    || value.split('/').filter(Boolean).length < 2
    || /^\/(?:etc|home|root|usr|proc|sys|dev|boot)(?:\/|$)/.test(value)
    || ['/var/lib', '/var/log', '/var/cache', '/var/tmp', '/var/lib/vector'].some((root) => value === root || value.startsWith(`${root}/`))) {
    // /var/lib/readsb is an explicitly supported receiver output location.
    if (typeof value !== 'string' || !/^\/var\/lib\/readsb\/[a-zA-Z0-9_.\/-]+$/.test(value) || posix.normalize(value) !== value) {
      throw new Error('The receiver data directory is not safe for automatic setup');
    }
  }
  return value;
}

export function serviceName(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*\.service$/.test(value)) throw new Error('Invalid receiver service name');
  return value;
}

export function argumentValue(argv, name) {
  let result;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === name) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
      result = argv[++i];
    } else if (argv[i].startsWith(`${name}=`)) result = argv[i].slice(name.length + 1);
  }
  return result;
}

/** Change only selected assignments. Environment files are data, never shell scripts. */
export function patchEnvironment(text, changes, remove = []) {
  const values = { ...changes };
  const removed = new Set([...Object.keys(changes), ...remove]);
  const lines = text.split(/\r?\n/).filter((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    return !match || !removed.has(match[1]);
  });
  while (lines.at(-1) === '') lines.pop();
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n\0"\\]/.test(value)) throw new Error('Unsupported environment value');
    lines.push(`${key}="${value}"`);
  }
  return `${lines.join('\n')}\n`;
}

export function migrationSettings(text, live, history) {
  const existing = parseEnv(text);
  return patchEnvironment(text, {
    READSB_SOURCE: 'local', READSB_LIVE_DIR: dataDirectory(live), READSB_HISTORY_DIR: dataDirectory(history),
    VECTOR_AIRCRAFT_DATABASE: existing.VECTOR_AIRCRAFT_DATABASE || '/var/lib/vector/aircraft-db/aircraft.csv.gz',
  }, ['READSB_LIVE_URL', 'READSB_HISTORY_URL', 'READSB_TAR1090_URL', 'READSB_REMOTE_URL']);
}

/** Only the conventional EnvironmentFile + JSON_OPTIONS layout is changed automatically. */
export function planReadsb({ argv, help, unit, defaults }) {
  if (!argv.length || posix.basename(argv[0]) !== 'readsb') throw new Error('The receiver process is not a direct readsb process');
  const live = dataDirectory(argumentValue(argv, '--write-json') || '/run/readsb');
  const recording = dataDirectory(argumentValue(argv, '--write-globe-history') || ownedHistory);
  const history = dataDirectory(argumentValue(argv, '--heatmap-dir') || recording);
  const full = argumentValue(argv, '--full-trace-dir');
  if (full && full !== live) throw new Error('A separate full-trace directory needs a custom receiver setup; automatic migration would change existing recordings');
  const additions = [];
  if (!argumentValue(argv, '--write-json')) additions.push(`--write-json ${live}`);
  if (!argumentValue(argv, '--write-globe-history')) additions.push(`--write-globe-history ${recording}`);
  if (!(Number(argumentValue(argv, '--heatmap')) > 0)) additions.push('--heatmap 30');
  if (Number(argumentValue(argv, '--json-trace-hist-only') || 0) !== 0) additions.push('--json-trace-hist-only 0');
  if (Number(argumentValue(argv, '--write-json-binCraft-only') || 0) > 1) additions.push('--write-json-binCraft-only 0');
  for (const flag of ['--write-json', '--write-globe-history', '--heatmap', ...additions.map((value) => value.split(' ')[0])]) {
    if (!help.includes(flag)) throw new Error(`This readsb build does not support ${flag}`);
  }
  if (!additions.length) return { live, history, recording, defaults, restart: false, newRecording: false };
  const environmentFiles = [...unit.matchAll(/^EnvironmentFile\s*=\s*(.*)$/gm)].map((match) => match[1].trim());
  const commands = [...unit.matchAll(/^ExecStart\s*=\s*(.*)$/gm)].map((match) => match[1].trim()).filter(Boolean);
  if (environmentFiles.length !== 1 || environmentFiles[0] !== '/etc/default/readsb' || commands.length !== 1
    || !/^\/?[\w/.-]*readsb\s/.test(commands[0]) || !/\$(?:JSON_OPTIONS\b|\{JSON_OPTIONS\})/.test(commands[0])
    || /\\\s*$/.test(commands[0])) {
    throw new Error('The receiver uses a custom startup configuration; refusing to replace its command or SDR settings');
  }
  const assignments = defaults.match(/^\s*JSON_OPTIONS\s*=.*$/gm) || [];
  if (assignments.length > 1 || (assignments[0] && !/^\s*JSON_OPTIONS\s*=\s*"[^"\\\r\n]*"\s*(?:#.*)?$/.test(assignments[0]))) {
    throw new Error('JSON_OPTIONS uses a nonstandard expression; refusing to interpret shell code');
  }
  const options = parseEnv(defaults).JSON_OPTIONS || '';
  if (/[\r\n\0"\\$`]/.test(options)) throw new Error('JSON_OPTIONS contains an unsupported expression');
  return { live, history, recording, restart: true, newRecording: !argumentValue(argv, '--write-globe-history'),
    defaults: patchEnvironment(defaults, { JSON_OPTIONS: `${options} ${additions.join(' ')}`.trim() }) };
}

/** Preserve effective access for existing ACL entries when extending the mask. */
export function readerAcl(acl, uid, directory, traverseOnly = false) {
  const lines = acl.split('\n').map((line) => line.split('#')[0].trim()).filter(Boolean);
  const permissions = (value) => (value.includes('r') ? 4 : 0) | (value.includes('w') ? 2 : 0) | (value.includes('x') ? 1 : 0);
  const format = (value) => `${value & 4 ? 'r' : '-'}${value & 2 ? 'w' : '-'}${value & 1 ? 'x' : '-'}`;
  const update = (prefix, base) => {
    const entries = base.map((line) => line.slice(prefix.length).split(':'));
    const mask = entries.find(([kind]) => kind === 'mask');
    const currentMask = mask ? permissions(mask[2]) : 7;
    const prior = entries.find(([kind, who]) => kind === 'user' && who === String(uid));
    const wanted = (traverseOnly ? 1 : directory ? 5 : 4) | (prior ? permissions(prior[2]) & currentMask : 0);
    let nextMask = wanted;
    const output = entries.filter(([kind, who]) => kind !== 'mask' && !(kind === 'user' && who === String(uid))).map(([kind, who, value]) => {
      if (kind === 'group' || (kind === 'user' && who)) {
        value = format(permissions(value) & currentMask);
        nextMask |= permissions(value);
      }
      return `${prefix}${kind}:${who}:${value}`;
    });
    output.push(`${prefix}user:${uid}:${format(wanted)}`, `${prefix}mask::${format(nextMask)}`);
    return output;
  };
  const access = lines.filter((line) => !line.startsWith('default:'));
  const defaults = lines.filter((line) => line.startsWith('default:'));
  const output = update('', access);
  if (traverseOnly) output.push(...defaults);
  else if (directory) output.push(...update('default:', defaults.length ? defaults : output.filter((line) => /^(?:user::|group::|other::)/.test(line)).map((line) => `default:${line}`)));
  return `${output.join('\n')}\n`;
}
