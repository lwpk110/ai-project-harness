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

`POST /api/apply` accepts an optional JSON body such as `{ "modules": ["docs", "git"] }`. A zero-byte body is treated as `{}` for compatibility with clients that omit the optional selector. When a body is present, its `Content-Type` must be `application/json` (an optional `charset` parameter is accepted); other media types return `415` with `error.code: "unsupported_media_type"`.

The JSON top level must be an object, and the only supported field is `modules`. Unknown fields return `400` with `error.code: "unknown_request_field"`; malformed JSON returns `400` with `error.code: "invalid_json"`; a non-object JSON value returns `400` with `error.code: "invalid_request_body"`. When present, `modules` must be a non-empty array of non-empty strings, otherwise the response is `400` with `error.code: "invalid_modules"`. Request bodies over the 16 KiB limit return `413` with `error.code: "payload_too_large"`.

The `modules` field uses the same `--only` selection semantics as the CLI. Stale Plans, review gates, conflicts, and missing Plans retain governed error responses rather than being silently retried.

The browser response deliberately omits operation content and secret-like settings. It exposes operation type, path, ownership, provider, precondition, and review status so a human can inspect scope without turning the dashboard into a credential or file-content exfiltration surface.

## Boundary and next step

The current backend is a process-isolated transport adapter over the CLI. A future service layer can replace the child-process boundary after lifecycle, hosted-plugin, authentication, and multi-user authorization contracts are defined. Until then, do not bind the server to a public interface or place it behind a shared reverse proxy.
