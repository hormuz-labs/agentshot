<p align="center">
  <img src="build/icons/256x256.png" width="96" alt="AgentShot">
</p>

<h1 align="center">AgentShot</h1>

<h3 align="center">The video editor you talk to.<br><sub>Give notes. Point at the frame. Get the cut.</sub></h3>

<p align="center">
  <a href="https://github.com/hormuz-labs/agentshot/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/hormuz-labs/agentshot?style=flat&color=262626&label=release"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-GPLv3-262626?style=flat"></a>
  <img alt="macOS · Windows · Linux · iOS · Android" src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux%20·%20iOS%20·%20Android-262626?style=flat">
  <a href="https://github.com/hormuz-labs/agentshot/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/hormuz-labs/agentshot?style=flat&color=f2a541&label=stars"></a>
</p>

<p align="center">
  <a href="#get-agentshot"><b>Download</b></a> ·
  <a href="https://agentshot.si">Website</a> ·
  <a href="#what-a-session-feels-like">See a session</a> ·
  <a href="ROADMAP.md">Roadmap</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<p align="center">
  <img src="docs/readme-hero.webp" alt="AgentShot, give notes, get cuts: the conversation with the agent's steps and reply, and the film beside it with a lower third boxed on the frame and a before / after proposal to keep or reject" width="100%">
</p>

<p align="center">
  <code>brew install hormuz-labs/tap/manul</code>
  <br>
  <sub>macOS · <a href="#get-agentshot">Windows, Linux and phones below</a> · free and open source, forever</sub>
</p>

---

## What is AgentShot

This is the Manul monorepo: the desktop app (`src/`), [website](site/README.md) (`site/`),
[account service](account/README.md), [AI gateway](gateway/README.md), and mobile clients (`mobile/`).
See [workspace and hosting](docs/workspace.md) for development commands and deployment setup.

AgentShot is **a video editor you direct by talking**. Drop in your footage, say what you want, and point at the frame when something's off. It makes the cut **on your own computer** and shows you a before / after of every change, to keep or send back. You never have to touch a timeline.

<p align="center">
  <img src="docs/point.webp" alt="A box drawn around the cat's face with the note “zoom in on this grumpy face”, then AgentShot's before / after of the zoom, ready to keep or send back" width="100%">
</p>

https://github.com/user-attachments/assets/084276fb-6129-47e2-9cba-4724c1432990

<p align="center"><sub>90 seconds with AgentShot, starring the grumpiest cat on Earth. Pallas's cat footage: BBC, <i>Frozen Planet II</i>.</sub></p>

<table>
<tr>
<td width="33%" align="center" valign="top">
<h3>① Drop</h3>
<sub>Footage, a folder, a zip, or nothing at all: start from an example or have your product filmed.</sub>
</td>
<td width="33%" align="center" valign="top">
<h3>② Point &amp; say</h3>
<sub>Box the frame, drag across the timeline, or just type. “Cut the ums.” “Blur this.” “Name on screen here.”</sub>
</td>
<td width="33%" align="center" valign="top">
<h3>③ Keep or send back</h3>
<sub>Every edit is a proposal you scrub before and after. Nothing is ever overwritten.</sub>
</td>
</tr>
</table>

---

## Why it's different

Video editors make **you** operate them. AI video tools take your footage away and hand back whatever they made. AgentShot works the way a director works with a good editor in the room.

<table>
<tr>
<td width="50%" valign="top">

<img src="docs/icons/mouse-pointer-click.svg" width="44" alt="">

### You point. It edits.
Draw a box around a number plate that needs blurring. Drag across the sentence that drags on. Click the one word in a title that's wrong. Your note sits on that exact spot and moment, and that's the spot AgentShot changes.

</td>
<td width="50%" valign="top">

<img src="docs/icons/git-compare-arrows.svg" width="44" alt="">

### It proposes. You decide.
Nothing is overwritten. Every edit arrives as a new version you can scrub before and after, then keep or send back with a reply. Every version you ever kept is one click away.

</td>
</tr>
<tr>
<td width="50%" valign="top">

<img src="docs/icons/film.svg" width="44" alt="">

### Your pixels stay real.
AgentShot cuts **your** footage. It never swaps your shots for generated ones: generated b-roll is coming, but only where you ask, labelled as generated. Titles, lower thirds and captions are real typography, drawn frame-perfect, and you can still drag the words around after AgentShot has made them.

</td>
<td width="50%" valign="top">

<img src="docs/icons/lock-keyhole.svg" width="44" alt="">

### Your footage stays home.
No upload queue, no cloud project, no waiting for a render farm. The editing and even the transcription run on your computer. The AI you bring your own key for only ever sees text and still frames.

</td>
</tr>
</table>

---

## What a session feels like

> **You:** cut the ums, and the bit where I lose my train of thought
>
> **AgentShot:** Cut 9 fillers and the restart at 0:42. *2:31 → 2:12.* &nbsp; `before / after` &nbsp; **Keep** · **Send back**
>
> **You:** *(draws a box over a parked car, 0:18–0:24)* blur this number plate
>
> **AgentShot:** Blurred that box from 0:18 to 0:24. The rest of the shot is untouched.
>
> **You:** put my name on screen when I introduce myself, and add quiet music under the whole thing
>
> **AgentShot:** Lower third "Sara Malik · Product designer" at 0:04. Music looped to 2:12, dipping under every sentence.
>
> **You:** now a vertical one for Shorts, captions burned in

<sub>An example of the kind of conversation AgentShot is built for. Every reply comes with a before / after you can scrub.</sub>

---

## Point, then say it

The conversation fills the window, and your film plays beside it with each proposal ready to compare. To point at something, draw a box on the picture (<kbd>B</kbd>), drag across the timeline, or press <kbd>N</kbd> at a moment, and a message box opens right there: say what should change and press <kbd>↵</kbd>.

<p align="center">
  <img src="docs/inline.png" alt="A box drawn around the lower third on the frame, with a message box open just under it: “make the name bigger”" width="100%">
</p>

Your projects live in the sidebar, the one on screen opened up into its chats and its files: click a file to attach it to your next message, or drag footage onto the timeline to put it in the film. <kbd>⌘Z</kbd> takes any of it back. Drag a divider to give the film more room, or keep dragging to fold a pane away.

<table>
<tr>
<td width="50%"><img src="docs/start.png" alt="The start screen: drop a video and say what you want in one box, or start from an idea"></td>
<td width="50%"><img src="docs/dark.png" alt="The same project in the dark theme"></td>
</tr>
</table>

<sub>Light by default, dark if you prefer, or follow the system: <b>Settings → Appearance</b>. The little cat beside your message follows your cursor, waves when an edit is finished, takes a catnap when you leave it alone, and reacts when you pet it.</sub>

---

## No footage? Start from an example

Under the message box are **233 motion videos** people made with Claude, each with the prompt that made it, collected by [prompt-motion.com](https://prompt-motion.com). Hover one to watch it; open it for the whole video with sound, who made it and their prompt.

<p align="center">
  <img src="docs/gallery.png" alt="The gallery under the message box: tags to filter by, and a grid of motion videos, each credited to its maker" width="100%">
</p>

Pick **Use this example**, say what yours is about, and AgentShot makes your video the way that one was made: it reads the prompt, studies the video, asks for what it needs (your words, your logo, a track), and shows you a storyboard before it makes a frame. The scenes are real motion graphics, so a note like “the title lands late” changes one scene, not the film.

<p align="center">
  <img src="docs/example.png" alt="An example opened: the whole video playing with sound, its maker and a link to their post, the prompt that made it, and Use this example" width="100%">
</p>

<sub>Every video and prompt belongs to the person credited on it; the app links to their post. The videos stream when you watch them, so they don’t add to the download.</sub>

---

## No video yet? Have it filmed

Ask for *“a walkthrough of app.example.com: sign up and make a first project”*. AgentShot tries the product in a browser first, without filming, then shows you a storyboard: one line per step, what it will do and what the voice will say. Say **“film it”** and it films the whole thing in one take: real clicks, typing you can watch, smooth scrolling.

Then it edits like a pro would: cuts the time it spent thinking, speeds through slow loads, holds each step until its line is said, zooms in on what's being done, and draws a cursor gliding into each click. Ask for changes in your own words (“tighter”, “less zoom”, “say it differently in step 3”): nothing is filmed again, and lines you kept keep their voice.

<sub>Filmed in your own Chrome, where you're already signed in, through <a href="https://github.com/Tencent/BrowserSkill">BrowserSkill</a> (without it, in AgentShot's own browser). Nothing to set up; turn on Chrome's remote debugging (chrome://inspect/#remote-debugging) for up to 60 frames a second instead of about 10. The agent's overlay never shows on film, and filming stops while you sign in.</sub>

---

## What's in the box

<table>
<tr>
<td width="56" align="center"><img src="docs/icons/scissors.svg" width="36" alt=""></td>
<td><b>Word-accurate cuts</b><br>Every spoken word is transcribed with its timing, and each cut point is moved into the quiet between words, so "cut the ums" or "drop the second take" lands on the exact word</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/scan-eye.svg" width="36" alt=""></td>
<td><b>It watches the whole film first</b><br>Who speaks when, every shot, camera shake, exposure, frozen and black frames, faces and objects, loudness and pauses, and the music's tempo, bars and drops, all measured on your computer. So "keep only Ravi's answers", "lose the shaky bits" and "cut on the beat after the drop" mean something exact</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/type.svg" width="36" alt=""></td>
<td><b>Titles it designs</b><br>Title cards, lower thirds, callouts, charts and animated text, timed to your film. Drag, resize or retype any word on the picture afterwards, or click one and ask for a change to just that</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/audio-waveform.svg" width="36" alt=""></td>
<td><b>A mix you hear live</b><br>Music loops to the length of your film and ducks under speech, and you hear the mix as the film plays, before anything renders</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/ratio.svg" width="36" alt=""></td>
<td><b>One film, every shape</b><br>16:9 for YouTube, 9:16 for Shorts, Reels and TikTok, 1:1 for feeds. The crop follows whoever is in frame, and captions go in burned or as a file</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/paperclip.svg" width="36" alt=""></td>
<td><b>Your files, put to use</b><br>Drop in subtitles, music, your logo, fonts and LUTs, or a whole folder or zip of them. AgentShot says what each one is and the edit uses them</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/at-sign.svg" width="36" alt=""></td>
<td><b>Point at anything by name</b><br>Type @ and pick a file, a version you kept or a title AgentShot made: "put @logo.png bottom right and @song.mp3 under the intro"</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/globe.svg" width="36" alt=""></td>
<td><b>Its own browser</b><br>It looks up references and finds footage in a browser of its own, never yours, unless you switch that on</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/brain.svg" width="36" alt=""></td>
<td><b>A memory for taste, and the craft</b><br>Say "captions are always yellow" once and every project after knows it. It also knows how each kind of film is cut: talking heads, tutorials, Shorts and Reels, promos, montages, motion graphics, cleanup and repair</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/layers-2.svg" width="36" alt=""></td>
<td><b>Every film in the sidebar, and any model</b><br>Open projects keep working in the background. Claude, Gemini or GPT, or any OpenAI- or Anthropic-compatible endpoint, picked per project</td>
</tr>
</table>

---

## Your phone, from anywhere

<table>
<tr>
<td width="33%" valign="top">

<img src="docs/icons/qr-code.svg" width="44" alt="">

### Scan once
Turn on **Settings → Mobile** and AgentShot shows a QR code. Scan it with the [companion app](mobile/README.md) and you're paired, pinned to your computer's certificate.

</td>
<td width="33%" valign="top">

<img src="docs/icons/smartphone.svg" width="44" alt="">

### Direct on the go
Shoot and send clips, ask for edits, draw boxes on the frame, review before / after proposals and share the export, all from your phone.

</td>
<td width="33%" valign="top">

<img src="docs/icons/server.svg" width="44" alt="">

### Heavy lifting elsewhere
Hand renders and agent edits to a **Cloud Worker**, or your own workstation running `manul --worker`. Projects sync peer to peer.

</td>
</tr>
</table>

Away from home, the phone and your computer meet over AgentShot's own private mesh (Headscale/WireGuard, built into the app; no Tailscale install, no IP addresses, no port forwarding). Traffic stays end-to-end encrypted and pinned. <sub>Pairing from anywhere is on Android today; iOS pairs on the same Wi-Fi, with the code shown under the QR.</sub>

**Cloud workers.** A cloud worker is AgentShot running headless as a lendable worker, leased to one person at a time. Your computer can hand it renders and agent edits (Settings → Mobile → Use cloud worker), and the phone can work on one when none of your computers is on (Your computers → Use a cloud worker). Whoever leases it sees only the projects they made there, and its own keys and settings stay its own. To lend one of your computers, turn on **Share this computer as a cloud worker** in Settings → Mobile and enter the pool key (the account service's `WORKER_POOL_SECRET`). That starts a separate background worker with its own profile and projects folder: none of your projects, keys or sign-in go with it. On a server, AgentShot started with `--worker` and `MANUL_POOL_SECRET` does the same.

---

## You stay in charge

<table>
<tr>
<td width="50%" valign="top" align="center">
<img src="docs/settings-browser.png" alt="Settings, Browser: AgentShot's own browser by default, your Chrome only if you choose it" width="100%">
<br><b>Which browser it uses</b><br>
<sub>Its own, by default. Yours only if you say so, or to film a product walkthrough where you're signed in.</sub>
</td>
<td width="50%" valign="top" align="center">
<img src="docs/settings-tools.png" alt="Settings, Tools: built-in tools, speech recognition found on this computer, heavier tools downloaded only when needed" width="100%">
<br><b>What it installs</b><br>
<sub>Nothing heavy until you ask, and it uses what you already have.</sub>
</td>
</tr>
</table>

On first run AgentShot asks whether to send crash reports and usage statistics. **Both start unticked.** It never sends your footage, file or project names, prompts, transcripts or keys: [exactly what is sent](telemetry/README.md).

---

## Get AgentShot

> [!NOTE]
> AgentShot is in early days. Expect rough edges, and please [open an issue](https://github.com/hormuz-labs/agentshot/issues) when you hit one.

| Platform | Install |
| --- | --- |
| **macOS** | `brew install hormuz-labs/tap/manul` |
| **Windows 10 (1903+) / 11, x64** | [`AgentShot-windows-x64-Setup.exe`](https://github.com/hormuz-labs/agentshot/releases/latest) |
| **Debian / Ubuntu** | signed apt repository, [three commands below](#debian--ubuntu) |
| **Other Linux** | AppImage from the [latest release](https://github.com/hormuz-labs/agentshot/releases/latest) |
| **Android / iOS** | the companion app in [`mobile/`](mobile/README.md) |

<details>
<summary><b>macOS: never used Terminal?</b></summary>
<br>

Press <kbd>⌘</kbd> <kbd>Space</kbd>, type **Terminal**, press <kbd>↵</kbd>, paste the line below and press <kbd>↵</kbd> again.

```bash
brew install hormuz-labs/tap/manul
```

If it says `brew: command not found`, install [Homebrew](https://brew.sh) first (one line, same window), then paste it again.

</details>

<details>
<summary><b>Windows</b></summary>
<br>

From the [latest release](https://github.com/hormuz-labs/agentshot/releases/latest), download `AgentShot-windows-x64-Setup.exe` and run it. It is a single offline installer: no wizard, and no Node, Git, Python, FFmpeg or developer tools to install. It installs for your account, adds Desktop and Start menu shortcuts, opens AgentShot, and later versions update themselves inside the app. Speech models and optional heavier tools download inside AgentShot when needed.

Requires Windows 10 version 1903 (build 18362) or newer, or Windows 11, x64. Windows ARM64 and 32-bit are not built. The installer is signed with Hormuz Labs' own certificate rather than a public one, so SmartScreen may ask once: **More info → Run anyway**.

</details>

<a name="debian--ubuntu"></a>
<details>
<summary><b>Debian / Ubuntu</b></summary>
<br>

Add the signed apt repository once and apt keeps AgentShot up to date:

```bash
curl -fsSL https://apt.agentshot.si/manul.gpg | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/manul.gpg &&
echo "deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.agentshot.si stable main" | sudo tee /etc/apt/sources.list.d/manul.list &&
sudo apt update && sudo apt install manul
```

</details>

<details>
<summary><b>Let your coding agent install it</b></summary>
<br>

Hand this to Claude Code, Cursor, Codex or any other coding agent:

```text
Install AgentShot from https://github.com/hormuz-labs/agentshot. On macOS run `brew install hormuz-labs/tap/manul`. On Windows, download `AgentShot-windows-x64-Setup.exe` from https://github.com/hormuz-labs/agentshot/releases/latest and run it. On Debian or Ubuntu, add the apt repository at https://apt.agentshot.si (the three commands are on that page) and run `sudo apt install manul`; on other Linux, download the AppImage for this machine's architecture from https://github.com/hormuz-labs/agentshot/releases/latest. Then open AgentShot.
```

</details>

### First run

- **An AI key.** Sign in under **Settings → Keys → AgentShot key**: new accounts start with 1,000 credits, and Pro and Max plans (shared with Pitch: same email, same plan) add more every month. Or bring your own Claude, Gemini or OpenAI key, kept in your system's keychain; your own keys are used first.
- **A guided start.** A first-run walkthrough connects a key, adds footage and gives your first direction; the editor tour then covers notes, boxes, files, proposals, versions and export. Replay it from the sidebar's **Product tour**, **Help → Product Tour**, or the command palette (<kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd>).
- **Hack on it.** Run it from source with **[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

## Where it's going

<table>
<tr>
<td width="72"><b>Now</b></td>
<td>Directing by talking and pointing, titles, music, every export shape, mobile companion with pairing from anywhere, cloud &amp; home workers</td>
<td width="40" align="center"><img src="docs/icons/circle-dot.svg" width="20" alt=""></td>
</tr>
<tr>
<td width="72"><b>Next</b></td>
<td>Hand the cut to Premiere, Resolve or Final Cut · publish straight to YouTube · generated b-roll where asked</td>
<td width="40" align="center"><img src="docs/icons/circle-dashed.svg" width="20" alt=""></td>
</tr>
<tr>
<td width="72"><b>Later</b></td>
<td>Clients leave notes on the frame · shared brand kits and skills · teams</td>
<td width="40" align="center"><img src="docs/icons/circle-dashed.svg" width="20" alt=""></td>
</tr>
</table>

<p align="center"><b><a href="ROADMAP.md">See the full roadmap →</a></b></p>

---

## Free, open, and yours

AgentShot is free and open source under the [GNU GPL v3](LICENSE) (or later): use it, change it, ship it, edit paid work with it. If you distribute a changed version, share its source under the same licence, and keep the [NOTICE](NOTICE) attribution.

If you like where it's going, **a ⭐ helps other people find it.**

<br>

<p align="center">
  <img src="build/icons/64x64.png" width="28" alt=""><br>
  <sub>Named after the <b>manul</b>, the Pallas cat: small, patient, and unbothered by anything.</sub><br>
  <sub><a href="LICENSE">GPL-3.0</a> &nbsp;·&nbsp; <a href="THIRD_PARTY_NOTICES.md">Third-party notices</a> &nbsp;·&nbsp; <a href="CONTRIBUTING.md">Contribute</a> &nbsp;·&nbsp; Made by <a href="https://github.com/hormuz-labs">Hormuz Labs</a></sub>
</p>
