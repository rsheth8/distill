/**
 * Lightweight CI checks: panel message contract, AI task names vs backend, /health probe.
 */
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extRoot = join(root, 'extension');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function extractToPanelTypes(bgSource) {
  const collapsed = bgSource.replace(/\s+/g, ' ');
  const types = new Set();
  const re = /toPanel\(\{\s*type:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(collapsed)) !== null) types.add(m[1]);
  return types;
}

function extractSidepanelCases(spSource) {
  const cases = new Set();
  const re = /case\s+'([^']+)':/g;
  let m;
  while ((m = re.exec(spSource)) !== null) cases.add(m[1]);
  return cases;
}

function extractTaskCosts(serverSource) {
  const start = serverSource.indexOf('const TASK_COSTS = {');
  if (start === -1) throw new Error('TASK_COSTS block not found');
  const brace = serverSource.indexOf('{', start);
  let depth = 0;
  let i = brace;
  for (; i < serverSource.length; i++) {
    const c = serverSource[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  const block = serverSource.slice(brace + 1, i - 1);
  const keys = new Set();
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([a-z][a-z0-9_]*)\s*:\s*\d+/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

function extractBackgroundAiTasks(bgSource) {
  const tasks = new Set();
  const re = /\btask:\s*'([a-z_][a-z0-9_]*)'/g;
  let m;
  while ((m = re.exec(bgSource)) !== null) tasks.add(m[1]);
  return tasks;
}

/** Keys inside every `taskMaxTokens: { … }` under AI_TUNING (balanced + ultra-lean). */
function extractAllTaskMaxTokenKeys(bgSource) {
  const keys = new Set();
  let from = 0;
  while (true) {
    const idx = bgSource.indexOf('taskMaxTokens:', from);
    if (idx === -1) break;
    const brace = bgSource.indexOf('{', idx);
    let depth = 0;
    let i = brace;
    for (; i < bgSource.length; i++) {
      const c = bgSource[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    const inner = bgSource.slice(brace + 1, i - 1);
    for (const line of inner.split('\n')) {
      const m = line.match(/^\s*([a-z_][a-z0-9_]*)\s*:\s*\d+/);
      if (m) keys.add(m[1]);
    }
    from = i;
  }
  return keys;
}

async function probeBackendHealth() {
  const port = 43000 + Math.floor(Math.random() * 2500);
  const statePath = join(root, 'backend', 'data', `.ci-state-${port}.json`);
  const proc = spawn('node', ['server.js'], {
    cwd: join(root, 'backend'),
    env: {
      ...process.env,
      PORT: String(port),
      ALLOW_INSECURE_SECRETS: '1',
      BACKEND_SECRET: 'ci-smoke-secret-32chars-minimum',
      STATE_FILE_PATH: statePath,
      KILL_SWITCH_AI_RUN: '1',
      KILL_SWITCH_GUEST_AUTH: '1',
      KILL_SWITCH_USAGE: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const errBuf = [];
  proc.stderr?.on('data', chunk => errBuf.push(chunk));

  const tryFetch = async path => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) });
    return r;
  };

  const deadline = Date.now() + 12000;
  let ok = false;
  while (Date.now() < deadline) {
    try {
      const r = await tryFetch('/health');
      if (r.ok) {
        const j = await r.json();
        if (j && j.ok === true) {
          ok = true;
          break;
        }
      }
    } catch {
      /* not up yet */
    }
    await new Promise(res => setTimeout(res, 120));
  }

  proc.kill('SIGTERM');
  await new Promise(res => {
    proc.on('close', res);
    setTimeout(res, 2000);
  });

  if (!ok) {
    const errText = Buffer.concat(errBuf).toString('utf8').slice(0, 800);
    fail(`Backend /health smoke failed (port ${port}). stderr:\n${errText}`);
  }
  console.log('smoke: backend GET /health ok');
}

const bg = readFileSync(join(extRoot, 'background.js'), 'utf8');
const sp = readFileSync(join(extRoot, 'sidepanel.js'), 'utf8');
const server = readFileSync(join(root, 'backend', 'server.js'), 'utf8');

const panelTypes = extractToPanelTypes(bg);
const cases = extractSidepanelCases(sp);
const missing = [...panelTypes].filter(t => !cases.has(t)).sort();
if (missing.length) {
  fail(
    `smoke: background → panel message types missing from sidepanel switch: ${missing.join(', ')}`
  );
}
console.log(`smoke: all ${panelTypes.size} toPanel() types have sidepanel cases`);

const taskCosts = extractTaskCosts(server);
const bgTasks = extractBackgroundAiTasks(bg);
const unknown = [...bgTasks].filter(t => !taskCosts.has(t)).sort();
if (unknown.length) {
  fail(`smoke: background AI task(s) not in backend TASK_COSTS: ${unknown.join(', ')}`);
}
const unused = [...taskCosts].filter(t => !bgTasks.has(t)).sort();
if (unused.length) {
  fail(`smoke: backend TASK_COSTS key(s) unused by background streamTask: ${unused.join(', ')}`);
}
console.log('smoke: background AI tasks match backend TASK_COSTS');

const tuningKeys = extractAllTaskMaxTokenKeys(bg);
const tuningMismatch = [...tuningKeys].filter(t => !taskCosts.has(t)).sort();
if (tuningMismatch.length) {
  fail(`smoke: AI_TUNING taskMaxTokens keys missing from TASK_COSTS: ${tuningMismatch.join(', ')}`);
}
const tuningMissing = [...taskCosts].filter(t => !tuningKeys.has(t)).sort();
if (tuningMissing.length) {
  fail(`smoke: TASK_COSTS keys missing from AI_TUNING taskMaxTokens: ${tuningMissing.join(', ')}`);
}
console.log('smoke: AI_TUNING taskMaxTokens keys match backend TASK_COSTS');

const be = readFileSync(join(extRoot, 'utils', 'backendEnv.js'), 'utf8');
const unc = /DISTILL_BACKEND_PROD_UNCONFIGURED\s*=\s*'([^']+)'/.exec(be)?.[1];
const prod = /DISTILL_BACKEND_DEFAULTS\s*=\s*\{[\s\S]*?prod:\s*'([^']+)'/.exec(be)?.[1];
if (unc && prod && unc === prod) {
  fail(
    'smoke: extension/utils/backendEnv.js: `prod` URL must differ from DISTILL_BACKEND_PROD_UNCONFIGURED, ' +
      'otherwise Production mode incorrectly falls back to localhost.'
  );
}
console.log('smoke: backendEnv prod vs unconfigured sentinel OK');

async function main() {
  await probeBackendHealth();
  console.log('smoke: all checks passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
