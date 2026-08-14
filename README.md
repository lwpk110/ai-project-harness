# AI Project Harness

AI Project Harness provides a CLI for initializing and adopting a governed workspace for AI coding agents.

Its direction is a governed microkernel: the kernel owns permissions, plans, transactions, audit, ownership, and rollback; every project-specific capability is delivered by a plugin. See [Architecture](docs/architecture.md), [Plugin Architecture](docs/plugin-architecture.md), and [ADR 0001](docs/decisions/0001-every-product-capability-is-a-plugin.md).

## Quick start

```bash
npm install
node src/cli.js init --preset minimal
node src/cli.js audit --format markdown
node src/cli.js plan
node src/cli.js apply
node src/cli.js doctor
node src/cli.js verify
```

## Commands

- `init`: create a new harness configuration and baseline files.
- `adopt` / `audit`: inspect an existing project without changing it.
- `plan`: turn audit findings into an integration plan.
- `apply`: apply selected low-risk changes with a recovery snapshot.
- `add`: enable a built-in plugin.
- `doctor`: validate configuration and plugin dependencies.
- `verify`: run the configured verification command.

## Agent runtimes

The kernel is runtime-neutral. Agent runtimes are optional Connector + Adapter plugins: the Connector declares the external capability and permissions, while the Adapter translates governed tasks and runtime events. The built-in `deepseek-harness` plugin declares planned headless and ACP integration with [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness); v0.1 records its capabilities and permissions without installing or executing it.

## Implementation status

The runnable v0.1 slice establishes the CLI, manifests, state model, audit report, and safe adoption flow. M1 parses configuration and manifests structurally, discovers bundled plugins from their manifests, and validates compatibility, dependencies, and duplicate contributions. M2 composes read-only, provenance-backed audit facts and findings from declarative official plugins. Planning recipes, typed operations, and permission execution remain the next migration stages.

