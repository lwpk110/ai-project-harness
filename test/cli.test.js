import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { discoverBundledPlugins } from '../src/catalog.js';
import { createProjectView, runAudit, validateAuditContributions } from '../src/audit.js';
import { buildPlan, computePlanId, inputDigests, validatePlanningContributions } from '../src/planning.js';
import { executePlan } from '../src/executor.js';
import { parsePluginManifest, parseProjectConfig, stringifyProjectConfig } from '../src/manifest.js';

const cli = path.resolve('src/cli.js');
function run(cwd, ...args) { return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }); }
function setVerifyCommand(cwd, command) {
  const file = path.join(cwd, 'harness.yaml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('verify: "npm test"', `verify: '${command}'`));
}

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

test('init creates an idempotent runtime-neutral AI agent project scaffold', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-agent-project-'));
  run(cwd, 'init', '--preset', 'agent-project', '--agents', 'codex,claude', '--ci', 'github');
  const expected = [
    'harness.yaml',
    'AGENTS.md',
    'README.md',
    '.gitignore',
    'package.json',
    'package-lock.json',
    'agent/README.md',
    'agent/workflows/governed-change.md',
    'agent/skills/project-verification/SKILL.md',
    'agent/connectors/README.md',
    '.github/workflows/verify.yml'
  ];
  for (const file of expected) assert.equal(fs.existsSync(path.join(cwd, file)), true, file);
  const config = parseProjectConfig(fs.readFileSync(path.join(cwd, 'harness.yaml'), 'utf8'));
  assert.equal(config.project.preset, 'agent-project');
  assert.deepEqual(config.project.agents, ['codex', 'claude']);
  assert.match(fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8'), /audit -> plan -> apply -> verify/);
  const agentsBefore = fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8');
  run(cwd, 'init', '--preset', 'agent-project', '--agents', 'codex,claude', '--ci', 'github');
  assert.equal(fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8'), agentsBefore);
  assert.match(run(cwd, 'doctor'), /OK/);
  assert.match(run(cwd, 'verify'), /Harness verify: OK/);
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
  assert.deepEqual(lock.order, ['documentation', 'project-baseline', 'spec-driven']);
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
  setVerifyCommand(cwd, 'node -e "process.exit(0)"');
  run(cwd, 'audit', '--format', 'json');
  run(cwd, 'plan');
  run(cwd, 'apply');
  assert.equal(fs.existsSync(path.join(cwd, 'AGENTS.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.harness', 'state.json')), true);
});

test('apply --only limits adoption changes to selected modules', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  setVerifyCommand(cwd, 'node -e "process.exit(0)"');
  fs.rmSync(path.join(cwd, 'AGENTS.md'));
  run(cwd, 'audit');
  run(cwd, 'plan');
  assert.throws(() => run(cwd, 'apply', '--only', 'unknown'), /Unknown apply module: unknown/);
  assert.match(run(cwd, 'apply', '--only', 'git'), /Applied 1 operations/);
  assert.equal(fs.existsSync(path.join(cwd, '.gitignore')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'AGENTS.md')), false);
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
  assert.match(run(cwd, 'sync'), /Synchronized 2 plugin lock entries/);
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
  setVerifyCommand(cwd, 'node -e "process.exit(0)"');
  run(cwd, 'audit');
  run(cwd, 'plan');
  run(cwd, 'apply');
  fs.appendFileSync(path.join(cwd, '.gitignore'), 'Changed by the project.\n');
  assert.deepEqual(JSON.parse(run(cwd, 'diff')), { changes: [{ file: '.gitignore', status: 'modified', ownership: 'seeded' }] });
});

test('audit is a read-only, provenance-backed composition of plugin facts and rules', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  fs.writeFileSync(path.join(cwd, 'package.json'), '{}\n');
  fs.mkdirSync(path.join(cwd, '.github', 'workflows'), { recursive: true });
  run(cwd, 'init');
  const report = JSON.parse(run(cwd, 'audit', '--format', 'json'));
  const stack = report.facts.find(fact => fact.id === 'project.stack');
  const ci = report.facts.find(fact => fact.id === 'project.ci');
  const testing = report.findings.find(finding => finding.id === 'testing.missing');
  assert.deepEqual(stack.value, 'node');
  assert.deepEqual(ci.value, 'github-actions');
  assert.deepEqual(stack.provider, { plugin: 'project-baseline', contribution: 'project-baseline' });
  assert.deepEqual(testing.provider, { plugin: 'project-baseline', contribution: 'testing-missing' });
  assert.deepEqual(testing.facts, ['project.has-tests']);
  assert.equal(fs.existsSync(path.join(cwd, '.harness', 'state.json')), false);
});

test('a project plugin contribution can add an audit rule without changing the CLI', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  run(cwd, 'init');
  fs.cpSync(path.resolve('plugins', 'project-baseline'), path.join(cwd, 'plugins', 'project-baseline'), { recursive: true });
  const manifest = path.join(cwd, 'plugins', 'project-baseline', 'harness-plugin.yaml');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/(    - gitignore-missing)\r?\n/, '$1\n    - readme-missing\n'));
  fs.writeFileSync(path.join(cwd, 'plugins', 'project-baseline', 'contributions', 'rules', 'readme-missing.yaml'), 'apiVersion: harness.dev/v1\nkind: Rule\nmetadata:\n  id: readme-missing\nwhen:\n  fact: project.has-docs\n  equals: false\nfinding:\n  id: project.readme-missing\n  priority: P3\n  title: README is missing\n  action: Add a project README\n');
  const report = JSON.parse(run(cwd, 'audit', '--format', 'json'));
  assert.deepEqual(report.findings.find(finding => finding.id === 'project.readme-missing').provider, { plugin: 'project-baseline', contribution: 'readme-missing' });
  assert.ok(report.findings.some(finding => finding.id === 'testing.missing'));
});

test('ProjectView is an immutable snapshot that excludes harness internals', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-view-'));
  fs.mkdirSync(path.join(cwd, '.harness'));
  fs.mkdirSync(path.join(cwd, 'node_modules', 'ignored'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Readme\n');
  const view = createProjectView(cwd);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.entries), true);
  assert.equal(view.entries[0].path, 'README.md');
  assert.equal(view.entries[0].type, 'file');
  assert.match(view.entries[0].hash, /^sha256:/);
});

test('audit values are deeply immutable and rules use structural equality', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-'));
  fs.writeFileSync(path.join(cwd, 'signal'), 'present\n');
  const plugin = path.join(cwd, 'plugin');
  fs.mkdirSync(path.join(plugin, 'contributions', 'detectors'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'contributions', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'contributions', 'detectors', 'nested.yaml'), 'apiVersion: harness.dev/v1\nkind: Detector\nmetadata:\n  id: nested\nfacts:\n  - id: example.nested\n    select:\n      type: first-existing\n      candidates:\n        - path: signal\n          value:\n            first: 1\n            values: [a, b]\n      default: {}\n');
  fs.writeFileSync(path.join(plugin, 'contributions', 'rules', 'matches.yaml'), 'apiVersion: harness.dev/v1\nkind: Rule\nmetadata:\n  id: matches\nwhen:\n  fact: example.nested\n  equals:\n    values: [a, b]\n    first: 1\nfinding:\n  id: example.matches\n  priority: P3\n  title: Nested value matched\n  action: No action required\n');
  const loaded = { directory: plugin, manifest: { contributes: { detectors: ['nested'], rules: ['matches'] } } };
  const resolved = { ordered: ['example'], active: new Map([['example', loaded]]) };
  const report = runAudit({ root: cwd, resolved });
  assert.equal(report.findings[0].id, 'example.matches');
  assert.equal(Object.isFrozen(report.facts[0].value), true);
  assert.equal(Object.isFrozen(report.facts[0].value.values), true);
});

test('audit contribution validation rejects fields from the other contract kind', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-'));
  fs.mkdirSync(path.join(directory, 'contributions', 'detectors'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'contributions', 'detectors', 'invalid.yaml'), 'apiVersion: harness.dev/v1\nkind: Detector\nmetadata:\n  id: invalid\nfacts:\n  - id: example.fact\n    select:\n      type: any-path\n      paths: [README.md]\nfinding:\n  id: example.invalid\n');
  const loaded = { directory, manifest: { contributes: { detectors: ['invalid'] } } };
  assert.throws(() => validateAuditContributions({ ordered: ['example'], active: new Map([['example', loaded]]) }), /finding is not supported/);
});

test('planning is deterministic and emits immutable provenance-backed operations', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plan-'));
  run(cwd, 'init');
  fs.rmSync(path.join(cwd, 'AGENTS.md'));
  const first = JSON.parse(run(cwd, 'plan'));
  const second = JSON.parse(run(cwd, 'plan'));
  assert.deepEqual(second, first);
  assert.match(first.id, /^sha256:/);
  assert.equal(first.status, 'approved');
  assert.deepEqual(first.operations.map(operation => [operation.type, operation.path, operation.module]), [
    ['file.create', 'AGENTS.md', 'docs'],
    ['file.create', '.gitignore', 'git']
  ]);
  assert.deepEqual(first.operations[0].provider, { plugin: 'project-baseline', contribution: 'create-agent-instructions' });
  assert.deepEqual(first.reviews.map(review => review.status), ['approved', 'approved']);
});

test('apply rejects stale or tampered immutable plans before changing files', () => {
  const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-stale-'));
  run(staleRoot, 'init');
  run(staleRoot, 'plan');
  fs.writeFileSync(path.join(staleRoot, 'unexpected.txt'), 'changed after planning\n');
  assert.throws(() => run(staleRoot, 'apply'), /Plan inputs are stale/);
  assert.equal(fs.existsSync(path.join(staleRoot, '.gitignore')), false);

  const tamperedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tampered-'));
  run(tamperedRoot, 'init');
  run(tamperedRoot, 'plan');
  const statePath = path.join(tamperedRoot, '.harness', 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.plan.operations[0].content = 'tampered\n';
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  assert.throws(() => run(tamperedRoot, 'apply'), /Plan integrity check failed/);
  assert.equal(fs.existsSync(path.join(tamperedRoot, '.gitignore')), false);

  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-drift-'));
  run(pluginRoot, 'init');
  fs.cpSync(path.resolve('plugins', 'project-baseline'), path.join(pluginRoot, 'plugins', 'project-baseline'), { recursive: true });
  run(pluginRoot, 'plan');
  fs.appendFileSync(path.join(pluginRoot, 'plugins', 'project-baseline', 'contributions', 'recipes', 'create-gitignore.yaml'), '\n');
  assert.throws(() => run(pluginRoot, 'apply'), /Plan inputs are stale/);

  const forgedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-forged-'));
  run(forgedRoot, 'init');
  setVerifyCommand(forgedRoot, 'node -e "process.exit(0)"');
  run(forgedRoot, 'plan');
  const forgedStatePath = path.join(forgedRoot, '.harness', 'state.json');
  const forgedState = JSON.parse(fs.readFileSync(forgedStatePath, 'utf8'));
  forgedState.plan.operations.push({
    id: 'forged/recipe/0',
    module: 'docs',
    provider: { plugin: 'forged', contribution: 'recipe' },
    type: 'file.create',
    path: 'forged.txt',
    content: 'forged\n',
    ownership: 'seeded',
    precondition: { state: 'absent' }
  });
  forgedState.plan.reviews.push({
    operation: 'forged/recipe/0',
    permission: { kind: 'filesystem.write', value: 'forged.txt' },
    status: 'approved',
    reason: 'forged approval'
  });
  forgedState.plan.id = computePlanId((({ id, ...body }) => body)(forgedState.plan));
  fs.writeFileSync(forgedStatePath, `${JSON.stringify(forgedState, null, 2)}\n`);
  assert.throws(() => run(forgedRoot, 'apply'), /Stored plan does not match the current generated plan/);
  assert.equal(fs.existsSync(path.join(forgedRoot, 'forged.txt')), false);
});

test('recipe validation covers the closed operation vocabulary and rejects unknown types', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-recipes-'));
  fs.mkdirSync(path.join(directory, 'contributions', 'recipes'), { recursive: true });
  const file = path.join(directory, 'contributions', 'recipes', 'all.yaml');
  const header = 'apiVersion: harness.dev/v1\nkind: Recipe\nmetadata:\n  id: all\n  module: test\nwhen:\n  finding: example.trigger\noperations:\n';
  fs.writeFileSync(file, `${header}  - { type: file.create, path: new.txt, content: new, ownership: seeded }\n  - { type: file.replace, path: old.txt, content: old, ownership: managed }\n  - type: structured.merge\n    path: config.yaml\n    format: yaml\n    fragment: { enabled: true }\n    conflictPolicy: preserve\n    ownership: structured-merge\n  - { type: directory.ensure, path: generated }\n  - { type: command.run, grant: verify, args: [] }\n  - { type: connector.configure, connector: github, settings: {}, secretRefs: [GITHUB_TOKEN] }\n`);
  const loaded = { directory, manifest: { metadata: { version: '0.1.0' }, contributes: { recipes: ['all'], connectors: ['github'] }, permissions: { filesystem: { write: ['new.txt', 'old.txt', 'config.yaml', 'generated'] }, commands: ['verify'], secrets: ['GITHUB_TOKEN'] } } };
  const resolved = { ordered: ['example'], active: new Map([['example', loaded]]) };
  assert.doesNotThrow(() => validatePlanningContributions(resolved));
  fs.writeFileSync(file, `${header}  - { type: shell.exec }\n`);
  assert.throws(() => validatePlanningContributions(resolved), /type is not supported/);
  fs.writeFileSync(file, `${header}  - { type: file.create, path: .harness/owned.txt, content: invalid, ownership: managed }\n`);
  assert.throws(() => validatePlanningContributions(resolved), /targets reserved harness state/);
});

test('transactional apply rolls back files and implicit directories on failure', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-transaction-'));
  fs.writeFileSync(path.join(cwd, 'broken.yaml'), 'value: [\n');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-'));
  fs.mkdirSync(path.join(directory, 'contributions', 'recipes'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'contributions', 'recipes', 'transaction.yaml'), 'apiVersion: harness.dev/v1\nkind: Recipe\nmetadata:\n  id: transaction\n  module: test\nwhen:\n  finding: example.trigger\noperations:\n  - type: file.create\n    path: nested/created.txt\n    content: created\n    ownership: seeded\n  - type: structured.merge\n    path: broken.yaml\n    format: yaml\n    fragment: { enabled: true }\n    conflictPolicy: replace\n    ownership: structured-merge\n');
  const manifest = { metadata: { version: '0.1.0' }, contributes: { recipes: ['transaction'] }, permissions: { filesystem: { write: ['nested/**', 'broken.yaml'] } } };
  const loaded = { directory, content: 'transaction-plugin', manifest };
  const resolved = { ordered: ['example'], active: new Map([['example', loaded]]) };
  const config = { integration: { auto_fix_max_priority: 'P2' } };
  const report = { findings: [{ id: 'example.trigger', priority: 'P2' }] };
  const plan = buildPlan({ root: cwd, config, resolved, report });
  assert.throws(() => executePlan({ root: cwd, plan, currentInputs: inputDigests({ root: cwd, config, resolved }) }), /Apply failed and rolled back/);
  assert.equal(fs.existsSync(path.join(cwd, 'nested')), false);
  assert.equal(fs.readFileSync(path.join(cwd, 'broken.yaml'), 'utf8'), 'value: [\n');
});

test('commands remain review-gated without an execution broker', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-command-'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-'));
  fs.mkdirSync(path.join(directory, 'contributions', 'recipes'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'contributions', 'recipes', 'command.yaml'), 'apiVersion: harness.dev/v1\nkind: Recipe\nmetadata:\n  id: command\n  module: test\nwhen:\n  finding: example.trigger\noperations:\n  - type: command.run\n    grant: verify\n    args: []\n');
  const manifest = { metadata: { version: '0.1.0' }, contributes: { recipes: ['command'] }, permissions: { commands: ['verify'] } };
  const loaded = { directory, content: 'command-plugin', manifest };
  const resolved = { ordered: ['example'], active: new Map([['example', loaded]]) };
  const config = { integration: { auto_fix_max_priority: 'P2' } };
  const plan = buildPlan({ root: cwd, config, resolved, report: { findings: [{ id: 'example.trigger', priority: 'P2' }] } });
  assert.equal(plan.status, 'review-required');
  assert.throws(() => executePlan({ root: cwd, plan, currentInputs: inputDigests({ root: cwd, config, resolved }) }), /unapproved operation/);
});

test('apply runs verification before committing and rolls back on verify failure', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-verify-'));
  run(cwd, 'init');
  fs.rmSync(path.join(cwd, 'AGENTS.md'));
  setVerifyCommand(cwd, 'node -e "process.exit(1)"');
  run(cwd, 'plan');
  assert.throws(() => run(cwd, 'apply'), /Apply failed and rolled back/);
  assert.equal(fs.existsSync(path.join(cwd, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(cwd, '.gitignore')), false);
  const state = JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'state.json'), 'utf8'));
  assert.equal(state.applied, undefined);
});

test('file operations execute through the kernel and record ownership', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-files-'));
  fs.writeFileSync(path.join(cwd, 'managed.txt'), 'before\n');
  fs.writeFileSync(path.join(cwd, 'config.json'), '{"existing":true}\n');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-'));
  fs.mkdirSync(path.join(directory, 'contributions', 'recipes'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'contributions', 'recipes', 'files.yaml'), 'apiVersion: harness.dev/v1\nkind: Recipe\nmetadata:\n  id: files\n  module: files\nwhen:\n  finding: example.trigger\noperations:\n  - { type: directory.ensure, path: generated }\n  - { type: file.create, path: generated/new.txt, content: "new\\n", ownership: seeded }\n  - { type: file.replace, path: managed.txt, content: "after\\n", ownership: managed }\n  - type: structured.merge\n    path: config.json\n    format: json\n    fragment: { added: true }\n    conflictPolicy: error\n    ownership: structured-merge\n');
  const manifest = { metadata: { version: '0.1.0' }, contributes: { recipes: ['files'] }, permissions: { filesystem: { write: ['generated', 'generated/**', 'managed.txt', 'config.json'] } } };
  const loaded = { directory, content: 'files-plugin', manifest };
  const resolved = { ordered: ['example'], active: new Map([['example', loaded]]) };
  const config = { integration: { auto_fix_max_priority: 'P2' } };
  const plan = buildPlan({ root: cwd, config, resolved, report: { findings: [{ id: 'example.trigger', priority: 'P2' }] } });
  assert.throws(() => executePlan({ root: cwd, plan, currentInputs: inputDigests({ root: cwd, config, resolved }), commit() { throw new Error('state write failed'); } }), /Apply failed and rolled back: state write failed/);
  assert.equal(fs.existsSync(path.join(cwd, 'generated')), false);
  assert.equal(fs.readFileSync(path.join(cwd, 'managed.txt'), 'utf8'), 'before\n');
  const result = executePlan({ root: cwd, plan, currentInputs: inputDigests({ root: cwd, config, resolved }) });
  assert.equal(fs.readFileSync(path.join(cwd, 'managed.txt'), 'utf8'), 'after\n');
  assert.equal(fs.readFileSync(path.join(cwd, 'generated', 'new.txt'), 'utf8'), 'new\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, 'config.json'), 'utf8')), { existing: true, added: true });
  assert.equal(result.files['managed.txt'].ownership, 'managed');
  assert.equal(result.files['config.json'].ownership, 'structured-merge');
});

test('file creation is exclusive so concurrent writes fail safely', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-race-'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-'));
  fs.mkdirSync(path.join(directory, 'contributions', 'recipes'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'contributions', 'recipes', 'create.yaml'), 'apiVersion: harness.dev/v1\nkind: Recipe\nmetadata:\n  id: create\n  module: files\nwhen:\n  finding: example.trigger\noperations:\n  - { type: file.create, path: created.txt, content: "planned\\n", ownership: seeded }\n');
  const manifest = { metadata: { version: '0.1.0' }, contributes: { recipes: ['create'] }, permissions: { filesystem: { write: ['created.txt'] } } };
  const loaded = { directory, content: 'create-plugin', manifest };
  const resolved = { ordered: ['example'], active: new Map([['example', loaded]]) };
  const config = { integration: { auto_fix_max_priority: 'P2' } };
  const plan = buildPlan({ root: cwd, config, resolved, report: { findings: [{ id: 'example.trigger', priority: 'P2' }] } });
  const target = path.join(cwd, 'created.txt');
  const originalWrite = fs.writeFileSync;
  let injected = false;
  fs.writeFileSync = function wrappedWrite(file, data, options) {
    if (!injected && file === target) {
      injected = true;
      originalWrite.call(fs, file, 'concurrent\n');
    }
    return originalWrite.call(fs, file, data, options);
  };
  try {
    assert.throws(() => executePlan({ root: cwd, plan, currentInputs: inputDigests({ root: cwd, config, resolved }) }), /Apply failed and rolled back/);
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'concurrent\n');
});

test('executePlan rejects missing or duplicated review coverage', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reviews-'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-'));
  fs.mkdirSync(path.join(directory, 'contributions', 'recipes'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'contributions', 'recipes', 'create.yaml'), 'apiVersion: harness.dev/v1\nkind: Recipe\nmetadata:\n  id: create\n  module: files\nwhen:\n  finding: example.trigger\noperations:\n  - { type: file.create, path: created.txt, content: "planned\\n", ownership: seeded }\n');
  const manifest = { metadata: { version: '0.1.0' }, contributes: { recipes: ['create'] }, permissions: { filesystem: { write: ['created.txt'] } } };
  const loaded = { directory, content: 'create-plugin', manifest };
  const resolved = { ordered: ['example'], active: new Map([['example', loaded]]) };
  const config = { integration: { auto_fix_max_priority: 'P2' } };
  const plan = buildPlan({ root: cwd, config, resolved, report: { findings: [{ id: 'example.trigger', priority: 'P2' }] } });
  const missingReviewPlan = { ...plan, reviews: [] };
  missingReviewPlan.id = computePlanId((({ id, ...body }) => body)(missingReviewPlan));
  assert.throws(() => executePlan({ root: cwd, plan: missingReviewPlan, currentInputs: inputDigests({ root: cwd, config, resolved }) }), /Plan review is missing/);
  const duplicatedReviewPlan = { ...plan, reviews: [...plan.reviews, plan.reviews[0]] };
  duplicatedReviewPlan.id = computePlanId((({ id, ...body }) => body)(duplicatedReviewPlan));
  assert.throws(() => executePlan({
    root: cwd,
    plan: duplicatedReviewPlan,
    currentInputs: inputDigests({ root: cwd, config, resolved })
  }), /Plan review is duplicated/);
});

test('planning rejects conflicting targets and undeclared write permissions', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-conflict-'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-'));
  fs.mkdirSync(path.join(directory, 'contributions', 'recipes'), { recursive: true });
  const recipe = id => `apiVersion: harness.dev/v1\nkind: Recipe\nmetadata:\n  id: ${id}\n  module: test\nwhen:\n  finding: example.trigger\noperations:\n  - { type: file.create, path: shared.txt, content: ${id}, ownership: seeded }\n`;
  fs.writeFileSync(path.join(directory, 'contributions', 'recipes', 'first.yaml'), recipe('first'));
  fs.writeFileSync(path.join(directory, 'contributions', 'recipes', 'second.yaml'), recipe('second'));
  const config = { integration: { auto_fix_max_priority: 'P2' } };
  const report = { findings: [{ id: 'example.trigger', priority: 'P2' }] };
  const loaded = { directory, content: 'conflict-plugin', manifest: { metadata: { version: '0.1.0' }, contributes: { recipes: ['first', 'second'] }, permissions: { filesystem: { write: ['shared.txt'] } } } };
  const resolved = { ordered: ['example'], active: new Map([['example', loaded]]) };
  assert.throws(() => buildPlan({ root: cwd, config, resolved, report }), /Operation conflict on shared.txt/);
  loaded.manifest.contributes.recipes = ['first'];
  loaded.manifest.permissions.filesystem.write = [];
  assert.throws(() => buildPlan({ root: cwd, config, resolved, report }), /may not write undeclared path shared.txt/);
  assert.throws(() => validatePlanningContributions(resolved), /may not write undeclared path shared.txt/);
});

test('planning permission boundaries do not treat sibling prefixes as descendants', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-permissions-'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-'));
  fs.mkdirSync(path.join(directory, 'contributions', 'recipes'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'contributions', 'recipes', 'scoped.yaml'), 'apiVersion: harness.dev/v1\nkind: Recipe\nmetadata:\n  id: scoped\n  module: test\nwhen:\n  finding: example.trigger\noperations:\n  - { type: file.create, path: generated2/out.txt, content: blocked, ownership: seeded }\n');
  const config = { integration: { auto_fix_max_priority: 'P2' } };
  const report = { findings: [{ id: 'example.trigger', priority: 'P2' }] };
  const loaded = { directory, manifest: { metadata: { version: '0.1.0' }, contributes: { recipes: ['scoped'] }, permissions: { filesystem: { write: ['generated/**'] } } } };
  const resolved = { ordered: ['example'], active: new Map([['example', loaded]]) };
  assert.throws(() => buildPlan({ root: cwd, config, resolved, report }), /may not write undeclared path generated2\/out.txt/);
  assert.throws(() => validatePlanningContributions(resolved), /may not write undeclared path generated2\/out.txt/);
});

test('planning rejects directory.ensure over symlinks', { skip: process.platform === 'win32' }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-symlink-'));
  fs.symlinkSync('target', path.join(cwd, 'generated'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-'));
  fs.mkdirSync(path.join(directory, 'contributions', 'recipes'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'contributions', 'recipes', 'ensure.yaml'), 'apiVersion: harness.dev/v1\nkind: Recipe\nmetadata:\n  id: ensure\n  module: test\nwhen:\n  finding: example.trigger\noperations:\n  - { type: directory.ensure, path: generated }\n');
  const config = { integration: { auto_fix_max_priority: 'P2' } };
  const report = { findings: [{ id: 'example.trigger', priority: 'P2' }] };
  const loaded = { directory, manifest: { metadata: { version: '0.1.0' }, contributes: { recipes: ['ensure'] }, permissions: { filesystem: { write: ['generated'] } } } };
  const resolved = { ordered: ['example'], active: new Map([['example', loaded]]) };
  assert.throws(() => buildPlan({ root: cwd, config, resolved, report }), /cannot create directory over symlink generated/);
});
