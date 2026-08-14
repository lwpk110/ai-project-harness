import { parseDocument, stringify } from 'yaml';

const manifestKeys = new Set(['apiVersion', 'kind', 'metadata', 'compatibility', 'dependencies', 'contributes', 'runtime', 'permissions']);
const metadataKeys = new Set(['name', 'version', 'description']);
const compatibilityKeys = new Set(['harness']);
const dependencyKeys = new Set(['plugins']);
const contributionKeys = new Set(['standards', 'workflows', 'skills', 'connectors', 'detectors', 'rules', 'recipes', 'verifiers', 'adapters']);
const runtimeKeys = new Set(['mode', 'entry']);
const permissionKeys = new Set(['filesystem', 'network', 'secrets', 'commands']);
const filesystemKeys = new Set(['read', 'write']);
const networkKeys = new Set(['hosts']);

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isNonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }

function parseYaml(source, label) {
  const document = parseDocument(source, { prettyErrors: false, uniqueKeys: true });
  if (document.errors.length) throw new Error(`${label}: ${document.errors.map(error => error.message).join('; ')}`);
  const value = document.toJS();
  if (!isRecord(value)) throw new Error(`${label}: expected a mapping at the document root`);
  return value;
}

function rejectUnknownKeys(value, allowed, label, errors) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not supported`);
}

function validateStringArray(value, label, errors) {
  if (!Array.isArray(value) || value.some(item => !isNonEmptyString(item))) errors.push(`${label} must be an array of non-empty strings`);
  else if (new Set(value).size !== value.length) errors.push(`${label} must not contain duplicate ids`);
}

function validateMapping(value, label, errors) {
  if (!isRecord(value)) { errors.push(`${label} must be a mapping`); return false; }
  return true;
}

export function parseProjectConfig(source, label = 'harness.yaml') {
  const config = parseYaml(source, label);
  const errors = [];
  for (const section of ['project', 'integration', 'commands', 'policies']) {
    if (config[section] !== undefined && !validateMapping(config[section], section, errors)) continue;
  }
  if (config.plugins !== undefined && !validateMapping(config.plugins, 'plugins', errors)) {
    throw new Error(`${label}: ${errors.join('; ')}`);
  }
  for (const [name, entry] of Object.entries(config.plugins ?? {})) {
    if (!isNonEmptyString(name)) errors.push('plugins contains an empty name');
    if (typeof entry !== 'boolean' && !isRecord(entry)) errors.push(`plugins.${name} must be a boolean or mapping`);
  }
  if (errors.length) throw new Error(`${label}: ${errors.join('; ')}`);
  return {
    ...config,
    plugins: config.plugins ?? {},
    project: config.project ?? {},
    integration: config.integration ?? {},
    commands: config.commands ?? {},
    policies: config.policies ?? {}
  };
}

export function stringifyProjectConfig(config) {
  const plugins = {};
  for (const [name, entry] of Object.entries(config.plugins ?? {})) {
    plugins[name] = isRecord(entry) && Object.keys(entry).length === 1 && typeof entry.enabled === 'boolean' ? entry.enabled : entry;
  }
  return stringify({
    ...config,
    schema: config.schema ?? 1,
    project: config.project ?? {},
    integration: config.integration ?? {},
    plugins,
    commands: config.commands ?? {},
    policies: config.policies ?? {}
  });
}

export function parsePluginManifest(source, expectedName, label = 'harness-plugin.yaml') {
  const manifest = parseYaml(source, label);
  const errors = [];
  rejectUnknownKeys(manifest, manifestKeys, 'manifest', errors);
  if (manifest.apiVersion !== 'harness.dev/v1') errors.push('apiVersion must be harness.dev/v1');
  if (manifest.kind !== 'Plugin') errors.push('kind must be Plugin');

  if (validateMapping(manifest.metadata, 'metadata', errors)) {
    rejectUnknownKeys(manifest.metadata, metadataKeys, 'metadata', errors);
    if (!isNonEmptyString(manifest.metadata.name)) errors.push('metadata.name is required');
    else if (expectedName && manifest.metadata.name !== expectedName) errors.push(`metadata.name must be ${expectedName}`);
    if (!isNonEmptyString(manifest.metadata.version)) errors.push('metadata.version is required');
    if (manifest.metadata.description !== undefined && !isNonEmptyString(manifest.metadata.description)) errors.push('metadata.description must be a non-empty string');
  }

  if (manifest.compatibility !== undefined && validateMapping(manifest.compatibility, 'compatibility', errors)) {
    rejectUnknownKeys(manifest.compatibility, compatibilityKeys, 'compatibility', errors);
    if (manifest.compatibility.harness !== undefined && !isNonEmptyString(manifest.compatibility.harness)) errors.push('compatibility.harness must be a non-empty string');
  }

  if (manifest.dependencies !== undefined && validateMapping(manifest.dependencies, 'dependencies', errors)) {
    rejectUnknownKeys(manifest.dependencies, dependencyKeys, 'dependencies', errors);
    if (manifest.dependencies.plugins !== undefined && validateMapping(manifest.dependencies.plugins, 'dependencies.plugins', errors)) {
      for (const [name, range] of Object.entries(manifest.dependencies.plugins)) if (!isNonEmptyString(name) || !isNonEmptyString(range)) errors.push('dependencies.plugins must map plugin names to non-empty version ranges');
    }
  }

  if (manifest.contributes !== undefined && validateMapping(manifest.contributes, 'contributes', errors)) {
    rejectUnknownKeys(manifest.contributes, contributionKeys, 'contributes', errors);
    for (const [kind, values] of Object.entries(manifest.contributes)) validateStringArray(values, `contributes.${kind}`, errors);
  }

  if (manifest.runtime !== undefined && validateMapping(manifest.runtime, 'runtime', errors)) {
    rejectUnknownKeys(manifest.runtime, runtimeKeys, 'runtime', errors);
    const mode = manifest.runtime.mode ?? 'declarative';
    if (!['declarative', 'bundled', 'hosted'].includes(mode)) errors.push('runtime.mode must be declarative, bundled, or hosted');
    if (manifest.runtime.entry !== undefined && !isNonEmptyString(manifest.runtime.entry)) errors.push('runtime.entry must be a non-empty string');
    if (mode !== 'declarative' && !isNonEmptyString(manifest.runtime.entry)) errors.push(`runtime.entry is required for ${mode} plugins`);
  }

  if (manifest.permissions !== undefined && validateMapping(manifest.permissions, 'permissions', errors)) {
    rejectUnknownKeys(manifest.permissions, permissionKeys, 'permissions', errors);
    if (manifest.permissions.filesystem !== undefined && validateMapping(manifest.permissions.filesystem, 'permissions.filesystem', errors)) {
      rejectUnknownKeys(manifest.permissions.filesystem, filesystemKeys, 'permissions.filesystem', errors);
      for (const [kind, values] of Object.entries(manifest.permissions.filesystem)) validateStringArray(values, `permissions.filesystem.${kind}`, errors);
    }
    if (manifest.permissions.network !== undefined && validateMapping(manifest.permissions.network, 'permissions.network', errors)) {
      rejectUnknownKeys(manifest.permissions.network, networkKeys, 'permissions.network', errors);
      if (manifest.permissions.network.hosts !== undefined) validateStringArray(manifest.permissions.network.hosts, 'permissions.network.hosts', errors);
    }
    if (manifest.permissions.secrets !== undefined) validateStringArray(manifest.permissions.secrets, 'permissions.secrets', errors);
    if (manifest.permissions.commands !== undefined) validateStringArray(manifest.permissions.commands, 'permissions.commands', errors);
  }

  if (errors.length) throw new Error(`Invalid plugin ${expectedName ?? manifest.metadata?.name ?? '<unknown>'}: ${errors.join('; ')}`);
  return manifest;
}
