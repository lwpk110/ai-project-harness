import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseDocument } from 'yaml';
import { createProjectView } from './audit.js';

const operationTypes = new Set(['file.create', 'file.replace', 'structured.merge', 'directory.ensure', 'command.run', 'connector.configure']);
const ownershipModes = new Set(['managed', 'structured-merge', 'seeded']);

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isNonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function sha256(value) { return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`; }

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function deepFreeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  if (isRecord(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepFreeze(item)])));
  return value;
}

function parseYaml(source, label) {
  const document = parseDocument(source, { prettyErrors: false, uniqueKeys: true });
  if (document.errors.length) throw new Error(`${label}: ${document.errors.map(error => error.message).join('; ')}`);
  const value = document.toJS();
  if (!isRecord(value)) throw new Error(`${label}: expected a mapping at the document root`);
  return value;
}

function onlyKeys(value, allowed, label, errors) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not supported`);
}

export function normalizeOperationPath(value, label = 'operation.path') {
  if (!isNonEmptyString(value)) throw new Error(`${label} must be a non-empty project-relative path`);
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw new Error(`${label} must be project-relative`);
  const result = path.posix.normalize(normalized);
  if (result === '.' || result === '..' || result.startsWith('../')) throw new Error(`${label} escapes the project root`);
  if (['.git', '.harness'].includes(result.split('/')[0])) throw new Error(`${label} targets reserved harness state`);
  return result;
}

function validateOperation(operation, label, errors) {
  if (!isRecord(operation)) { errors.push(`${label} must be a mapping`); return; }
  if (!operationTypes.has(operation.type)) { errors.push(`${label}.type is not supported`); return; }
  const common = new Set(['type']);
  if (operation.type === 'file.create' || operation.type === 'file.replace') {
    onlyKeys(operation, new Set([...common, 'path', 'content', 'ownership']), label, errors);
    try { normalizeOperationPath(operation.path, `${label}.path`); } catch (error) { errors.push(error.message); }
    if (typeof operation.content !== 'string') errors.push(`${label}.content must be a string`);
    if (!ownershipModes.has(operation.ownership)) errors.push(`${label}.ownership is not supported`);
  } else if (operation.type === 'structured.merge') {
    onlyKeys(operation, new Set([...common, 'path', 'format', 'fragment', 'conflictPolicy', 'ownership']), label, errors);
    try { normalizeOperationPath(operation.path, `${label}.path`); } catch (error) { errors.push(error.message); }
    if (!['json', 'yaml'].includes(operation.format)) errors.push(`${label}.format must be json or yaml`);
    if (!isRecord(operation.fragment)) errors.push(`${label}.fragment must be a mapping`);
    if (!['error', 'preserve', 'replace'].includes(operation.conflictPolicy)) errors.push(`${label}.conflictPolicy must be error, preserve, or replace`);
    if (operation.ownership !== 'structured-merge') errors.push(`${label}.ownership must be structured-merge`);
  } else if (operation.type === 'directory.ensure') {
    onlyKeys(operation, new Set([...common, 'path']), label, errors);
    try { normalizeOperationPath(operation.path, `${label}.path`); } catch (error) { errors.push(error.message); }
  } else if (operation.type === 'command.run') {
    onlyKeys(operation, new Set([...common, 'grant', 'args']), label, errors);
    if (!isNonEmptyString(operation.grant)) errors.push(`${label}.grant is required`);
    if (!Array.isArray(operation.args) || operation.args.some(item => typeof item !== 'string')) errors.push(`${label}.args must be an array of strings`);
  } else {
    onlyKeys(operation, new Set([...common, 'connector', 'settings', 'secretRefs']), label, errors);
    if (!isNonEmptyString(operation.connector)) errors.push(`${label}.connector is required`);
    if (!isRecord(operation.settings)) errors.push(`${label}.settings must be a mapping`);
    if (!Array.isArray(operation.secretRefs) || operation.secretRefs.some(item => !isNonEmptyString(item))) errors.push(`${label}.secretRefs must be an array of names`);
  }
}

function validateRecipe(source, expectedId, label) {
  const recipe = parseYaml(source, label);
  const errors = [];
  onlyKeys(recipe, new Set(['apiVersion', 'kind', 'metadata', 'when', 'operations']), label, errors);
  if (recipe.apiVersion !== 'harness.dev/v1') errors.push('apiVersion must be harness.dev/v1');
  if (recipe.kind !== 'Recipe') errors.push('kind must be Recipe');
  if (!isRecord(recipe.metadata)) errors.push('metadata must be a mapping');
  else {
    onlyKeys(recipe.metadata, new Set(['id', 'module']), 'metadata', errors);
    if (recipe.metadata.id !== expectedId) errors.push(`metadata.id must be ${expectedId}`);
    if (!isNonEmptyString(recipe.metadata.module)) errors.push('metadata.module is required');
  }
  if (!isRecord(recipe.when)) errors.push('when must be a mapping');
  else {
    onlyKeys(recipe.when, new Set(['finding']), 'when', errors);
    if (!isNonEmptyString(recipe.when.finding)) errors.push('when.finding is required');
  }
  if (!Array.isArray(recipe.operations) || !recipe.operations.length) errors.push('operations must be a non-empty array');
  else recipe.operations.forEach((operation, index) => validateOperation(operation, `operations[${index}]`, errors));
  if (errors.length) throw new Error(`Invalid recipe contribution ${expectedId}: ${errors.join('; ')}`);
  return recipe;
}

function contributionFile(loaded, id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error(`Invalid contribution id: ${id}`);
  return path.join(loaded.directory, 'contributions', 'recipes', `${id}.yaml`);
}

function loadRecipes(resolved) {
  const recipes = [];
  for (const plugin of resolved.ordered) {
    const loaded = resolved.active.get(plugin);
    for (const id of loaded.manifest.contributes?.recipes ?? []) {
      const file = contributionFile(loaded, id);
      if (!fs.existsSync(file)) throw new Error(`Plugin ${plugin} declares recipes/${id} but ${path.relative(loaded.directory, file)} is missing`);
      const content = fs.readFileSync(file, 'utf8');
      recipes.push({ plugin, id, loaded, content, document: validateRecipe(content, id, file) });
    }
  }
  return recipes;
}

export function validatePlanningContributions(resolved) {
  for (const recipe of loadRecipes(resolved)) {
    for (const declaration of recipe.document.operations) {
      const operation = { ...declaration };
      if (operation.path) operation.path = normalizeOperationPath(operation.path);
      operationPermission(operation, recipe);
    }
  }
}

function packageFiles(directory, relative = '') {
  const records = [];
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === 'node_modules') continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) records.push(...packageFiles(directory, child));
    else if (entry.isFile()) records.push({ path: child.split(path.sep).join('/'), hash: sha256(fs.readFileSync(path.join(directory, child))) });
  }
  return records;
}

function pluginInputs(resolved) {
  return resolved.ordered.map(name => {
    const loaded = resolved.active.get(name);
    return { name, version: loaded.manifest.metadata.version, integrity: sha256(canonicalJson(packageFiles(loaded.directory))) };
  });
}

export function inputDigests({ root, config, resolved }) {
  const view = createProjectView(root);
  return deepFreeze({
    project: sha256(canonicalJson(view.entries)),
    config: sha256(canonicalJson(config)),
    plugins: sha256(canonicalJson(pluginInputs(resolved)))
  });
}

function pathPermissionAllows(patterns, target) {
  return patterns.some(pattern => pattern === '.' || pattern === target || (pattern.endsWith('/**') && target.startsWith(pattern.slice(0, -3))));
}

function operationPermission(operation, recipe) {
  const manifest = recipe.loaded.manifest;
  if (operation.path) {
    const allowed = manifest.permissions?.filesystem?.write ?? [];
    if (!pathPermissionAllows(allowed, operation.path)) throw new Error(`Recipe ${recipe.plugin}/${recipe.id} may not write undeclared path ${operation.path}`);
    return { kind: 'filesystem.write', value: operation.path };
  }
  if (operation.type === 'command.run') {
    if (!(manifest.permissions?.commands ?? []).includes(operation.grant)) throw new Error(`Recipe ${recipe.plugin}/${recipe.id} may not use undeclared command grant ${operation.grant}`);
    return { kind: 'command', value: operation.grant };
  }
  if (!(manifest.contributes?.connectors ?? []).includes(operation.connector)) throw new Error(`Recipe ${recipe.plugin}/${recipe.id} may not configure undeclared connector ${operation.connector}`);
  const declaredSecrets = new Set(manifest.permissions?.secrets ?? []);
  for (const secret of operation.secretRefs) if (!declaredSecrets.has(secret)) throw new Error(`Recipe ${recipe.plugin}/${recipe.id} may not reference undeclared secret ${secret}`);
  return { kind: 'connector', value: operation.connector };
}

function materializeOperation(declaration, recipe, index, view) {
  const operation = { ...declaration, id: `${recipe.plugin}/${recipe.id}/${index}`, module: recipe.document.metadata.module, provider: { plugin: recipe.plugin, contribution: recipe.id } };
  if (operation.path) operation.path = normalizeOperationPath(operation.path);
  const entry = operation.path ? view.entries.find(item => item.path === operation.path) : null;
  if (operation.type === 'file.create') {
    if (entry) throw new Error(`Recipe ${recipe.plugin}/${recipe.id} cannot create existing path ${operation.path}`);
    operation.precondition = { state: 'absent' };
  } else if (operation.type === 'file.replace' || operation.type === 'structured.merge') {
    if (entry?.type !== 'file') throw new Error(`Recipe ${recipe.plugin}/${recipe.id} requires existing file ${operation.path}`);
    operation.precondition = { state: 'file', hash: entry.hash };
  } else if (operation.type === 'directory.ensure') {
    if (entry?.type === 'file') throw new Error(`Recipe ${recipe.plugin}/${recipe.id} cannot create directory over file ${operation.path}`);
    operation.precondition = { state: entry ? 'directory' : 'absent' };
  }
  return operation;
}

function autoApproved(priority, threshold) {
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return Object.hasOwn(rank, priority) && Object.hasOwn(rank, threshold) && rank[priority] >= rank[threshold];
}

function assertNoConflicts(operations) {
  const targets = operations.filter(item => item.path);
  for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < targets.length; rightIndex += 1) {
      const left = targets[leftIndex];
      const right = targets[rightIndex];
      if (left.path === right.path) throw new Error(`Operation conflict on ${left.path}: ${left.id} and ${right.id}`);
      const [parent, child] = left.path.length < right.path.length ? [left, right] : [right, left];
      if (child.path.startsWith(`${parent.path}/`) && parent.type !== 'directory.ensure') throw new Error(`Operation conflict between ${parent.path} and ${child.path}`);
    }
  }
}

function planBody(plan) {
  const { id, ...body } = plan;
  return body;
}

export function assertPlanIntegrity(plan) {
  if (!isRecord(plan) || plan.schema !== 1 || plan.protocol !== 'harness.dev/plan/v1') throw new Error('Unsupported plan schema');
  const expected = sha256(canonicalJson(planBody(plan)));
  if (plan.id !== expected) throw new Error('Plan integrity check failed');
  return true;
}

export function buildPlan({ root, config, resolved, report }) {
  const view = createProjectView(root);
  const findings = new Map(report.findings.map(finding => [finding.id, finding]));
  const operations = [];
  const reviews = [];
  const matchedFindings = new Set();
  for (const recipe of loadRecipes(resolved)) {
    const finding = findings.get(recipe.document.when.finding);
    if (!finding) continue;
    matchedFindings.add(finding.id);
    recipe.document.operations.forEach((declaration, index) => {
      const operation = materializeOperation(declaration, recipe, index, view);
      const permission = operationPermission(operation, recipe);
      const automatic = permission.kind === 'filesystem.write' && autoApproved(finding.priority, config.integration?.auto_fix_max_priority ?? 'P3');
      operations.push(operation);
      reviews.push({ operation: operation.id, permission, status: automatic ? 'approved' : 'required', reason: automatic ? 'low-risk policy' : 'explicit approval required' });
    });
  }
  assertNoConflicts(operations);
  const body = {
    schema: 1,
    protocol: 'harness.dev/plan/v1',
    inputs: inputDigests({ root, config, resolved }),
    operations,
    reviews,
    manualFindings: report.findings.filter(finding => !matchedFindings.has(finding.id)).map(finding => finding.id),
    status: reviews.every(review => review.status === 'approved') ? 'approved' : 'review-required'
  };
  return deepFreeze({ id: sha256(canonicalJson(body)), ...body });
}
