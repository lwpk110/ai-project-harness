# AI Project Harness

## Mission

Provide a composable, auditable and upgradeable harness for AI-agent-driven software projects.

## Commands

- `npm test`: run unit tests.
- `npm run verify`: run project doctor and verification checks.

## Constraints

- Keep the runtime dependency-free unless a dependency is justified in the PRD.
- Preserve existing project files during adoption; use audit -> plan -> apply.
- Do not add credentials, generated recovery snapshots or machine-local state.
- Every behavior change requires tests.
