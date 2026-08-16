# Plugin Architecture

This document defines the target plugin system accepted in [ADR 0001](decisions/0001-every-product-capability-is-a-plugin.md). It also records the implemented v0.1 migration boundary so contributors can distinguish available contracts from planned hosted/runtime capabilities.

## Product Boundary

AI Project Harness is a project-governance harness. It composes project facts, policies, workflows, skills, connectors, generated files, and verification into an auditable state. It does not implement an LLM, agent loop, IDE, source-control platform, or sandbox.

The kernel answers four questions:

1. Which locked plugins and contributions are active?
2. What facts and findings justify a proposed project change?
3. Which permissions and files will the change affect?
4. Can the change be verified, audited, upgraded, and rolled back?

Plugins provide the domain-specific answers.

## Target Structure

```text
CLI
└─ Kernel
   ├─ Configuration + lockfile
   ├─ Plugin resolver + lifecycle
   ├─ Capability registry
   ├─ Permission broker + audit log
   ├─ Fact and finding store
   ├─ Plan builder + conflict resolver
   ├─ Transactional change executor
   ├─ File ownership + migration state
   ├─ Verification coordinator
   └─ Contribution providers
      ├─ Official plugins
      ├─ Project and organization plugins
      └─ Hosted adapters and third-party plugins
```

The CLI routes commands into kernel pipelines. It does not contain knowledge of Node.js, GitHub, documentation standards, prototype replication, or a specific agent runtime.

## Two Contribution Planes

Plugins contribute to two related planes.

### Project Plane

These contributions become part of the governed project and are visible to humans and agents.

| Contribution | Responsibility | Typical output |
|---|---|---|
| Standard | Defines an acceptable project state | Policy, checks, CI gates |
| Workflow | Defines an ordered development process | States, transitions, gates |
| Skill | Teaches an agent to perform a task | Instructions, evals, output contract |
| Connector | Describes controlled access to an external capability | Health check, permission requirements |

### Engine Plane

These contributions extend how the harness observes, plans, applies, and verifies without changing kernel invariants.

| Contribution | Input | Output | Allowed effects |
|---|---|---|---|
| Detector | Read-only project view | Facts with evidence | None |
| Rule | Facts and policy config | Findings | None |
| Recipe | Facts, findings, and config | Proposed typed operations | None |
| Verifier | Read-only project view or command grant | Check results | Declared checks only |
| Adapter | Governed project context and task request | External runtime result/events | Declared hosted capabilities |

The existing four project-plane concepts remain stable. Engine-plane contributions are the mechanism that removes hard-coded behavior from `detect()`, `audit()`, `plan()`, `apply()`, and agent-specific rendering.

## Canonical Data Flow

```text
discover -> resolve -> inspect permissions -> lock -> activate
                                                  |
audit:  project view -> detectors -> facts -> rules -> findings
plan:   facts + findings -> recipes -> typed operations -> conflict/permission review
apply:  approved immutable plan -> snapshot -> kernel executor -> verify -> commit
                                                                  \-> rollback on failure
```

Each stage consumes immutable records and emits records with plugin provenance. The kernel may cache a stage only when its inputs include project hashes, configuration, plugin lock, and protocol version.

## Records

### Fact

A fact is an observed project property, not a conclusion.

```json
{
  "id": "node.package-manager",
  "value": "npm",
  "evidence": [{ "path": "package-lock.json", "hash": "sha256:..." }],
  "provider": "node-project@1.2.0"
}
```

Fact identifiers are namespaced. Conflicting providers do not overwrite one another; the active policy selects or rejects competing values.

### Finding

A finding is a rule result supported by facts and evidence.

```json
{
  "id": "testing.missing-entrypoint",
  "priority": "P1",
  "facts": ["node.package-manager"],
  "impact": "Agents cannot run a repeatable verification command.",
  "provider": "testing-standard@2.0.0"
}
```

### Typed Operation

A recipe proposes operations from a closed, versioned operation vocabulary. Initial operations should include:

- `file.create` with ownership mode and expected absence;
- `file.replace` with a required baseline hash;
- `structured.merge` with format, fragment, and conflict policy;
- `directory.ensure`;
- `command.run` referencing a declared command grant;
- `connector.configure` referencing a declared connector and secret names.

Operations contain no raw credentials. Paths are project-relative and normalized before review. The kernel rejects unsupported operations instead of delegating arbitrary code during `apply`.

## Capability Seams

Every engine-plane contribution is a capability seam with:

- a protocol-owned Definition;
- one or more plugin Providers;
- a kernel pipeline or plugin Consumer;
- explicit cardinality: single, ordered-many, or keyed-many;
- deterministic ordering and conflict rules;
- failure and cancellation semantics;
- required permissions and lifecycle;
- contract tests supplied by the kernel SDK.

Provider selection is configuration, never import order. Dependencies establish a topological order; explicit priority may order independent providers, while equal-priority exclusive providers are an error.

## Plugin Package

The manifest is the inspectable control plane. Executable code, when present, is a separately declared data-plane entry point.

```text
plugin/
├─ harness-plugin.yaml
├─ contributions/
│  ├─ standards/
│  ├─ workflows/
│  ├─ skills/
│  ├─ connectors/
│  ├─ detectors/
│  ├─ rules/
│  ├─ recipes/
│  ├─ verifiers/
│  └─ adapters/
├─ templates/
├─ schemas/
├─ migrations/
├─ runtime/                 # optional bundled or hosted entry point
├─ tests/
└─ README.md
```

A future manifest revision will describe contributions by stable ids rather than only string lists:

```yaml
apiVersion: harness.dev/v1
kind: Plugin
metadata:
  name: node-project
  version: 1.2.0
compatibility:
  harness: ">=0.2 <1.0"
dependencies:
  plugins: {}
contributes:
  detectors:
    - id: node-project
      entry: runtime/detector.js
  rules:
    - id: repeatable-verification
      source: contributions/rules/repeatable-verification.yaml
  recipes:
    - id: add-verification-entrypoint
      source: contributions/recipes/add-verification-entrypoint.yaml
runtime:
  mode: bundled
  entry: runtime/index.js
permissions:
  filesystem:
    read: [package.json, package-lock.json, pnpm-lock.yaml, yarn.lock]
    write: [package.json]
  commands: []
  network:
    hosts: []
  secrets: []
```

Manifest validation must be structural and reject unknown security-relevant fields. The lockfile records the exact manifest digest, package integrity, source, resolved dependencies, granted permissions, and migration version.

### Parsing and schema policy

Regular-expression field extraction and an undocumented YAML subset are not acceptable protocol parsers. The kernel must parse the complete document and validate the resulting data against the selected `apiVersion` before using any contribution or permission field.

The zero-dependency preference does not justify a custom YAML parser or incomplete security validation. A narrowly selected, pinned, and audited YAML parser and schema validator are justified kernel infrastructure dependencies if M1 evaluation shows they reduce owned parser code and supply-chain risk overall. Domain frameworks, plugin runtimes, agent SDKs, and platform clients remain outside the kernel.

## Lifecycle

Plugin installation and command activation are separate lifecycles.

### Installation lifecycle

```text
discover -> resolve -> fetch -> inspect -> approve -> install -> lock
update   -> resolve -> diff permissions/migrations -> approve -> transact -> verify -> commit
remove   -> dependency check -> plan owned-file changes -> transact -> verify -> commit
```

Fetching never implies activation. Permission expansion, new executable entry points, and ownership-mode changes require renewed approval.

### Activation lifecycle

```text
load locked manifest -> validate -> register providers -> run pipeline -> dispose in reverse order
```

Activation returns a disposer for every registered effect. Partial activation failure disposes already-activated providers. Timeouts and cancellation flow through the same cleanup path.

## Trust and Execution

### Declarative plugins

The kernel parses data and performs all work. This is the preferred model for standards, workflows, skills, rules, recipes, templates, and connector descriptions.

### Bundled executable plugins

Official plugins may run in process through a capability-scoped context. They must use the same public contracts and contract tests as external providers. They are not allowed private kernel imports.

### Hosted executable plugins

Third-party executable providers run out of process. The host protocol grants named capabilities rather than exposing the process environment or unrestricted filesystem. At minimum the supervisor enforces:

- protocol and plugin-version negotiation;
- explicit project root and normalized path grants;
- secret references resolved only for an approved call;
- command and network allowlists;
- timeouts, cancellation, output limits, and process-tree cleanup;
- structured results and append-only audit events.

## Built-in Plugin Parity

The `builtins` array has been removed. The current implementation discovers bundled manifests from the packaged plugin directory and validates them before use. `plugin list`, `add`, `doctor`, dependency resolution, and tests consume that catalog rather than a hand-maintained name list. A generated build-time index may later optimize distribution, but it must remain a derivative of the same manifests.

Official plugins must not receive hidden contribution types or relaxed validation. This ensures that built-ins continuously exercise the public ecosystem path.

## Agent Runtime Adapters

An Adapter is an engine-plane contribution backed by a Connector in the project plane. It translates a governed task request into an external runtime protocol and translates events back into harness audit records.

For DeepSeek Harness:

- headless is the first one-shot process adapter;
- ACP is the structured session, cancellation, and permission adapter;
- DeepSeek Harness owns agent execution and session behavior;
- AI Project Harness owns project policy, permission grants, verification, file provenance, and the final audit record.

Adapters cannot mark work complete merely because the external agent exited successfully. Completion is determined by the selected workflow and kernel verification results.

## Migration Roadmap

### M0: Direction and vocabulary

- Accept ADR 0001.
- Document current versus target boundaries.
- Keep existing behavior stable.

Exit criterion: new design work uses the common kernel, plugin, contribution, fact, finding, recipe, operation, and adapter vocabulary.

### M1: Manifest and discovery foundation (implemented)

- Replace ad hoc configuration and Manifest field matching with structural YAML parsing and validation.
- Discover the bundled plugin catalog from manifests.
- Remove the hard-coded `builtins` list.
- Add enabled dependency ordering, compatibility checks, and contribution-id uniqueness.

Exit criterion: adding a declarative built-in plugin requires no `src/cli.js` edit.

### M2: Read-only composition (implemented)

- Introduce read-only ProjectView, FactStore, Detector, and Rule contracts.
- Move stack, package-manager, CI, documentation, testing, and agent-instruction detection into official plugins.
- Make audit output entirely provenance-backed.

Exit criterion: adding an audit rule requires only a plugin contribution and contract tests.

### M3: Governed change planning (implemented)

- Introduce Recipe and typed-operation schemas.
- Move finding-to-change mapping out of `plan()`.
- Add conflict detection, stale-hash rejection, permission review, and immutable plan ids.
- Make `apply()` a transactional typed-operation executor for file operations.
- Keep command and connector operations review-required until their execution broker is delivered.

Exit criterion: no plugin writes project files directly during adoption.

### M3.1: Local full-stack integration (implemented)

- Expose audit, Plan, and governed apply through a loopback-only HTTP adapter.
- Serve a static browser console that consumes the same API contract used by integration tests.
- Redact operation content from the public Plan view while retaining scope, provenance, preconditions, and review status.
- Keep HTTP transport out of the Kernel executor and preserve CLI process isolation.

Exit criterion: a browser can inspect a real audit, generate a Plan, and apply it through the existing permission, verification, and rollback gates.

### M4: Lifecycle, upgrade, and hosted execution

- Add lockfile resolution, migrations, permission diffs, and reverse-order disposal.
- Add the hosted plugin protocol and process supervisor.
- Implement install, update, remove, rollback, and supply-chain verification.

Exit criterion: a third-party executable provider can fail or be cancelled without leaking effects or bypassing declared permissions.

### M5: Runtime adapters and ecosystem

- Implement DeepSeek Harness headless, then ACP.
- Add Codex and Claude Code adapters against the same governed context.
- Add organization presets, signed registries, compatibility matrices, and plugin publishing.

Exit criterion: the same project plan and verification policy can be executed by at least two runtimes without kernel changes.

## Current Gaps

The current v0.1 slice intentionally falls short of this target:

- catalog discovery and validation are local-only; registry resolution, signatures, and broad SemVer support are deferred;
- ProjectView, detector selection, fact records, and rule evaluation are kernel protocols; only the generic protocol executor lives in `src/audit.js`;
- command and connector operations have no execution broker yet; they are schema-validated and review-gated;
- plugins cannot yet register providers or lifecycle effects;
- lockfile source resolution, migrations, hosted execution, and runtime-level transactional rollback are deferred.

These are migration inputs, not reasons to expand the current CLI with more domain-specific branches.
