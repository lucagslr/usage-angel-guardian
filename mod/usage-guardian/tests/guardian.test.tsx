import { expect, mock, test } from 'claude-code/testing'

// Semaine officielle : reset lundi 16 nov. 2026 00:00 (Zurich) = 15 nov. 23:00 UTC.
const RESET = '2026-11-15T23:00:00.000Z'
const NOW = Date.parse('2026-11-09T11:00:00.000Z') // lundi 12:00 Zurich

const BAND = {
  plugin: 'usage-guardian',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140 },
} as const

const norm = (p: string) => p.split(String.fromCharCode(92)).join('/')

function world(on: Parameters<Parameters<typeof test>[1]>[1], files: Map<string, string>) {
  mock.env(on, { USERPROFILE: 'C:/Users/test', APPDATA: 'C:/Users/test/AppData/Roaming' })
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'guardian' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: {}, rateLimits: [] } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('fs.read', (_, e) => {
    const text = files.get(norm(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', (_, e) => ({
    value: [...files.keys()]
      .filter(p => p.startsWith(`${norm(e.path!)}/`))
      .map(p => ({ name: p.slice(norm(e.path!).length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }))
}

test('enregistre les limites officielles et affiche le budget du jour', async ($, on) => {
  const files = new Map<string, string>()
  // Mesure de début de semaine déjà enregistrée (0 %).
  files.set(
    'C:/Users/test/.claude-usage-guardian/snapshots/2026-11-09-mod-old.jsonl',
    JSON.stringify({ t: Date.parse('2026-11-08T23:00:30Z'), source: 'desktop-mod', sevenDay: { pct: 0, resetsAt: Date.parse(RESET) }, fiveHour: null, scoped: [] }) + '\n',
  )
  world(on, files)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({
    context: {} as never,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-09T14:00:00.000Z' },
      { kind: 'seven_day', percentUsed: 5.2, resetsAt: RESET },
    ],
    changed: ['rateLimits'],
  })

  const written = [...files.entries()].find(([p]) => p.includes('-mod-') && !p.includes('mod-old'))
  expect(written?.[1]).toContain('"pct":5.2')

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const today = await ui.find({ type: 'Text', text: /AUJOURD'HUI/ })
    expect(today?.text).toContain("AUJOURD'HUI 5,2 % / 14,3 %")
    expect((await ui.find({ type: 'Text', text: /5H : 42 %/ }))?.text).toContain('SEMAINE : 5 %')
    await ui.unmount()
  }
})

test('sans aucune mesure, la bande ne dessine rien d’inventé', async ($, on) => {
  world(on, new Map())
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /AUJOURD/ }))).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /indisponible|engine/ }))).toBeTruthy()
  await ui.unmount()
})
