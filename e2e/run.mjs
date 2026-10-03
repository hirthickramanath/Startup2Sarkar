import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { runFlows } from './flows.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT || 4010);
const base = `http://localhost:${PORT}`;
const shotsDir = process.env.E2E_SHOTS || path.join(here, 'screenshots');
const tmpDir = process.env.E2E_TMP || path.join(here, '.tmp');

const server = spawn(process.execPath, ['--import', 'tsx', path.join(here, 'server.ts')], { env: { ...process.env, E2E_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
const stop = () => { try { server.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', stop);
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('The test server did not start in time.')), 60000);
  server.stdout.on('data', (d) => { if (String(d).includes('E2E-SERVER READY')) { clearTimeout(t); resolve(); } });
  server.on('exit', (c) => reject(new Error(`The test server exited early (code ${c}).`)));
});

let result;
try { result = await runFlows({ base, shotsDir, tmpDir }); }
catch (e) { console.error('SUITE ERROR:', e.message); stop(); process.exit(2); }
stop();
console.log(`\n${result.failures.length} failed checks, ${result.problems.length} browser errors, ${result.warnings.length} layout warnings`);
if (result.problems.length) console.log(result.problems.join('\n'));
if (result.warnings.length) console.log('WARNINGS:\n' + result.warnings.join('\n'));
process.exit(result.failures.length || result.problems.length ? 1 : 0);
