# Architecture

## Direction

AI Project Harness uses a governed microkernel architecture:

> The kernel owns mechanisms and invariants. Every product-specific capability is delivered by a plugin.

This decision is recorded in [ADR 0001](decisions/0001-every-product-capability-is-a-plugin.md). The target contracts, records, lifecycle, trust model, and migration milestones are defined in [Plugin Architecture](plugin-architecture.md).

"Everything is a plugin" is intentionally bounded. The kernel is the bootstrap trust anchor and cannot be replaced by a plugin, because it enforces the rules that govern plugins.

## Kernel Boundary

The kernel owns only:

- configuration, lockfile, plugin discovery, resolution, and lifecycle;
- schema validation and deterministic capability composition;
- permission decisions and append-only audit records;
- fact, finding, immutable plan, and typed-operation protocols;
- transactional change execution and stale-input detection;
- file ownership, migrations, verification, state, and rollback;
- stable CLI routing and hosted-plugin supervision.

The kernel does not know what a Node.js project, GitHub workflow, documentation standard, prototype, or DeepSeek agent is.

## Plugin Boundary

Plugins provide all product-specific behavior in two planes:

| Plane | Contributions |
|---|---|
| Project | Standards, workflows, skills, connectors |
| Engine | Detectors, rules, recipes, verifiers, adapters |

Project-plane contributions become part of the governed workspace. Engine-plane contributions extend kernel pipelines without weakening their invariants.

A replaceable capability separates its versioned Definition, plugin Provider, and kernel or plugin Consumer. Provider selection and ordering come from configuration and dependency resolution, never incidental import order.

## Adoption Pipeline

```text
audit: project view -> detectors -> facts -> rules -> findings
plan:  facts + findings -> recipes -> typed operations -> conflict and permission review
apply: approved immutable plan -> snapshot -> kernel executor -> verify -> commit
                                                              \-> rollback on failure
```

The safety rules are non-negotiable:

- audit is read-only;
- plan is deterministic and has no side effects;
- plugins propose typed operations, while only the kernel applies them;
- apply rejects stale project hashes and undeclared permissions;
- every result records plugin provenance, ownership, and rollback data;
- activation effects are disposed in reverse order on success, failure, or cancellation.

## Runtime and Trust

The current CLI uses Node.js built-ins only. The target architecture preserves a small kernel and prefers declarative plugins, while recognizing three execution classes:

| Class | Model |
|---|---|
| Declarative | The kernel parses data and performs the work |
| Bundled | Official code runs in process through public capability contracts |
| Hosted | Third-party code runs out of process with explicit capability grants |

Arbitrary third-party packages are never imported into the kernel process. Hosted execution requires integrity locking, permission approval, protocol negotiation, cancellation, timeout, output bounds, cleanup, and structured audit events.

## Agent Runtime Boundary

AI Project Harness governs a project; it does not own an agent loop. Agent runtimes consume locked project facts, policies, workflows, skills, connectors, and verification entry points through Adapter contributions.

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is the first concrete runtime target:

| AI Project Harness | DeepSeek Harness |
|---|---|
| Audits and adopts repositories | Runs agent loops and tools |
| Owns policy, permissions, file provenance, plans, and verification | Owns sessions, model adapters, context, sandboxing, approvals, and execution |
| Produces the final governed audit result | Produces runtime events and task output |

The first executable integration will use `dsh --profile headless`; ACP stdio follows for sessions, cancellation, and permission requests. DeepSeek Harness remains an optional out-of-process dependency. Enabling its current declarative plugin does not install it, read `DEEPSEEK_API_KEY`, or execute an agent.

The project borrows plugin composition, Definition/Provider/Consumer capability seams, reversible lifecycle effects, and reconstructable model-visible context. It does not import Cordis, fork DeepSeek Harness, or bind the kernel to a specific model.

## Local Full-Stack Surface

The first backend/frontend integration is `harness serve`. It is a loopback-only HTTP transport adapter that serves the static browser console and exposes `harness.dev/http/v1` endpoints for health, audit, plan, and apply. Mutating requests invoke the existing CLI in a child process; this keeps the HTTP surface from becoming a second executor with different permission or rollback behavior.

The dashboard receives a redacted public Plan containing operation scope, provider, precondition, and review status, but not operation content or secret-like settings. `POST /api/apply` still requires the persisted immutable Plan, approved reviews, current input digests, and successful verification. Public binding, authentication, multi-user sessions, and direct remote execution are intentionally deferred until the hosted lifecycle contracts are implemented.

## Current Implementation

The runnable v0.1 slice proves the CLI and safe adoption flow. M1 replaced Manifest field matching with structural YAML parsing, discovers bundled plugins from their manifests, and validates compatibility, enabled dependency order, and duplicate contribution ids. M2 provides an immutable ProjectView and composes declarative Detector and Rule contributions into provenance-backed audit reports. M3 moves finding-to-change mapping into declarative Recipe contributions and provides deterministic immutable Plans, typed operations, conflict detection, stale-input rejection, permission review, and a kernel executor with recovery snapshots and rollback.

The current boundary is explicit:

- Recipes and typed-operation planning are implemented in `src/planning.js`; the CLI only routes the pipeline and persists state.
- `file.create`, `file.replace`, `structured.merge`, and `directory.ensure` are applied transactionally by `src/executor.js`.
- `command.run` and `connector.configure` are validated and permission-reviewed but are rejected by the M3 executor until an execution broker is available.
- Plugin permissions are enforced for Recipe-generated operations; low-risk P2/P3 filesystem operations may be auto-approved by project policy, while command and connector operations remain review-required.
- the lockfile records manifest integrity but does not yet resolve remote sources or migrations;
- plugin providers, lifecycle effects, hosted execution, and runtime adapters remain deferred to M4/M5.
- the local HTTP adapter and static console are available for single-user integration testing; authentication and public deployment remain out of scope.

New work should follow the milestones in [Plugin Architecture](plugin-architecture.md#migration-roadmap) and should not add new project-specific branches to the CLI when a contribution point can own the behavior.
