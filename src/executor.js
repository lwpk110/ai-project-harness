import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument, stringify } from 'yaml';
import { assertPlanIntegrity, normalizeOperationPath } from './planning.js';

function sha256(value) { return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`; }
function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); }

function targetPath(root, projectPath) {
  const normalized = normalizeOperationPath(projectPath);
  const target = path.resolve(root, ...normalized.split('/'));
  const relative = path.relative(path.resolve(root), target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Operation path escapes project root: ${projectPath}`);
  let cursor = path.resolve(root);
  for (const segment of normalized.split('/')) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Operation path traverses symbolic link: ${projectPath}`);
  }
  return target;
}

function currentState(root, operation) {
  if (!operation.path) return null;
  const target = targetPath(root, operation.path);
  if (!fs.existsSync(target)) return { state: 'absent' };
  const stat = fs.statSync(target);
  if (stat.isDirectory()) return { state: 'directory' };
  return { state: 'file', hash: sha256(fs.readFileSync(target)) };
}

function validatePreconditions(root, operations) {
  for (const operation of operations) {
    if (operation.type === 'command.run' || operation.type === 'connector.configure') throw new Error(`Operation ${operation.type} requires an execution broker that is not available in M3`);
    const current = currentState(root, operation);
    if (!isDeepStrictEqual(current, operation.precondition)) throw new Error(`Stale operation input for ${operation.path}`);
  }
}

function mergeMappings(current, fragment, policy, prefix = '') {
  const result = { ...current };
  for (const [key, value] of Object.entries(fragment)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (!(key in result)) { result[key] = value; continue; }
    if (result[key] !== null && value !== null && typeof result[key] === 'object' && typeof value === 'object' && !Array.isArray(result[key]) && !Array.isArray(value)) {
      result[key] = mergeMappings(result[key], value, policy, field);
    } else if (isDeepStrictEqual(result[key], value) || policy === 'preserve') continue;
    else if (policy === 'replace') result[key] = value;
    else throw new Error(`Structured merge conflict at ${field}`);
  }
  return result;
}

function applyOperation(root, operation) {
  const target = targetPath(root, operation.path);
  if (operation.type === 'directory.ensure') { ensureDir(target); return; }
  ensureDir(path.dirname(target));
  if (operation.type === 'file.create' || operation.type === 'file.replace') {
    fs.writeFileSync(target, operation.content);
    return;
  }
  const source = fs.readFileSync(target, 'utf8');
  let current;
  if (operation.format === 'json') current = JSON.parse(source);
  else {
    const document = parseDocument(source, { prettyErrors: false, uniqueKeys: true });
    if (document.errors.length) throw new Error(`Cannot merge ${operation.path}: ${document.errors.map(error => error.message).join('; ')}`);
    current = document.toJS();
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) throw new Error(`Cannot merge ${operation.path}: document root must be a mapping`);
  const merged = mergeMappings(current, operation.fragment, operation.conflictPolicy);
  fs.writeFileSync(target, operation.format === 'json' ? `${JSON.stringify(merged, null, 2)}\n` : stringify(merged));
}

function capture(root, operations) {
  const snapshots = [];
  for (const operation of operations) {
    if (!operation.path || snapshots.some(item => item.path === operation.path)) continue;
    const segments = operation.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const parentPath = segments.slice(0, index).join('/');
      const parent = targetPath(root, parentPath);
      if (!fs.existsSync(parent) && !snapshots.some(item => item.path === parentPath)) snapshots.push({ path: parentPath, state: 'absent-directory' });
    }
    const target = targetPath(root, operation.path);
    if (!fs.existsSync(target)) snapshots.push({ path: operation.path, state: 'absent' });
    else if (fs.statSync(target).isDirectory()) snapshots.push({ path: operation.path, state: 'directory' });
    else snapshots.push({ path: operation.path, state: 'file', content: fs.readFileSync(target) });
  }
  return snapshots;
}

function rollback(root, snapshots) {
  for (const snapshot of [...snapshots].reverse()) {
    const target = targetPath(root, snapshot.path);
    if (snapshot.state === 'file') { ensureDir(path.dirname(target)); fs.writeFileSync(target, snapshot.content); }
    else if ((snapshot.state === 'absent' || snapshot.state === 'absent-directory') && fs.existsSync(target)) {
      if (fs.statSync(target).isDirectory()) fs.rmdirSync(target);
      else fs.unlinkSync(target);
    }
  }
}

function selectOperations(plan, only) {
  if (!only) return plan.operations;
  if (only === true) throw new Error('apply --only requires a comma-separated module list');
  const requested = new Set(String(only).split(',').map(item => item.trim()).filter(Boolean));
  const available = new Set(plan.operations.map(operation => operation.module));
  for (const module of requested) if (!available.has(module)) throw new Error(`Unknown apply module: ${module}`);
  return plan.operations.filter(operation => requested.has(operation.module));
}

export function executePlan({ root, plan, currentInputs, only, commit }) {
  assertPlanIntegrity(plan);
  if (!isDeepStrictEqual(plan.inputs, currentInputs)) throw new Error('Plan inputs are stale; run harness plan again');
  const operations = selectOperations(plan, only);
  const selected = new Set(operations.map(operation => operation.id));
  const pending = plan.reviews.filter(review => selected.has(review.operation) && review.status !== 'approved');
  if (pending.length) throw new Error(`Plan has ${pending.length} unapproved operation(s)`);
  validatePreconditions(root, operations);
  const snapshots = capture(root, operations);
  const recovery = path.join(root, '.harness', 'recovery', plan.id.replace(':', '-'));
  ensureDir(recovery);
  fs.writeFileSync(path.join(recovery, 'manifest.json'), `${JSON.stringify(snapshots.map(snapshot => ({ path: snapshot.path, state: snapshot.state })), null, 2)}\n`);
  for (const snapshot of snapshots.filter(item => item.state === 'file')) {
    const backup = path.join(recovery, 'files', ...snapshot.path.split('/'));
    ensureDir(path.dirname(backup));
    fs.writeFileSync(backup, snapshot.content);
  }
  try {
    for (const operation of operations) applyOperation(root, operation);
    const results = operations.map(operation => ({ id: operation.id, type: operation.type, path: operation.path ?? null, provider: operation.provider, status: 'applied' }));
    const files = {};
    for (const operation of operations.filter(item => item.path && item.type !== 'directory.ensure')) {
      const target = targetPath(root, operation.path);
      files[operation.path] = { hash: sha256(fs.readFileSync(target)), ownership: operation.ownership, provider: operation.provider, operation: operation.id };
    }
    const result = { planId: plan.id, appliedAt: new Date().toISOString(), recovery: path.relative(root, recovery).replaceAll('\\', '/'), results, files };
    if (commit) commit(result);
    return result;
  } catch (error) {
    try { rollback(root, snapshots); }
    catch (rollbackError) { throw new Error(`Apply failed: ${error.message}; rollback also failed: ${rollbackError.message}`); }
    throw new Error(`Apply failed and rolled back: ${error.message}`);
  }
}
