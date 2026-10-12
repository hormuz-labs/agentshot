/** Editor-focused tests explicitly dismiss the first-run introduction, as a user would. */
export async function dismissOnboarding(win) {
  await win.locator('.manul-tour-skip').waitFor()
  await win.locator('.manul-tour-skip').click()
  await win.locator('.manul-tour').waitFor({ state: 'detached' })
}

export async function dismissSettingsOnboarding(win) {
  await win.locator('.manul-tour[data-tour-phase="settings"] .manul-tour-skip').waitFor()
  await win.locator('.manul-tour[data-tour-phase="settings"] .manul-tour-skip').click()
  await win.locator('.manul-tour').waitFor({ state: 'detached' })
}
