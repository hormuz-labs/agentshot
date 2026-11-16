// Editorial comparisons, not benchmarks. Recheck the linked primary sources before updating the review date.
// Scarlet is pinned to the main-branch snapshot reviewed on this date; missing documentation is not proof of absence.
export const REVIEWED = '2026-11-16'
export const REVIEWED_LABEL = 'November 16, 2026'
export const SCARLET_COMMIT = '52e200ffddee70e16c7db53ed809921a8e5d8bf6'
const scarlet = `https://github.com/Forward-Future/scarlet/blob/${SCARLET_COMMIT}`
const agentshot = 'https://github.com/hormuz-labs/agentshot/blob/main'

export interface Source { id: string; label: string; url: string }
export interface ComparisonRow { feature: string; us: string; them: string; sources: string[] }
export interface Advantage { title: string; text: string; sources: string[] }
export interface Comparison {
  slug: string
  name: string
  tone: string
  category: string
  hook: string
  description: string
  verdict: string
  overview: string
  overviewSources: string[]
  rows: ComparisonRow[]
  advantages: Advantage[]
  chooseThem: string
  chooseUs: string
  prompt: string
  outcome: string
  faqs: { q: string; a: string }[]
  sources: Source[]
}

export const AGENTSHOT_SOURCES: Source[] = [
  { id: 'app', label: 'AgentShot: features, model choice, privacy and mobile availability', url: `${agentshot}/README.md` },
  { id: 'plans', label: 'AgentShot pricing: Local, optional plans and provider costs', url: 'https://agentshot.si/pricing/' },
  { id: 'walkthrough', label: 'AgentShot product-walkthrough skill: explore, storyboard, record and narrate', url: `${agentshot}/resources/skills/product-walkthrough/SKILL.md` },
  { id: 'editing', label: 'AgentShot video-editing skill: shots, speakers, subjects, beats and timeline export', url: `${agentshot}/resources/skills/video-editing/SKILL.md` },
  { id: 'providers', label: 'AgentShot compatible-provider configuration', url: `${agentshot}/src/shared/providers.ts` },
  { id: 'privacy', label: 'AgentShot telemetry: off until the user opts in', url: `${agentshot}/telemetry/README.md` },
]

const local = 'Editing, transcription and analysis on your computer by default. Cloud workers are optional.'
const models = 'Claude, Gemini, OpenAI, or an OpenAI- or Anthropic-compatible endpoint, chosen per project.'
const cost = '$0 for the Local app, no watermark or AgentShot-imposed usage cap. Your model provider bills separately; AgentShot-key plans are optional.'
const demo = 'Give a product URL; the agent explores it, asks you to approve a storyboard, films it in Chrome and composes a narrated walkthrough.'
const modelAdvantage: Advantage = { title: 'Your model. Your terms.', text: 'Bring your own Claude, Gemini or OpenAI key, or use a compatible company gateway or local endpoint. The Local app is free; your provider’s charges and limits still apply.', sources: ['providers', 'plans'] }
const localAdvantage: Advantage = { title: 'Keep the edit on your computer.', text: 'Transcription, analysis and rendering run locally by default. A remote AI provider receives the editing request, transcript context and requested still frames, not the video file. Choosing cloud workers is a separate decision.', sources: ['app'] }
const demoAdvantage: Advantage = { title: 'Film the product, not just a presenter.', text: 'Start with a website URL instead of a screen recording. AgentShot explores the app, shows a storyboard for approval, then records the real workflow and adds step-timed narration, cursor movement and zooms.', sources: ['walkthrough'] }
const phoneAdvantage: Advantage = { title: 'Give notes from your phone.', text: 'The companion is a remote for your computer: mark a moment, box something in the picture, and review the next version. Android is in Google Play testing; iPhone connectivity is on the same Wi-Fi. It is not a standalone mobile editor.', sources: ['app'] }

export const COMPARISONS: Comparison[] = [
  {
    slug: 'scarlet', name: 'Scarlet', tone: 'coral', category: 'Open-source desktop editor',
    hook: 'Beyond the dialogue cut.',
    description: 'AgentShot vs Scarlet: compare two open-source AI video editors on model choice, product-demo filming, media analysis, mobile review and telemetry.',
    verdict: 'AgentShot is the better fit if you want an open-source AI video editor that also films product walkthroughs, works with your own model endpoints and takes review notes from your phone. Scarlet is a compelling choice for dialogue-focused editing with your existing Claude Code or Codex subscription.',
    overview: 'Scarlet, from Forward Future, is an MIT-licensed AI video editor for macOS, Windows and Linux. Its documented workflows include dialogue cleanup, target-length edits, cold opens, Shorts, captions, punch-ins and HTML motion graphics. It renders locally, preserves source footage and exports timelines to other editors. Those are shared capabilities, not exclusive AgentShot advantages.',
    overviewSources: ['scarlet-readme', 'scarlet-skills'],
    rows: [
      { feature: 'AI model connection', us: models, them: 'Claude Code or Codex with an existing subscription. A Gemini CLI runner remains for existing setups; the agent guide notes consumer-account availability ended in June 2026.', sources: ['providers', 'scarlet-agents'] },
      { feature: 'Product URL → filmed demo', us: demo, them: 'Documents editing imported screen recordings, including framing and speeding through waits. Autonomous browser recording from a product URL is not documented in the reviewed workflows.', sources: ['walkthrough', 'scarlet-skills'] },
      { feature: 'Shots, objects and beats', us: 'Local shot-boundary, camera-shake, face/object tracking and music beat/bar analysis, used to guide cuts and reframing.', them: 'Local speech, waveform, loudness, screen-text and face-position measurements. A learned shot-boundary detector is listed as not built yet; general object tracking and music beat-grid analysis are not documented in the reviewed guide.', sources: ['editing', 'scarlet-agents'] },
      { feature: 'Phone-directed review', us: 'Companion remote: time-linked notes, frame boxes and version review. Android in testing; iPhone on the same Wi-Fi.', them: 'Desktop apps are documented. A phone companion is not documented in the reviewed README or workflow library.', sources: ['app', 'scarlet-readme', 'scarlet-skills'] },
      { feature: 'Telemetry default', us: 'Crash reports and usage statistics are off until you opt in.', them: 'Packaged releases send anonymous usage and edit-review events to PostHog. You can disable reporting in Settings or with an environment variable.', sources: ['privacy', 'scarlet-telemetry'] },
      { feature: 'Where footage is edited', us: local, them: 'Projects and rendering stay on your computer. The connected AI provider receives requests and project context, potentially transcript excerpts and frames.', sources: ['app', 'scarlet-readme'] },
      { feature: 'Captions, Shorts and graphics', us: 'Captioned Shorts, reframing, lower thirds and motion graphics, including a gallery of 233 starting examples.', them: 'Captioned Shorts, face-aware framing, punch-ins and HTML motion graphics are documented.', sources: ['app', 'scarlet-skills', 'scarlet-agents'] },
      { feature: 'Editable timeline handoff', us: 'Premiere XML, FCPXML and OpenTimelineIO with footage; keep trimming in Premiere, Resolve or Final Cut.', them: 'Advanced export includes FCPXML, OpenTimelineIO, copied footage, SRT captions and notes on transfer limitations.', sources: ['app', 'scarlet-readme'] },
      { feature: 'License and AI cost', us: 'GPL-3.0-or-later. The Local app costs $0; bring your key and pay your provider, or choose an optional AgentShot-key plan.', them: 'MIT-licensed editor. Documented agent setup uses your existing Claude Code or Codex subscription. Some optional transcription-model weights have separate licensing terms.', sources: ['plans', 'scarlet-readme', 'scarlet-transcription'] },
    ],
    advantages: [demoAdvantage, modelAdvantage, { title: 'Read more than the dialogue.', text: 'AgentShot measures shot boundaries, shake, subjects and the music’s beats and bars. That gives requests like “lose the shaky shots” and “cut on the beat after the drop” concrete evidence beyond transcript cleanup.', sources: ['editing', 'scarlet-agents'] }, phoneAdvantage],
    chooseThem: 'You mainly cut interviews, podcasts or talking heads, prefer Scarlet’s dialogue-cut review workflow, and already pay for Claude Code or Codex. Its MIT license may also suit a proprietary integration better than GPL.',
    chooseUs: 'You want product-demo capture, broader model/provider choice, measured montage editing, phone-directed notes and telemetry that starts off. Pick AgentShot for that broader workflow—not because Scarlet lacks captions, local rendering or motion graphics.',
    prompt: 'A walkthrough of app.example.com: sign up and make a first project.',
    outcome: 'AgentShot tries the product, proposes a storyboard, then films and narrates the workflow after you approve. You do not need to record the screen first.',
    faqs: [
      { q: 'Is AgentShot a Scarlet alternative?', a: 'Yes. Both are open-source desktop AI video editors with local rendering. AgentShot adds a documented product-URL-to-recorded-demo workflow, compatible model endpoints and a phone companion; Scarlet emphasizes dialogue editing through Claude Code or Codex.' },
      { q: 'Does Scarlet already have motion graphics and Shorts?', a: 'Yes. Scarlet documents motion graphics, captions, Shorts and face-position-aware framing. We do not count those shared features as reasons that AgentShot is uniquely better.' },
      { q: 'Are both editors free?', a: 'Both editors are open source, but AI use is not necessarily free. AgentShot Local has no app fee with your own key; provider usage is billed separately. Scarlet documents using an existing Claude Code or Codex subscription. Optional model weights may have separate license terms.' },
      { q: 'Is AgentShot more private than Scarlet?', a: 'Both edit and render locally, while a remote AI provider can receive text context and frames. One concrete difference is telemetry: AgentShot crash reports and usage statistics are opt-in; Scarlet packaged releases report anonymous usage by default, with an opt-out.' },
    ],
    sources: [
      { id: 'scarlet-readme', label: 'Scarlet README: setup, local processing, exports and MIT license', url: `${scarlet}/README.md` },
      { id: 'scarlet-skills', label: 'Scarlet workflow library: dialogue, Shorts, captions and graphics', url: `${scarlet}/skills/README.md` },
      { id: 'scarlet-agents', label: 'Scarlet agent design: harnesses, perception and not-built-yet features', url: `${scarlet}/docs/AI-AGENTS.md` },
      { id: 'scarlet-telemetry', label: 'Scarlet telemetry: packaged defaults and opt-out', url: `${scarlet}/docs/telemetry.md` },
      { id: 'scarlet-transcription', label: 'Scarlet transcription models and separate weight licensing', url: `${scarlet}/docs/transcription-models.md` },
    ],
  },
  {
    slug: 'descript', name: 'Descript', tone: 'violet', category: 'Cloud-connected AI co-editor',
    hook: 'A co-editor. On your terms.',
    description: 'AgentShot vs Descript and Underlord: compare local processing, bring-your-own-model editing, free watermark-free exports and automated product walkthroughs.',
    verdict: 'AgentShot is the better Descript alternative when you prioritize local footage processing, your own model keys and an open-source editor without an app subscription. Descript is a strong fit when you want its hosted collaboration, remote recording and speech-generation tools in one service.',
    overview: 'Descript combines transcript editing with Underlord, a conversational AI video co-editor. Underlord can take editing instructions, make bulk changes and iterate on feedback: chat-based editing is not unique to AgentShot. Descript has announced a $50 million Series C led by the OpenAI Startup Fund; funding is context, not a measure of editing quality.',
    overviewSources: ['descript-underlord', 'descript-funding'],
    rows: [
      { feature: 'Editing interaction', us: 'Type or speak a note, attach it to a moment or frame box, then compare the proposed version.', them: 'Underlord takes natural-language instructions; transcript, scene and timeline editing remain available.', sources: ['app', 'descript-underlord'] },
      { feature: 'Processing and storage', us: local, them: 'Cloud-backed projects. The help center says offline editing is not supported and an internet connection is required for syncing and backups.', sources: ['app', 'descript-cloud'] },
      { feature: 'AI provider choice', us: models, them: 'Underlord and AI tools are provided inside Descript. Bring-your-own editing-model endpoints are not advertised on the reviewed product page.', sources: ['providers', 'descript-underlord'] },
      { feature: 'Free app and exports', us: cost, them: 'The reviewed Free plan lists media/AI allowances and 720p watermarked exports. Paid plans add watermark-free exports and higher allowances.', sources: ['plans', 'descript-underlord'] },
      { feature: 'Record a product from a URL', us: demo, them: 'Screen recording and product-demo creation tools are advertised. Autonomous browser exploration and recording from a URL are not documented on the reviewed page.', sources: ['walkthrough', 'descript-underlord'] },
      { feature: 'Source and customization', us: 'GPL-3.0-or-later code and editable craft skills; inspect and modify your editor.', them: 'Hosted commercial product with its own AI tools and templates; not presented as an open-source, self-hosted editor.', sources: ['app', 'descript-underlord'] },
    ],
    advantages: [localAdvantage, modelAdvantage, demoAdvantage, { title: 'No paid plan just to lose a watermark.', text: 'AgentShot Local includes watermark-free exports without an editor subscription. You still cover AI-provider costs and need a computer capable of the render. Descript’s reviewed free offer has watermark and resolution restrictions.', sources: ['plans', 'descript-underlord'] }],
    chooseThem: 'You want transcript-first editing, Descript Rooms for remote recording, Studio Sound, voice cloning or shared cloud projects. Underlord already offers conversational editing; you do not need to switch just to get a chat interface.',
    chooseUs: 'You want to process footage locally, choose your editing model, change the source or craft skills, and film real product workflows from a URL without paying an editor subscription.',
    prompt: 'Cut the false starts, put my name on screen, then make a vertical one with captions.',
    outcome: 'The agent edits your local footage and returns a version to compare. You choose the model and can send back a note on the exact moment that still needs work.',
    faqs: [
      { q: 'Is AgentShot a free Descript alternative?', a: 'AgentShot Local is free and open source, with watermark-free exports and your own model keys. AI-provider usage is billed separately. Optional AgentShot-key plans are available but are not required to unlock the Local editor.' },
      { q: 'Does Descript have a conversational AI editor?', a: 'Yes. Underlord accepts instructions, makes edits and takes feedback. AgentShot’s differentiators are local processing, compatible model endpoints, open source and automated product-demo recording—not the mere existence of a chat box.' },
      { q: 'Can AgentShot edit without uploading my video?', a: 'Yes, in the default local workflow. Transcription, analysis and rendering stay on your computer. A remote model still receives text context and requested still frames. Optional cloud workers move project material off the computer only if you choose them.' },
      { q: 'Does AgentShot replace every Descript feature?', a: 'No. Choose Descript if its remote recording, cloud collaboration or speech-generation workflow is your priority. This comparison does not claim parity with every Descript feature.' },
    ],
    sources: [
      { id: 'descript-underlord', label: 'Descript Underlord: AI editing, recording tools and current plan limits', url: 'https://www.descript.com/underlord' },
      { id: 'descript-cloud', label: 'Descript help: cloud saving and offline-editing limitations', url: 'https://help.descript.com/working-in-projects/save' },
      { id: 'descript-funding', label: 'Descript announcement: OpenAI Startup Fund-led Series C', url: 'https://www.descript.com/blog/article/all-new-descript-backed-by-openai-startup-fund' },
    ],
  },
  {
    slug: 'veed', name: 'VEED', tone: 'sky', category: 'Browser-based video creation',
    hook: 'Your footage. Not an upload queue.',
    description: 'AgentShot vs VEED: a local, open-source alternative to browser video editing. Compare provider choice, product-demo filming, pricing and cloud workflows.',
    verdict: 'AgentShot is the better VEED alternative for creators who want local editing, their own AI-model connection and source-code control. VEED is a strong fit for browser-based teams that need avatars, dubbing, branded templates and a managed creation service.',
    overview: 'VEED offers browser-based editing, subtitles, screen recording, AI generation, avatars and dubbing. It announced a $35 million investment from Sequoia Capital. The practical difference here is not who funded it: VEED is a managed online workspace, while AgentShot’s default editing workflow runs on your computer.',
    overviewSources: ['veed-product', 'veed-funding'],
    rows: [
      { feature: 'Where you work', us: local, them: 'Online, browser-based video creation and editing; no desktop installation required for the advertised workflow.', sources: ['app', 'veed-product'] },
      { feature: 'AI model connection', us: models, them: 'AI models and generation tools supplied through VEED. Bring-your-own editing-model endpoints are not advertised in the reviewed product description.', sources: ['providers', 'veed-product'] },
      { feature: 'How the editor is paid for', us: cost, them: 'Free to start, with paid plans billed per editor seat. AI generation credits and translation allowances depend on the plan.', sources: ['plans', 'veed-pricing'] },
      { feature: 'Product walkthrough capture', us: demo, them: 'Screen recording, product-demo templates and AI-generated videos are advertised. Automatic exploration and filming of a real web app from its URL are not documented on the reviewed page.', sources: ['walkthrough', 'veed-product'] },
      { feature: 'Source and workflow control', us: 'Open-source editor and editable skills; local projects can be handed off as editable timelines.', them: 'Managed browser tools, templates, team workspaces and APIs. Not presented as an open-source editor you run yourself.', sources: ['app', 'veed-product'] },
      { feature: 'Avatars and localization', us: 'Footage editing, captions, voiceover and motion graphics. We do not claim VEED-equivalent avatar or dubbing features.', them: 'AI avatars, voice cloning, lip sync and dubbing are advertised as part of its creation suite.', sources: ['app', 'veed-product'] },
    ],
    advantages: [localAdvantage, modelAdvantage, demoAdvantage, { title: 'Change the workflow itself.', text: 'AgentShot’s editing skills are plain files, and the editor is open source. You can inspect what it does, adapt its craft rules and use your own infrastructure rather than waiting for a hosted feature.', sources: ['app', 'editing'] }],
    chooseThem: 'You need a no-install browser workflow, team branding, AI avatars, lip sync or multilingual dubbing. VEED’s managed service can be more convenient than maintaining a capable editing computer and model keys.',
    chooseUs: 'You want local footage processing, your own models, an editable open-source workflow, and automatic filming of the actual product rather than an avatar-led or template-based substitute.',
    prompt: 'Film a walkthrough of our dashboard, then add quiet music and captions.',
    outcome: 'Approve the storyboard before recording. AgentShot captures the real interface, composes narration around each step and lets you give follow-up notes on the result.',
    faqs: [
      { q: 'Is AgentShot an offline VEED alternative?', a: 'AgentShot processes and renders footage on your computer by default rather than in a browser service. It is not automatically fully offline: remote AI models, downloads and optional services need a connection. Compatible local model endpoints are supported.' },
      { q: 'Do I need a paid AgentShot plan?', a: 'No. The Local app is free with your own keys and has no watermark or AgentShot-imposed usage cap. Your AI provider’s costs and limits still apply. AgentShot-key plans and cloud workers are optional.' },
      { q: 'Can AgentShot make real product demos?', a: 'Yes. It can explore a website, propose a storyboard, record the approved workflow in Chrome and compose narration, zooms and cursor movement. Recording starts after approval.' },
      { q: 'When is VEED the better choice?', a: 'VEED may be the better choice when browser convenience, shared brand templates, avatars, lip sync or dubbing matter more than local processing and source-code control.' },
    ],
    sources: [
      { id: 'veed-product', label: 'VEED: browser workflow, AI tools, screen recording and avatars', url: 'https://www.veed.io/' },
      { id: 'veed-pricing', label: 'VEED pricing: per-seat billing, AI credits and translation allowances', url: 'https://www.veed.io/pricing' },
      { id: 'veed-funding', label: 'VEED announcement: $35 million from Sequoia Capital', url: 'https://www.veed.io/blog/raising-series-a' },
    ],
  },
  {
    slug: 'kapwing', name: 'Kapwing', tone: 'mint', category: 'Collaborative online editor',
    hook: 'Keep the keys. Keep the files.',
    description: 'AgentShot vs Kapwing and Kai: compare local video editing, model-provider control, watermark-free Local exports and browser-based team collaboration.',
    verdict: 'AgentShot is the better Kapwing alternative if local footage processing, your own model keys and an open-source, watermark-free Local editor come first. Kapwing is a strong fit for teams that want a collaborative browser workspace, localization and integrated generation tools.',
    overview: 'Kapwing combines Kai, a conversational AI assistant, with its Studio timeline and one-click editing tools. It supports footage editing, captions, generation, dubbing and shared workspaces. Its company has publicly announced venture backing, including a seed round led by Kleiner Perkins. Having chat, captions or model-powered tools is not unique to AgentShot.',
    overviewSources: ['kapwing-product', 'kapwing-funding'],
    rows: [
      { feature: 'Footage workflow', us: local, them: 'A cloud-based browser workspace: upload footage, prompt the assistant, then refine in Studio.', sources: ['app', 'kapwing-product'] },
      { feature: 'Conversational editing', us: 'Give typed or spoken notes tied to a moment, frame box or selected range, and compare versions.', them: 'Kai takes prompts to trim, arrange, caption and enhance; direct timeline tools are also available.', sources: ['app', 'kapwing-product'] },
      { feature: 'Model-provider control', us: models, them: 'Multiple integrated AI models are available through Kapwing. Bring-your-own editing-model endpoints are not advertised on the reviewed page.', sources: ['providers', 'kapwing-product'] },
      { feature: 'Watermarks and usage', us: cost, them: 'Free-plan exports have a watermark. Pro removes it; AI features use a credit system.', sources: ['plans', 'kapwing-product'] },
      { feature: 'Real product URL → recording', us: demo, them: 'Generates video from prompts, documents and images, and edits uploaded footage. Autonomous filming of a live product workflow from its URL is not documented on the reviewed page.', sources: ['walkthrough', 'kapwing-product'] },
      { feature: 'Team collaboration and dubbing', us: 'Local projects, before/after review, phone notes and editable timeline handoff. Not a claim of shared browser-workspace or dubbing parity.', them: 'Shared workspaces, real-time comments, Brand Kits and dubbing are advertised.', sources: ['app', 'kapwing-product'] },
    ],
    advantages: [localAdvantage, modelAdvantage, demoAdvantage, { title: 'Export without buying away a watermark.', text: 'AgentShot Local does not watermark your exports or impose an editor usage allowance. Provider charges, available storage and your computer’s render capacity remain real limits. Kapwing’s reviewed free offer includes watermarked exports.', sources: ['plans', 'kapwing-product'] }],
    chooseThem: 'You want teammates editing in a shared browser workspace, commenting in real time, applying Brand Kits or dubbing content. Kai already provides conversational editing and Kapwing integrates several generation models.',
    chooseUs: 'You want the raw video processed locally, your own editing-model endpoint, source you can modify and a product-demo workflow that records the actual web app after you approve the storyboard.',
    prompt: 'Make three Shorts from this interview. Keep the speaker in frame and caption every word.',
    outcome: 'AgentShot uses the local transcript and subject tracking to make vertical cuts, then returns versions you can review and revise with a note.',
    faqs: [
      { q: 'Is AgentShot a free Kapwing alternative without watermarks?', a: 'Yes. AgentShot Local includes watermark-free exports with no app subscription. Bring your own model keys and pay your provider for AI use. Kapwing’s reviewed free offer watermarks exports; its Pro offer removes the watermark.' },
      { q: 'Does Kapwing already have an AI chat editor?', a: 'Yes. Kai supports conversational creation and editing, with Studio for direct adjustments. AgentShot differs in local processing, source-code access, custom editing-model endpoints and automatic product-demo capture.' },
      { q: 'Does supporting many models make the products equivalent?', a: 'No. Kapwing integrates multiple AI models within its service. AgentShot lets you configure your own editing-model provider and endpoint. Integrated model selection and bring-your-own-provider control are different capabilities.' },
      { q: 'When should I keep using Kapwing?', a: 'Keep Kapwing if collaborative browser editing, shared Brand Kits, dubbing or managed generation tools are central to your workflow. AgentShot is aimed at local, model-flexible creation and editing rather than matching every hosted team feature.' },
    ],
    sources: [
      { id: 'kapwing-product', label: 'Kapwing AI editor: Kai, cloud workflow, model integrations, collaboration and watermarks', url: 'https://www.kapwing.com/ai' },
      { id: 'kapwing-funding', label: 'Kapwing company announcement: Kleiner Perkins-led seed funding', url: 'https://www.kapwing.com/blog/kapwing-press-release-06-16-2018/' },
    ],
  },
  {
    slug: 'opus-clip', name: 'OpusClip', tone: 'pink', category: 'AI clipping and publishing',
    hook: 'Make the cut. Own the workflow.',
    description: 'AgentShot vs OpusClip: compare local AI clipping, custom model endpoints, open-source workflows, product-demo capture and social publishing tools.',
    verdict: 'AgentShot is the better OpusClip alternative when you want clipping and video creation on your own computer, with your own model connection and editable source. OpusClip is a strong fit when managed repurposing, social publishing and workflow automation are the priority.',
    overview: 'OpusClip offers AI clipping, subject-aware reframing, captions, an AI editor, team workspaces, APIs and social publishing. Its product family has expanded beyond podcast clipping, so we do not describe it as only a one-click Shorts tool. OpusClip announced funding from SoftBank Vision Fund 2 in March 2025; funding does not establish which editor is better for your job.',
    overviewSources: ['opus-product', 'opus-funding'],
    rows: [
      { feature: 'Where footage is processed', us: local, them: 'Managed web workflow using an uploaded file or a video link.', sources: ['app', 'opus-product'] },
      { feature: 'Clips, reframing and captions', us: 'Prompt-selected Shorts, local face/object tracking and timed captions, reviewed as proposed versions.', them: 'ClipAnything, ReframeAnything, dynamic captions and natural-language clip selection are advertised.', sources: ['app', 'opus-product'] },
      { feature: 'Editing-model choice', us: models, them: 'OpusClip supplies its AI editing and clipping models within the service. Custom editing-model endpoints are not advertised on the reviewed page.', sources: ['providers', 'opus-product'] },
      { feature: 'App fee and processing allowance', us: cost, them: 'Free and paid offers with processing credits and plan-dependent features. Check the current plan rather than assuming unlimited processing.', sources: ['plans', 'opus-product', 'opus-pricing'] },
      { feature: 'Real web-app walkthrough capture', us: demo, them: 'Clipping, reframing and editing existing media are documented. Autonomous recording of a live web-app workflow from a URL is not documented on the reviewed product page.', sources: ['walkthrough', 'opus-product'] },
      { feature: 'Publishing and integrations', us: 'Export locally or hand off an editable timeline. Direct YouTube publishing and a public API/MCP server remain on the roadmap.', them: 'Social publishing, team workspaces and workflow APIs are advertised; its site also advertises XML export.', sources: ['app', 'opus-product', 'opus-funding'] },
    ],
    advantages: [localAdvantage, modelAdvantage, demoAdvantage, { title: 'Inspect and adapt the editor.', text: 'AgentShot’s code and craft skills are available under GPL-3.0-or-later. Keep local project versions, change the editing rules and hand off the timeline when you want to finish elsewhere.', sources: ['app', 'editing'] }],
    chooseThem: 'You need a managed upload-to-publish workflow, social scheduling, team automation or an API. OpusClip already offers reframing and broad video editing, so those alone are not reasons to switch.',
    chooseUs: 'You want local processing, custom model endpoints, source-code access, a phone review remote and automated capture of your real product. You are happy to export and publish yourself rather than rely on a managed publishing service.',
    prompt: 'Find the three best answers, make each a vertical Short, and keep the pauses before the punchlines.',
    outcome: 'AgentShot works from the local transcript and subject measurements, then returns cuts to compare. A follow-up note can change the pacing of one moment without restarting the project.',
    faqs: [
      { q: 'Is AgentShot an OpusClip alternative for Shorts?', a: 'Yes. AgentShot can pick moments from longer footage, reframe them vertically and add timed captions. Its differentiators are local processing, custom editing-model providers and open source—not a claim that OpusClip cannot reframe or caption.' },
      { q: 'Is OpusClip only for podcasts?', a: 'No. Its reviewed product page advertises ClipAnything for different video genres, subject-aware reframing, an AI editor and publishing automation. We compare against those capabilities, not an older podcast-only description.' },
      { q: 'Can AgentShot publish directly to social platforms?', a: 'Direct YouTube publishing is still on AgentShot’s public roadmap. Export the film and publish it yourself today. OpusClip may be a better fit if integrated publishing and automation are requirements.' },
      { q: 'Does AgentShot impose clipping-minute limits?', a: 'The Local editor has no AgentShot-imposed clipping allowance or watermark. Your model provider can impose charges and limits, and local processing depends on your computer. Optional AgentShot-key use is credit-based.' },
    ],
    sources: [
      { id: 'opus-product', label: 'OpusClip: clipping models, reframing, editing, uploads and publishing', url: 'https://www.opus.pro/' },
      { id: 'opus-pricing', label: 'OpusClip current plans and processing credits', url: 'https://www.opus.pro/pricing' },
      { id: 'opus-funding', label: 'OpusClip announcement: SoftBank Vision Fund 2 funding and product links', url: 'https://www.opus.pro/blog/opusclip-raises-a-new-round-of-funding-from-softbank-and-launches-opussearch' },
    ],
  },
]

export const comparisonPath = (slug: string) => `/compare/${slug}/`
