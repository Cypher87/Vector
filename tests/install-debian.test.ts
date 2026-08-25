import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installerUrl = new URL('../scripts/install-debian.sh', import.meta.url);

test('Node.js and system administration tools are on PATH before Corepack starts', async () => {
  const installer = await readFile(installerUrl, 'utf8');
  const systemPath =
    "readonly SYSTEM_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'";
  const initialPathExport = 'export PATH="$SYSTEM_PATH"';
  const runtimePathExport = 'export PATH="$VECTOR_RUNTIME/node/bin:$SYSTEM_PATH"';
  const corepackInvocation =
    '"$node_directory/bin/corepack" enable --install-directory "$node_directory/bin"';

  const systemPathIndex = installer.indexOf(systemPath);
  const initialPathIndex = installer.indexOf(initialPathExport);
  const runtimePathIndex = installer.indexOf(runtimePathExport);
  const runuserIndex = installer.indexOf('runuser -u "$VECTOR_USER"');
  const corepackIndex = installer.indexOf(corepackInvocation);

  assert.notEqual(systemPathIndex, -1, 'the installer must define a safe Debian system PATH');
  assert.notEqual(initialPathIndex, -1, 'the system PATH must be exported for root commands');
  assert.notEqual(runtimePathIndex, -1, 'the isolated Node.js bin directory must be exported');
  assert.notEqual(runuserIndex, -1, 'the installer must execute application commands as vector');
  assert.notEqual(corepackIndex, -1, 'the installer must enable Corepack');
  assert.ok(initialPathIndex < runuserIndex, 'runuser must be discoverable through /usr/sbin');
  assert.ok(
    runtimePathIndex < corepackIndex,
    'Node.js must be discoverable by Corepack\'s env shebang',
  );
});

test('application commands run from the Vector checkout', async () => {
  const installer = await readFile(installerUrl, 'utf8');

  assert.match(installer, /local working_directory="\$1"\n\s+shift/);
  assert.match(installer, /--chdir="\$working_directory"/);
  assert.match(
    installer,
    /run_as_vector "\$VECTOR_APP" pnpm install --frozen-lockfile/,
  );
  assert.match(installer, /run_as_vector "\$VECTOR_APP" pnpm build/);
});
