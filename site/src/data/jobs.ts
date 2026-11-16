// One page per job AgentShot does, each written for the words people search with ("remove filler words from video").
// Every claim comes from the README or the craft skill the page links to; keep them in step when either changes.
import motion from './motion.json'

const GH = 'https://github.com/hormuz-labs/agentshot/blob/main'
const ex = (id: string) => motion.find(m => m.id === id)!

export interface Job {
  slug: string
  tone: string
  tag: string
  title: string
  description: string
  h1: string
  grad: string
  intro: string
  video: string
  poster: string
  tall?: boolean
  caption: string
  says: string[]
  steps: { title: string; text: string }[]
  skill: { label: string; url: string }
  compare: string[]
  faqs: { q: string; a: string }[]
}

export const JOBS: Job[] = [
  {
    slug: 'ai-product-demo-video', tone: 'sky', tag: 'product demo videos',
    title: 'AI Product Demo Video Maker: from a URL to a narrated walkthrough · AgentShot',
    description: 'Make a product demo video from your app’s URL. AgentShot tries the product, shows a storyboard, films it in your Chrome and adds the voiceover, zooms and cursor.',
    h1: 'Product demo videos,', grad: 'from just a URL.',
    intro: 'Give AgentShot your product’s address and say what the demo should show. It tries the product first, shows you a storyboard with what the voice will say at each step, then films one take in your own Chrome, where you’re already signed in. You get a narrated walkthrough with the waiting cut out and a zoom on every click.',
    video: '/motion/robj3d3-b18fad.mp4', poster: '/motion/robj3d3-b18fad.jpg',
    caption: `A product film from the motion gallery, by @${ex('robj3d3-b18fad').handle}`,
    says: ['A walkthrough of app.example.com: sign up and make a first project.', 'Show how to invite a teammate, in under a minute.', 'Same demo, but vertical for LinkedIn, with captions.'],
    steps: [
      { title: 'It tries the product first', text: 'Before filming anything, it clicks through the flow you described, so it knows each step and where things are.' },
      { title: 'You approve a storyboard', text: 'One line per step, with what the voice will say. Change a step or a line before a single frame is recorded.' },
      { title: 'It films one take in your Chrome', text: 'Real scrolling and typing, in the browser you already use, with your logins. No screen recorder to set up.' },
      { title: 'It cuts it like an editor would', text: 'Idle time is cut, each click gets a zoom, a cursor is drawn, and each step is held for its line of voiceover.' },
    ],
    skill: { label: 'The product-walkthrough skill AgentShot follows', url: `${GH}/resources/skills/product-walkthrough/SKILL.md` },
    compare: ['descript', 'veed'],
    faqs: [
      { q: 'Do I need to record my screen first?', a: 'No. Give it a URL and it films the product itself, after you approve the storyboard. If you already have a screen recording, give it that instead and it edits the recording.' },
      { q: 'Can it film pages behind a login?', a: 'Yes. It films in your own Chrome, where you’re already signed in, so it sees what you see. Nothing is filmed until you approve the storyboard.' },
      { q: 'Who does the voiceover?', a: 'A generated voice reads the line for each step, from ElevenLabs, Gemini or OpenAI with your own key, or the AgentShot key. Each step is held on screen for as long as its line takes.' },
      { q: 'Is it free?', a: 'The app is free and open source. With your own model key there is no AgentShot charge and no watermark; your model and voice providers bill you for what you use.' },
    ],
  },
  {
    slug: 'remove-filler-words', tone: 'coral', tag: 'clean takes',
    title: 'Remove Filler Words, Ums and Pauses from Video, Free · AgentShot',
    description: 'Remove filler words, ums, false starts and long pauses from video automatically. AgentShot cuts in the silence between words, on your own computer, for free.',
    h1: 'Cut the ums.', grad: 'Keep the person.',
    intro: 'Say “cut the ums, false starts and long pauses” and AgentShot does it from a word-level transcript made on your computer. Each cut lands in the quiet before the next word, so nothing sounds clipped, and it leaves the breath before a punchline. You hear the result before and after, and keep it or send it back.',
    video: '/film/before-after-loop.mp4', poster: '/film/before-after.jpg',
    caption: 'Five edits from the film about AgentShot, each before and after',
    says: ['Cut the ums, the false starts and the long pauses.', 'Drop the second take of the intro.', 'Tighter, but keep the pause before the punchline.'],
    steps: [
      { title: 'It listens to every word', text: 'Whisper runs inside the app and times every word, fillers included, then re-times each one so cuts land on the right syllable.' },
      { title: 'It finds what to cut', text: 'Ums and uhs, false starts like “so the — so the thing is”, repeated takes and long silences. It keeps the last complete attempt.' },
      { title: 'It cuts between words', text: 'Every cut falls in the silence between two words, and pauses are shortened rather than removed, so it still sounds like you.' },
      { title: 'You hear before and after', text: 'It says what it cut (“9 fillers and the restart at 0:42, 2:31 → 2:12”). Too tight? Say so, and it loosens the pauses.' },
    ],
    skill: { label: 'The talking-head skill AgentShot follows', url: `${GH}/resources/skills/talking-head/SKILL.md` },
    compare: ['descript', 'scarlet'],
    faqs: [
      { q: 'Is my video uploaded to remove the filler words?', a: 'No. Transcription and cutting run on your computer. The AI model reads the transcript and a few still frames it asks for, never the video file.' },
      { q: 'Does it remove every pause?', a: 'No, on purpose. Long pauses are shortened, and a breath after a point or before a punchline is kept, because that is pacing. Say “tighter” or “looser” to change it.' },
      { q: 'Can I undo a cut?', a: 'Yes. Nothing is overwritten: every change is a new version you compare before and after. Send it back with a note like “keep the bit at 1:10” and it changes only that.' },
      { q: 'Does it work for podcasts and interviews with several people?', a: 'Yes. It works out who speaks when, so you can say “keep only Ravi’s answers” as well as cutting fillers from each voice.' },
    ],
  },
  {
    slug: 'long-video-to-shorts', tone: 'pink', tag: 'Shorts, Reels and TikToks',
    title: 'Turn Long Videos into Shorts and Reels with Captions · AgentShot',
    description: 'Turn a podcast, stream or talk into vertical Shorts, Reels and TikToks. AgentShot finds the best moments, keeps the speaker in frame and adds word-by-word captions.',
    h1: 'One long video.', grad: 'Three Shorts by lunch.',
    intro: 'Give AgentShot a podcast, a stream or a talk and say how many Shorts you want. It picks the moments worth clipping, reframes 16:9 to 9:16 so whoever is talking stays in frame, and burns in captions that land word by word. Each Short comes back to review and change with a note.',
    video: '/demo/short.mp4', poster: '/demo/short.webp', tall: true,
    caption: 'The after, rendered by the engine AgentShot drives',
    says: ['Find the 3 best moments and make each a vertical Short with captions.', 'Make this a Reel. Captions word by word, always yellow.', 'Start on the punchline, then show the setup.'],
    steps: [
      { title: 'It picks the moments', text: 'From the transcript and who is speaking, it finds clips that stand on their own and open with a hook in the first second.' },
      { title: 'It reframes to 9:16', text: 'Faces and subjects are tracked shot by shot, and the crop follows whoever is talking, so they never leave the frame.' },
      { title: 'It captions every word', text: 'Captions are timed to each word and kept out of the platform’s buttons and the speaker’s face.' },
      { title: 'It exports for each platform', text: '1080 × 1920 at -14 LUFS for Shorts, Reels and TikTok. Say “captions are always yellow” once and later projects remember.' },
    ],
    skill: { label: 'The short-form skill AgentShot follows', url: `${GH}/resources/skills/short-form/SKILL.md` },
    compare: ['opus-clip', 'kapwing'],
    faqs: [
      { q: 'Which apps are the Shorts for?', a: 'YouTube Shorts, Instagram Reels and TikTok: vertical 1080 × 1920, with text kept inside each platform’s safe zone. It can also make 1:1 and 4:5 versions.' },
      { q: 'Does the crop follow the speaker?', a: 'Yes. Faces and objects are tracked shot by shot on your computer, and the 9:16 crop follows the subject or whoever is talking.' },
      { q: 'Can it post the Shorts for me?', a: 'Not yet. You export the files and post them yourself; direct YouTube publishing is on the public roadmap.' },
      { q: 'Is there a limit on how many clips I can make?', a: 'The Local app has no AgentShot limit and no watermark. Your model provider bills you for its use, and rendering speed depends on your computer.' },
    ],
  },
  {
    slug: 'ai-motion-graphics', tone: 'violet', tag: 'motion graphics',
    title: 'AI Motion Graphics from Text: title cards, explainers, launch teasers · AgentShot',
    description: 'Describe a launch teaser, title card or explainer and AgentShot builds it as real motion graphics, scene by scene. Start from 233 examples, each with its prompt.',
    h1: 'Motion graphics,', grad: 'from one sentence.',
    intro: 'Describe what you want, or start from one of 233 motion videos people made with Claude, each with the prompt behind it, and say what yours is about. AgentShot asks for what it needs (your words, logo and a track), shows a storyboard, then builds real motion graphics. Because each scene is built separately, a note like “the title lands late” changes one scene, not the whole film.',
    video: '/motion/tdinh-me-815acb.mp4', poster: '/motion/tdinh-me-815acb.jpg',
    caption: `An example from the gallery, by @${ex('tdinh-me-815acb').handle}`,
    says: ['A 15-second launch teaser in our colours, ending on @logo.png.', `Use the “${ex('tdinh-me-815acb').title}” example, but for our product.`, 'An end card with our handle, on the beat.'],
    steps: [
      { title: 'Start from words or an example', text: 'Describe it from scratch, or pick one of 233 gallery examples and AgentShot studies how that video was made.' },
      { title: 'It asks for what it needs', text: 'Your words, a logo, two colours, a track: only what the film needs, before it starts.' },
      { title: 'You approve a storyboard', text: 'Each scene and what happens in it, before a single frame is made.' },
      { title: 'It builds real, editable scenes', text: 'Scenes are HTML and GSAP rendered frame-exact at 60 fps, with real type, so a note changes one scene and text stays retypable.' },
    ],
    skill: { label: 'The motion-design skill AgentShot follows', url: `${GH}/resources/skills/motion-design/SKILL.md` },
    compare: ['scarlet', 'veed'],
    faqs: [
      { q: 'Is this an AI video generator?', a: 'No. It doesn’t generate pixels. It designs and animates real typography, shapes and your own assets, so the result is exact, on-brand and every word stays editable.' },
      { q: 'What are the 233 examples?', a: 'Motion videos people made with Claude, each with the prompt that made it, collected by prompt-motion.com and credited to their makers. Pick one and say what yours is about.' },
      { q: 'Can I use my logo and brand colours?', a: 'Yes. Attach your logo with @ and say your colours; it asks for what is missing before it starts.' },
      { q: 'Can I put motion graphics on my own footage?', a: 'Yes. Lower thirds, title cards, captions and end cards can go over your footage in the same project, timed to the words or the beat.' },
    ],
  },
]

export const jobPath = (slug: string) => `/${slug}/`
