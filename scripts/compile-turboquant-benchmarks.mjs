import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

rmSync('.bench-build', { recursive: true, force: true });
const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '-p', 'tsconfig.benchmark.json'], {
  stdio: 'inherit',
  shell: false,
});
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync('.bench-build', { recursive: true });
writeFileSync('.bench-build/package.json', '{"type":"commonjs"}\n');
console.log('TurboQuant benchmark modules compiled into .bench-build/.');
