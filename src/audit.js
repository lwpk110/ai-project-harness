import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

const excludedDirectories = new Set(['.git', '.harness', 'node_modules', 'plugins']);
const contributionKinds = new Set(['Detector', 'Rule']);

function freezeArray(items) {
  return Object.freeze(items.map(item => Object.freeze(item)));
}

function freezeValue(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freezeValue(item);
    return Object.freeze(value);
  }
  return value;
}

function normalizeProjectPath(file) {
  return file.split(path.sep).join('/');
}

function collectEntries(root, relative = '') {
  const directory = path.join(root, relative);
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    entries.push({ path: normalizeProjectPath(child), type: entry.isDirectory() ? 'directory' : 'file' });
    if (entry.isDirectory()) entries.push(...collectEntries(root, child));
  }
  return entries;
}

export function createProjectView(root) {
  const entries = collectEntries(root).sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({ root, entries: freezeArray(entries) });
}

function existingPaths(view) {
  return new Set(view.entries.map(entry => entry.path));
}

function selectFact(view, selector, label) {
  if (selector.type === 'first-existing') {
    const existing = existingPaths(view);
    for (const candidate of selector.candidates) {
      if (existing.has(candidate.path)) return { value: candidate.value, evidence: [{ path: candidate.path }] };
    }
    return { value: selector.default, evidence: [] };
  }
  if (selector.type === 'all-existing') {
    const existing = existingPaths(view);
    const matches = selector.paths.filter(item => existing.has(item));
    return { value: matches, evidence: matches.map(path => ({ path })) };
  }
  if (selector.type === 'any-path') {
    const existing = existingPaths(view);
    const matches = selector.paths.filter(item => existing.has(item));
    return { value: matches.length > 0, evidence: matches.map(path => ({ path })) };
  }
  if (selector.type === 'path-contains') {
    const matches = view.entries
      .filter(entry => selector.types.includes(entry.type) && selector.terms.some(term => entry.path.toLowerCase().includes(term.toLowerCase())))
      .map(entry => entry.path);
    return { value: matches.length > 0, evidence: matches.map(path => ({ path })) };
  }
  throw new Error(`${label}: unsupported selector type ${selector.type}`);
}

function parseYaml(source, label) {
  const document = parseDocument(source, { prettyErrors: false, uniqueKeys: true });
  if (document.errors.length) throw new Error(`${label}: ${document.errors.map(error => error.message).join('; ')}`);
  const value = document.toJS();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected a mapping at the document root`);
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function onlyKeys(value, allowed, label, errors) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not supported`);
}

function validateStringArray(value, label, errors) {
  if (!Array.isArray(value) || value.some(item => !isNonEmptyString(item))) errors.push(`${label} must be an array of non-empty strings`);
}

function validateSelector(value, label, errors) {
  if (!isRecord(value)) { errors.push(`${label} must be a mapping`); return; }
  if (!isNonEmptyString(value.type)) { errors.push(`${label}.type is required`); return; }
  if (value.type === 'first-existing') {
    onlyKeys(value, new Set(['type', 'candidates', 'default']), label, errors);
    if (!Array.isArray(value.candidates) || !value.candidates.length) errors.push(`${label}.candidates must be a non-empty array`);
    else for (const [index, candidate] of value.candidates.entries()) {
      if (!isRecord(candidate) || !isNonEmptyString(candidate.path) || !Object.hasOwn(candidate, 'value')) errors.push(`${label}.candidates[${index}] requires path and value`);
    }
    if (!Object.hasOwn(value, 'default')) errors.push(`${label}.default is required`);
  } else if (value.type === 'all-existing' || value.type === 'any-path') {
    onlyKeys(value, new Set(['type', 'paths']), label, errors);
    validateStringArray(value.paths, `${label}.paths`, errors);
  } else if (value.type === 'path-contains') {
    onlyKeys(value, new Set(['type', 'terms', 'types']), label, errors);
    validateStringArray(value.terms, `${label}.terms`, errors);
    validateStringArray(value.types, `${label}.types`, errors);
    if (Array.isArray(value.types) && value.types.some(item => !['file', 'directory'].includes(item))) errors.push(`${label}.types may only contain file or directory`);
  } else errors.push(`${label}.type is not supported`);
}

function validateContribution(source, expectedKind, expectedId, label) {
  const document = parseYaml(source, label);
  const errors = [];
  onlyKeys(document, new Set(['apiVersion', 'kind', 'metadata', 'facts', 'when', 'finding']), label, errors);
  if (document.apiVersion !== 'harness.dev/v1') errors.push('apiVersion must be harness.dev/v1');
  if (!contributionKinds.has(document.kind) || document.kind !== expectedKind) errors.push(`kind must be ${expectedKind}`);
  if (!isRecord(document.metadata)) errors.push('metadata must be a mapping');
  else {
    onlyKeys(document.metadata, new Set(['id']), 'metadata', errors);
    if (document.metadata.id !== expectedId) errors.push(`metadata.id must be ${expectedId}`);
  }
  if (expectedKind === 'Detector') {
    if (!Array.isArray(document.facts) || !document.facts.length) errors.push('facts must be a non-empty array');
    else for (const [index, fact] of document.facts.entries()) {
      const factLabel = `facts[${index}]`;
      if (!isRecord(fact)) { errors.push(`${factLabel} must be a mapping`); continue; }
      onlyKeys(fact, new Set(['id', 'select']), factLabel, errors);
      if (!isNonEmptyString(fact.id) || !fact.id.includes('.')) errors.push(`${factLabel}.id must be a namespaced string`);
      validateSelector(fact.select, `${factLabel}.select`, errors);
    }
  } else {
    if (!isRecord(document.when)) errors.push('when must be a mapping');
    else {
      onlyKeys(document.when, new Set(['fact', 'equals']), 'when', errors);
      if (!isNonEmptyString(document.when.fact)) errors.push('when.fact is required');
      if (!Object.hasOwn(document.when, 'equals')) errors.push('when.equals is required');
    }
    if (!isRecord(document.finding)) errors.push('finding must be a mapping');
    else {
      onlyKeys(document.finding, new Set(['id', 'priority', 'title', 'action']), 'finding', errors);
      if (!isNonEmptyString(document.finding.id) || !document.finding.id.includes('.')) errors.push('finding.id must be a namespaced string');
      if (!['P1', 'P2', 'P3'].includes(document.finding.priority)) errors.push('finding.priority must be P1, P2, or P3');
      if (!isNonEmptyString(document.finding.title)) errors.push('finding.title is required');
      if (!isNonEmptyString(document.finding.action)) errors.push('finding.action is required');
    }
  }
  if (errors.length) throw new Error(`Invalid ${expectedKind.toLowerCase()} contribution ${expectedId}: ${errors.join('; ')}`);
  return document;
}

function contributionFile(loaded, directory, id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error(`Invalid contribution id: ${id}`);
  return path.join(loaded.directory, 'contributions', directory, `${id}.yaml`);
}

function loadContributions(resolved, manifestKey, kind, directory) {
  const contributions = [];
  for (const plugin of resolved.ordered) {
    const loaded = resolved.active.get(plugin);
    for (const id of loaded.manifest.contributes?.[manifestKey] ?? []) {
      const file = contributionFile(loaded, directory, id);
      if (!fs.existsSync(file)) throw new Error(`Plugin ${plugin} declares ${manifestKey}/${id} but ${path.relative(loaded.directory, file)} is missing`);
      contributions.push({ plugin, id, document: validateContribution(fs.readFileSync(file, 'utf8'), kind, id, file) });
    }
  }
  return contributions;
}

export function validateAuditContributions(resolved) {
  loadContributions(resolved, 'detectors', 'Detector', 'detectors');
  loadContributions(resolved, 'rules', 'Rule', 'rules');
}

export function runAudit({ root, resolved }) {
  const view = createProjectView(root);
  const detectors = loadContributions(resolved, 'detectors', 'Detector', 'detectors');
  const rules = loadContributions(resolved, 'rules', 'Rule', 'rules');
  const facts = [];
  const factMap = new Map();
  for (const detector of detectors) {
    for (const declaration of detector.document.facts) {
      if (factMap.has(declaration.id)) throw new Error(`Fact ${declaration.id} is provided by both ${factMap.get(declaration.id).provider.plugin} and ${detector.plugin}`);
      const selected = selectFact(view, declaration.select, `${detector.plugin}/${detector.id}/${declaration.id}`);
      const fact = Object.freeze({ id: declaration.id, value: freezeValue(selected.value), evidence: freezeArray(selected.evidence), provider: Object.freeze({ plugin: detector.plugin, contribution: detector.id }) });
      factMap.set(fact.id, fact);
      facts.push(fact);
    }
  }
  const findings = [];
  const findingIds = new Set();
  for (const rule of rules) {
    const fact = factMap.get(rule.document.when.fact);
    if (!fact) throw new Error(`Rule ${rule.plugin}/${rule.id} references unknown fact ${rule.document.when.fact}`);
    if (JSON.stringify(fact.value) !== JSON.stringify(rule.document.when.equals)) continue;
    const finding = rule.document.finding;
    if (findingIds.has(finding.id)) throw new Error(`Finding ${finding.id} is provided more than once`);
    findingIds.add(finding.id);
    findings.push(Object.freeze({ ...finding, facts: Object.freeze([fact.id]), evidence: fact.evidence, provider: Object.freeze({ plugin: rule.plugin, contribution: rule.id }) }));
  }
  return Object.freeze({ generatedAt: new Date().toISOString(), root, facts: freezeArray(facts), findings: freezeArray(findings), plugins: Object.freeze([...resolved.ordered]) });
}
