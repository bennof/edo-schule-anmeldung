## Authentication and Test Access

The development environment provides two independent authentication paths.

### Secretariat SPA

The Secretariat SPA uses interactive Microsoft 365 user authentication.

The `.env` contains the configuration required by the SPA, including
tenant ID, client ID and development redirect URI.

A dedicated Microsoft 365 test user is also available for testing the
authenticated Secretariat SPA.

Credentials for this test user are stored only in `.env`.

They may be used by development/test agents to test the SPA and its
SharePoint integration.

The test-user credentials MUST NOT:

- be included in application source code
- be exposed to browser code as configuration
- be committed to the repository
- appear in logs, screenshots, generated documentation or sprint reviews
- be copied into `.env.example`

The credentials exist solely for development and automated/manual testing.

### Public Daemon

The public Rust daemon uses a separate non-interactive application
identity.

It authenticates using the OAuth client-credentials flow:

- tenant ID
- daemon client ID
- daemon client secret

These credentials are also stored only in `.env`.

The daemon credentials MUST never be exposed to the SPA or any other
browser-delivered code.

The current daemon SharePoint permissions are temporary development
permissions. Before production deployment they must be restricted to
the required SharePoint resources as defined by the backlog.

### Security rule

`.env` is test infrastructure, not application configuration that may
be distributed.

Agents may read and use `.env` for development and integration testing,
but must never reproduce its secret values in source code, commits,
documentation, test output or generated artifacts


### Software stack
ts, svelte, rust
