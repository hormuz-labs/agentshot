.DEFAULT_GOAL := help

.PHONY: help install build dev run start preview typecheck test test-watch test-e2e smoke package package-dir clean whisper beats ml

help: ## Show this help message
	@grep -E '^[-a-zA-Z0-9_]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies and binaries (ffmpeg, bsk, models, whisper-cli, manul-beats, manul-speakers, manul-vision)
	npm install
	./scripts/build-whisper.sh
	./scripts/build-beats.sh
	./scripts/build-ml.sh

whisper: ## Build the bundled whisper-cli binary
	./scripts/build-whisper.sh

beats: ## Build the bundled beat tracker (manul-beats, on aubio)
	./scripts/build-beats.sh

ml: ## Build the bundled model runners (manul-speakers, manul-vision)
	./scripts/build-ml.sh

dev: ## Run Manul in development mode with hot reload
	npm run dev

run: dev ## Alias for dev

build: ## Build Electron main, preload, and renderer bundles
	npm run build

start: ## Preview the built application
	npm run start

preview: start ## Alias for start

typecheck: ## Run TypeScript type checks
	npm run typecheck

test: ## Run unit and integration tests (Vitest)
	npm run test

test-watch: ## Run Vitest in watch mode
	npm run test:watch

test-e2e: ## Run end-to-end tests (Playwright)
	npm run test:e2e

smoke: ## Build and run smoke tests
	npm run smoke

package: ## Package production binaries (.deb, AppImage, or .dmg)
	npm run package

package-dir: ## Package unpacked production directory into dist/
	npm run package:dir

clean: ## Remove build outputs (out/ and dist/)
	rm -rf out dist
