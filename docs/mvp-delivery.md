# MVP Delivery

The v0.1 MVP is the governed local project lifecycle, not a hosted agent runtime.

## Delivered scope

- Structural plugin manifest parsing, bundled catalog discovery, compatibility checks, dependency ordering, and lock integrity.
- Read-only ProjectView, provenance-backed facts/findings, declarative recipes, immutable Plans, typed file operations, permission review, verification, recovery, and rollback.
- Seven declarative official plugins, including the optional DeepSeek Harness connector declaration. Enabling it does not install, authenticate, or execute DeepSeek Harness.
- `harness serve` loopback HTTP adapter and static browser console for the real `audit -> plan -> apply` path.
- Redacted public Plan responses, strict apply request validation, bounded bodies, loopback Origin checks, CLI timeouts, and error redaction.

## Acceptance commands

```bash
npm ci
npm test
npm run verify
npm start
```

Open `http://127.0.0.1:3210/` after `npm start`. The browser can inspect the audit, generate a Plan, and apply only approved operations. The same checks run in `.github/workflows/ci.yml` for Node 20 and 22.

## Explicit boundaries

The MVP does not expose a public listener, authentication, multi-user sessions, remote plugin registry, signed supply-chain resolution, hosted executable plugins, command/connector execution brokers, or DeepSeek Harness headless/ACP execution. Those belong to M4 and M5 and must use new versioned contracts rather than bypassing the Kernel.
