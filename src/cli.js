#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const harnessDir = path.join(root, '.harness');
const configPath = path.join(root, 'harness.yaml');
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
function loadState() { return exists(statePath) ? JSON.parse(readText(statePath)) : { files: {}, audit: null, plan: null }; }
function saveState(state) { ensureDir(harnessDir); write(statePath, `${JSON.stringify(state, null, 2)}\n`); }
function projectFiles() { return fs.readdirSync(root, { withFileTypes: true }).filter(e => !['.git', '.harness', 'node_modules'].includes(e.name)).map(e => e.name); }

function init() {
  if (!exists(configPath)) write(configPath, readText(path.join(import.meta.dirname, '..', 'harness.yaml')));
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
function doctor() { const config = parseConfig(); const errors = []; for (const name of Object.keys(config.plugins ?? {})) if (!builtins.includes(name)) errors.push(`Unknown plugin: ${name}`); if (!config.commands?.verify) errors.push('commands.verify is required'); if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; } else console.log('Harness doctor: OK'); }
function verify() { const config = parseConfig(); const command = config.commands?.verify; if (!command) throw new Error('commands.verify is required'); const [bin, ...args] = command.split(/\s+/); if (process.platform === 'win32') execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], { cwd: root, stdio: 'inherit' }); else execFileSync(bin, args, { cwd: root, stdio: 'inherit' }); console.log('Harness verify: OK'); }
function help() { console.log('harness init | adopt | audit | plan | apply | add <plugin> | doctor | verify'); }

const { command, options, positional } = parseArgs(process.argv.slice(2));
try {
  if (command === 'init' || command === 'adopt') init();
  else if (command === 'audit') audit(options);
  else if (command === 'plan') plan();
  else if (command === 'apply') apply();
  else if (command === 'add') addPlugin(positional[0]);
  else if (command === 'doctor') doctor();
  else if (command === 'verify') verify();
  else help();
} catch (error) { console.error(`harness: ${error.message}`); process.exitCode = 1; }
