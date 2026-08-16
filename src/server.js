import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const moduleDir = fileURLToPath(new URL('.', import.meta.url));
const defaultCliPath = path.join(moduleDir, 'cli.js');
const frontendDir = path.join(moduleDir, '..', 'web');
const maxBodyBytes = 16 * 1024;
const defaultCliTimeoutMs = 30 * 1000;
const assets = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }]
]);
const apiMethods = new Map([
  ['/api/health', ['GET']],
  ['/api/dashboard', ['GET']],
  ['/api/audit', ['GET']],
  ['/api/plan', ['GET', 'POST']],
  ['/api/apply', ['POST']]
]);

function json(response, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders
  });
  response.end(body);
}

function text(response, status, value, type) {
  response.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(value) });
  response.end(value);
}

function methodNotAllowed(response, allowed) {
  return json(response, 405, { error: { code: 'method_not_allowed', message: `Method not allowed. Allowed methods: ${allowed.join(', ')}` } }, { allow: allowed.join(', ') });
}

function readText(file) { return fs.readFileSync(file, 'utf8'); }
function stateFile(root) { return path.join(root, '.harness', 'state.json'); }

function readState(root) {
  const file = stateFile(root);
  if (!fs.existsSync(file)) return { files: {}, audit: null, plan: null };
  return JSON.parse(readText(file));
}

function projectSummary(root) {
  const configFile = path.join(root, 'harness.yaml');
  if (!fs.existsSync(configFile)) throw new Error('harness.yaml not found. Run harness init first.');
  const document = parseDocument(readText(configFile), { prettyErrors: false, uniqueKeys: true });
  if (document.errors.length) throw new Error(`Invalid harness.yaml: ${document.errors.map(error => error.message).join('; ')}`);
  const config = document.toJS() ?? {};
  return {
    name: path.basename(path.resolve(root)),
    mode: config.project?.mode ?? 'unknown',
    preset: config.project?.preset ?? 'minimal',
    agents: Array.isArray(config.project?.agents) ? [...config.project.agents] : [],
    policy: config.integration?.policy ?? 'unknown',
    autoFixMaxPriority: config.integration?.auto_fix_max_priority ?? null,
    verifyConfigured: typeof config.commands?.verify === 'string' && config.commands.verify.length > 0,
    enabledPlugins: Object.entries(config.plugins ?? {}).filter(([, entry]) => entry === true || entry?.enabled === true).map(([name]) => name).sort()
  };
}

function cliError(message, statusCode, code = 'cli_failed') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function safeCliFailureMessage(child) {
  const stderr = String(child.stderr ?? '');
  const harnessLine = stderr.split(/\r?\n/).map(line => line.trim()).find(line => /^harness:\s*/i.test(line));
  if (harnessLine) return harnessLine.replace(/^harness:\s*/i, '').slice(0, 1024);
  return `CLI command failed with exit status ${child.status ?? 'unknown'}`;
}

function cliFailureStatus(child) {
  const output = `${child.stderr ?? ''}\n${child.stdout ?? ''}`;
  return /stale|review|approved|conflict|does not match|requires an execution broker/i.test(output) ? 409 : 422;
}

function runCli(root, cliPath, args, timeoutMs = defaultCliTimeoutMs) {
  const child = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
    timeout: timeoutMs,
    killSignal: 'SIGTERM'
  });
  if (child.error) {
    if (child.error.code === 'ETIMEDOUT') throw cliError(`CLI command timed out after ${timeoutMs} ms`, 504, 'cli_timeout');
    throw cliError('Unable to start CLI command', 502, 'cli_start_failed');
  }
  if (child.status !== 0) {
    const error = cliError(safeCliFailureMessage(child), cliFailureStatus(child));
    error.cliStatus = child.status;
    throw error;
  }
  return child.stdout.trim();
}

function audit(root, cliPath, timeoutMs) { return JSON.parse(runCli(root, cliPath, ['audit', '--format', 'json'], timeoutMs)); }
function plan(root, cliPath, timeoutMs) { return JSON.parse(runCli(root, cliPath, ['plan'], timeoutMs)); }

function publicPlan(planRecord) {
  if (!planRecord) return null;
  return {
    id: planRecord.id,
    status: planRecord.status,
    manualFindings: planRecord.manualFindings ?? [],
    operations: (planRecord.operations ?? []).map(operation => ({
      id: operation.id,
      module: operation.module,
      type: operation.type,
      path: operation.path ?? null,
      ownership: operation.ownership ?? null,
      provider: operation.provider,
      precondition: operation.precondition ?? null
    })),
    reviews: (planRecord.reviews ?? []).map(review => ({
      operation: review.operation,
      permission: review.permission,
      status: review.status,
      reason: review.reason
    }))
  };
}

function publicApplied(applied) {
  if (!applied) return null;
  return {
    planId: applied.planId,
    appliedAt: applied.appliedAt,
    recovery: applied.recovery,
    results: applied.results,
    files: Object.fromEntries(Object.entries(applied.files ?? {}).map(([file, value]) => [file, {
      hash: value.hash,
      ownership: value.ownership,
      provider: value.provider
    }]))
  };
}

function errorStatus(error) {
  if (error.statusCode) return error.statusCode;
  if (error.cliStatus === 1 && /stale|review|approved|conflict|does not match|requires an execution broker/i.test(error.message)) return 409;
  if (error.cliStatus === 1) return 422;
  return 500;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers['content-length']);
    let settled = false;
    const chunks = [];
    let size = 0;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      handler(value);
    };
    const rejectTooLarge = () => {
      // Stop buffering immediately, then drain the socket so the 413 response can be delivered.
      request.pause();
      request.resume();
      finish(reject, cliError('Request body is too large', 413, 'payload_too_large'));
    };
    const onData = chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBodyBytes) return rejectTooLarge();
      chunks.push(chunk);
    };
    const onEnd = () => finish(resolve, Buffer.concat(chunks).toString('utf8'));
    const onError = error => finish(reject, error);
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    if (Number.isSafeInteger(declaredLength) && declaredLength > maxBodyBytes) rejectTooLarge();
  });
}

function requestError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isJsonContentType(contentType) {
  return typeof contentType === 'string'
    && /^application\/json(?:\s*;\s*charset\s*=\s*(?:"[^"]*"|[^;\s]+))?$/i.test(contentType.trim());
}

function parseApplyBody(raw, contentType) {
  if (raw.length === 0) return {};
  if (!isJsonContentType(contentType)) throw requestError('Content-Type must be application/json for a non-empty request body', 415, 'unsupported_media_type');
  let value;
  try { value = JSON.parse(raw); } catch { throw requestError('Request body must be valid JSON', 400, 'invalid_json'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw requestError('Request body must be a JSON object', 400, 'invalid_request_body');
  const unknownFields = Object.keys(value).filter(key => key !== 'modules');
  if (unknownFields.length) throw requestError(`Unsupported request field(s): ${unknownFields.join(', ')}`, 400, 'unknown_request_field');
  if (value.modules !== undefined && (!Array.isArray(value.modules) || value.modules.length === 0 || value.modules.some(item => typeof item !== 'string' || !item.trim()))) throw requestError('modules must be a non-empty array of non-empty strings', 400, 'invalid_modules');
  return value;
}

function isLoopbackAddress(address) {
  const value = String(address ?? '').toLowerCase();
  if (value === '::1' || value === '[::1]') return true;
  if (value.startsWith('::ffff:')) return isLoopbackAddress(value.slice('::ffff:'.length));
  const octets = value.split('.').map(Number);
  return octets.length === 4 && octets.every(Number.isInteger) && octets[0] === 127 && octets.slice(1).every(octet => octet >= 0 && octet <= 255);
}

function assertLocalOrigin(request) {
  if (!isLoopbackAddress(request.socket.localAddress)) throw cliError('HTTP server must receive requests on a loopback interface', 403, 'forbidden_origin');
  const origin = request.headers.origin;
  if (origin === undefined) return;
  let originUrl;
  let hostUrl;
  try {
    originUrl = new URL(origin);
    hostUrl = new URL(`${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`);
  } catch {
    throw cliError('Request Origin must match the local server origin', 403, 'forbidden_origin');
  }
  if (!['http:', 'https:'].includes(originUrl.protocol) || !isLoopbackAddress(originUrl.hostname) && originUrl.hostname !== 'localhost' || originUrl.origin !== hostUrl.origin) {
    throw cliError('Request Origin must match the local server origin', 403, 'forbidden_origin');
  }
}

function routeApi(request, response, root, cliPath, pathname, cliTimeoutMs) {
  const allowed = apiMethods.get(pathname);
  if (allowed && !allowed.includes(request.method)) return methodNotAllowed(response, allowed);
  if (request.method === 'POST') assertLocalOrigin(request);
  if (request.method === 'GET' && pathname === '/api/health') {
    return json(response, 200, { status: 'ok', service: 'ai-project-harness', protocol: 'harness.dev/http/v1' });
  }
  if (request.method === 'GET' && pathname === '/api/dashboard') {
    const report = audit(root, cliPath, cliTimeoutMs);
    const state = readState(root);
    return json(response, 200, { project: projectSummary(root), audit: report, plan: publicPlan(state.plan), applied: publicApplied(state.applied) });
  }
  if (request.method === 'GET' && pathname === '/api/audit') return json(response, 200, audit(root, cliPath, cliTimeoutMs));
  if (request.method === 'GET' && pathname === '/api/plan') return json(response, 200, publicPlan(readState(root).plan));
  if (request.method === 'POST' && pathname === '/api/plan') return json(response, 200, publicPlan(plan(root, cliPath, cliTimeoutMs)));
  if (request.method === 'POST' && pathname === '/api/apply') {
    return readBody(request).then(raw => {
      const body = parseApplyBody(raw, request.headers['content-type']);
      const args = ['apply'];
      if (body.modules?.length) args.push('--only', body.modules.join(','));
      runCli(root, cliPath, args, cliTimeoutMs);
      const state = readState(root);
      return json(response, 200, publicApplied(state.applied));
    });
  }
  return json(response, 404, { error: { code: 'not_found', message: 'API route not found' } });
}

export function createHarnessServer({ root = process.cwd(), cliPath = defaultCliPath, cliTimeoutMs = defaultCliTimeoutMs } = {}) {
  if (!Number.isInteger(cliTimeoutMs) || cliTimeoutMs <= 0) throw new Error('cliTimeoutMs must be a positive integer');
  return http.createServer((request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    } catch {
      return json(response, 400, { error: { code: 'invalid_request_target', message: 'Request target must be a valid URL path' } });
    }
    const handle = async () => {
      try {
        if (pathname.startsWith('/api/')) return await routeApi(request, response, root, cliPath, pathname, cliTimeoutMs);
        if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
        const asset = assets.get(pathname);
        if (!asset) return text(response, 404, 'Not found\n', 'text/plain; charset=utf-8');
        return text(response, 200, readText(path.join(frontendDir, asset.file)), asset.type);
      } catch (error) {
        return json(response, errorStatus(error), { error: { code: error.code ?? 'request_failed', message: error.message } });
      }
    };
    handle().catch(error => json(response, 500, { error: { code: 'internal_error', message: error.message } }));
  });
}

export function startServer({ root = process.cwd(), port = 3210, cliPath = defaultCliPath, cliTimeoutMs = defaultCliTimeoutMs } = {}) {
  const server = createHarnessServer({ root, cliPath, cliTimeoutMs });
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    console.log(`Harness web server: http://127.0.0.1:${address.port}`);
  });
  return server;
}
