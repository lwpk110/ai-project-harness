import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const cli = path.resolve('src/cli.js');
function run(cwd, ...args) { return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }); }

test('adopt audit plan apply keeps existing files and creates missing baseline', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"scripts":{"test":"node -e \\"console.log(1)\\"}}\n');
  run(cwd, 'init');
  run(cwd, 'audit', '--format', 'json');
  run(cwd, 'plan');
  run(cwd, 'apply');
  assert.equal(fs.existsSync(path.join(cwd, 'AGENTS.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.harness', 'state.json')), true);
});

test('apply --only limits adoption changes to selected modules', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  fs.rmSync(path.join(cwd, 'AGENTS.md'));
  run(cwd, 'audit');
  run(cwd, 'plan');
  assert.match(run(cwd, 'apply', '--only', 'git'), /Applied 1 changes/);
  assert.equal(fs.existsSync(path.join(cwd, '.gitignore')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'AGENTS.md')), false);
  assert.throws(() => run(cwd, 'apply', '--only', 'unknown'), /Unknown apply module: unknown/);
});

test('plugins can be enabled from an empty configuration', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  run(cwd, 'add', 'spec-driven');
  assert.match(run(cwd, 'doctor'), /OK/);
  assert.match(fs.readFileSync(path.join(cwd, 'harness.yaml'), 'utf8'), /spec-driven: true/);
});

test('sync locks plugin manifests and doctor detects manifest drift', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  run(cwd, 'add', 'spec-driven');
  assert.match(run(cwd, 'sync'), /Synchronized 1 plugin lock entries/);
  const lock = JSON.parse(fs.readFileSync(path.join(cwd, 'harness.lock'), 'utf8'));
  assert.equal(lock.schema, 1);
  assert.equal(lock.plugins['spec-driven'].version, '0.1.0');
  assert.match(lock.plugins['spec-driven'].integrity, /^sha256:/);
  fs.mkdirSync(path.join(cwd, 'plugins', 'spec-driven'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'plugins', 'spec-driven', 'harness-plugin.yaml'), 'apiVersion: harness.dev/v1\nkind: Plugin\nmetadata:\n  name: spec-driven\n  version: 9.9.9\n');
  assert.throws(() => run(cwd, 'doctor'), /Lock integrity mismatch: spec-driven/);
});

test('verify executes npm commands on Windows', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  fs.writeFileSync(path.join(cwd, 'harness.yaml'), 'schema: 1\ncommands:\n  verify: "npm --version"\n');
  assert.match(run(cwd, 'verify'), /Harness verify: OK/);
});

test('verify preserves quoted command arguments', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  fs.writeFileSync(path.join(cwd, 'verify-argument.js'), "if (process.argv[2] !== 'quoted value') process.exit(1);\n");
  fs.writeFileSync(path.join(cwd, 'harness.yaml'), 'schema: 1\ncommands:\n  verify: \'node verify-argument.js "quoted value"\'\n');
  assert.equal(spawnSync(process.execPath, [cli, 'verify'], { cwd, encoding: 'utf8' }).status, 0);
});

test('plugin management validates and toggles built-in plugins', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  assert.match(run(cwd, 'plugin', 'validate', 'spec-driven'), /Valid plugin spec-driven/);
  assert.deepEqual(JSON.parse(run(cwd, 'plugin', 'info', 'spec-driven')), { name: 'spec-driven', version: '0.1.0', apiVersion: 'harness.dev/v1', kind: 'Plugin' });
  fs.mkdirSync(path.join(cwd, 'plugins', 'spec-driven'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'plugins', 'spec-driven', 'harness-plugin.yaml'), 'apiVersion: harness.dev/v1\nkind: Plugin\nmetadata:\n  name: wrong-name\n');
  assert.throws(() => run(cwd, 'plugin', 'validate', 'spec-driven'), /metadata.name must be spec-driven/);
  fs.writeFileSync(path.join(cwd, 'plugins', 'spec-driven', 'harness-plugin.yaml'), 'apiVersion: harness.dev/v1\nkind: Plugin\nmetadata:\n  name: spec-driven\n  version: 0.1.0\n');
  run(cwd, 'enable', 'spec-driven');
  assert.match(run(cwd, 'plugin', 'list'), /spec-driven\tenabled\t0.1.0/);
  run(cwd, 'disable', 'spec-driven');
  assert.match(run(cwd, 'plugin', 'list'), /spec-driven\tdisabled\t0.1.0/);
  run(cwd, 'remove', 'spec-driven');
  assert.doesNotMatch(fs.readFileSync(path.join(cwd, 'harness.yaml'), 'utf8'), /spec-driven/);
  assert.throws(() => run(cwd, 'remove', 'spec-driven'), /Plugin is not configured/);
});

test('diff reports modified seeded files', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  fs.writeFileSync(path.join(cwd, 'package.json'), '{}\n');
  run(cwd, 'init');
  run(cwd, 'audit');
  run(cwd, 'plan');
  run(cwd, 'apply');
  fs.appendFileSync(path.join(cwd, 'AGENTS.md'), 'Changed by the project.\n');
  assert.deepEqual(JSON.parse(run(cwd, 'diff')), { changes: [{ file: 'AGENTS.md', status: 'modified', ownership: 'seeded' }] });
});
