// Render AgentShot's Homebrew cask. The hormuz-labs/homebrew-tap repository runs this from each release tag itself.
//   node scripts/homebrew-cask.mjs <version> <arm64 dmg sha256> <x64 dmg sha256>  > Casks/manul.rb
// auto_updates: AgentShot updates itself (electron-updater), so `brew upgrade` leaves it alone.
// Releases are Developer ID signed and notarized (release.yml refuses to publish otherwise), so Gatekeeper opens it as is.
import { fileURLToPath } from 'node:url'

export function renderCask({ version, arm64, x64 }) {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`bad version "${version}"`)
  for (const [k, v] of Object.entries({ arm64, x64 })) if (!/^[0-9a-f]{64}$/.test(v)) throw new Error(`bad sha256 for ${k}`)
  const url = arch => `https://github.com/hormuz-labs/agentshot/releases/download/v#{version}/AgentShot-#{version}-${arch}.dmg`
  return `cask "manul" do
  version "${version}"

  on_arm do
    sha256 "${arm64}"

    url "${url('arm64')}"
  end
  on_intel do
    sha256 "${x64}"

    url "${url('x64')}"
  end

  name "AgentShot"
  desc "Agentic video editor: drop in a video, say what you want, and it does the edit"
  homepage "https://github.com/hormuz-labs/agentshot"

  auto_updates true
  depends_on macos: :monterey

  app "AgentShot.app"

  zap trash: [
    "~/Library/Application Support/AgentShot",
    "~/Library/Caches/manul-updater",
    "~/Library/Logs/AgentShot",
    "~/Library/Preferences/com.hormuzlabs.manul.plist",
    "~/Library/Saved Application State/com.hormuzlabs.manul.savedState",
  ]
end
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, arm64, x64] = process.argv.slice(2)
  process.stdout.write(renderCask({ version, arm64, x64 }))
}
