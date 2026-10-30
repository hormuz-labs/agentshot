/** Explicit local testing only. A packaged app can never enable the development entitlement. */
export const localProEnabled = (packaged: boolean, flag: string | undefined) => !packaged && flag === '1'
