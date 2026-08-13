# Architecture

## v0.1 boundary

The kernel owns configuration, plugin state, audit reports, integration plans, recovery snapshots, validation, and CLI command routing. Plugins contribute standards, workflows, skills, and connectors; they do not change kernel behavior directly.

## Runtime

The CLI uses Node.js built-ins only. This keeps `init`, `audit`, `plan`, `apply`, `doctor`, and `verify` usable before an ecosystem package manager or registry exists.

## Adoption flow

`audit` is read-only. `plan` converts findings into low-risk changes and manual actions. `apply` creates a recovery snapshot before adding only missing baseline files. Existing files are preserved.

## Deferred work

Plugin version resolution, lockfiles, structured file merging, executable plugin hooks, signed registries, GitHub MCP registration, and transactional rollback are specified in the PRD but intentionally deferred beyond the first runnable slice.
