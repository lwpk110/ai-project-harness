import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync, spawn } from 'node:child_process';

const cli = path.resolve('src/cli.js');

function run(cwd, ...args) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

async function startServer(root) {
  const child = spawn(process.execPath, [cli, 'serve', '--port', '0'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const output = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error('E2E server startup timed out')), 5000);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (/Harness web server: http:\/\/127\.0\.0\.1:\d+/.test(stdout)) {
        clearTimeout(timer);
        resolve(stdout);
      }
    });
    child.stderr.on('data', chunk => { stdout += chunk.toString(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      if (code !== null) {
        clearTimeout(timer);
        reject(new Error(`E2E server exited before startup with code ${code}`));
      }
    });
  });
  const port = Number(output.match(/127\.0\.0\.1:(\d+)/)?.[1]);
  assert.ok(port > 0, 'server should publish a loopback port');
  return { child, base: `http://127.0.0.1:${port}` };
}

test('E2E: initialize, govern a change, verify, and serve a new agent project', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-e2e-project-'));
  const initialized = run(root, 'init', '--preset', 'agent-project', '--agents', 'codex,claude', '--ci', 'github');
  assert.match(initialized, /agent-project; 11 files created/);
  assert.match(run(root, 'doctor'), /Harness doctor: OK/);

  const instructions = path.join(root, 'AGENTS.md');
  const before = fs.readFileSync(instructions, 'utf8');
  run(root, 'init', '--preset', 'agent-project', '--agents', 'codex,claude', '--ci', 'github');
  assert.equal(fs.readFileSync(instructions, 'utf8'), before, 're-init must not overwrite instructions');

  fs.unlinkSync(instructions);
  const audit = JSON.parse(run(root, 'audit', '--format', 'json'));
  assert.ok(audit.findings.some(finding => finding.id === 'agents.instructions'));
  const plan = JSON.parse(run(root, 'plan'));
  assert.equal(plan.status, 'approved');
  assert.ok(plan.operations.some(operation => operation.path === 'AGENTS.md'));
  assert.match(run(root, 'apply'), /Applied 1 operations/);
  assert.equal(fs.existsSync(instructions), true);
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const smoke = execSync('npm test 2>&1', { cwd: root, encoding: 'utf8', env: childEnv });
  assert.match(smoke, /tests 1/);
  assert.match(run(root, 'verify'), /Harness verify: OK/);

  const server = await startServer(root);
  t.after(() => { if (!server.child.killed) server.child.kill(); });
  const health = await fetch(`${server.base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).protocol, 'harness.dev/http/v1');
  const dashboard = await fetch(`${server.base}/api/dashboard`);
  assert.equal(dashboard.status, 200);
  const state = await dashboard.json();
  assert.equal(state.project.preset, 'agent-project');
  assert.deepEqual(state.project.agents, ['codex', 'claude']);
  assert.equal(state.applied.results.length, 1);
});
