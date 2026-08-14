# Local HTTP API

`harness serve` provides the first backend/frontend integration surface for the governed Kernel. It binds to `127.0.0.1` by default and serves the browser console and API from the same origin:

```bash
node src/cli.js serve --port 3210
```

The adapter is intentionally thin. Each mutating request invokes the existing CLI pipeline in a child process, so the HTTP layer cannot bypass plugin resolution, Plan integrity, permissions, verification, or transactional rollback. It is a local control surface, not a remote deployment API.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Report protocol and service availability |
| `GET` | `/api/dashboard` | Return project summary, audit report, public Plan, and last apply |
| `GET` | `/api/audit` | Run the read-only audit pipeline |
| `GET` | `/api/plan` | Read the persisted public Plan, if one exists |
| `POST` | `/api/plan` | Generate and persist a new deterministic Plan |
| `POST` | `/api/apply` | Apply the persisted approved Plan and run verification |

`POST /api/apply` accepts an optional body such as `{ "modules": ["docs", "git"] }`. It uses the same `--only` selection semantics as the CLI. Invalid JSON is rejected with `400`; stale Plans, review gates, conflicts, and missing Plans retain governed error responses rather than being silently retried.

The browser response deliberately omits operation content and secret-like settings. It exposes operation type, path, ownership, provider, precondition, and review status so a human can inspect scope without turning the dashboard into a credential or file-content exfiltration surface.

## Boundary and next step

The current backend is a process-isolated transport adapter over the CLI. A future service layer can replace the child-process boundary after lifecycle, hosted-plugin, authentication, and multi-user authorization contracts are defined. Until then, do not bind the server to a public interface or place it behind a shared reverse proxy.
