// How-to guides: each answers a question people search before they know AgentShot exists, then shows the short way.
// Claims about AgentShot come from the README and the craft skills (resources/skills); keep them in step.
import { EXAMPLES } from './examples'

const N = EXAMPLES.length

export interface Guide {
  slug: string
  tone: string
  title: string
  description: string
  h1: string
  minutes: number
  intro: string
  /** why it's worth doing, or what makes it hard by hand */
  why: { heading: string; text: string }
  steps: { title: string; text: string }[]
  /** the same job in AgentShot: what to say, and what comes back */
  short: { say: string; text: string }
  tips: string[]
  faqs: { q: string; a: string }[]
  /** a job page or the gallery, for readers who want the product page next */
  next: { label: string; href: string }
}

export const PUBLISHED = '2026-11-16'
export const PUBLISHED_LABEL = 'November 16, 2026'

export const GUIDES: Guide[] = [
  {
    slug: 'how-to-remove-filler-words-from-video', tone: 'coral', minutes: 4,
    title: 'How to Remove Filler Words from a Video (ums, pauses, false starts)',
    description: 'A step-by-step guide to cutting ums, uhs, long pauses and false starts from a video without making it sound chopped, by hand or automatically with AI.',
    h1: 'How to remove filler words from a video',
    intro: 'Ums, restarts and long pauses make a good take feel slow. Cutting them is simple in principle and tedious in practice: a ten-minute talking video can hide a hundred of them. Here’s how to do it so the result still sounds like a person talking.',
    why: { heading: 'Why it sounds chopped when you do it badly', text: 'Most bad filler cuts fail in one of two ways. The cut lands on the edge of a word and clips a consonant, or every pause is removed and the speaker never breathes. A clean result comes from where you cut and what you leave in, not from how many fillers you find.' },
    steps: [
      { title: 'Get a transcript with word timings', text: 'You need to know where every word starts and ends, fillers included. Many transcribers silently drop “um” and “uh”, so use one that keeps them.' },
      { title: 'Mark the fillers, false starts and repeats', text: 'Look for ums and uhs, sentences that restart (“so the — so the thing is”), and second takes of the same line. For restarts, keep the last complete attempt.' },
      { title: 'Cut in the silence, not on the word', text: 'Place each cut in the quiet gap just before the next word. Cutting inside the gap hides the edit; cutting against the word clips it.' },
      { title: 'Shorten long pauses instead of deleting them', text: 'Bring a long pause down to a short one rather than to zero. Keep the breath after a point lands and the beat before a punchline.' },
      { title: 'Cover the jump cuts', text: 'Each cut makes the picture jump. Hide it with a slight punch-in on alternate cuts, or with b-roll over the join.' },
      { title: 'Listen to the whole thing once', text: 'Play it through at normal speed. Anything that sounds rushed needs a few frames of pause put back.' },
    ],
    short: { say: 'Cut the ums, the false starts and the long pauses.', text: 'AgentShot transcribes on your computer with every filler kept and timed, places each cut in the silence before the next word, and shortens pauses rather than removing them. It tells you what it cut (“9 fillers and the restart at 0:42, 2:31 → 2:12”) and shows a before and after. Too tight? Say “looser” and it puts the pauses back.' },
    tips: ['Don’t remove every “um”. One left in the middle of a thought often sounds more natural than a cut.', 'Cut the picture and the sound at the same point unless you’re covering with b-roll.', 'If two takes say the same thing, choose one before trimming fillers in either.'],
    faqs: [
      { q: 'Can I remove filler words automatically?', a: 'Yes. Tools that work from a word-level transcript can find and cut them for you. AgentShot does it on your own computer from one sentence, and shows the result as a before and after so you can loosen or undo it.' },
      { q: 'Will removing fillers make my video sound unnatural?', a: 'Only if cuts land on words or every pause is removed. Cut in the silence between words and keep short pauses, and it sounds like a cleaner take.' },
      { q: 'How much shorter will the video get?', a: 'It varies with the speaker. As one real example, a 2:31 take came down to 2:12 after cutting nine fillers and one restart.' },
    ],
    next: { label: 'Clean takes in AgentShot', href: '/remove-filler-words/' },
  },
  {
    slug: 'how-to-make-a-product-demo-video', tone: 'sky', minutes: 5,
    title: 'How to Make a Product Demo Video for Your App or SaaS',
    description: 'How to plan, record and edit a product demo video: what to show, how long to make it, how to write the voiceover, and how to get one from just a URL.',
    h1: 'How to make a product demo video',
    intro: 'A product demo shows one person getting one thing done with your product. The hard part isn’t the recording. It’s deciding what to leave out, and then cutting away all the waiting, mis-clicks and dead time.',
    why: { heading: 'What a good demo does', text: 'It answers “what is this and what would I do with it?” in under two minutes. That means one job, shown start to finish, with each step on screen just long enough to follow, and a voice saying why the step matters rather than reading the buttons aloud.' },
    steps: [
      { title: 'Pick one job, not a feature tour', text: 'Choose the thing a new user does first, such as “sign up and create a first project”. A tour of every menu loses people.' },
      { title: 'Write the steps and a line for each', text: 'List five to eight steps. For each, write one short sentence of voiceover about why it matters. That list is your storyboard.' },
      { title: 'Prepare a clean account', text: 'Use realistic sample data, hide anything private, close other tabs and set the browser to a standard size.' },
      { title: 'Record it in one take', text: 'Click through the steps at a natural pace. Don’t stop for mistakes; you’ll cut them.' },
      { title: 'Cut the waiting and zoom on the action', text: 'Remove loading time and hesitation. Zoom in on each click or field so it can be read on a phone.' },
      { title: 'Add the voice, then time the picture to it', text: 'Record or generate the voiceover, and hold each step on screen for as long as its line takes.' },
      { title: 'Export for where it will live', text: '16:9 for your site and YouTube, and a vertical version with captions for social feeds.' },
    ],
    short: { say: 'A walkthrough of app.example.com: sign up and make a first project.', text: 'AgentShot does the whole list from your product’s URL. It tries the product first, shows you the storyboard with the line for each step, then films one take in your own Chrome, where you’re already signed in. It cuts the idle time, zooms on each click, draws the cursor and holds each step for its voiceover. Nothing is filmed until you approve the storyboard.' },
    tips: ['Aim for 60 to 90 seconds. If it runs long, you’re showing two jobs.', 'Say what the viewer gets, not what you’re clicking: “now your team can see it”, not “click Share”.', 'Start on the result if you can, then show how to get there.'],
    faqs: [
      { q: 'How long should a product demo video be?', a: 'One to two minutes for a first demo. Long enough to show one job from start to finish, short enough to watch without deciding to.' },
      { q: 'Do I need to record my screen myself?', a: 'Not with AgentShot: give it the URL and it films the product in your Chrome after you approve the storyboard. If you already have a recording, it can edit that instead.' },
      { q: 'What should the voiceover say?', a: 'One sentence per step about why the step matters to the viewer. Avoid narrating clicks; the picture already shows them.' },
    ],
    next: { label: 'Product demo videos in AgentShot', href: '/ai-product-demo-video/' },
  },
  {
    slug: 'how-to-turn-a-podcast-into-shorts', tone: 'pink', minutes: 5,
    title: 'How to Turn a Podcast or Long Video into Shorts, Reels and TikToks',
    description: 'How to cut a podcast, stream or talk into vertical Shorts: picking moments that stand alone, reframing to 9:16, captions, and exporting for each platform.',
    h1: 'How to turn a podcast into Shorts',
    intro: 'One good hour of conversation holds several clips worth posting. Getting them out means finding moments that make sense without the hour around them, then reshaping a wide picture for a phone.',
    why: { heading: 'What makes a clip work', text: 'People decide in about a second whether to keep watching, usually with the sound off and with the app’s buttons covering part of the screen. So a clip needs a first line that hooks, a speaker who stays in frame, and captions that carry the story without audio.' },
    steps: [
      { title: 'Find moments that stand alone', text: 'Read the transcript for a complete thought in 20 to 60 seconds: a strong claim, a story with an ending, a clear answer to a question. If it needs the previous five minutes to make sense, skip it.' },
      { title: 'Open on the hook', text: 'Start the clip on its most interesting sentence. If the best line comes at the end, lead with it, then show the setup.' },
      { title: 'Reframe to 9:16 on the speaker', text: 'Crop the wide shot to vertical and keep whoever is talking in the middle. With two people, move the crop when the speaker changes.' },
      { title: 'Caption every word', text: 'Burn in captions timed word by word. Keep them clear of the speaker’s face and out of the bottom quarter, where the app puts its own text.' },
      { title: 'Tighten the pacing', text: 'Cut the fillers and trim the pauses harder than you would in the long version.' },
      { title: 'Export 1080 × 1920', text: 'That size works for YouTube Shorts, Instagram Reels and TikTok. Level the sound to about -14 LUFS so it matches other clips in the feed.' },
    ],
    short: { say: 'Find the 3 best moments and make each a vertical Short with captions.', text: 'AgentShot picks the moments from the transcript and who is speaking, tracks faces shot by shot so the 9:16 crop follows the speaker, and captions every word. Each Short comes back to review. Say “start on the punchline” or “captions are always yellow” and it changes that, and remembers the caption style for next time.' },
    tips: ['Post one clip per platform per day rather than all at once.', 'Cut away from a wide two-shot quickly. On a phone, two small faces are harder to watch than one large one.', 'A clip that ends where it began loops, and loops get rewatched.', 'Put a short text hook at the top of the frame for the first two seconds.'],
    faqs: [
      { q: 'How long should a Short be?', a: 'Usually 20 to 60 seconds: long enough for one complete thought. Shorter is fine if the thought is complete.' },
      { q: 'Do Shorts need captions?', a: 'Yes. Most people watch with the sound off, so a talking clip without captions is a silent face.' },
      { q: 'How many Shorts can I get from one episode?', a: 'A good hour of conversation usually holds three to six moments that stand on their own. Fewer strong clips beat many weak ones: a clip that needs context to make sense won’t be watched to the end.' },
      { q: 'Can AI choose the clips for me?', a: 'Yes. AgentShot reads the transcript and picks moments that stand on their own, then shows you each one to keep or send back. You can also name the moment yourself.' },
    ],
    next: { label: 'Shorts and Reels in AgentShot', href: '/long-video-to-shorts/' },
  },
  {
    slug: 'how-to-add-captions-to-a-video', tone: 'yellow', minutes: 4,
    title: 'How to Add Captions to a Video (burned-in or .srt)',
    description: 'How to add captions to a video: burned-in versus .srt subtitles, word-by-word timing, readable styling, and where to place them for Shorts and Reels.',
    h1: 'How to add captions to a video',
    intro: 'Captions make a video watchable on mute, easier to follow and easier to find. There are two kinds, and which one you need depends on where the video is going.',
    why: { heading: 'Burned-in or a subtitle file?', text: 'Burned-in captions are part of the picture: they always show and you control exactly how they look, which is what short social clips need. A subtitle file such as .srt travels next to the video: viewers can turn it on or off and platforms can read and translate it, which suits YouTube and longer videos. Many videos want both.' },
    steps: [
      { title: 'Transcribe with timings', text: 'Get a transcript where each word has a start and end time. Word-level timing is what lets captions appear as the words are spoken.' },
      { title: 'Fix names and terms', text: 'Read it through once. Product names, people’s names and jargon are where transcription goes wrong.' },
      { title: 'Break it into short lines', text: 'Two to five words at a time for social clips, a full line or two for long videos. Break at natural pauses, not mid-phrase.' },
      { title: 'Style it to be read at a glance', text: 'A heavy sans-serif, high contrast with the picture, and an outline or soft box behind the text. Highlighting the word being spoken helps people keep their place.' },
      { title: 'Place it safely', text: 'Keep captions off the speaker’s face. On vertical video, stay out of the bottom quarter and the very top, where the app draws its own buttons and text.' },
      { title: 'Export both kinds if you can', text: 'Burn captions into the social version, and export an .srt to upload alongside the long version.' },
    ],
    short: { say: 'Captions, word by word. Always yellow.', text: 'AgentShot transcribes on your computer, times captions to every word and burns them in, or exports an .srt next to the video. Say the style once (“always yellow”) and later projects remember it. If a name is wrong, say so and it fixes that word everywhere.' },
    tips: ['Captions help search too: a subtitle file gives a platform the words of your video to index.', 'Check captions on a phone, not a monitor. Text that looks fine large is often too small there.', 'One style per channel. Changing the look every video makes it harder to recognise yours.', 'Leave fillers out of the captions even if a few remain in the audio.'],
    faqs: [
      { q: 'What is the difference between captions and subtitles?', a: 'In everyday use they’re the same thing: text of what’s said. Strictly, captions also include sounds for people who can’t hear, and subtitles translate speech. Tools mostly use the words interchangeably.' },
      { q: 'What is an .srt file?', a: 'A plain text file listing each caption with its start and end time. YouTube and most players accept it, and viewers can switch it on or off.' },
      { q: 'Should I burn captions in or upload a subtitle file?', a: 'Burn them in for short vertical clips, where viewers watch muted and you want the look to be yours. Upload an .srt for long videos on YouTube, where viewers choose whether to see them and the platform can translate them. For a video that goes to both, do both.' },
      { q: 'How many words should be on screen at once?', a: 'For Shorts and Reels, two to five words, changing as they’re spoken. For long horizontal videos, one or two full lines of up to about forty characters each, held long enough to read comfortably.' },
      { q: 'Can I add captions automatically for free?', a: 'Yes. AgentShot’s Local app is free with your own model key and transcribes on your computer, with no watermark on the export.' },
    ],
    next: { label: 'Shorts and Reels in AgentShot', href: '/long-video-to-shorts/' },
  },
  {
    slug: 'how-to-make-motion-graphics-with-ai', tone: 'violet', minutes: 5,
    title: 'How to Make Motion Graphics with AI (and write the prompt)',
    description: `How to make motion graphics with AI: what to put in the prompt, how to get on-brand results instead of generic ones, and ${N} example prompts to start from.`,
    h1: 'How to make motion graphics with AI',
    intro: 'A language model can design and animate real motion graphics: type, shapes, charts and interface mock-ups, timed to a beat. The difference between a generic result and one you’d publish is almost all in what you tell it.',
    why: { heading: 'Generated video versus built motion graphics', text: 'Video generators paint pixels, so text comes out wobbly and nothing can be edited afterwards. Motion graphics built as code are exact: the type is real type, your logo is your logo, and one scene can be changed without redoing the rest. For titles, explainers and launch videos, that’s the kind you want.' },
    steps: [
      { title: 'Say what it’s for and how long', text: 'A 15-second launch teaser and a 60-second explainer are different films. Give the length, the shape (16:9 or vertical) and where it will be shown.' },
      { title: 'Give it your material', text: 'The exact words to show, your logo file, two or three brand colours and a font if you have one. Without these it invents them.' },
      { title: 'Describe a look, and what to avoid', text: 'Name a direction (“warm off-white, bold type, one orange accent”) and list what’s banned, such as gradients, glows or stock footage. The bans do as much as the direction.' },
      { title: 'Pick one idea that connects the scenes', text: 'A dot that travels through every scene, a shape that becomes the logo. One thread makes separate scenes feel like a film.' },
      { title: 'Ask for a storyboard first', text: 'Have it list each scene and what happens before it builds anything. It’s much cheaper to change a line of storyboard than a finished scene.' },
      { title: 'Time it to music', text: 'Give it a track with a clear beat and ask for the main moves to land on the beats.' },
      { title: 'Give notes scene by scene', text: '“The title lands late” or “hold the logo longer” is easier to act on than “make it better”.' },
    ],
    short: { say: 'A 15-second launch teaser in our colours, ending on @logo.png.', text: 'In AgentShot, describe the film or pick one of the gallery’s examples and say what yours is about. It asks for what it’s missing, shows a storyboard, then builds each scene as HTML and GSAP rendered frame-exact at 60 fps. Because scenes are built separately, a note changes one scene, and the text stays retypable.' },
    tips: ['Start from an example you like. A prompt that already worked is the fastest way to a good one.', 'Fewer colours and fewer fonts almost always look more expensive.', 'Read the prompts behind videos you admire; the banned lists are where the taste is.'],
    faqs: [
      { q: 'Can AI make motion graphics?', a: 'Yes. Models like Claude can write the code for animated type, shapes, charts and interface mock-ups, and a renderer turns that into video. AgentShot does both steps and keeps every scene editable.' },
      { q: 'Where can I find motion graphics prompts?', a: `AgentShot’s example gallery shows ${N} motion videos people made with Claude, each with the exact prompt behind it and a credit to its maker.` },
      { q: 'Do I need After Effects?', a: 'No. The scenes are built and rendered inside AgentShot. If you want to finish elsewhere, export the film and bring it into your editor.' },
    ],
    next: { label: `Browse ${N} example prompts`, href: '/examples/' },
  },
  {
    slug: 'how-to-edit-video-with-ai', tone: 'mint', minutes: 5,
    title: 'How to Edit Video with AI (Claude, Gemini or ChatGPT)',
    description: 'How AI video editing really works: what a model like Claude, Gemini or GPT can and can’t see, how to give notes it can act on, and how to keep control of the cut.',
    h1: 'How to edit video with AI',
    intro: 'You can now edit a video by describing the change: “cut the ums”, “make a vertical one with captions”, “blur that number plate”. It works well when you know what the model can see, and how to ask.',
    why: { heading: 'A language model can’t watch your video', text: 'Models read text and look at still images. They don’t watch footage. So an AI editor first has to turn the film into things a model can read: a transcript with the time of every word, who is speaking when, where the shots change, where the faces are and where the beat falls. The quality of the edit depends on those measurements more than on the model.' },
    steps: [
      { title: 'Use an editor that measures the footage first', text: 'Pasting a transcript into a chatbot gets you advice, not an edit. You need a tool that measures the film, lets the model decide, then makes the cut.' },
      { title: 'Give notes like you would to an editor', text: 'Say the outcome: “cut the part where I lose my train of thought”, “keep only Ravi’s answers”. You don’t need timecodes or editing terms.' },
      { title: 'Point when words aren’t enough', text: 'For anything about a place in the picture, mark it: draw a box on the frame or pick the moment. “Blur this” with a box beats a paragraph of description.' },
      { title: 'Review every change before keeping it', text: 'Compare before and after. A good tool keeps the old version, so a bad change costs nothing.' },
      { title: 'Send it back with a smaller note', text: 'If it’s nearly right, say what’s still off: “too tight at 1:10”. Don’t start over.' },
      { title: 'Finish by hand if you want to', text: 'AI is good at the first ninety percent. Export the timeline to Premiere, Resolve or Final Cut for the last ten.' },
    ],
    short: { say: 'Cut the ums, then put my name on screen when I introduce myself.', text: 'AgentShot is built this way. It measures words, voices, shots, faces and beats on your own computer, then your model (Claude, Gemini, GPT or any compatible endpoint) reads those measurements and a few stills, never the video file. Every change comes back as a before and after to keep or send back, and the cut stays an editable timeline you can hand to Premiere, Resolve or Final Cut.' },
    tips: ['One change per note at first. You’ll see what it understood.', 'If your footage is private, check whether the tool uploads it. AgentShot doesn’t.', 'A stronger model helps most on judgement calls like “find the best moments”, less on mechanical cuts.'],
    faqs: [
      { q: 'Can Claude or ChatGPT edit a video?', a: 'Not on their own: they can’t watch footage or render video. Inside an editor that measures the film and makes the cuts, they can direct the whole edit. AgentShot works with Claude, Gemini, GPT or any compatible endpoint.' },
      { q: 'Is my video uploaded to the AI?', a: 'It depends on the tool. In AgentShot, transcription, analysis and rendering run on your computer; the model receives text and a few still frames it asks to see, not the video file.' },
      { q: 'Which AI model is best for video editing?', a: 'The strongest general model you have access to. Stronger models help most with judgement, such as picking moments or restructuring. AgentShot lets you choose per project.' },
    ],
    next: { label: 'See what AgentShot makes', href: '/#make' },
  },
]

export const guidePath = (slug: string) => `/guides/${slug}/`
