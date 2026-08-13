import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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

test('plugins can be enabled from an empty configuration', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  run(cwd, 'add', 'spec-driven');
  assert.match(run(cwd, 'doctor'), /OK/);
  assert.match(fs.readFileSync(path.join(cwd, 'harness.yaml'), 'utf8'), /spec-driven: true/);
});

test('verify executes npm commands on Windows', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  fs.writeFileSync(path.join(cwd, 'harness.yaml'), 'schema: 1\ncommands:\n  verify: "npm --version"\n');
  assert.match(run(cwd, 'verify'), /Harness verify: OK/);
});

test('plugin management validates and toggles built-in plugins', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  fs.mkdirSync(path.join(cwd, 'plugins', 'spec-driven'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'plugins', 'spec-driven', 'harness-plugin.yaml'), 'apiVersion: harness.dev/v1\nkind: Plugin\nmetadata:\n  name: spec-driven\n  version: 0.1.0\n');
  assert.match(run(cwd, 'plugin', 'validate', 'spec-driven'), /Valid plugin spec-driven/);
  assert.deepEqual(JSON.parse(run(cwd, 'plugin', 'info', 'spec-driven')), { name: 'spec-driven', version: '0.1.0', apiVersion: 'harness.dev/v1', kind: 'Plugin' });
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
