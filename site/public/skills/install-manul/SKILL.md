---
name: install-manul
description: Install AgentShot, the free open-source video agent you talk to, on macOS (Homebrew or .dmg), Windows 10/11 x64 (Setup.exe), or Linux (apt on Debian/Ubuntu, or AppImage). Use when the user asks to install, set up or update AgentShot.
---

# Install AgentShot

AgentShot is an open-source video agent for macOS 12+, Windows 10/11 (x64), and Linux. Detect the system, then run the matching steps. Ask before using `sudo`.

## macOS

```bash
brew install hormuz-labs/tap/manul
```

No Homebrew: download the `.dmg` for this Mac (`arm64` for Apple silicon, `x64` for Intel) from https://github.com/hormuz-labs/agentshot/releases/latest. Until notarization is done, the first launch needs right-click → Open.

## Windows (x64)

Download `AgentShot-windows-x64-Setup.exe` from https://github.com/hormuz-labs/agentshot/releases/latest and run it (Windows 10 1903+ or Windows 11 x64):

```powershell
irm https://github.com/hormuz-labs/agentshot/releases/latest/download/AgentShot-windows-x64-Setup.exe -OutFile "$env:TEMP\AgentShot-Setup.exe"; Start-Process "$env:TEMP\AgentShot-Setup.exe"
```

The installer is per-user (no admin prompt), bundles core tools, and creates Desktop and Start menu shortcuts. It is signed with Hormuz Labs' certificate; if Windows SmartScreen prompts on first launch, click **More info → Run anyway**.

## Debian and Ubuntu

```bash
curl -fsSL https://apt.agentshot.si/manul.gpg | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/manul.gpg &&
echo "deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.agentshot.si stable main" | sudo tee /etc/apt/sources.list.d/manul.list &&
sudo apt update && sudo apt install manul
```

## Other Linux

Download `manul_<version>_x86_64.AppImage` or `manul_<version>_arm64.AppImage` from https://github.com/hormuz-labs/agentshot/releases/latest, `chmod +x` it, and run it.

## Headless worker mode (optional)

To run AgentShot as a remote rendering and agent worker on a workstation or server:

```bash
manul --worker
```

## After installing

Open AgentShot. Sign in for an AgentShot key (new accounts get 1,000 starter credits; plans under Settings → Keys → AgentShot key), or add a Claude, Gemini or OpenAI API key, kept in the system keychain. Updates install themselves (Homebrew and apt also update it).
