import fs from 'node:fs';
import path from 'node:path';

export function discoverBundledPlugins(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, 'harness-plugin.yaml')))
    .map(entry => entry.name)
    .sort();
}
