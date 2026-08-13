# AI Project Harness

AI Project Harness is a zero-runtime-dependency CLI for initializing and adopting a governed workspace for AI coding agents.

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

The v0.1 implementation intentionally keeps plugin execution declarative. It establishes the protocol, state model, audit report, and safe adoption flow before adding external registries and executable third-party hooks.
