// Screenshot baselines are taken and compared in one place: the official Playwright
// image pinned to the @playwright/test version in package.json. CI calls this
// without --update-snapshots, so a wrong pixel fails the job. Regenerating is
// `npm run test:visual:update`, which is the same image and the same command.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).devDependencies['@playwright/test'];
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('test:visual needs an exact @playwright/test version, found', version);
  process.exit(1);
}
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const update = process.argv.includes('--update-snapshots');
const docker = process.env.DOCKER || 'docker';

const pull = spawnSync(docker, ['pull', image], {stdio: 'inherit'});
if (pull.status !== 0) process.exit(pull.status ?? 1);

const args = [
  'run', '--rm', '--network', 'host', '--ipc', 'host',
  '-v', `${root}:/work`,
  '-w', '/work',
  '-e', 'SCOPEFLOW_VISUAL_DOCKER=1',
  // localhost, not 127.0.0.1: the auth fixture rejects any other Origin.
  '-e', `SCOPEFLOW_TEST_URL=${process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173'}`,
  ...(process.env.CI ? ['-e', 'CI=true'] : []),
  image,
  'node', 'node_modules/@playwright/test/cli.js', 'test',
  'tests/e2e/visual-pages.spec.ts',
  'tests/e2e/visual-themes.spec.ts',
  ...(update ? ['--update-snapshots'] : []),
];
const run = spawnSync(docker, args, {stdio: 'inherit'});
if (update && typeof process.getuid === 'function' && process.getuid() !== 0) {
  spawnSync('sudo', ['chown', '-R', `${process.getuid()}:${process.getgid()}`,
    'tests/e2e/visual-pages.spec.ts-snapshots',
    'tests/e2e/visual-themes.spec.ts-snapshots'], {cwd: root, stdio: 'inherit'});
}
process.exit(run.status ?? 1);
