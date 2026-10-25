// Manul's plans, as the site shows them. Credits are shared with Pitch (trypitch.co): same account email, same
// balance, same billing. The app (Settings → Keys → Manul key) is where people subscribe; the numbers here only describe it.

export const STARTER_CREDITS = 1_000
export const CONTACT = 'hello@hormuz-labs.dev'
/** Launch offer: model usage is billed at half its list rate. Set to 0 to end it (the app's is USAGE_RATE in the manul repo). */
export const LAUNCH_DISCOUNT = 50

export interface Plan {
  key: 'local' | 'pro' | 'max' | 'flex' | 'enterprise'
  name: string
  price: string
  per: string
  blurb: string
  features: string[]
  annual?: { price: number; credits: number; save: number }
  monthly?: { price: number; credits: number }
  cta: { label: string; href: string }
  note?: string
  popular?: boolean
}

const fmt = (n: number) => n.toLocaleString('en-US')
const save = (month: number, year: number) => Math.round((1 - year / (month * 12)) * 100)

export const PLANS: Plan[] = [
  {
    key: 'local',
    name: 'Local',
    price: '$0',
    per: 'forever',
    blurb: 'The whole app, open source, with your own model keys.',
    features: [
      'Every feature, no watermark, no limits from us',
      'Bring your own Claude, Gemini or OpenAI key',
      'Or any OpenAI- or Anthropic-compatible endpoint',
      'Pair your phone or a home worker (manul --worker)',
      `${fmt(STARTER_CREDITS)} starter credits on a new AgentShot account`,
    ],
    cta: { label: 'Download AgentShot', href: '/#get' },
  },
  {
    key: 'pro',
    name: 'Pro',
    price: '$45',
    per: 'a month',
    monthly: { price: 45, credits: 10_000 },
    annual: { price: 432, credits: 120_000, save: save(45, 432) },
    blurb: 'One AgentShot key for every model, so you never manage a key again.',
    features: [
      `${fmt(10_000)} credits a month`,
      'Max and Ultra model tiers: the strongest models',
      'Voice, music and cloud workers on the same key',
      'Flex top-ups when a project runs long',
    ],
    cta: { label: 'Get Pro', href: '/#get' },
    note: 'Subscribe in the app: Settings → Keys → AgentShot key',
    popular: true,
  },
  {
    key: 'max',
    name: 'Max',
    price: '$80',
    per: 'a month',
    monthly: { price: 80, credits: 30_000 },
    annual: { price: 768, credits: 360_000, save: save(80, 768) },
    blurb: 'Three times the credits, for people publishing every week.',
    features: [
      `${fmt(30_000)} credits a month`,
      'Max and Ultra model tiers',
      'Voice, music and cloud workers on the same key',
      'The lowest price per credit',
    ],
    cta: { label: 'Get Max', href: '/#get' },
    note: 'Subscribe in the app: Settings → Keys → AgentShot key',
  },
]

export const FLEX = { name: 'Flex top-up', price: 20, credits: 5_000 }

export const ENTERPRISE = {
  name: 'Enterprise',
  blurb: 'Custom credit volume, volume pricing, help setting up your workflow, and a person to talk to.',
  href: `mailto:${CONTACT}?subject=AgentShot%20Enterprise`,
}

export const TIERS = [
  { name: 'Low', who: 'Everyone' },
  { name: 'Medium', who: 'Everyone' },
  { name: 'High', who: 'Everyone' },
  { name: 'Max', who: 'Pro and Max' },
  { name: 'Ultra', who: 'Pro and Max' },
]

export const PITCH = 'Coming from Pitch? Sign in to AgentShot with the same email — your plan and credits are already there.'

/** One-line summary for FAQ answers, llms-style text and structured data. */
export const PLAN_SUMMARY = `AgentShot is free forever with your own model keys, and new AgentShot accounts get ${fmt(STARTER_CREDITS)} starter credits. Pro is $45 a month for ${fmt(10_000)} credits (or $432 a year with ${fmt(120_000)} credits upfront); Max is $80 a month for ${fmt(30_000)} credits (or $768 a year with ${fmt(360_000)} upfront). A Flex top-up adds ${fmt(5_000)} credits for $20 with an active Pro or Max plan. Credits never expire once granted.`

export { fmt }

/** schema.org offers for the SoftwareApplication JSON-LD. */
export const OFFERS = [
  { '@type': 'Offer', name: 'Local', price: '0', priceCurrency: 'USD', description: 'Free and open source, with your own model keys.' },
  ...PLANS.filter(p => p.monthly).flatMap(p => [
    { '@type': 'Offer', name: `${p.name} (monthly)`, price: String(p.monthly!.price), priceCurrency: 'USD', description: `${fmt(p.monthly!.credits)} credits a month`,
      priceSpecification: { '@type': 'UnitPriceSpecification', price: String(p.monthly!.price), priceCurrency: 'USD', billingDuration: 'P1M', unitCode: 'MON' } },
    { '@type': 'Offer', name: `${p.name} (yearly)`, price: String(p.annual!.price), priceCurrency: 'USD', description: `${fmt(p.annual!.credits)} credits granted upfront`,
      priceSpecification: { '@type': 'UnitPriceSpecification', price: String(p.annual!.price), priceCurrency: 'USD', billingDuration: 'P1Y', unitCode: 'ANN' } },
  ]),
  { '@type': 'Offer', name: FLEX.name, price: String(FLEX.price), priceCurrency: 'USD', description: `${fmt(FLEX.credits)} credits, one-time, with an active Pro or Max plan` },
]

/** Questions about plans and credits: on the home page FAQ and on /pricing (HTML allowed in answers). */
export const PRICING_FAQS = [
  { q: 'Is it really free?', a: `Yes. AgentShot is open source under the <a href="https://github.com/hormuz-labs/agentshot/blob/main/LICENSE">Apache License 2.0</a> and runs on your computer. Bring your own Claude, Gemini or OpenAI key (or any compatible endpoint) and AgentShot costs nothing, for good: you pay your model provider directly, usually cents per edit. No account needed.` },
  { q: 'What are credits?', a: `Credits are how the AgentShot key is paid for. Each agent run, voice line or music cue draws down credits by what it actually used: the model, the tokens, the minutes of audio. A quick cut uses a little; a long motion film on an Ultra model uses more. New AgentShot accounts get ${fmt(STARTER_CREDITS)} starter credits, and credits never expire once they’re granted.` },
  { q: 'What do Pro and Max add?', a: `A monthly credit allowance (Pro ${fmt(10_000)}, Max ${fmt(30_000)}) and the Max and Ultra tiers in the AgentShot key’s model picker: the strongest models. Low, Medium and High are open to everyone. Paying yearly grants the whole year’s credits upfront (${fmt(120_000)} or ${fmt(360_000)}) for 20% less. Need more mid-month? A Flex top-up adds ${fmt(5_000)} credits for $20.` },
  { q: 'Where do I subscribe?', a: `In the app: open AgentShot, sign in, and go to <b>Settings → Keys → AgentShot key</b>. Billing is handled by Dodo Payments, and you can change or cancel there any time. Your own keys keep working alongside a plan and are used first.` },
  { q: 'I have a Pitch account. What happens to it?', a: `Pitch is becoming part of AgentShot. Sign in to AgentShot with the same email and your plan and credits are already there: one account, one balance, the same billing. Nothing to move.` },
]
