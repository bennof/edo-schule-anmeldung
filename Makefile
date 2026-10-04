# Anmeldesystem – central entry point for all build systems:
# pnpm (TypeScript/Svelte), Cargo (Rust public server) and Docker (SVWS).
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
COMPOSE ?= docker compose

SERVER  := server
DIST    := dist
SVWS_DIR     := docker/svws
SVWS_COMPOSE := $(COMPOSE) --project-directory $(SVWS_DIR) -f $(SVWS_DIR)/compose.yml --env-file $(SVWS_DIR)/.env

E2E_TESTS := e2e-login e2e-forms e2e-secretariat e2e-booking e2e-registration e2e-day e2e-config e2e-designer-uploads

##@ Overview

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"} /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)} /^[a-zA-Z0-9_-]+:.*##/ {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: doctor
doctor: ## Check the required tools
	@for tool in node $(PNPM) $(CARGO) docker; do \
		printf '%-8s ' $$tool; command -v $$tool >/dev/null && ($$tool --version | head -1) || echo 'MISSING'; \
	done
	@test -f .env && echo '.env     present' || echo '.env     MISSING (copy .env.example)'

##@ Build

.PHONY: install
install: node_modules ## Install JavaScript dependencies

node_modules: package.json pnpm-lock.yaml pnpm-workspace.yaml $(wildcard apps/*/package.json packages/*/package.json)
	$(PNPM) install --frozen-lockfile
	@touch node_modules

.PHONY: build
build: build-web build-server ## Build both SPAs and the Rust server (release)

.PHONY: build-web
build-web: install ## Build the public and the secretariat SPA
	$(PNPM) -r build

.PHONY: build-server
build-server: ## Build the Rust public server (release)
	cd $(SERVER) && $(CARGO) build --release

.PHONY: dist
dist: build ## Collect deployable artifacts in dist/
	rm -rf $(DIST) && mkdir -p $(DIST)
	cp -r apps/public/dist $(DIST)/public
	cp -r apps/secretariat/dist $(DIST)/secretariat
	cp $(SERVER)/target/release/anmeldung-server $(DIST)/
	@echo "dist/: public/, secretariat/ (static files), anmeldung-server (binary)"

.PHONY: generate
generate: install ## Regenerate catalogs and the PDF template
	$(PNPM) --filter @anmeldung/forms catalogs
	$(PNPM) --filter @anmeldung/pdf template

.PHONY: clean
clean: ## Remove build output (keeps dependencies)
	rm -rf $(DIST) apps/*/dist packages/pdf/test-output
	cd $(SERVER) && $(CARGO) clean

##@ Quality

.PHONY: check
check: install ## Type checks, Rust lints and formatting
	$(PNPM) -r check
	$(NODE) node_modules/typescript/bin/tsc -p scripts
	cd $(SERVER) && $(CARGO) fmt --check && $(CARGO) clippy -q -- -D warnings

.PHONY: fmt
fmt: ## Format the Rust code
	cd $(SERVER) && $(CARGO) fmt

.PHONY: test
test: install ## Unit tests (TypeScript and Rust)
	$(PNPM) -r test
	cd $(SERVER) && $(CARGO) test -q

.PHONY: test-integration
test-integration: install ## Integration tests against the SharePoint test site (.env)
	$(NODE) scripts/integration-test.ts
	$(NODE) scripts/integration-public-api.ts

.PHONY: test-mail
test-mail: install ## Mail test: one booking -> one mail to MAIL_TEST_TO
	$(NODE) scripts/integration-mail.ts

.PHONY: test-e2e
test-e2e: install ## Browser tests (headless Chromium, M365 test user)
	@for t in $(E2E_TESTS); do echo "== $$t"; $(NODE) scripts/$$t.ts; done

.PHONY: test-svws
test-svws: install ## SVWS adapter against the local SVWS test server (make svws-up first)
	$(NODE) scripts/integration-svws.ts
	$(NODE) scripts/e2e-svws.ts

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
dev-server: ## Rust public server on :8080 (reads .env)
	cd $(SERVER) && $(CARGO) run

.PHONY: dev-public
dev-public: install ## Public SPA on http://localhost:5174
	$(PNPM) --filter @anmeldung/public dev

.PHONY: dev-secretariat
dev-secretariat: install ## Secretariat SPA on http://localhost:5173
	$(PNPM) --filter @anmeldung/secretariat dev

##@ SVWS / SchILD-NRW test server (Docker, rootless)

# random alphanumeric passwords; never pure hex: EclipseLink in the SVWS-Server
# treats hex strings as encrypted passwords and fails to decrypt them
pw = Pw$$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 22)

$(SVWS_DIR)/.env:
	@umask 077; sed \
		-e "s/^MARIADB_ROOT_PASSWORD=.*/MARIADB_ROOT_PASSWORD=$(pw)/" \
		-e "s/^MARIADB_PASSWORD=.*/MARIADB_PASSWORD=$(pw)/" \
		-e "s/^SVWS_TLS_KEYSTORE_PASSWORD=.*/SVWS_TLS_KEYSTORE_PASSWORD=$(pw)/" \
		$(SVWS_DIR)/env.example > $@
	@echo "created $@ with random passwords"

.PHONY: svws-env
svws-env: $(SVWS_DIR)/.env ## Create docker/svws/.env with random passwords

.PHONY: svws-pull
svws-pull: svws-env ## Pull the SVWS-Server and MariaDB images
	$(SVWS_COMPOSE) pull

.PHONY: svws-init
svws-init: svws-pull ## First start: import the official test school (GymAbi)
	IMPORT_TEST_DATA=true $(SVWS_COMPOSE) up -d
	@$(MAKE) svws-wait
	@echo "Test data imported. Further starts with: make svws-up"

.PHONY: svws-up
svws-up: svws-env ## Start SVWS-Server and MariaDB (keeps existing data)
	$(SVWS_COMPOSE) up -d
	@$(MAKE) svws-wait

.PHONY: svws-wait
svws-wait: ## Wait until the SVWS-Server answers on https://localhost:8443
	@port=$$(grep -E '^SVWS_PORT=' $(SVWS_DIR)/.env | cut -d= -f2); port=$${port:-8443}; \
	printf 'waiting for SVWS on https://localhost:%s ' $$port; \
	for i in $$(seq 1 180); do \
		if curl -ksf -o /dev/null https://localhost:$$port/; then echo ' ready'; exit 0; fi; \
		printf '.'; sleep 2; \
	done; echo ' timeout (see make svws-logs)'; exit 1

.PHONY: svws-check
svws-check: ## Query the test school via the SVWS API (user Admin, empty password)
	@port=$$(grep -E '^SVWS_PORT=' $(SVWS_DIR)/.env | cut -d= -f2); db=$$(grep -E '^MARIADB_DATABASE=' $(SVWS_DIR)/.env | cut -d= -f2); \
	printf 'SVWS version: '; curl -ksf https://localhost:$${port:-8443}/status/version; echo; \
	printf 'school:       '; curl -ksf -u 'Admin:' https://localhost:$${port:-8443}/db/$${db:-gymabi}/schule/stammdaten \
		| $(NODE) -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.schulNr,j.bezeichnung1)})'

.PHONY: svws-status
svws-status: svws-env ## Show container status
	$(SVWS_COMPOSE) ps

.PHONY: svws-logs
svws-logs: svws-env ## Follow the SVWS-Server log
	$(SVWS_COMPOSE) logs -f svws

.PHONY: svws-down
svws-down: svws-env ## Stop the containers (data stays in volumes)
	$(SVWS_COMPOSE) down

.PHONY: svws-reset
svws-reset: svws-env ## Stop and DELETE all SVWS/MariaDB data
	@read -p "Delete all SVWS and MariaDB data? [y/N] " a && [ "$$a" = y ]
	$(SVWS_COMPOSE) down -v
