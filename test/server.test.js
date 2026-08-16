import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import test from 'node:test';
import { createHarnessServer } from '../src/server.js';

const cli = path.resolve('src/cli.js');

function run(cwd, ...args) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

function setVerifyCommand(cwd, command = 'node -e "process.exit(0)"') {
  const file = path.join(cwd, 'harness.yaml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('verify: "npm test"', `verify: '${command}'`));
}

async function openServer(root, options = {}) {
  const server = createHarnessServer({ root, cliPath: cli, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function launchCliServer(root) {
  const child = spawn(process.execPath, [cli, 'serve', '--port', '0'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const output = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error('CLI serve did not start within the timeout')), 5000);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (/Harness web server: http:\/\/127\.0\.0\.1:\d+/.test(stdout)) {
        clearTimeout(timer);
        resolve(stdout);
      }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      if (code !== null) {
        clearTimeout(timer);
        reject(new Error(`CLI serve exited before startup with code ${code}`));
      }
    });
  });
  return { child, output };
}

test('HTTP backend serves health, frontend assets, and safe 404 responses', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-web-assets-'));
  run(root, 'init');
  const { server, base } = await openServer(root);
  t.after(() => closeServer(server));

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'ai-project-harness', protocol: 'harness.dev/http/v1' });

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Governed workspace/);
  const script = await fetch(`${base}/app.js`);
  assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const scriptText = await script.text();
  assert.match(scriptText, /\/api\/dashboard/);
  assert.match(scriptText, /accept: 'application\/json'/);
  const styles = await fetch(`${base}/styles.css`);
  assert.equal(styles.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.match(await styles.text(), /\.panel-heading > \.mono/);

  const missing = await fetch(`${base}/api/not-found`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'not_found');
});

test('CLI serve starts the loopback HTTP surface', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cli-serve-'));
  run(root, 'init');
  const { child, output } = await launchCliServer(root);
  t.after(() => {
    if (!child.killed) child.kill();
  });
  const port = Number(output.match(/127\.0\.0\.1:(\d+)/)?.[1]);
  assert.ok(port > 0);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).protocol, 'harness.dev/http/v1');
});

test('frontend API drives audit, plan, and verified apply through the kernel CLI', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-web-flow-'));
  run(root, 'init');
  setVerifyCommand(root);
  fs.rmSync(path.join(root, 'AGENTS.md'));
  const { server, base } = await openServer(root);
  t.after(() => closeServer(server));

  const dashboard = await fetch(`${base}/api/dashboard`);
  assert.equal(dashboard.status, 200);
  const initial = await dashboard.json();
  assert.equal(initial.project.verifyConfigured, true);
  assert.equal(initial.plan, null);
  assert.ok(initial.audit.findings.some(finding => finding.id === 'agents.instructions'));

  const generated = await fetch(`${base}/api/plan`, { method: 'POST' });
  assert.equal(generated.status, 200);
  const plan = await generated.json();
  assert.equal(plan.status, 'approved');
  assert.ok(plan.operations.some(operation => operation.path === 'AGENTS.md'));
  assert.ok(plan.operations.every(operation => !Object.hasOwn(operation, 'content')));

  const applied = await fetch(`${base}/api/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(applied.status, 200);
  const result = await applied.json();
  assert.equal(result.planId, plan.id);
  assert.ok(result.results.length >= 1);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), true);

  const refreshed = await (await fetch(`${base}/api/dashboard`)).json();
  assert.equal(refreshed.applied.planId, plan.id);
});

test('HTTP backend validates apply input and exposes governed apply errors', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-web-errors-'));
  run(root, 'init');
  const { server, base } = await openServer(root);
  t.after(() => closeServer(server));

  const invalid = await fetch(`${base}/api/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  const invalidBody = await invalid.json();
  assert.equal(invalidBody.error.code, 'invalid_json');

  const unsupportedMediaType = await fetch(`${base}/api/apply`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(unsupportedMediaType.status, 415);
  assert.equal((await unsupportedMediaType.json()).error.code, 'unsupported_media_type');

  const unknownField = await fetch(`${base}/api/apply`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ modules: ['docs'], dryRun: true }) });
  assert.equal(unknownField.status, 400);
  assert.equal((await unknownField.json()).error.code, 'unknown_request_field');

  assert.match(invalidBody.error.message, /valid JSON/);

  const tooLarge = await fetch(`${base}/api/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modules: ['x'.repeat(20 * 1024)] }) });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, 'payload_too_large');

  const emptyModules = await fetch(`${base}/api/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modules: [] }) });
  assert.equal(emptyModules.status, 400);
  assert.match((await emptyModules.json()).error.message, /non-empty array/);

  const crossOrigin = await fetch(`${base}/api/plan`, { method: 'POST', headers: { origin: 'https://untrusted.example' } });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error.code, 'forbidden_origin');

  const wrongMethod = await fetch(`${base}/api/health`, { method: 'POST' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');

  const noPlan = await fetch(`${base}/api/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noPlan.status, 422);
  assert.match((await noPlan.json()).error.message, /No plan found/);
});

test('HTTP backend times out CLI children and redacts unstructured stderr', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-web-process-'));
  const hangingCli = path.join(root, 'hanging-cli.js');
  fs.writeFileSync(hangingCli, 'setTimeout(() => {}, 5000);\n');
  const { server, base } = await openServer(root, { cliPath: hangingCli, cliTimeoutMs: 100 });
  const servers = [server];
  t.after(() => Promise.all(servers.map(item => closeServer(item))));

  const timedOut = await fetch(`${base}/api/audit`);
  assert.equal(timedOut.status, 504);
  assert.equal((await timedOut.json()).error.code, 'cli_timeout');

  const noisyCli = path.join(root, 'noisy-cli.js');
  fs.writeFileSync(noisyCli, "console.error('secret-token=do-not-return'); console.error('x'.repeat(100000)); process.exit(1);\n");
  const noisyServer = createHarnessServer({ root, cliPath: noisyCli, cliTimeoutMs: 1000 });
  servers.push(noisyServer);
  await new Promise(resolve => noisyServer.listen(0, '127.0.0.1', resolve));
  const noisyAddress = noisyServer.address();
  const failed = await fetch(`http://127.0.0.1:${noisyAddress.port}/api/audit`);
  assert.equal(failed.status, 422);
  const failure = await failed.json();
  assert.equal(failure.error.code, 'cli_failed');
  assert.doesNotMatch(failure.error.message, /secret-token|xxxxx/);
  assert.ok(failure.error.message.length < 200);
});
