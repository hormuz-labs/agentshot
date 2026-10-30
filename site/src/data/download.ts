// Where the download buttons point. GitHub keeps stable names for the Mac and Windows installers on every release;
// the Linux packages carry the version, so those follow src/release.json.
import release from '../release.json'

export const GH = 'https://github.com/hormuz-labs/agentshot'
export const version = release.version
const latest = (f: string) => `${GH}/releases/latest/download/${f}`
const versioned = (f: string) => `${GH}/releases/download/v${version}/${f}`

export const MAC_ARM = latest('AgentShot-arm64.dmg')
export const MAC_INTEL = latest('AgentShot-x64.dmg')
export const WINDOWS = latest('AgentShot-windows-x64-Setup.exe')
export const DEB = versioned(`manul_${version}_amd64.deb`)
export const DEB_ARM = versioned(`manul_${version}_arm64.deb`)
export const APPIMAGE = versioned(`manul_${version}_x86_64.AppImage`)
export const APPIMAGE_ARM = versioned(`manul_${version}_arm64.AppImage`)

export const BREW = 'brew install hormuz-labs/tap/manul'
export const APT = `curl -fsSL https://apt.agentshot.si/manul.gpg | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/manul.gpg &&
echo "deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.agentshot.si stable main" | sudo tee /etc/apt/sources.list.d/manul.list &&
sudo apt update && sudo apt install manul`
export const AGENT_PROMPT = `Install AgentShot from ${GH}. On macOS run \`${BREW}\`. On Windows, download AgentShot-windows-x64-Setup.exe from ${GH}/releases/latest and run it. On Debian or Ubuntu, add the apt repository at https://apt.agentshot.si and run \`sudo apt install manul\`; on other Linux, download the AppImage for this machine's architecture from the latest release. Then open AgentShot.`
