import { describe, expect, it } from 'vitest'
import { colourOf, longestTurn, nameOf, people, speakerOfSegments, type Speakers } from '../src/shared/speakers'
import { speakersReport } from '../src/main/speakers'

const sp: Speakers = {
  duration: 60,
  speakers: [
    { id: 'A', talk: 20, turns: 2, share: 40, minor: false },
    { id: 'B', talk: 18, turns: 2, share: 36, minor: false },
    { id: 'C', talk: 10, turns: 1, share: 20, minor: false },
    { id: 'D', talk: 2, turns: 1, share: 4, minor: true },
  ],
  turns: [
    { speaker: 'A', s: 0, e: 12 }, { speaker: 'B', s: 12, e: 20 }, { speaker: 'C', s: 20, e: 30 },
    { speaker: 'A', s: 30, e: 38 }, { speaker: 'B', s: 38, e: 48 }, { speaker: 'D', s: 48, e: 50 },
  ],
}

describe('naming voices', () => {
  it('unnamed voices are Speaker A, B…', () => {
    expect(nameOf('C')).toBe('Speaker C')
    expect(nameOf('C', { C: '  Ultron ' })).toBe('Ultron')
  })

  it('the same name on two voices makes one person (diarization splits people)', () => {
    expect(people(sp, { A: 'Tony', C: 'Tony', B: 'Ultron' })).toEqual([
      { name: 'Tony', ids: ['A', 'C'], talk: 30, turns: 3, named: true },
      { name: 'Ultron', ids: ['B'], talk: 18, turns: 2, named: true },
      { name: 'Speaker D', ids: ['D'], talk: 2, turns: 1, named: false },
    ])
  })

  it('each transcript sentence gets the voice that speaks most of it', () => {
    const seg = (s: number, e: number) => ({ s, e, text: '', words: [] })
    expect(speakerOfSegments([seg(1, 5), seg(10, 19), seg(29, 33), seg(55, 58)], sp.turns)).toEqual(['A', 'B', 'A', undefined])
  })

  it("a voice's longest turn is where to hear who it is", () => {
    expect(longestTurn(sp, 'A')).toEqual({ speaker: 'A', s: 0, e: 12 })
    expect(longestTurn(sp, 'Z')).toBeUndefined()
  })

  it('a name keeps its colour', () => {
    expect(colourOf('Tony')).toBe(colourOf('Tony'))
    expect(colourOf('Tony')).toBeGreaterThanOrEqual(0)
    expect(colourOf('Tony')).toBeLessThan(8)
  })

  it('the agent reads the names, and who is one person', () => {
    const r = speakersReport(sp, 'media/film.mp4', '.cache/speakers/x.json', 120, { A: 'Tony', C: 'Tony', B: 'Ultron' })
    expect(r).toContain('Tony (A): 0:20 of talk')
    expect(r).toContain('People (voices with the same name are one person): Tony = A+C, Ultron = B, Speaker D = D')
    expect(r).toContain('0:20.0–0:30.0 Tony')
    expect(r).toContain('Names are the ones the user gave')
    expect(speakersReport(sp, 'media/film.mp4', 'x.json')).toContain('then name them with name_speakers')
  })
})

describe('regrouping voices by their embeddings', async () => {
  const { regroup, nearestVoices, REGROUP } = await import('../src/main/speakers')
  // a seeded random 192-d voice, and samples of it with noise: two samples of one person agree about as much as two
  // turns of one actor in a film (cosine ≈ 0.45)
  let seed = 7
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 - 0.5 }
  const voice = () => Array.from({ length: 192 }, rand)
  const sample = (v: number[], noise: number) => v.map(x => x + noise * rand() * 2.2)

  it("one person split into many voices comes back as one; a stranger's few seconds stay apart", () => {
    const people = [voice(), voice(), voice()], stranger = voice()
    const turns: { speaker: string; s: number; e: number }[] = [], emb: number[][] = []
    let t = 0
    // each person split by the diarizer into 5 voices, 4 turns of 3 s each
    people.forEach((v, p) => { for (let split = 0; split < 5; split++) for (let k = 0; k < 4; k++) { turns.push({ speaker: `P${p}-${split}`, s: t, e: t + 3 }); emb.push(sample(v, 0.5)); t += 3 } })
    // two 1-second slivers of person 0 and a stranger who says one 3 s line
    turns.push({ speaker: 'sliver', s: t, e: t + 1 }); emb.push(sample(people[0], 0.5)); t += 1
    turns.push({ speaker: 'sliver2', s: t, e: t + 1 }); emb.push(sample(people[0], 0.5)); t += 1
    turns.push({ speaker: 'stranger', s: t, e: t + 3 }); emb.push(sample(stranger, 0.5))
    const { speakers, centres } = regroup(turns, emb)
    const of = (prefix: string) => new Set(speakers.filter((_, n) => turns[n].speaker.startsWith(prefix)))
    for (const p of ['P0-', 'P1-', 'P2-']) expect(of(p).size).toBe(1)
    expect(new Set([...of('P0-'), ...of('P1-'), ...of('P2-')]).size).toBe(3)
    expect(of('sliver')).toEqual(of('P0-'))
    expect([...of('stranger')][0]).toBe('stranger')
    expect(centres.size).toBe(3) // the voices with real talk
    // a line no turn covered goes to the voice it sounds like; noise to none
    const [near] = nearestVoices([sample(people[1], 0.5)], centres)
    expect(near).toBe([...of('P1-')][0])
    expect(nearestVoices([voice(), null], centres)).toEqual([null, null])
    expect(REGROUP.merge).toBeGreaterThan(REGROUP.floor)
  })
})
