# Anmeldesystem

School registration MVP. See `backlog.md` (scope, architecture) and `info.md` (auth and test access).

## Layout

```
packages/domain       shared domain models and state machines (TypeScript)
packages/sharepoint   Graph/SharePoint adapter, schema provisioning, config store
packages/forms        form JSON schema, runtime, school form (examples/), generated catalogs
packages/form-ui      Svelte form renderer (public and secretariat mode)
apps/public           public SPA (Svelte), dev port 5174, proxies /api to the server
apps/secretariat      secretariat SPA (Svelte, Microsoft 365 login), dev port 5173
server                public Rust server (tiny_http, ureq), port 8080, daemon identity
scripts               Node test tooling (integration test against SharePoint)
docs/sprint-reviews   sprint reviews
docs/reference        the school's previous registration form (Word)
```

TypeScript packages are consumed as source (no build step). Scripts run with
Node's built-in type stripping, so imports use `.ts` extensions.

## Commands

Requires Node 24, pnpm and Rust (`source "$HOME/.cargo/env"`).

```sh
pnpm install
pnpm test                  # unit tests (vitest)
pnpm check                 # type checks
pnpm build                 # build both SPAs
pnpm dev:public            # http://localhost:5174
pnpm dev:secretariat       # http://localhost:5173
pnpm dev:server            # Rust public server on :8080 (reads ../.env)
pnpm test:integration      # adapter and public API against the SharePoint test site
pnpm test:e2e              # browser tests (headless Chromium); secretariat tests sign in
                           # with the M365 test user and clean up their SharePoint data

cd server && cargo test && cargo run
```

## Daemon permissions

`node scripts/daemon-permissions.ts show|grant|revoke-site|restore-site` manages the
public daemon's SharePoint grants (list-level target, see docs/sprint-reviews/sprint-3.md).

## Configuration

Copy `.env.example` to `.env`. The Rust server additionally reads `BIND_ADDR`,
`WORKERS` and `TRUST_PROXY` (set to 1 behind a reverse proxy). `.env` is test infrastructure and is never committed.
Only the keys whitelisted in `apps/secretariat/vite.config.ts` reach browser code;
client secrets never do.
