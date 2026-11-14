// The landing page's own moving parts, in real Chrome: node test/landing.mjs [url]
//   the hero's message box (a chip puts its note in and its answer under it; it cycles by itself until one is picked),
//   the jobs (one on screen at a time, chosen like tabs), an example's prompt, and no sideways scroll on a phone.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://localhost:4321/'
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] })
const errors = []
const check = (ok, what) => { if (!ok) errors.push(what) }
const open = async (opts) => {
  const page = await browser.newPage(opts)
  page.on('pageerror', e => errors.push(`page error: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  await page.goto(url, { waitUntil: 'networkidle' })
  return page
}
const pressed = page => page.evaluate(() => [...document.querySelectorAll('#ask .chip')].findIndex(c => c.getAttribute('aria-pressed') === 'true'))

// 1. with reduced motion nothing types and nothing moves by itself: a chip swaps the whole exchange at once
{
  const page = await open({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const asks = JSON.parse(await page.locator('#ask-data').textContent())
  check(asks.length >= 6, `the hero has ${asks.length} asks, expected at least 6`)
  check(await page.locator('#ask-note').textContent() === asks[0].note, 'the first ask is not on the page as it loads')
  await page.waitForTimeout(5000)
  check(await pressed(page) === 0, 'with reduced motion the asks still cycle by themselves')
  const last = asks.length - 1
  await page.locator('#ask .chip').nth(last).click()
  check(await page.locator('#ask-note').textContent() === asks[last].note, 'a chip does not put its note in the box')
  check(await page.locator('#ask-did').textContent() === asks[last].did, 'a chip does not show its answer')
  check(await page.locator('#ask-name').textContent() === asks[last].file, 'a chip does not show what is attached')
  check(await pressed(page) === last, 'the chip that was pressed is not marked as pressed')
  check(await page.locator('#ask .chip[aria-pressed="true"]').count() === 1, 'more than one chip is marked as pressed')
  // and the film on the page stays a still picture: nothing is fetched or played until it is opened
  await page.locator('.film-card').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1200)
  check(await page.locator('#film-loop').evaluate(v => v.paused && !v.getAttribute('src')), 'with reduced motion the film on the page loads or plays by itself')
  await page.close()
}

// 2. with motion: it moves on by itself, types the note, and stops for good once a chip is picked
{
  const page = await open({ viewport: { width: 1440, height: 900 } })
  const asks = JSON.parse(await page.locator('#ask-data').textContent())
  check(await page.locator('#film-loop').evaluate(v => !v.getAttribute('src')), 'the film on the page is fetched before it is scrolled to')
  await page.waitForFunction(() => [...document.querySelectorAll('#ask .chip')].findIndex(c => c.getAttribute('aria-pressed') === 'true') > 0, null, { timeout: 15000 })
    .catch(() => errors.push('the asks never moved on by themselves'))
  await page.locator('#ask .chip').nth(3).click()
  await page.waitForFunction(note => document.getElementById('ask-note').textContent === note, asks[3].note, { timeout: 8000 })
    .catch(() => errors.push('a picked ask never finished typing'))
  await page.waitForFunction(() => !document.getElementById('ask-answer').classList.contains('off'), null, { timeout: 4000 })
    .catch(() => errors.push('the answer never came back after the note was typed'))
  check(await page.locator('#ask-did').textContent() === asks[3].did, 'the answer shown is not the picked ask\'s')
  await page.waitForTimeout(7000)
  check(await pressed(page) === 3, 'the asks kept cycling after one was picked')

  // 3. the jobs: one at a time, and the one chosen plays
  const shown = () => page.evaluate(() => [...document.querySelectorAll('#make .job')].filter(j => j.offsetParent).map(j => j.dataset.i))
  check((await shown()).join() === '0', `the jobs showing at first are [${await shown()}], expected only the first`)
  await page.locator('#make .tabs label').nth(3).click()
  check((await shown()).join() === '3', `after choosing the fourth job, [${await shown()}] are showing`)
  await page.waitForFunction(() => !!document.querySelector('#make .job[data-i="3"] video').getAttribute('src'), null, { timeout: 8000 })
    .catch(() => errors.push('the chosen job\'s film never loaded'))
  await page.locator('#jt-3').press('ArrowLeft')
  check((await shown()).join() === '2', 'the arrow keys do not move between jobs')

  // 4. an example opens with the prompt that made it
  await page.locator('#examples [data-ex]').first().click()
  check(await page.locator('#ex').evaluate(d => d.open), 'an example does not open')
  check((await page.locator('#ex-prompt').textContent()).length > 100, 'an example opens without its prompt')
  await page.locator('#ex .close').click()
  check(!(await page.locator('#ex').evaluate(d => d.open)), 'an example does not close')

  // 5. the film opens from the hero and from its poster
  for (const sel of ['.hero [data-film]', '.film-card']) {
    await page.locator(sel).click()
    check(await page.locator('#film').evaluate(d => d.open), `${sel} does not open the film`)
    await page.locator('#film .close').click()
  }

  // 6. the film: the one file, the length the page says, playing silently on the page and with sound once opened
  const FILM = '/film/agentshot.mp4'
  const file = await page.request.get(new URL(FILM, url).href)
  check(file.ok(), `${FILM} is not served`)
  check((await file.body()).length < 6 * 1024 * 1024, `${FILM} is over 6 MB, too heavy to play by itself on the page`)
  check(/^WEBVTT/.test(await (await page.request.get(new URL('/captions/film.vtt', url).href)).text()), 'the film has no captions file')
  check((await page.locator('.hero [data-film] .dur').textContent()) === '0:28', 'the hero does not give the film\'s length as 0:28')
  const card = page.locator('.film-card'), onPage = page.locator('#film-loop'), opened = page.locator('#film-v')
  await card.scrollIntoViewIfNeeded()
  await page.waitForFunction(() => { const v = document.getElementById('film-loop'); return !v.paused && v.currentTime > 0.3 }, null, { timeout: 10000 })
    .catch(() => errors.push('the film on the page does not play when it is scrolled to'))
  check(await onPage.evaluate(v => v.muted && v.loop && v.currentSrc.endsWith('/film/agentshot.mp4')), 'the film on the page is not the silent, looping film')
  await card.click()
  await page.waitForFunction(() => { const v = document.getElementById('film-v'); return v.readyState >= 1 && !v.paused }, null, { timeout: 10000 })
    .catch(() => errors.push('the opened film does not play'))
  check(await opened.evaluate(v => v.currentSrc.endsWith('/film/agentshot.mp4') && !v.muted), 'the opened film is not the film with its sound on')
  check(await opened.evaluate(v => Math.abs(v.duration - 28.4) < 0.5), `the film is ${await opened.evaluate(v => v.duration)} s long, but the page says 0:28`)
  check(await opened.evaluate(v => v.textTracks.length === 1), 'the opened film has no captions track')
  check(await onPage.evaluate(v => v.paused), 'the film on the page keeps playing under the opened one')
  await page.locator('#film .close').click()
  await page.waitForFunction(() => document.getElementById('film-v').paused, null, { timeout: 5000 })
    .catch(() => errors.push('closing the film does not stop it'))
  await page.waitForFunction(() => !document.getElementById('film-loop').paused, null, { timeout: 5000 })
    .catch(() => errors.push('the film on the page does not carry on after the opened one is closed'))
  await page.mouse.wheel(0, -20000)
  await page.waitForFunction(() => document.getElementById('film-loop').paused, null, { timeout: 5000 })
    .catch(() => errors.push('the film on the page keeps playing after it is scrolled away'))
  await page.close()
}

// 7. a phone: nothing pushes the page sideways (the chips and tabs scroll inside their own rows)
for (const width of [320, 390]) {
  const page = await open({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true })
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  check(wide <= 0, `at ${width} wide the page scrolls sideways by ${wide}px`)
  check(await page.locator('#ask .chips').evaluate(c => c.scrollWidth > c.clientWidth), `at ${width} wide the chips are not a row to swipe`)
  await page.close()
}

await browser.close()
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no errors')
process.exitCode = errors.length ? 1 : 0
