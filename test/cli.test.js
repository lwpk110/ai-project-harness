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

test('verify preserves quoted command arguments', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  fs.writeFileSync(path.join(cwd, 'verify-argument.js'), "if (process.argv[2] !== 'quoted value') { console.error(JSON.stringify(process.argv)); process.exit(1); }\n");
  fs.writeFileSync(path.join(cwd, 'harness.yaml'), 'schema: 1\ncommands:\n  verify: \'node verify-argument.js "quoted value"\'\n');
  const result = spawnSync(process.execPath, [cli, 'verify'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
