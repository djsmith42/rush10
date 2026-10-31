// `pnpm test:e2e`: the functional tests first (many at once), then the animation tests on a quiet machine,
// since their frame timing is only meaningful without other browsers competing for the CPU.
// Both phases write into one album. With -g/--grep, everything runs in a single pass.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const playwright = (extra, env = {}) => spawnSync('pnpm', ['exec', 'playwright', 'test', '-c', 'e2e', '--pass-with-no-tests', ...extra, ...args],
  { stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;

if (args.some(arg => arg === '-g' || arg.startsWith('--grep'))) process.exit(playwright([]));
const functional = playwright(['--grep-invert', '@animation']);
const animation = playwright(['--grep', '@animation'], { E2E_APPEND: '1', E2E_WORKERS: process.env.E2E_ANIMATION_WORKERS ?? '3' });
process.exit(functional || animation);
