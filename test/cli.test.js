import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { discoverBundledPlugins } from '../src/catalog.js';
import { parsePluginManifest, parseProjectConfig, stringifyProjectConfig } from '../src/manifest.js';

const cli = path.resolve('src/cli.js');
function run(cwd, ...args) { return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }); }

test('bundled plugin catalog discovers manifests without a name list', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-catalog-'));
  fs.mkdirSync(path.join(directory, 'detector-pack'));
  fs.writeFileSync(path.join(directory, 'detector-pack', 'harness-plugin.yaml'), 'apiVersion: harness.dev/v1\nkind: Plugin\nmetadata:\n  name: detector-pack\n  version: 0.1.0\n');
  fs.mkdirSync(path.join(directory, 'empty-directory'));
  assert.deepEqual(discoverBundledPlugins(directory), ['detector-pack']);
});

test('project configuration preserves nested plugin settings through structured parsing', () => {
  const config = parseProjectConfig('schema: 1\npreset: startup-web\nplugins:\n  spec-driven:\n    enabled: true\n    contributions:\n      workflows:\n        - spec-driven-development\ncommands:\n  verify: npm test\n');
  assert.equal(config.plugins['spec-driven'].enabled, true);
  assert.deepEqual(config.plugins['spec-driven'].contributions.workflows, ['spec-driven-development']);
  assert.equal(parseProjectConfig(stringifyProjectConfig(config)).preset, 'startup-web');
  assert.throws(() => parseProjectConfig('plugins:\n  spec-driven: enabled\n'), /plugins.spec-driven must be a boolean or mapping/);
});

test('manifest validation rejects unknown permission fields and invalid contributions', () => {
  const base = 'apiVersion: harness.dev/v1\nkind: Plugin\nmetadata:\n  name: example\n  version: 0.1.0\n';
  assert.throws(() => parsePluginManifest(`${base}permissions:\n  network:\n    hosts: []\n    bypass: true\n`, 'example'), /permissions.network.bypass is not supported/);
  assert.throws(() => parsePluginManifest(`${base}contributes:\n  detectors: project-detector\n`, 'example'), /contributes.detectors must be an array of non-empty strings/);
});

test('plugin dependencies are enabled in topological lock order', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  fs.mkdirSync(path.join(cwd, 'plugins', 'spec-driven'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'plugins', 'spec-driven', 'harness-plugin.yaml'), 'apiVersion: harness.dev/v1\nkind: Plugin\nmetadata:\n  name: spec-driven\n  version: 0.1.0\ncompatibility:\n  harness: ">=0.1 <1.0"\ndependencies:\n  plugins:\n    documentation: ">=0.1 <1.0"\ncontributes:\n  workflows:\n    - spec-driven-development\n');
  run(cwd, 'add', 'spec-driven');
  const config = parseProjectConfig(fs.readFileSync(path.join(cwd, 'harness.yaml'), 'utf8'));
  assert.equal(config.plugins.documentation, true);
  assert.equal(config.plugins['spec-driven'], true);
  run(cwd, 'sync');
  const lock = JSON.parse(fs.readFileSync(path.join(cwd, 'harness.lock'), 'utf8'));
  assert.deepEqual(lock.order, ['documentation', 'spec-driven']);
});

test('plugin compatibility and contribution uniqueness fail before activation', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  run(cwd, 'remove', 'spec-driven');
  fs.mkdirSync(path.join(cwd, 'plugins', 'spec-driven'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'plugins', 'spec-driven', 'harness-plugin.yaml'), 'apiVersion: harness.dev/v1\nkind: Plugin\nmetadata:\n  name: spec-driven\n  version: 0.1.0\ncompatibility:\n  harness: ">=9.0 <10.0"\n');
  assert.throws(() => run(cwd, 'plugin', 'validate', 'spec-driven'), /requires harness >=9.0 <10.0/);
  fs.writeFileSync(path.join(cwd, 'plugins', 'spec-driven', 'harness-plugin.yaml'), 'apiVersion: harness.dev/v1\nkind: Plugin\nmetadata:\n  name: spec-driven\n  version: 0.1.0\ncontributes:\n  workflows:\n    - shared-workflow\n');
  fs.mkdirSync(path.join(cwd, 'plugins', 'documentation'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'plugins', 'documentation', 'harness-plugin.yaml'), 'apiVersion: harness.dev/v1\nkind: Plugin\nmetadata:\n  name: documentation\n  version: 0.1.0\ncontributes:\n  workflows:\n    - shared-workflow\n');
  run(cwd, 'add', 'documentation');
  assert.throws(() => run(cwd, 'add', 'spec-driven'), /Contribution workflows\/shared-workflow is provided by both documentation and spec-driven/);
});

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

test('DeepSeek Harness is available as an optional connector plugin', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  assert.match(run(cwd, 'plugin', 'validate', 'deepseek-harness'), /Valid plugin deepseek-harness/);
  run(cwd, 'add', 'deepseek-harness');
  assert.match(run(cwd, 'doctor'), /OK/);
  assert.match(fs.readFileSync(path.join(cwd, 'harness.yaml'), 'utf8'), /deepseek-harness: true/);
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
