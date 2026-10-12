export type SettingsTourStatus = 'pending' | 'completed' | 'skipped'
export type SettingsOnboarding = { firstOpenedAt: number; tourStatus: SettingsTourStatus }
export type SettingsOpened = { firstOpen: boolean; state: SettingsOnboarding }
