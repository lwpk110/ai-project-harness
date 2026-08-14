#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverBundledPlugins } from './catalog.js';
import { runAudit, validateAuditContributions } from './audit.js';
import { buildPlan, inputDigests, validatePlanningContributions } from './planning.js';
import { executePlan } from './executor.js';
import { parsePluginManifest, parseProjectConfig, stringifyProjectConfig } from './manifest.js';
import { startServer } from './server.js';

const root = process.cwd();
const moduleDir = fileURLToPath(new URL('.', import.meta.url));
const harnessDir = path.join(root, '.harness');
const configPath = path.join(root, 'harness.yaml');
const lockPath = path.join(root, 'harness.lock');
const statePath = path.join(harnessDir, 'state.json');
const builtinPluginsDir = path.join(moduleDir, '..', 'plugins');
const harnessVersion = JSON.parse(readText(path.join(moduleDir, '..', 'package.json'))).version;

function readText(file) { return fs.readFileSync(file, 'utf8'); }
function exists(file) { return fs.existsSync(file); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function write(file, content) { ensureDir(path.dirname(file)); fs.writeFileSync(file, content); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const options = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (item.startsWith('--')) options[item.slice(2)] = rest[i + 1]?.startsWith('--') ? true : (rest[++i] ?? true);
    else positional.push(item);
  }
  return { command, options, positional };
}

function parseConfig() {
  if (!exists(configPath)) throw new Error('harness.yaml not found. Run harness init first.');
  return parseProjectConfig(readText(configPath), configPath);
}
function saveConfig(config) {
  write(configPath, stringifyProjectConfig(config));
}
function splitCommand(command) { const parts = []; let current = ''; let quote = ''; let escaped = false; for (const char of command.trim()) { if (escaped) { current += char; escaped = false; } else if (char === '\\' && quote === '"') escaped = true; else if (quote) { if (char === quote) quote = ''; else current += char; } else if (char === '"' || char === "'") quote = char; else if (/\s/.test(char)) { if (current) { parts.push(current); current = ''; } } else current += char; } if (escaped) current += '\\'; if (quote) throw new Error('Unterminated quote in verification command'); if (current) parts.push(current); return parts; }
function loadState() { return exists(statePath) ? JSON.parse(readText(statePath)) : { files: {}, audit: null, plan: null }; }
function loadLock() { return exists(lockPath) ? JSON.parse(readText(lockPath)) : null; }
function saveLock(lock) { write(lockPath, `${JSON.stringify(lock, null, 2)}\n`); }
function saveState(state) { ensureDir(harnessDir); write(statePath, `${JSON.stringify(state, null, 2)}\n`); }

const scaffoldPresets = new Set(['agent-project', 'minimal', 'startup-web', 'backend-service']);
const scaffoldCi = new Set(['none', 'github']);

function optionList(value, label) {
  if (value === undefined || value === true || value === '') return [];
  const values = String(value).split(',').map(item => item.trim()).filter(Boolean);
  if (values.some(item => !/^[a-z0-9][a-z0-9._-]*$/i.test(item))) throw new Error(`${label} must be a comma-separated list of names`);
  return [...new Set(values)];
}

function projectName() { return path.basename(path.resolve(root)); }
function writeIfMissing(file, content) { if (exists(file)) return false; write(file, content); return true; }

function scaffoldFiles({ agents, preset }) {
  const runtimeText = agents.length ? agents.join(', ') : 'runtime-neutral';
  const name = projectName();
  return new Map([
    ['README.md', `# ${name}\n\nThis project is initialized as a governed AI agent project with the AI Project Harness.\n\n## Development loop\n\n1. Read the project context and selected skills.\n2. Run \`npm test\` before delivery.\n3. Use \`harness audit\`, \`harness plan\`, and \`harness apply\` for governed changes.\n4. Run \`npm run verify\` before handing work back.\n\nPreset: \`${preset}\`\nSelected runtimes: ${runtimeText}\n`],
    ['AGENTS.md', `# Agent instructions\n\nThis repository is governed by AI Project Harness.\n\n## Required loop\n\n- Inspect the repository before editing.\n- Keep changes within the approved Plan when one exists.\n- Run \`npm test\` and \`npm run verify\` before delivery.\n- Do not add credentials, recovery snapshots, or machine-local state.\n\n## Agent project\n\n- Preset: \`${preset}\`\n- Runtime adapters: ${runtimeText}\n- Governed flow: audit -> plan -> apply -> verify\n`],
    ['.gitignore', 'node_modules/\n.env\n.harness/state.json\n.harness/cache/\n.harness/recovery/\n*.log\n'],
    ['agent/README.md', `# Agent Project Surface\n\nThis directory contains runtime-neutral material shared by AI coding agents.\n\n- \`workflows/\`: repeatable project workflows.\n- \`skills/\`: focused task instructions and output contracts.\n- \`connectors/\`: declared external capabilities; credentials are never stored here.\n`],
    ['agent/workflows/governed-change.md', '# Governed Change\n\n1. Inspect the project and read relevant skills.\n2. Run `harness audit --format markdown`.\n3. Generate and review a Plan with `harness plan`.\n4. Apply only approved operations with `harness apply`.\n5. Run `npm run verify` and report evidence.\n'],
    ['agent/skills/project-verification/SKILL.md', '# Project Verification\n\n## Purpose\n\nProduce repeatable evidence that the project is healthy before delivery.\n\n## Contract\n\n- Run `npm test`.\n- Run `npm run verify`.\n- Report commands, exit status, and relevant failures.\n- Do not modify source files while verifying.\n'],
    ['agent/connectors/README.md', '# Connectors\n\nExternal capabilities must be declared as Harness plugins and approved by policy.\nDo not place API keys, tokens, or session files in this directory.\n']
  ]);
}

function nodePackage() {
  const name = projectName().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent-project';
  return {
    package: `${JSON.stringify({ name, version: '0.1.0', private: true, type: 'module', scripts: { test: 'node --test', verify: 'node --test' } }, null, 2)}\n`,
    lock: `${JSON.stringify({ name, version: '0.1.0', lockfileVersion: 3, requires: true, packages: { '': { name, version: '0.1.0', private: true, type: 'module', scripts: { test: 'node --test', verify: 'node --test' } } } }, null, 2)}\n`
  };
}

function githubWorkflow() {
  return `name: Verify\n\non:\n  push:\n    branches: [main, master]\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20.x\n          cache: npm\n      - run: npm ci\n      - run: npm run verify\n`;
}

function init(options = {}) {
  const adopt = options.adopt === true;
  const preset = String(options.preset ?? 'minimal');
  const scaffold = !adopt && options.preset !== undefined && preset !== 'minimal';
  if (!scaffoldPresets.has(preset)) throw new Error(`Unknown init preset: ${preset}`);
  const agents = optionList(options.agents, '--agents');
  const ci = String(options.ci ?? 'none').toLowerCase();
  if (!scaffoldCi.has(ci)) throw new Error(`Unknown CI provider: ${ci}`);
  if (!exists(configPath)) {
    const template = readText(path.join(moduleDir, '..', 'harness.yaml'));
    if (scaffold) {
      const config = parseProjectConfig(template);
      config.project = { ...config.project, mode: 'new', preset, agents };
      write(configPath, stringifyProjectConfig(config));
    } else {
      write(configPath, template);
    }
  }
  ensureDir(harnessDir);
  const created = [];
  if (!exists(path.join(root, 'AGENTS.md'))) {
    if (adopt || !scaffold) created.push(writeIfMissing(path.join(root, 'AGENTS.md'), '# Agent instructions\n\nRun the project verification command before delivery.\n'));
    else for (const [file, content] of scaffoldFiles({ agents, preset })) created.push(writeIfMissing(path.join(root, file), content));
  } else if (scaffold) {
    for (const [file, content] of scaffoldFiles({ agents, preset })) if (file !== 'AGENTS.md') created.push(writeIfMissing(path.join(root, file), content));
  }
  if (scaffold && !exists(path.join(root, 'package.json'))) {
    const packageFiles = nodePackage();
    created.push(writeIfMissing(path.join(root, 'package.json'), packageFiles.package));
    created.push(writeIfMissing(path.join(root, 'package-lock.json'), packageFiles.lock));
  }
  if (scaffold && ci === 'github') created.push(writeIfMissing(path.join(root, '.github', 'workflows', 'verify.yml'), githubWorkflow()));
  console.log(`Initialized AI Project Harness in ${root} (${preset}; ${created.filter(Boolean).length} files created)`);
}
function audit(options = {}) {
  const config = parseConfig();
  const report = runAudit({ root, resolved: resolveEnabledPlugins(config) });
  if (options.silent) return report;
  if (options.format === 'json') console.log(JSON.stringify(report, null, 2));
  else { console.log('# Harness audit\n\n## Facts\n'); for (const fact of report.facts) console.log(`- ${fact.id}: ${JSON.stringify(fact.value)}`); console.log('\n## Findings\n'); for (const finding of report.findings) console.log(`- [${finding.priority}] ${finding.title}: ${finding.action}`); if (!report.findings.length) console.log('- No findings.'); }
  return report;
}
function plan() {
  const config = parseConfig();
  const resolved = resolveEnabledPlugins(config);
  const report = runAudit({ root, resolved });
  const generated = buildPlan({ root, config, resolved, report });
  const state = loadState(); state.plan = generated; saveState(state);
  console.log(JSON.stringify(generated, null, 2));
}
function apply(options = {}) {
  const state = loadState(); if (!state.plan) throw new Error('No plan found. Run harness plan first.');
  const config = parseConfig();
  const resolved = resolveEnabledPlugins(config);
  const report = runAudit({ root, resolved });
  const expectedPlan = buildPlan({ root, config, resolved, report });
  const verificationCommand = config.commands?.verify;
  if (!verificationCommand) throw new Error('commands.verify is required');
  const result = executePlan({
    root,
    plan: state.plan,
    expectedPlan,
    currentInputs: inputDigests({ root, config, resolved }),
    only: options.only,
    commit(applied) {
      runVerificationCommand(verificationCommand);
      state.applied = applied;
      state.appliedAt = applied.appliedAt;
      state.files = { ...(state.files ?? {}), ...applied.files };
      saveState(state);
    }
  });
  console.log(`Applied ${result.results.length} operations. Recovery: ${result.recovery}`);
}
let _builtinPluginNames;
function builtinPluginNames() {
  if (!_builtinPluginNames) _builtinPluginNames = discoverBundledPlugins(builtinPluginsDir);
  return _builtinPluginNames;
}
function isBuiltinPlugin(name) { return builtinPluginNames().includes(name); }
function requireBuiltinPlugin(name) { if (!isBuiltinPlugin(name)) throw new Error(`Unknown built-in plugin: ${name ?? ''}`); }
function pluginEnabled(entry) { return entry === true || (entry !== null && typeof entry === 'object' && entry.enabled === true); }
function parseVersion(value) { const match = String(value).match(/^(\d+)\.(\d+)(?:\.(\d+))?$/); if (!match) throw new Error(`Unsupported semantic version: ${value}`); return match.slice(1).map(part => Number(part ?? 0)); }
function compareVersions(left, right) { const leftParts = parseVersion(left); const rightParts = parseVersion(right); for (let index = 0; index < 3; index += 1) { if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]; } return 0; }
function satisfiesVersionRange(version, range) {
  const comparators = String(range).trim().split(/\s+/).filter(Boolean);
  if (!comparators.length) throw new Error('Compatibility range cannot be empty');
  return comparators.every(comparator => {
    const match = comparator.match(/^(>=|<=|>|<|=)?(\d+\.\d+(?:\.\d+)?)$/);
    if (!match) throw new Error(`Unsupported compatibility comparator: ${comparator}`);
    const comparison = compareVersions(version, match[2]);
    switch (match[1] ?? '=') {
      case '>': return comparison > 0;
      case '>=': return comparison >= 0;
      case '<': return comparison < 0;
      case '<=': return comparison <= 0;
      default: return comparison === 0;
    }
  });
}
function pluginManifestFile(name) {
  requireBuiltinPlugin(name);
  const projectFile = path.join(root, 'plugins', name, 'harness-plugin.yaml');
  const builtinFile = path.join(builtinPluginsDir, name, 'harness-plugin.yaml');
  if (exists(projectFile)) return { file: projectFile, directory: path.dirname(projectFile), source: 'project' };
  if (exists(builtinFile)) return { file: builtinFile, directory: path.dirname(builtinFile), source: 'builtin' };
  throw new Error(`Manifest not found for plugin: ${name}`);
}
function loadPluginManifest(name) {
  const descriptor = pluginManifestFile(name);
  const content = readText(descriptor.file);
  return { ...descriptor, content, manifest: parsePluginManifest(content, name, descriptor.file) };
}
function pluginManifest(name) { return loadPluginManifest(name).content; }
function validatePlugin(name) {
  const { manifest } = loadPluginManifest(name);
  const compatibility = manifest.compatibility?.harness;
  if (compatibility && !satisfiesVersionRange(harnessVersion, compatibility)) throw new Error(`Plugin ${name} requires harness ${compatibility}, current version is ${harnessVersion}`);
  return { name: manifest.metadata.name, version: manifest.metadata.version, apiVersion: manifest.apiVersion, kind: manifest.kind };
}
function pluginDependencies(loaded) { return Object.keys(loaded.manifest.dependencies?.plugins ?? {}).sort(); }
function resolveEnabledPlugins(config) {
  const enabled = new Set(Object.entries(config.plugins ?? {}).filter(([, entry]) => pluginEnabled(entry)).map(([name]) => name));
  const active = new Map();
  const ordered = [];
  const visiting = new Set();
  function visit(name) {
    if (active.has(name)) return;
    if (visiting.has(name)) throw new Error(`Plugin dependency cycle: ${[...visiting, name].join(' -> ')}`);
    requireBuiltinPlugin(name);
    if (!enabled.has(name)) throw new Error(`Plugin dependency is not enabled: ${name}`);
    visiting.add(name);
    const loaded = loadPluginManifest(name);
    validatePlugin(name);
    for (const dependency of pluginDependencies(loaded)) visit(dependency);
    visiting.delete(name);
    active.set(name, loaded);
    ordered.push(name);
  }
  for (const name of [...enabled].sort()) visit(name);
  const contributions = new Map();
  for (const name of ordered) {
    for (const [kind, ids] of Object.entries(active.get(name).manifest.contributes ?? {})) {
      for (const id of ids) {
        const key = `${kind}/${id}`;
        if (contributions.has(key)) throw new Error(`Contribution ${key} is provided by both ${contributions.get(key)} and ${name}`);
        contributions.set(key, name);
      }
    }
  }
  return { active, ordered };
}
function enablePluginWithDependencies(name, config, visiting = new Set()) {
  if (visiting.has(name)) throw new Error(`Plugin dependency cycle: ${[...visiting, name].join(' -> ')}`);
  requireBuiltinPlugin(name);
  visiting.add(name);
  const loaded = loadPluginManifest(name);
  validatePlugin(name);
  for (const dependency of pluginDependencies(loaded)) enablePluginWithDependencies(dependency, config, visiting);
  visiting.delete(name);
  const entry = config.plugins[name];
  config.plugins[name] = entry !== null && typeof entry === 'object' ? { ...entry, enabled: true } : true;
}
function addPlugin(name) { const config = parseConfig(); enablePluginWithDependencies(name, config); resolveEnabledPlugins(config); saveConfig(config); console.log(`Enabled plugin ${name}`); }
function syncLock() { const config = parseConfig(); const resolved = resolveEnabledPlugins(config); const plugins = {}; for (const name of resolved.ordered) { const loaded = resolved.active.get(name); plugins[name] = { version: loaded.manifest.metadata.version, source: loaded.source, integrity: `sha256:${sha256(loaded.content)}` }; } const lock = { schema: 1, order: resolved.ordered, plugins }; saveLock(lock); console.log(`Synchronized ${Object.keys(plugins).length} plugin lock entries`); return lock; }
function pluginCommand(action, name) { const config = parseConfig(); if (action === 'list') { for (const item of builtinPluginNames()) { const enabled = pluginEnabled(config.plugins?.[item]); let version = 'invalid'; try { version = validatePlugin(item).version; } catch {} console.log(`${item}\t${enabled ? 'enabled' : 'disabled'}\t${version}`); } return; } requireBuiltinPlugin(name); if (action === 'info') { console.log(JSON.stringify(validatePlugin(name), null, 2)); return; } if (action === 'validate') { console.log(`Valid plugin ${name} (${validatePlugin(name).version})`); return; } throw new Error(`Unknown plugin action: ${action}`); }
function setPluginEnabled(name, enabled) { const config = parseConfig(); if (enabled) enablePluginWithDependencies(name, config); else { requireBuiltinPlugin(name); const entry = config.plugins[name]; config.plugins[name] = entry !== null && typeof entry === 'object' ? { ...entry, enabled: false } : false; } resolveEnabledPlugins(config); saveConfig(config); console.log(`${enabled ? 'Enabled' : 'Disabled'} plugin ${name}`); }
function removePlugin(name) { requireBuiltinPlugin(name); const config = parseConfig(); if (!Object.hasOwn(config.plugins, name)) throw new Error(`Plugin is not configured: ${name}`); delete config.plugins[name]; resolveEnabledPlugins(config); saveConfig(config); console.log(`Removed plugin ${name}`); }
function diff() { const state = loadState(); const changes = []; for (const [file, record] of Object.entries(state.files ?? {})) { const current = path.join(root, file); const currentHash = exists(current) ? sha256(readText(current)) : null; if (currentHash !== record.hash) changes.push({ file, status: exists(current) ? 'modified' : 'deleted', ownership: record.ownership }); } console.log(JSON.stringify({ changes }, null, 2)); return changes; }
function doctor() { const config = parseConfig(); const errors = []; try { const resolved = resolveEnabledPlugins(config); validateAuditContributions(resolved); validatePlanningContributions(resolved); } catch (error) { errors.push(error.message); } for (const name of Object.keys(config.plugins ?? {})) { if (!isBuiltinPlugin(name)) { errors.push(`Unknown plugin: ${name}`); continue; } try { validatePlugin(name); } catch (error) { errors.push(error.message); } } const lock = loadLock(); if (lock && lock.schema !== 1) errors.push('harness.lock schema must be 1'); if (lock) for (const [name, entry] of Object.entries(lock.plugins ?? {})) { try { if (entry.integrity !== `sha256:${sha256(pluginManifest(name))}`) errors.push(`Lock integrity mismatch: ${name}`); } catch (error) { errors.push(error.message); } } if (!config.commands?.verify) errors.push('commands.verify is required'); if (errors.length) { console.error([...new Set(errors)].join('\n')); process.exitCode = 1; } else console.log('Harness doctor: OK'); }
function runVerificationCommand(command) { if (process.platform === 'win32') execSync(command, { cwd: root, stdio: 'inherit' }); else { const [bin, ...args] = splitCommand(command); execFileSync(bin, args, { cwd: root, stdio: 'inherit' }); } }
function verify() { const config = parseConfig(); const command = config.commands?.verify; if (!command) throw new Error('commands.verify is required'); runVerificationCommand(command); console.log('Harness verify: OK'); }
function serve(options = {}) {
  const port = Number(options.port ?? 3210);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('serve --port must be an integer between 0 and 65535');
  startServer({ root, port });
}
function help() { console.log('harness init [--preset agent-project] [--agents codex,claude] [--ci github] | adopt | audit | plan | apply | serve | add <plugin> | remove <plugin> | enable <plugin> | disable <plugin> | plugin list|info|validate <plugin> | diff | sync | doctor | verify'); }

const { command, options, positional } = parseArgs(process.argv.slice(2));
try {
  if (command === 'init') init(options);
  else if (command === 'adopt') init({ ...options, adopt: true });
  else if (command === 'audit') audit(options);
  else if (command === 'plan') plan();
  else if (command === 'apply') apply(options);
  else if (command === 'add') addPlugin(positional[0]);
  else if (command === 'remove') removePlugin(positional[0]);
  else if (command === 'enable') setPluginEnabled(positional[0], true);
  else if (command === 'disable') setPluginEnabled(positional[0], false);
  else if (command === 'plugin') pluginCommand(positional[0] ?? 'list', positional[1]);
  else if (command === 'diff') diff();
  else if (command === 'sync') syncLock();
  else if (command === 'doctor') doctor();
  else if (command === 'verify') verify();
  else if (command === 'serve') serve(options);
  else help();
} catch (error) { console.error(`harness: ${error.message}`); process.exitCode = 1; }
