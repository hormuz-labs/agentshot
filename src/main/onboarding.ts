import { app } from 'electron'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SettingsOnboarding, SettingsOpened } from '../shared/onboarding'

/** Per-install onboarding, separate from pi-durable's agent-owned schema. */
export class OnboardingStore {
  constructor(private file = join(app.getPath('userData'), 'onboarding.sqlite')) {}

  private connect() {
    const db = new DatabaseSync(this.file)
    db.exec(`CREATE TABLE IF NOT EXISTS settings_onboarding (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      first_opened_at INTEGER NOT NULL,
      tour_status TEXT NOT NULL CHECK (tour_status IN ('pending', 'completed', 'skipped'))
    )`)
    return db
  }

  opened(): SettingsOpened {
    const db = this.connect()
    try {
      const inserted = db.prepare("INSERT OR IGNORE INTO settings_onboarding (id, first_opened_at, tour_status) VALUES (1, ?, 'pending')").run(Date.now())
      const row = db.prepare('SELECT first_opened_at, tour_status FROM settings_onboarding WHERE id = 1').get()!
      return { firstOpen: inserted.changes === 1, state: { firstOpenedAt: row.first_opened_at as number, tourStatus: row.tour_status as SettingsOnboarding['tourStatus'] } }
    } finally { db.close() }
  }

  finish(status: 'completed' | 'skipped') {
    if (status !== 'completed' && status !== 'skipped') throw new Error('Invalid Settings tour outcome.')
    const db = this.connect()
    try { db.prepare('UPDATE settings_onboarding SET tour_status = ? WHERE id = 1').run(status) }
    finally { db.close() }
  }
}
