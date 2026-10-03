# Anmeldesystem

School registration MVP. See `backlog.md` (scope, architecture) and `info.md` (auth and test access).

## Layout

```
packages/domain       shared domain models and state machines (TypeScript)
packages/sharepoint   Graph/SharePoint adapter, schema provisioning, config store
packages/forms        form JSON schema (schema/form.schema.json), types, semantic checks
apps/public           public SPA (Svelte), dev port 5174, proxies /api to the server
apps/secretariat      secretariat SPA (Svelte, Microsoft 365 login), dev port 5173
server                public Rust server (tiny_http), port 8080
scripts               Node test tooling (integration test against SharePoint)
docs/sprint-reviews   sprint reviews
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
pnpm test:integration      # against the SharePoint test site, needs .env

cd server && cargo test && cargo run
```

## Configuration

Copy `.env.example` to `.env`. `.env` is test infrastructure and is never committed.
Only the keys whitelisted in `apps/secretariat/vite.config.ts` reach browser code;
client secrets never do.
