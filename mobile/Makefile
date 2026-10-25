.DEFAULT_GOAL := help

# Tools: found in PATH, Android Studio's usual places, or ~/development (where scripts set them up); override any of
# them, e.g. `make start AVD=Pixel_8 ANDROID_HOME=/opt/android-sdk`.
ANDROID_HOME ?= $(firstword $(wildcard $(ANDROID_SDK_ROOT) $(HOME)/Android/Sdk $(HOME)/Library/Android/sdk $(HOME)/development/android-sdk))
FLUTTER ?= $(or $(shell command -v flutter 2>/dev/null),$(wildcard $(HOME)/development/flutter/bin/flutter),flutter)
ADB ?= $(or $(wildcard $(ANDROID_HOME)/platform-tools/adb),adb)
EMULATOR ?= $(or $(wildcard $(ANDROID_HOME)/emulator/emulator),emulator)
AVDMANAGER ?= $(or $(wildcard $(ANDROID_HOME)/cmdline-tools/latest/bin/avdmanager),avdmanager)
# Java 17 for Gradle: JAVA_HOME if set, else ~/development/jdk when there is one
JAVA_HOME ?= $(wildcard $(HOME)/development/jdk)
export ANDROID_HOME JAVA_HOME
export PATH := $(if $(JAVA_HOME),$(JAVA_HOME)/bin:)$(PATH)

AVD ?= agentshot_e2e
AVD_IMAGE ?= system-images;android-36;google_apis;x86_64
APP_ID := si.agentshot.app
MESH_AAR := android/app/libs/agentshotmesh.aar
# the device flutter and adb use: the first emulator, or DEVICE=<serial>
DEVICE ?= $(shell $(ADB) devices 2>/dev/null | awk 'NR>1 && $$2=="device" {print $$1; exit}')

.PHONY: help setup mesh avd start start-headless stop devices run install launch desktop analyze test e2e screenshots apk bundle logs clean

help: ## Show this help message
	@grep -E '^[-a-zA-Z0-9_]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

setup: $(MESH_AAR) ## Fetch Flutter packages, build the mesh library, and check the toolchain
	$(FLUTTER) pub get
	$(FLUTTER) doctor

mesh: ## Build the embedded mesh library the Android app links (needs Go, the SDK and NDK)
	ANDROID_NDK_HOME="$${ANDROID_NDK_HOME:-$$(ls -d $(ANDROID_HOME)/ndk/* | sort | tail -1)}" ../scripts/build-mesh.sh android

# built once, when missing (make mesh rebuilds it)
$(MESH_AAR):
	$(MAKE) mesh

avd: ## Create the emulator (AVD) if it doesn't exist yet
	@$(EMULATOR) -list-avds | grep -qx '$(AVD)' || \
	  { $(ANDROID_HOME)/cmdline-tools/latest/bin/sdkmanager '$(AVD_IMAGE)' 'emulator' 'platform-tools' && \
	    echo no | $(AVDMANAGER) create avd -n '$(AVD)' -k '$(AVD_IMAGE)' -d pixel_7; }

start: avd ## Start the emulator in a window and wait until Android has booted
	@if $(ADB) devices | grep -q '^emulator-'; then echo "An emulator is already running"; else \
	  nohup $(EMULATOR) -avd '$(AVD)' -gpu host -no-snapshot-save >/tmp/agentshot-emulator.log 2>&1 & \
	  $(ADB) wait-for-device; \
	  until [ "$$($(ADB) shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 2; done; \
	  echo "Emulator ready"; fi

start-headless: avd ## Start the emulator without a window (for tests)
	@if $(ADB) devices | grep -q '^emulator-'; then echo "An emulator is already running"; else \
	  nohup $(EMULATOR) -avd '$(AVD)' -no-window -no-audio -no-snapshot-save -no-boot-anim >/tmp/agentshot-emulator.log 2>&1 & \
	  $(ADB) wait-for-device; \
	  until [ "$$($(ADB) shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 2; done; \
	  echo "Emulator ready"; fi

stop: ## Shut the emulator down
	-$(ADB) -s $(DEVICE) emu kill

devices: ## List connected phones and emulators
	$(FLUTTER) devices

run: $(MESH_AAR) ## Run the app on the emulator or phone with hot reload (r reloads, q quits)
	$(FLUTTER) run -d $(DEVICE)

install: apk ## Build, install and open the app (no hot reload; stays installed)
	$(ADB) -s $(DEVICE) install -r build/app/outputs/flutter-apk/app-debug.apk
	$(MAKE) launch

launch: ## Open the installed app
	$(ADB) -s $(DEVICE) shell am start -n $(APP_ID)/.MainActivity

desktop: ## Run desktop AgentShot from this checkout (pair the phone in Settings → Mobile)
	cd .. && npm run dev

analyze: ## Static analysis (flutter analyze)
	$(FLUTTER) analyze

test: ## Unit and widget tests (flutter test)
	$(FLUTTER) test

e2e: $(MESH_AAR) ## All end-to-end tests on the emulator against the real desktop app (ONLY=editing,create runs some)
	cd .. && MOBILE_E2E_ONLY=$(ONLY) npm run test:e2e:mobile

e2e-smoke: $(MESH_AAR) ## The quick end-to-end set CI runs on every pull request (pairing, projects, conversation, editing)
	cd .. && MOBILE_E2E_ONLY=pairing,projects,conversation,editing npm run test:e2e:mobile

screenshots: $(MESH_AAR) ## Capture Play Store screenshots from the real app into build/store-screenshots
	cd .. && npx electron-vite build && MOBILE_E2E_SHOTS=$(CURDIR)/build/store-screenshots MOBILE_E2E_ONLY=store_screenshots node scripts/run-headless.mjs node test/e2e/mobile.e2e.mjs

apk: $(MESH_AAR) ## Build the debug APK
	$(FLUTTER) build apk --debug

# A release bundle is signed with android/key.properties (see key.properties.example); without it, it's unsigned.
bundle: $(MESH_AAR) ## Build the release app bundle for Google Play (VERSION=0.4.17 CODE=4017)
	$(FLUTTER) build appbundle --release $(if $(VERSION),--build-name $(VERSION)) $(if $(CODE),--build-number $(CODE))
	@echo "→ build/app/outputs/bundle/release/app-release.aab"

logs: ## Follow the app's log output from the device
	$(ADB) -s $(DEVICE) logcat -v brief flutter:V AndroidRuntime:E '*:S'

clean: ## Remove Flutter build outputs
	$(FLUTTER) clean
