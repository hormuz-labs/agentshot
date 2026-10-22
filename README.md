<p align="center">
  <img src="build/icons/256x256.png" width="88" alt="Manul">
</p>

<h1 align="center">Manul: the video editor you talk to</h1>

<p align="center">
  <img src="docs/readme-hero.webp" alt="Manul, give notes, get cuts: the conversation with the agent's steps and reply, and the film beside it with a lower third boxed on the frame and a before / after proposal to keep or reject" width="100%">
</p>

<p align="center">
  <a href="https://manul.si">Website</a> ·
  <a href="#get-manul">Download</a> ·
  <a href="ROADMAP.md">Roadmap</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="https://github.com/hormuz-labs/manul/releases">Releases</a>
</p>

<p align="center">
  <a href="https://github.com/hormuz-labs/manul/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/hormuz-labs/manul?style=flat&color=262626&label=release"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache%202.0-262626?style=flat"></a>
  <img alt="macOS · Windows · Linux" src="https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux-262626?style=flat">
  <a href="https://github.com/hormuz-labs/manul/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/hormuz-labs/manul?style=flat&color=f2a541&label=stars"></a>
</p>

---

## What is Manul

Manul is **a video editor you direct by talking**. Drop in your footage, say what you want, and point at the frame when something's off. It makes the cut on your own computer and shows you a before / after of every change, to keep or send back. You never have to touch a timeline.

It's **free and open source** under Apache-2.0, and stays free. If you like where it's going, a star (top right of this page) helps other people find it.

<p align="center">
  <img src="docs/point.webp" alt="A box drawn around the cat's face with the note “zoom in on this grumpy face”, then Manul's before / after of the zoom, ready to keep or send back" width="100%">
</p>

https://github.com/user-attachments/assets/084276fb-6129-47e2-9cba-4724c1432990

<p align="center"><sub>90 seconds with Manul, starring the grumpiest cat on Earth. Pallas's cat footage: BBC, <i>Frozen Planet II</i>.</sub></p>

---

## Why it's different

Video editors make **you** operate them. AI video tools take your footage away and hand back whatever they made. Manul works the way a director works with a good editor in the room.

<table>
<tr>
<td width="50%" valign="top">

<img src="docs/icons/mouse-pointer-click.svg" width="44" alt="">

### You point. It edits.
Draw a box around a number plate that needs blurring. Drag across the sentence that drags on. Click the one word in a title that's wrong. Your note sits on that exact spot and moment, and that's the spot Manul changes.

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
Manul cuts **your** footage. It never swaps your shots for generated ones: generated b-roll is coming, but only where you ask, labelled as generated. Titles, lower thirds and captions are real typography, drawn frame-perfect, and you can still drag the words around after Manul has made them.

</td>
<td width="50%" valign="top">

<img src="docs/icons/lock-keyhole.svg" width="44" alt="">

### Your footage stays home.
No upload queue, no cloud project, no waiting for a render farm. The editing and even the transcription run on your computer. The AI you bring your own key for only ever sees text and still frames.

</td>
</tr>
</table>

---

## Point, then say it

The conversation fills the window, and your film plays beside it with each proposal ready to compare. To point at something, draw a box on the picture (<kbd>B</kbd>), drag across the timeline, or press <kbd>N</kbd> at a moment, and a message box opens right there: say what should change and press <kbd>↵</kbd>. It goes to Manul with what you pointed at, and shows in the conversation like anything else you send.

<p align="center">
  <img src="docs/inline.png" alt="A box drawn around the lower third on the frame, with a message box open just under it: “make the name bigger”" width="100%">
</p>

Your projects are in the sidebar, the one on screen opened up into its chats and its files: click a file to attach it to your next message, or drag footage onto the timeline to put it in the film. Hover a project to close it or move its whole folder to the Trash. Drag a piece by its name to move it somewhere else; <kbd>⌘Z</kbd> takes any of it back. Drag a divider to give the film more room, or keep dragging to fold a pane away.

<table>
<tr>
<td width="50%"><img src="docs/start.png" alt="The start screen: drop a video and say what you want in one box, or start from an idea"></td>
<td width="50%"><img src="docs/dark.png" alt="The same project in the dark theme"></td>
</tr>
</table>

<sub>Light by default, dark if you prefer, or follow the system: <b>Settings → Appearance</b>.</sub>

The little Manul beside your message follows your cursor, blinks, and reacts when you pet it. The three small icons under
its status give you a high-five, a throaty growl, and a sound toggle; hover for a tooltip. It waves when an edit is finished,
and takes a catnap when you leave it alone. The full-body 3D cat is also Manul’s app logo.

---

## No footage? Start from an example

Under the message box are 233 motion videos people made with Claude, each with the prompt that made it, collected by
[prompt-motion.com](https://prompt-motion.com) and filed under the same tags. Hover one to watch it; open it for the
whole video with sound, who made it and their prompt.

<p align="center">
  <img src="docs/gallery.png" alt="The gallery under the message box: tags to filter by, and a grid of motion videos, each credited to its maker" width="100%">
</p>

Pick **Use this example**, say what yours is about, and Manul makes your video the way that one was made: it reads the
prompt, studies the video, asks for what it needs (your words, your logo, a track), and shows you a storyboard before it
makes a frame. The scenes are real motion graphics, so a note like “the title lands late” changes one scene, not the film.
Or skip the gallery: describe a motion video in the box, or give it a video of your own whose look to match.

<p align="center">
  <img src="docs/example.png" alt="An example opened: the whole video playing with sound, its maker and a link to their post, the prompt that made it, and Use this example" width="100%">
</p>

<sub>Every video and prompt belongs to the person credited on it; the app links to their post. The videos stream when you watch them, so they don’t add to the download.</sub>

---

## No video yet? Have it filmed

Ask for a walkthrough of your product in the message box (“a walkthrough of app.example.com: sign up and make a first
project”). There's nothing to set up. Manul tries the product in its browser first, without filming, then shows you a
storyboard, one line per step: what it will do and what the voice will say. Say “film it” and it films the whole thing
in one take: real clicks, typing you can watch, smooth scrolling. Then it cuts the time it spent thinking, speeds
through slow loads, holds each step until its line is said, zooms in on what's being done, and draws a cursor gliding
into each click. Ask for changes in your own words (“tighter”, “less zoom”, “say it differently in step 3”): nothing is
filmed again, and lines you kept keep their voice.

<sub>Filmed in your own Chrome, where you're already signed in, through <a href="https://github.com/Tencent/BrowserSkill">BrowserSkill</a>
(without it, in Manul's own browser). Nothing to set up; if you turn on Chrome's remote debugging
(chrome://inspect/#remote-debugging), the motion gets smoother: up to 60 frames a second instead of about 10. The agent's
“controlling” overlay never shows on film, and filming stops while you sign in.</sub>

---

## What a session feels like

> **You:** cut the ums, and the bit where I lose my train of thought
>
> **Manul:** Cut 9 fillers and the restart at 0:42. *2:31 → 2:12.* &nbsp; `before / after` &nbsp; **Keep** · **Send back**
>
> **You:** *(draws a box over a parked car, 0:18–0:24)* blur this number plate
>
> **Manul:** Blurred that box from 0:18 to 0:24. The rest of the shot is untouched.
>
> **You:** put my name on screen when I introduce myself, and add quiet music under the whole thing
>
> **Manul:** Lower third "Sara Malik · Product designer" at 0:04. Music looped to 2:12, dipping under every sentence.
>
> **You:** now a vertical one for Shorts, captions burned in

<sub>An example of the kind of conversation Manul is built for. Every reply comes with a before / after you can scrub.</sub>

---

## What's in the box

<table>
<tr>
<td width="56" align="center"><img src="docs/icons/scissors.svg" width="36" alt=""></td>
<td><b>Word-accurate cuts</b><br>Every spoken word is transcribed with its timing, and each cut point is moved into the quiet between words, so "cut the ums" or "drop the second take" lands on the exact word</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/scan-eye.svg" width="36" alt=""></td>
<td><b>It watches the whole film first</b><br>Before it edits, Manul measures your footage on your computer: who speaks when, every shot, camera shake, exposure, frozen and black frames, where the faces and objects are, loudness and pauses, and the music's tempo, bars and drops. So "keep only Ravi's answers", "lose the shaky bits" and "cut on the beat after the drop" all mean something exact</td>
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
<td><b>Your files, put to use</b><br>Drop in subtitles, music, your logo, fonts and LUTs, or a whole folder or zip of them. Manul says what each one is, they sit under the project in the sidebar, and the edit uses them</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/at-sign.svg" width="36" alt=""></td>
<td><b>Point at anything by name</b><br>Type @ in your message and pick a file, a version you kept or a title Manul made: "put @logo.png bottom right and @song.mp3 under the intro"</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/globe.svg" width="36" alt=""></td>
<td><b>Its own browser</b><br>It looks up references and finds footage in a browser of its own, never yours, unless you switch that on</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/brain.svg" width="36" alt=""></td>
<td><b>A memory for taste, and the craft</b><br>Say "captions are always yellow" once and every project after that knows it. It also knows how each kind of film is cut: talking heads, tutorials, Shorts and Reels, promos and montages, motion graphics, cleanup and repair</td>
</tr>
<tr>
<td width="56" align="center"><img src="docs/icons/layers-2.svg" width="36" alt=""></td>
<td><b>Every film in the sidebar, and any model</b><br>Your projects in one list, searchable, the one on screen opened up into its chats and its files; open ones keep working in the background. Claude, Gemini or GPT, or any OpenAI- or Anthropic-compatible endpoint, picked per project</td>
</tr>
</table>

---

## You stay in charge

<table>
<tr>
<td width="50%" valign="top" align="center">
<img src="docs/settings-browser.png" alt="Settings, Browser: Manul's own browser by default, your Chrome only if you choose it" width="100%">
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

---

## Get Manul

> **Manul is in early days.**

```bash
brew install hormuz-labs/tap/manul     # macOS
```

<sub>Never used Terminal? Press <kbd>⌘</kbd> <kbd>Space</kbd>, type <b>Terminal</b>, press <kbd>↵</kbd>, paste the line above and press <kbd>↵</kbd> again. If it says <code>brew: command not found</code>, install <a href="https://brew.sh">Homebrew</a> first (one line, same window), then paste it again.</sub>

Or hand it to your coding agent (Claude Code, Cursor, Codex…) and let it do the install:

```text
Install Manul from https://github.com/hormuz-labs/manul. On macOS run `brew install hormuz-labs/tap/manul`. On Windows, download `Manul-windows-x64-Setup.exe` from https://github.com/hormuz-labs/manul/releases/latest and run it. On Debian or Ubuntu, add the apt repository at https://apt.manul.si (the three commands are on that page) and run `sudo apt install manul`; on other Linux, download the AppImage for this machine's architecture from https://github.com/hormuz-labs/manul/releases/latest. Then open Manul.
```

On Debian or Ubuntu, add the signed apt repository once and apt keeps Manul up to date:

```bash
curl -fsSL https://apt.manul.si/manul.gpg | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/manul.gpg &&
echo "deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.manul.si stable main" | sudo tee /etc/apt/sources.list.d/manul.list &&
sudo apt update && sudo apt install manul
```

Other Linux: grab the AppImage from the [latest release](https://github.com/hormuz-labs/manul/releases/latest). More at **[manul.si](https://manul.si)**.

**Windows x64:** from the [latest release](https://github.com/hormuz-labs/manul/releases/latest), download `Manul-windows-x64-Setup.exe` and run it.
It is a single offline installer: no wizard, package manager, Node, Git, Git Bash, Python, FFmpeg or developer tools to install.
It installs for your account, creates Desktop and Start menu shortcuts, and opens Manul; later versions update themselves inside the app.
The app and core tool executables are bundled; speech models and optional heavier tools still download inside Manul when requested.
Requires **Windows 10 version 1903 (build 18362) or newer, or Windows 11, x64**. Windows ARM64 and 32-bit are not built.

It is signed with Hormuz Labs' own certificate rather than a public one, so SmartScreen may ask once: **More info → Run anyway**.

It's free and open source under the [Apache License 2.0](LICENSE): use it, change it, ship it, edit paid work with it.
Keep the [NOTICE](NOTICE) attribution when you redistribute it. No AI key of your own? Sign in under **Settings → Keys → Manul key**: new accounts start with 1,000 credits, and Pro and Max plans (shared with Pitch: same email, same plan) add more every month. Or bring a Claude, Gemini or OpenAI key (it's kept in your system's keychain); your own keys are used first.

On first run Manul asks whether to send crash reports and usage statistics. Both boxes start unticked, and you can change them anytime in Settings → About. It never sends your footage, file or project names, prompts, transcripts or keys. [Exactly what is sent](telemetry/README.md).

A first-run walkthrough shows you how to connect a key, add footage and give your first direction. After you open your
first video, the editor tour covers notes, boxes, files, proposals, versions and export. Replay it anytime using the
sidebar’s **Product tour** button, **Help → Product Tour**, or by searching “tour” in the command palette (**⌘K** on Mac,
**Ctrl+K** on Linux/Windows). The walkthrough remembers completion or dismissal on this computer.

The first time you open Settings, a short Keys and Browser tour explains **Manul key**, **your own provider keys
(BYOK)**, and which browser the assistant uses. Manul records that first open and remembers completion or dismissal in
its local onboarding database.

Want to hack on it? Run it from source with **[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

## Where it's going

<table>
<tr>
<td width="72"><b>Now</b></td>
<td>Directing by talking and pointing, titles, music, every export shape</td>
<td width="40" align="center"><img src="docs/icons/circle-dot.svg" width="20" alt=""></td>
</tr>
<tr>
<td width="72"><b>Next</b></td>
<td>Hand the cut to Premiere, Resolve or Final Cut · publish straight to YouTube</td>
<td width="40" align="center"><img src="docs/icons/circle-dashed.svg" width="20" alt=""></td>
</tr>
<tr>
<td width="72"><b>Then</b></td>
<td>Heavy tools in the cloud · your apps connected</td>
<td width="40" align="center"><img src="docs/icons/circle-dashed.svg" width="20" alt=""></td>
</tr>
<tr>
<td width="72"><b>Later</b></td>
<td>Shoot on your phone straight into a project · clients leave notes on the frame · teams</td>
<td width="40" align="center"><img src="docs/icons/circle-dashed.svg" width="20" alt=""></td>
</tr>
</table>

<p align="center"><b><a href="ROADMAP.md">See the full roadmap →</a></b></p>

<br>

<p align="center">
  <img src="build/icons/64x64.png" width="28" alt=""><br>
  <sub>Named after the <b>manul</b>, the Pallas cat: small, patient, and unbothered by anything.</sub><br>
  <sub><a href="LICENSE">Apache-2.0</a> &nbsp;·&nbsp; <a href="THIRD_PARTY_NOTICES.md">Third-party notices</a> &nbsp;·&nbsp; <a href="CONTRIBUTING.md">Contribute</a> &nbsp;·&nbsp; Made by <a href="https://github.com/hormuz-labs">Hormuz Labs</a></sub>
</p>
