// Plans and model tiers. The plans are Pitch's (same Dodo products, same prices, same credits), so a subscription
// bought in either app is the same subscription. Credits are Pitch's unit too: one credit is CREDIT_USD of billable
// usage, and billable usage is model cost times the platform margin.

export type PlanKey = 'pro' | 'max' | 'pro_annual' | 'max_annual'
export type TopupKey = 'flex'
export type Plan = { key: string; name: string; price: number; credits: number; every: 'month' | 'year' }

export const PLANS: Record<PlanKey, Plan> = {
  pro: { key: 'pro', name: 'Pro', price: 45, credits: 10_000, every: 'month' },
  max: { key: 'max', name: 'Max', price: 80, credits: 30_000, every: 'month' },
  pro_annual: { key: 'pro_annual', name: 'Pro', price: 432, credits: 120_000, every: 'year' },
  max_annual: { key: 'max_annual', name: 'Max', price: 768, credits: 360_000, every: 'year' },
}
export const TOPUPS: Record<TopupKey, { key: string; name: string; price: number; credits: number }> = {
  flex: { key: 'flex', name: 'Flex', price: 20, credits: 5_000 },
}
/** Plans Pitch no longer sells but still renews; they count as paid. */
const LEGACY = ['starter', 'enterprise']

/** The Dodo product of each plan, from the env Pitch uses (DODO_PRODUCT_PRO_LIVE …). */
export const productEnv = (key: PlanKey | TopupKey, live: boolean) => `DODO_PRODUCT_${key.toUpperCase()}_${live ? 'LIVE' : 'TEST'}` as const

/** Billable usage per credit (Pitch's CREDIT_USD) and the margin over model cost (Pitch's STUDIO_PLATFORM_MARGIN). */
export const CREDIT_USD = 0.0025
export const MARGIN = 1.25
/**
 * Model usage is priced at a list rate of twice the plain rate (Pitch's premium models cost 2× credits) and sold at the
 * plain rate during launch, shown as a 50% discount. Ending the launch offer: USAGE_RATE = LIST_USAGE_RATE.
 */
export const LIST_USAGE_RATE = 2
export const USAGE_RATE = 1
export const DISCOUNT = Math.round((1 - USAGE_RATE / LIST_USAGE_RATE) * 100)
const RATE = MARGIN * USAGE_RATE
/** Credits for a model cost in dollars (what the gateway meters). */
export const creditsForCost = (usd: number, rate = RATE) => Math.floor(Math.round((usd * rate / CREDIT_USD) * 1e6) / 1e6)
/** Dollars of model cost a number of credits buys. */
export const costForCredits = (credits: number, rate = RATE) => Math.max(0, credits) * CREDIT_USD / rate
/** Credits for a retail price in dollars (voice and music are priced as billable usage already). */
export const creditsForPrice = (usd: number) => Math.ceil(Math.round((usd / CREDIT_USD) * 1e6) / 1e6)

/** What a new AgentShot account starts with (Pitch's sign-up promo is separate and smaller). */
export const STARTER_CREDITS = 1_000

export type Tier = 'low' | 'medium' | 'high' | 'max' | 'ultra'
/**
 * Model tiers, as in Pitch's model picker: the app asks for `manul-<tier>` and the gateway's routing rule of the same
 * name picks the model (gateway/k8s/config.json). `manul` alone is medium, for apps from before the tiers.
 */
export const TIERS: { tier: Tier; name: string; paid: boolean; provider: string; model: string }[] = [
  { tier: 'low', name: 'Low', paid: false, provider: 'azure', model: 'gpt-5.6-luna' },
  { tier: 'medium', name: 'Medium', paid: false, provider: 'gemini', model: 'gemini-3.8-flash' },
  { tier: 'high', name: 'High', paid: false, provider: 'gemini', model: 'gemini-4-argon' },
  { tier: 'max', name: 'Max', paid: true, provider: 'azure', model: 'gpt-6.1-sol' },
  { tier: 'ultra', name: 'Ultra', paid: true, provider: 'azure', model: 'gpt-6-astra' },
]

export const isPaid = (plan: string | undefined) => !!plan && (plan.replace(/_annual$/, '') in PLANS || LEGACY.includes(plan))
export const tiersFor = (plan: string | undefined) => TIERS.filter(t => !t.paid || isPaid(plan)).map(t => t.tier)

/** The models a key may reach: its tiers' models, per provider (the key's provider_configs). */
export function providerConfigs(plan: string | undefined, providers?: string[]) {
  const allowed = new Map<string, Set<string>>()
  for (const t of TIERS) if (!t.paid || isPaid(plan)) (allowed.get(t.provider) || allowed.set(t.provider, new Set()).get(t.provider)!).add(t.model)
  return [...allowed].filter(([p]) => !providers || providers.includes(p))
    .map(([provider, models]) => ({ provider, allowed_models: [...models], key_ids: ['*'], weight: 1 }))
}
