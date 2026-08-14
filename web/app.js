const elements = {
  connection: document.querySelector('#connection-status'),
  projectName: document.querySelector('#project-name'),
  projectMeta: document.querySelector('#project-meta'),
  message: document.querySelector('#message'),
  findingCount: document.querySelector('#finding-count'),
  findingSubtitle: document.querySelector('#finding-subtitle'),
  planStatus: document.querySelector('#plan-status'),
  planSubtitle: document.querySelector('#plan-subtitle'),
  pluginCount: document.querySelector('#plugin-count'),
  applyStatus: document.querySelector('#apply-status'),
  applySubtitle: document.querySelector('#apply-subtitle'),
  auditTime: document.querySelector('#audit-time'),
  planId: document.querySelector('#plan-id'),
  findings: document.querySelector('#findings'),
  operations: document.querySelector('#operations'),
  refreshButton: document.querySelector('[data-action="refresh"]'),
  planButton: document.querySelector('[data-action="plan"]'),
  applyButton: document.querySelector('[data-action="apply"]')
};

let dashboard;
let connected = false;
let refreshInFlight = false;
let planInFlight = false;
let applyInFlight = false;
let refreshPromise;

function showMessage(message, kind = 'info') {
  elements.message.hidden = !message;
  elements.message.textContent = message;
  elements.message.dataset.kind = kind;
  elements.message.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  elements.message.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function setConnectionState(isConnected) {
  connected = isConnected;
  elements.connection.className = `status-dot status-dot--${isConnected ? 'ok' : 'error'}`;
  elements.connection.textContent = isConnected ? 'Connected' : 'Unavailable';
}

function markTransportFailure(error) {
  if (error?.name === 'TypeError') setConnectionState(false);
}

function updateActionState() {
  const plan = dashboard?.plan;
  const planCanApply = connected
    && plan?.status === 'approved'
    && Array.isArray(plan.operations)
    && plan.operations.length > 0
    && plan.id !== dashboard?.applied?.planId;
  const mutationInFlight = planInFlight || applyInFlight;

  elements.refreshButton.disabled = refreshInFlight || mutationInFlight;
  elements.refreshButton.setAttribute('aria-busy', String(refreshInFlight));
  elements.planButton.disabled = !connected || refreshInFlight || mutationInFlight;
  elements.planButton.setAttribute('aria-busy', String(planInFlight));
  elements.applyButton.disabled = !planCanApply || refreshInFlight || mutationInFlight;
  elements.applyButton.setAttribute('aria-busy', String(applyInFlight));
}

function appendDetail(container, label, value, { code = false } = {}) {
  const row = node('div', 'detail-row');
  row.append(node('dt', 'detail-label', label));
  const detail = node('dd', 'detail-value');
  detail.append(code ? node('code', null, value) : document.createTextNode(value));
  row.append(detail);
  container.append(row);
}

function formatValue(value, fallback = 'Not declared') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'object') return String(value);
  return Object.entries(value).map(([key, item]) => `${key}: ${typeof item === 'object' ? JSON.stringify(item) : item}`).join(' | ');
}

function renderEvidence(finding, item) {
  const facts = Array.isArray(finding.facts) ? finding.facts : [];
  const evidence = Array.isArray(finding.evidence) ? finding.evidence : [];
  if (facts.length) {
    const factList = node('ul', 'fact-list');
    for (const fact of facts) factList.append(node('li', null, fact));
    const factsBlock = node('div', 'evidence-block');
    factsBlock.append(node('span', 'detail-label', 'Facts'));
    factsBlock.append(factList);
    item.append(factsBlock);
  }
  if (evidence.length) {
    const evidenceList = node('ul', 'evidence-list');
    for (const entry of evidence) {
      const evidenceItem = node('li', 'evidence-item');
      evidenceItem.append(node('code', 'evidence-path', entry.path ?? 'unknown path'));
      evidenceItem.append(node('span', 'evidence-hash', entry.hash ?? 'hash unavailable'));
      evidenceList.append(evidenceItem);
    }
    const evidenceBlock = node('div', 'evidence-block');
    evidenceBlock.append(node('span', 'detail-label', 'Evidence'));
    evidenceBlock.append(evidenceList);
    item.append(evidenceBlock);
  }
}

function renderFindings(findings) {
  elements.findings.replaceChildren();
  if (!findings.length) {
    elements.findings.append(node('p', 'empty', 'No findings. The project baseline is clear.'));
    return;
  }
  for (const finding of findings) {
    const item = node('div', 'finding');
    const header = node('div', 'finding-header');
    header.append(node('span', `priority priority--${finding.priority.toLowerCase()}`, finding.priority));
    header.append(node('strong', null, finding.title));
    item.append(header);
    item.append(node('p', 'finding-action', finding.action));
    const provenance = finding.provider ? `${finding.provider.plugin} / ${finding.provider.contribution}` : 'unknown provider';
    item.append(node('span', 'provenance', provenance));
    renderEvidence(finding, item);
    elements.findings.append(item);
  }
}

function renderOperations(plan) {
  elements.operations.replaceChildren();
  elements.planId.textContent = plan?.id ?? '';
  if (!plan?.operations?.length) {
    elements.operations.append(node('p', 'empty', plan ? 'No operations proposed.' : 'Generate a plan to inspect operations.'));
    return;
  }
  const reviews = Array.isArray(plan.reviews) ? plan.reviews : [];
  for (const operation of plan.operations) {
    const review = reviews.find(item => item.operation === operation.id);
    const item = node('div', 'operation');
    const header = node('div', 'operation-header');
    header.append(node('strong', null, operation.type));
    header.append(node('span', `review review--${review?.status === 'approved' ? 'approved' : 'required'}`, review?.status === 'approved' ? 'Approved' : 'Review required'));
    item.append(header);
    item.append(node('code', 'operation-path', operation.path ?? operation.module));
    item.append(node('span', 'provenance', `${operation.module} | ${operation.provider?.plugin ?? 'unknown provider'}`));
    const details = node('dl', 'detail-list operation-details');
    appendDetail(details, 'Ownership', formatValue(operation.ownership));
    appendDetail(details, 'Precondition', formatValue(operation.precondition), { code: true });
    appendDetail(details, 'Permission kind', formatValue(review?.permission?.kind));
    appendDetail(details, 'Permission value', formatValue(review?.permission?.value));
    appendDetail(details, 'Review reason', formatValue(review?.reason, 'No review record'));
    item.append(details);
    elements.operations.append(item);
  }
}

function render(data) {
  dashboard = data;
  const { project, audit, plan, applied } = data;
  setConnectionState(true);
  elements.projectName.textContent = project.name;
  elements.projectMeta.textContent = `${project.mode} project | ${project.policy} | auto-fix through ${project.autoFixMaxPriority ?? 'manual review'}`;
  const findings = Array.isArray(audit.findings) ? audit.findings : [];
  const operations = Array.isArray(plan?.operations) ? plan.operations : [];
  elements.findingCount.textContent = String(findings.length);
  elements.findingSubtitle.textContent = findings.length ? 'Items needing attention' : 'Baseline is clear';
  elements.planStatus.textContent = plan?.status ?? 'None';
  elements.planSubtitle.textContent = plan ? `${operations.length} operation${operations.length === 1 ? '' : 's'}` : 'Generate a plan to continue';
  elements.pluginCount.textContent = String(project.enabledPlugins?.length ?? 0);
  elements.applyStatus.textContent = applied ? 'Applied' : 'Not yet';
  elements.applySubtitle.textContent = applied ? new Date(applied.appliedAt).toLocaleString() : 'No changes applied';
  elements.auditTime.textContent = audit.generatedAt ? new Date(audit.generatedAt).toLocaleTimeString() : '';
  renderFindings(findings);
  renderOperations(plan);
  updateActionState();
}

async function request(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { accept: 'application/json', ...(options?.headers ?? {}) }
  });
  const raw = await response.text();
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  if (!response.ok) {
    const error = new Error(body.error?.message ?? `Request failed (${response.status})`);
    error.code = body.error?.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshInFlight = true;
  updateActionState();
  showMessage('Refreshing workspace...', 'info');
  refreshPromise = (async () => {
    try {
      render(await request('/api/dashboard'));
      showMessage('Workspace refreshed.', 'success');
      return true;
    } catch (error) {
      setConnectionState(false);
      showMessage(error.message, 'error');
      return false;
    } finally {
      refreshInFlight = false;
      refreshPromise = undefined;
      updateActionState();
    }
  })();
  return refreshPromise;
}

async function generatePlan() {
  if (!connected || planInFlight || applyInFlight || refreshInFlight) return;
  planInFlight = true;
  updateActionState();
  elements.planButton.disabled = true;
  showMessage('Generating a deterministic plan...', 'info');
  try {
    await request('/api/plan', { method: 'POST' });
    if (await refresh()) showMessage('Plan generated. Review each operation before applying.', 'success');
  } catch (error) {
    markTransportFailure(error);
    showMessage(error.message, 'error');
  }
  finally {
    planInFlight = false;
    updateActionState();
  }
}

async function applyPlan() {
  if (!connected || planInFlight || applyInFlight || refreshInFlight) return;
  const plan = dashboard?.plan;
  if (!plan || plan.status !== 'approved' || !plan.operations?.length || dashboard.applied?.planId === plan.id) return;
  applyInFlight = true;
  updateActionState();
  elements.applyButton.disabled = true;
  showMessage('Applying approved operations and running verification...', 'info');
  try {
    await request('/api/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (await refresh()) showMessage('Apply completed and verification passed.', 'success');
  } catch (error) {
    markTransportFailure(error);
    showMessage(error.message, 'error');
  }
  finally {
    applyInFlight = false;
    updateActionState();
  }
}

document.addEventListener('click', event => {
  const action = event.target instanceof Element ? event.target.closest('[data-action]')?.dataset.action : undefined;
  if (action === 'refresh') void refresh();
  if (action === 'plan') void generatePlan();
  if (action === 'apply') void applyPlan();
});

updateActionState();
void refresh();
