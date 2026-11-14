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

// Every installer has a page of its own, /download/<name>/. The buttons go there and the page starts the download,
// so a download is a page view like any other (the only thing the site's visitor counts can see) and the visitor
// lands on what to do next. `file` is the name the download arrives under.
const named = (url: string) => ({ url, file: url.slice(url.lastIndexOf('/') + 1) })
export const DOWNLOADS = {
  mac: { ...named(MAC_ARM), system: 'mac', label: 'AgentShot for Mac' },
  'mac-intel': { ...named(MAC_INTEL), system: 'mac', label: 'AgentShot for Intel Macs' },
  windows: { ...named(WINDOWS), system: 'windows', label: 'AgentShot for Windows' },
  deb: { ...named(DEB), system: 'deb', label: 'AgentShot for Debian and Ubuntu' },
  'deb-arm': { ...named(DEB_ARM), system: 'deb', label: 'AgentShot for Debian and Ubuntu on ARM' },
  appimage: { ...named(APPIMAGE), system: 'appimage', label: 'the AgentShot AppImage' },
  'appimage-arm': { ...named(APPIMAGE_ARM), system: 'appimage', label: 'the AgentShot AppImage for ARM' },
} as const
export type Download = keyof typeof DOWNLOADS
export const page = (d: Download) => `/download/${d}/`

export const BREW = 'brew install hormuz-labs/tap/manul'
export const APT = `curl -fsSL https://apt.agentshot.si/manul.gpg | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/manul.gpg &&
echo "deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.agentshot.si stable main" | sudo tee /etc/apt/sources.list.d/manul.list &&
sudo apt update && sudo apt install manul`
export const AGENT_PROMPT = `Install AgentShot from ${GH}. On macOS run \`${BREW}\`. On Windows, download AgentShot-windows-x64-Setup.exe from ${GH}/releases/latest and run it. On Debian or Ubuntu, add the apt repository at https://apt.agentshot.si and run \`sudo apt install manul\`; on other Linux, download the AppImage for this machine's architecture from the latest release. Then open AgentShot.`
