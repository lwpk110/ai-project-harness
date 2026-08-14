# ADR 0001: Every Product Capability Is a Plugin

- Status: Accepted
- Date: 2026-08-14

## Context

AI Project Harness exists to compose, audit, and upgrade project governance for multiple AI coding agents. Its first implementation proves the `audit -> plan -> apply` flow, but product behavior is still centralized in `src/cli.js`: the built-in plugin catalog, stack detection, audit rules, plan conversion, and change application are hard-coded.

That structure makes manifests descriptive rather than architectural. Adding a language, policy, CI provider, or agent runtime still requires changing the kernel. It also makes independent plugin versioning, permission review, testing, and rollback impossible.

DeepSeek Harness demonstrates a useful direction: capabilities are assembled from plugins, extension effects have lifecycles, and providers can be replaced without editing a privileged agent loop. AI Project Harness has a different responsibility, so it will adopt the composition principles without importing Cordis or becoming an agent runtime.

## Decision

AI Project Harness will use a governed microkernel architecture:

> The kernel owns mechanisms and invariants. Every product-specific capability is delivered by a plugin.

The kernel is the bootstrap trust anchor and is intentionally not a plugin. It owns only:

- configuration and lockfile loading;
- plugin discovery, resolution, deterministic composition, and lifecycle;
- schema and compatibility validation;
- permission decisions and the append-only audit log;
- immutable plan construction, conflict detection, and approval;
- transactional execution of typed change operations;
- file ownership, state, migrations, verification, and rollback;
- stable CLI routing and plugin-host protocol.

Plugins own all project- or platform-specific behavior, including:

- project detectors and evidence collectors;
- audit rules and remediation recipes;
- standards, workflows, skills, and connectors;
- verification providers and policy packs;
- templates and structured merge fragments;
- Codex, Claude Code, DeepSeek Harness, and future agent adapters.

Core commands remain kernel entry points, but their domain behavior is assembled from plugin contributions. For example, `audit` is a kernel pipeline whose detectors and rules come from plugins; `apply` is a kernel transaction whose typed operations were proposed by plugin recipes.

## Safety Invariants

Plugin composition must not weaken the adoption safety model:

1. `audit` receives a read-only project view and cannot mutate the workspace.
2. `plan` is deterministic for the same facts, plugin lock, configuration, and project hashes.
3. A plugin proposes typed operations; only the kernel executes side effects.
4. `apply` executes an immutable approved plan and rejects stale input hashes.
5. Every filesystem, command, network, secret, and external-system capability is declared and policy-checked.
6. Every applied operation records ownership, provenance, result, and rollback data.
7. Activation and disposal order are deterministic and lifecycle effects are reversible.
8. Built-in plugins use the same manifest and contribution contracts as external plugins.
9. Agent-visible project context is reproducible from locked plugins, configuration, project facts, and generated artifacts.

## Capability Model

A replaceable capability is designed as three roles:

- **Definition**: the versioned interface and data contracts;
- **Provider**: a plugin contribution implementing the capability;
- **Consumer**: a kernel pipeline or another plugin using it through the interface.

Definitions belong to the kernel protocol. Providers and consumers must not reach into one another's implementation. A capability is not complete until its failure semantics, permissions, lifecycle, and verification method are defined.

## Execution Model

The architecture supports three trust classes:

| Class | Execution | Intended use |
|---|---|---|
| Declarative | Parsed and executed by the kernel | Templates, standards, rules, recipes, configuration fragments |
| Bundled | In-process through capability-scoped context | Official plugins shipped with the CLI |
| Hosted | Out-of-process protocol with explicit grants | Third-party executable plugins and agent runtimes |

Declarative contributions are preferred. Arbitrary third-party code will not be imported into the kernel process. Hosted execution requires lockfile integrity, permission approval, timeouts, cancellation, bounded output, and protocol-version negotiation.

## Consequences

Positive consequences:

- new ecosystems and agent runtimes can be added without kernel branches;
- project-specific policy can version independently from the CLI;
- the same permission, audit, ownership, and rollback model covers every capability;
- official plugins continuously test the public plugin protocol;
- DeepSeek Harness can be replaced by another runtime adapter without changing governance behavior.

Costs and constraints:

- the plugin protocol becomes a critical compatibility surface;
- deterministic ordering, conflict handling, and lifecycle cleanup require explicit design;
- the initial migration adds interfaces before it removes code;
- hosted plugins need a protocol and process supervisor before executable third-party hooks are safe.

## Rejected Alternatives

### Make the entire kernel a plugin

Rejected because discovery, permissions, transactions, and audit need a non-replaceable trust anchor. Making these replaceable would let a plugin bypass the rules that govern it.

### Keep plugins declarative forever

Rejected because detectors, structured planners, verifiers, and agent adapters eventually need executable behavior. Declarative contributions remain the default, with hosted execution as the controlled escape hatch.

### Load arbitrary npm plugins in process

Rejected because package installation would become code execution with the CLI's full filesystem, environment, and network authority.

### Fork or embed DeepSeek Harness

Rejected because it would couple project governance to one agent runtime and violate the small-kernel boundary. DeepSeek Harness is integrated through headless or ACP process adapters.

## Migration Rule

No new project-specific conditional should be added to the CLI when a documented contribution point can own it. During migration, a temporary kernel implementation may remain only when the target extension contract and removal milestone are recorded in the plugin architecture roadmap.
