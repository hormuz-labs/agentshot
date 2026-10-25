/** Editor-focused tests explicitly dismiss the first-run introduction, as a user would. */
export async function dismissOnboarding(win) {
  await win.locator('.agentshot-tour-skip').waitFor()
  await win.locator('.agentshot-tour-skip').click()
  await win.locator('.agentshot-tour').waitFor({ state: 'detached' })
}

export async function dismissSettingsOnboarding(win) {
  await win.locator('.agentshot-tour[data-tour-phase="settings"] .agentshot-tour-skip').waitFor()
  await win.locator('.agentshot-tour[data-tour-phase="settings"] .agentshot-tour-skip').click()
  await win.locator('.agentshot-tour').waitFor({ state: 'detached' })
}
