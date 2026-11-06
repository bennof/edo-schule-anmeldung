# Anmeldesystem – central entry point for all build systems:
# pnpm (TypeScript/Svelte) and Cargo (Rust public server).
# `make` or `make help` lists the targets.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
MAKEFLAGS += --no-print-directory

# Rust lives in ~/.cargo (rustup); make it available without sourcing
export PATH := $(HOME)/.cargo/bin:$(PATH)

PNPM    ?= pnpm
CARGO   ?= cargo
NODE    ?= node

SERVER  := server
DESKTOP := desktop
DIST    := dist
# Linux: server as a static musl binary (single file, runs on any distribution)
MUSL    := x86_64-unknown-linux-musl
SERVER_BIN := $(SERVER)/target/$(MUSL)/release/anmeldung-server
VITEST  := $(PNPM) exec vitest run --config tests/vitest.config.ts

##@ Overview

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"} /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)} /^[a-zA-Z0-9_-]+:.*##/ {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: doctor
doctor: ## Check the required tools
	@for tool in node $(PNPM) $(CARGO); do \
		printf '%-8s ' $$tool; command -v $$tool >/dev/null && ($$tool --version | head -1) || echo 'MISSING'; \
	done
	@test -f .env && echo '.env     present' || echo '.env     MISSING (copy .env.example)'

##@ Build

.PHONY: system-deps
system-deps: ## Debian/Ubuntu: system packages for musl build and desktop app (sudo)
	sudo apt install -y musl-tools build-essential curl wget file libssl-dev \
		libwebkit2gtk-4.1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev

.PHONY: install
install: node_modules ## Install JavaScript dependencies

node_modules: package.json pnpm-lock.yaml pnpm-workspace.yaml $(wildcard apps/*/package.json packages/*/package.json)
	$(PNPM) install --frozen-lockfile
	@touch node_modules

.PHONY: build
build: build-secretariat build-server build-desktop ## Build secretariat SPA, server and desktop app (release)

.PHONY: build-public
build-public: install ## Build the public SPA (registration page)
	$(PNPM) --filter @anmeldung/public build

.PHONY: build-secretariat
build-secretariat: install ## Build the secretariat SPA
	$(PNPM) --filter @anmeldung/secretariat build

.PHONY: build-server
build-server: build-public ## Build the server (static musl); the registration page is embedded
	cd $(SERVER) && $(CARGO) build --release --target $(MUSL)

.PHONY: build-desktop
build-desktop: build-secretariat ## Build the desktop app; the secretariat is embedded
	cd $(DESKTOP) && $(CARGO) build --release

.PHONY: dist
dist: build ## Collect deployable artifacts in dist/
	rm -rf $(DIST) && mkdir -p $(DIST)
	cp -r apps/secretariat/dist $(DIST)/secretariat
	cp $(SERVER_BIN) $(DESKTOP)/target/release/anmeldung-desktop $(DIST)/
	@echo "dist/: anmeldung-server (API + registration page), anmeldung-desktop (secretariat app), secretariat/ (static files)"

.PHONY: generate
generate: install ## Regenerate catalogs and the PDF template
	$(PNPM) --filter @anmeldung/forms catalogs
	$(PNPM) --filter @anmeldung/pdf template

.PHONY: clean
clean: ## Remove everything generated: build output, dependencies, Rust target
	rm -rf $(DIST) apps/*/dist packages/pdf/test-output $(SERVER)/target $(DESKTOP)/target $(DESKTOP)/gen
	rm -rf node_modules apps/*/node_modules packages/*/node_modules

##@ Quality

.PHONY: check
check: install ## Type checks, Rust lints and formatting
	$(PNPM) -r check
	$(NODE) node_modules/typescript/bin/tsc -p tests
	$(PNPM) --filter @anmeldung/sharepoint exec vitest run src/schema.test.ts
	cd $(SERVER) && $(CARGO) fmt --check && $(CARGO) clippy -q -- -D warnings
	cd $(DESKTOP) && $(CARGO) fmt --check && $(CARGO) clippy -q -- -D warnings

.PHONY: tenant-schema
tenant-schema: install ## Write scripts/tenant/sharepoint-schema.json (after a new SCHEMA_HISTORY entry)
	$(NODE) scripts/tenant/export-schema.ts

.PHONY: fmt
fmt: ## Format the Rust code
	cd $(SERVER) && $(CARGO) fmt
	cd $(DESKTOP) && $(CARGO) fmt

.PHONY: test
test: install ## Unit tests (TypeScript and Rust)
	$(PNPM) -r test
	cd $(SERVER) && $(CARGO) test -q
	cd $(DESKTOP) && $(CARGO) test -q

.PHONY: test-integration
test-integration: install ## Integration tests against the SharePoint test site (.env)
	$(VITEST) tests/integration

.PHONY: test-mail
test-mail: install ## Mail test: one booking -> one mail to MAIL_TEST_TO
	$(VITEST) tests/mail

.PHONY: test-e2e
test-e2e: install ## Browser tests (headless Chromium, M365 test user)
	$(VITEST) tests/e2e

.PHONY: test-svws
test-svws: install ## SVWS adapter against the SVWS server from .env (default https://localhost:8443)
	$(VITEST) tests/svws
	cd $(DESKTOP) && $(CARGO) test -q -- --ignored

.PHONY: test-all
test-all: check test test-integration test-e2e ## Everything except the mail and SVWS tests

.PHONY: playwright
playwright: install ## Download the headless Chromium for the browser tests
	$(PNPM) exec playwright-core install chromium

##@ Development

.PHONY: dev
dev: install ## Run Rust server, public and secretariat SPA together
	@$(MAKE) -j3 dev-server dev-public dev-secretariat

.PHONY: dev-server
dev-server: ## Rust public server on :23180 (reads .env)
	cd $(SERVER) && $(CARGO) run

.PHONY: dev-public
dev-public: install ## Public SPA on http://localhost:8954
	$(PNPM) --filter @anmeldung/public dev

.PHONY: dev-secretariat
dev-secretariat: install ## Secretariat SPA on http://localhost:8944
	$(PNPM) --filter @anmeldung/secretariat dev

.PHONY: dev-desktop
dev-desktop: build-secretariat ## Desktop app (window on http://localhost:8964, needs a display)
	cd $(DESKTOP) && $(CARGO) run
