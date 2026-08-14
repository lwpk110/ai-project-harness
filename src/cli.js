#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const moduleDir = fileURLToPath(new URL('.', import.meta.url));
const harnessDir = path.join(root, '.harness');
const configPath = path.join(root, 'harness.yaml');
const lockPath = path.join(root, 'harness.lock');
const statePath = path.join(harnessDir, 'state.json');
const builtins = ['git-conventions', 'documentation', 'spec-driven', 'github-development', 'prototype-replication'];

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
  const config = { plugins: {}, project: {}, integration: {}, commands: {}, policies: {} };
  let section = '';
  for (const raw of readText(configPath).split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const match = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (indent === 0) { section = key.trim(); if (value) config[section] = scalar(value); }
    else if (indent === 2) {
      if (section === 'plugins') config.plugins[key.trim()] = { enabled: scalar(value || 'true') };
      else if (config[section] && typeof config[section] === 'object') config[section][key.trim()] = scalar(value);
    }
  }
  return config;
}
function scalar(value) {
  const v = value.trim();
  if (!v) return {};
  if (v === '{}') return {};
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v.replace(/^['"]|['"]$/g, '');
}
function saveConfig(config) {
  const lines = ['schema: 1', 'project:'];
  for (const [k, v] of Object.entries(config.project ?? {})) lines.push(`  ${k}: ${format(v)}`);
  lines.push('integration:');
  for (const [k, v] of Object.entries(config.integration ?? {})) lines.push(`  ${k}: ${format(v)}`);
  lines.push('plugins:');
  for (const [k, v] of Object.entries(config.plugins ?? {})) lines.push(`  ${k}: ${format(v.enabled ?? true)}`);
  lines.push('commands:');
  for (const [k, v] of Object.entries(config.commands ?? {})) lines.push(`  ${k}: ${format(v)}`);
  lines.push('policies:');
  for (const [k, v] of Object.entries(config.policies ?? {})) lines.push(`  ${k}: ${format(v)}`);
  write(configPath, `${lines.join('\n')}\n`);
}
function format(v) { return typeof v === 'string' && /\s/.test(v) ? JSON.stringify(v) : String(v); }
function splitCommand(command) { const parts = []; let current = ''; let quote = ''; let escaped = false; for (const char of command.trim()) { if (escaped) { current += char; escaped = false; } else if (char === '\\' && quote === '"') escaped = true; else if (quote) { if (char === quote) quote = ''; else current += char; } else if (char === '"' || char === "'") quote = char; else if (/\s/.test(char)) { if (current) { parts.push(current); current = ''; } } else current += char; } if (escaped) current += '\\'; if (quote) throw new Error('Unterminated quote in verification command'); if (current) parts.push(current); return parts; }
function loadState() { return exists(statePath) ? JSON.parse(readText(statePath)) : { files: {}, audit: null, plan: null }; }
function loadLock() { return exists(lockPath) ? JSON.parse(readText(lockPath)) : null; }
function saveLock(lock) { write(lockPath, `${JSON.stringify(lock, null, 2)}\n`); }
function saveState(state) { ensureDir(harnessDir); write(statePath, `${JSON.stringify(state, null, 2)}\n`); }
function projectFiles() { return fs.readdirSync(root, { withFileTypes: true }).filter(e => !['.git', '.harness', 'node_modules'].includes(e.name)).map(e => e.name); }

function init() {
  if (!exists(configPath)) write(configPath, readText(path.join(moduleDir, '..', 'harness.yaml')));
  ensureDir(harnessDir);
  if (!exists(path.join(root, 'AGENTS.md'))) write(path.join(root, 'AGENTS.md'), '# Agent instructions\n\nRun the project verification command before delivery.\n');
  console.log(`Initialized AI Project Harness in ${root}`);
}
function detect() {
  const files = projectFiles();
  const detected = {
    stack: exists(path.join(root, 'package.json')) ? 'node' : exists(path.join(root, 'pyproject.toml')) ? 'python' : 'unknown',
    package_manager: exists(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : exists(path.join(root, 'yarn.lock')) ? 'yarn' : exists(path.join(root, 'package-lock.json')) ? 'npm' : 'unknown',
    ci: exists(path.join(root, '.github', 'workflows')) ? 'github-actions' : 'unknown',
    agent_instructions: ['AGENTS.md', 'CLAUDE.md', '.cursor'].filter(item => exists(path.join(root, item))),
    has_tests: files.some(item => /test|spec/i.test(item)),
    has_docs: files.includes('docs') || files.includes('README.md'),
    has_gitignore: files.includes('.gitignore')
  };
  return detected;
}
function audit(options = {}) {
  const config = parseConfig();
  const detected = detect();
  const findings = [];
  if (detected.stack === 'unknown') findings.push({ id: 'stack.unknown', priority: 'P1', title: '无法识别项目技术栈', evidence: '未发现 package.json 或 pyproject.toml', action: '在 harness.yaml 中补充 project.detected' });
  if (!detected.has_tests) findings.push({ id: 'testing.missing', priority: 'P1', title: '没有明显的测试目录或文件', evidence: '未发现 test/spec 命名文件', action: '配置可重复的测试命令并补充关键路径测试' });
  if (!detected.agent_instructions.length) findings.push({ id: 'agents.instructions', priority: 'P2', title: '缺少项目级 agent 指令', evidence: '未发现 AGENTS.md、CLAUDE.md 或 .cursor', action: '生成 AGENTS.md，记录项目地图和验证命令' });
  if (!detected.has_docs) findings.push({ id: 'docs.missing', priority: 'P2', title: '缺少项目文档入口', evidence: '未发现 README.md 或 docs/', action: '初始化 README.md 和 docs/architecture.md' });
  if (!detected.has_gitignore) findings.push({ id: 'gitignore.missing', priority: 'P2', title: '缺少 .gitignore', evidence: '未发现 .gitignore', action: '生成基础 .gitignore' });
  const report = { generatedAt: new Date().toISOString(), root, detected, findings, plugins: Object.keys(config.plugins ?? {}) };
  const state = loadState(); state.audit = report; saveState(state);
  if (options.format === 'json') console.log(JSON.stringify(report, null, 2));
  else { console.log(`# Harness audit\n\nStack: ${detected.stack}\nPackage manager: ${detected.package_manager}\nCI: ${detected.ci}\n\n## Findings\n`); for (const f of findings) console.log(`- [${f.priority}] ${f.title}: ${f.action}`); if (!findings.length) console.log('- No findings.'); }
  return report;
}
function plan() {
  const state = loadState(); const report = state.audit ?? audit({ format: 'json' });
  const changes = report.findings.filter(f => ['P2', 'P3'].includes(f.priority)).map(f => ({ id: f.id, priority: f.priority, action: f.action, files: f.id === 'agents.instructions' ? ['AGENTS.md'] : f.id === 'gitignore.missing' ? ['.gitignore'] : [] }));
  state.plan = { generatedAt: new Date().toISOString(), changes, manual: report.findings.filter(f => !['P2', 'P3'].includes(f.priority)).map(f => f.id) }; saveState(state);
  console.log(JSON.stringify(state.plan, null, 2));
}
function apply() {
  const state = loadState(); if (!state.plan) throw new Error('No plan found. Run harness plan first.');
  const recovery = path.join(harnessDir, 'recovery', new Date().toISOString().replace(/[:.]/g, '-')); ensureDir(recovery);
  for (const file of ['AGENTS.md', '.gitignore']) if (exists(path.join(root, file))) write(path.join(recovery, file), readText(path.join(root, file)));
  for (const change of state.plan.changes) {
    if (change.id === 'agents.instructions' && !exists(path.join(root, 'AGENTS.md'))) write(path.join(root, 'AGENTS.md'), '# Agent instructions\n\nRun the project verification command before delivery.\n');
    if (change.id === 'gitignore.missing' && !exists(path.join(root, '.gitignore'))) write(path.join(root, '.gitignore'), 'node_modules/\n.env\n');
  }
  state.appliedAt = new Date().toISOString(); state.files = {}; for (const file of ['AGENTS.md', '.gitignore']) if (exists(path.join(root, file))) state.files[file] = { hash: sha256(readText(path.join(root, file))), ownership: 'seeded' }; saveState(state); console.log(`Applied ${state.plan.changes.length} changes. Recovery: ${recovery}`);
}
function addPlugin(name) { if (!builtins.includes(name)) throw new Error(`Unknown built-in plugin: ${name}`); const config = parseConfig(); config.plugins[name] = { enabled: true }; saveConfig(config); console.log(`Enabled plugin ${name}`); }
function pluginManifestFile(name) { const projectFile = path.join(root, 'plugins', name, 'harness-plugin.yaml'); const builtinFile = path.join(moduleDir, '..', 'plugins', name, 'harness-plugin.yaml'); const file = exists(projectFile) ? projectFile : builtinFile; if (!exists(file)) throw new Error(`Plugin manifest not found: ${name}`); return { file, source: file === projectFile ? 'project' : 'builtin' }; }
function pluginManifest(name) { return readText(pluginManifestFile(name).file); }
function manifestField(manifest, field) { const match = manifest.match(new RegExp(`^\\s*${field}:\\s*(.+)$`, 'm')); return match?.[1]?.trim().replace(/^['"]|['"]$/g, ''); }
function validatePlugin(name) { const manifest = pluginManifest(name); const apiVersion = manifestField(manifest, 'apiVersion'); const kind = manifestField(manifest, 'kind'); const pluginName = manifestField(manifest, 'name'); const version = manifestField(manifest, 'version'); const errors = []; if (apiVersion !== 'harness.dev/v1') errors.push('apiVersion must be harness.dev/v1'); if (kind !== 'Plugin') errors.push('kind must be Plugin'); if (pluginName !== name) errors.push(`metadata.name must be ${name}`); if (!version) errors.push('metadata.version is required'); if (errors.length) throw new Error(`Invalid plugin ${name}: ${errors.join('; ')}`); return { name: pluginName, version, apiVersion, kind }; }
function syncLock() { const config = parseConfig(); const plugins = {}; for (const name of Object.keys(config.plugins ?? {}).sort()) { const manifest = pluginManifest(name); const detail = validatePlugin(name); plugins[name] = { version: detail.version, source: pluginManifestFile(name).source, integrity: `sha256:${sha256(manifest)}` }; } const lock = { schema: 1, plugins }; saveLock(lock); console.log(`Synchronized ${Object.keys(plugins).length} plugin lock entries`); return lock; }
function pluginCommand(action, name) { const config = parseConfig(); if (action === 'list') { for (const item of builtins) { const entry = config.plugins?.[item]; const enabled = entry === true || entry?.enabled === true; let version = 'invalid'; try { version = validatePlugin(item).version; } catch {} console.log(`${item}\t${enabled ? 'enabled' : 'disabled'}\t${version}`); } return; } if (!name || !builtins.includes(name)) throw new Error(`Unknown built-in plugin: ${name ?? ''}`); if (action === 'info') { console.log(JSON.stringify(validatePlugin(name), null, 2)); return; } if (action === 'validate') { console.log(`Valid plugin ${name} (${validatePlugin(name).version})`); return; } throw new Error(`Unknown plugin action: ${action}`); }
function setPluginEnabled(name, enabled) { if (!builtins.includes(name)) throw new Error(`Unknown built-in plugin: ${name}`); const config = parseConfig(); if (!config.plugins[name]) config.plugins[name] = { enabled }; else config.plugins[name].enabled = enabled; saveConfig(config); console.log(`${enabled ? 'Enabled' : 'Disabled'} plugin ${name}`); }
function removePlugin(name) { if (!builtins.includes(name)) throw new Error(`Unknown built-in plugin: ${name ?? ''}`); const config = parseConfig(); if (!config.plugins[name]) throw new Error(`Plugin is not configured: ${name}`); delete config.plugins[name]; saveConfig(config); console.log(`Removed plugin ${name}`); }
function diff() { const state = loadState(); const changes = []; for (const [file, record] of Object.entries(state.files ?? {})) { const current = path.join(root, file); const currentHash = exists(current) ? sha256(readText(current)) : null; if (currentHash !== record.hash) changes.push({ file, status: exists(current) ? 'modified' : 'deleted', ownership: record.ownership }); } console.log(JSON.stringify({ changes }, null, 2)); return changes; }
function doctor() { const config = parseConfig(); const errors = []; for (const name of Object.keys(config.plugins ?? {})) { if (!builtins.includes(name)) { errors.push(`Unknown plugin: ${name}`); continue; } try { validatePlugin(name); } catch (error) { errors.push(error.message); } } const lock = loadLock(); if (lock && lock.schema !== 1) errors.push('harness.lock schema must be 1'); if (lock) for (const [name, entry] of Object.entries(lock.plugins ?? {})) { try { if (entry.integrity !== `sha256:${sha256(pluginManifest(name))}`) errors.push(`Lock integrity mismatch: ${name}`); } catch (error) { errors.push(error.message); } } if (!config.commands?.verify) errors.push('commands.verify is required'); if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; } else console.log('Harness doctor: OK'); }
function verify() { const config = parseConfig(); const command = config.commands?.verify; if (!command) throw new Error('commands.verify is required'); if (process.platform === 'win32') execSync(command, { cwd: root, stdio: 'inherit' }); else { const [bin, ...args] = splitCommand(command); execFileSync(bin, args, { cwd: root, stdio: 'inherit' }); } console.log('Harness verify: OK'); }
function help() { console.log('harness init | adopt | audit | plan | apply | add <plugin> | remove <plugin> | enable <plugin> | disable <plugin> | plugin list|info|validate <plugin> | diff | sync | doctor | verify'); }

const { command, options, positional } = parseArgs(process.argv.slice(2));
try {
  if (command === 'init' || command === 'adopt') init();
  else if (command === 'audit') audit(options);
  else if (command === 'plan') plan();
  else if (command === 'apply') apply();
  else if (command === 'add') addPlugin(positional[0]);
  else if (command === 'remove') removePlugin(positional[0]);
  else if (command === 'enable') setPluginEnabled(positional[0], true);
  else if (command === 'disable') setPluginEnabled(positional[0], false);
  else if (command === 'plugin') pluginCommand(positional[0] ?? 'list', positional[1]);
  else if (command === 'diff') diff();
  else if (command === 'sync') syncLock();
  else if (command === 'doctor') doctor();
  else if (command === 'verify') verify();
  else help();
} catch (error) { console.error(`harness: ${error.message}`); process.exitCode = 1; }
