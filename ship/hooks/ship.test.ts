import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

type Call = readonly string[]
const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

const runShip = ($: Engine, args: string) =>
  $.command.run({
    command: 'ship',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

const status = (opts: { upstream?: string; ab?: string; files?: string[] }) =>
  [
    '# branch.oid abc',
    '# branch.head main',
    ...(opts.upstream ? [`# branch.upstream ${opts.upstream}`] : []),
    ...(opts.ab ? [`# branch.ab ${opts.ab}`] : []),
    ...(opts.files ?? []).map(f => `? ${f}`),
  ].join('\n')

function fakeGit(on: any, stdout: string) {
  const calls: Call[] = []
  on('process.run', async (_$: unknown, e: { argv: Call }) => {
    calls.push(e.argv)
    return { value: e.argv[1] === 'status' ? ok(stdout) : ok() }
  })
  return calls
}

test('/ship stages, commits with the message and pushes', async ($, on) => {
  const calls = fakeGit(on, status({ upstream: 'origin/main', ab: '+0 -0', files: ['a.ts', 'b.ts'] }))
  const result = await runShip($, 'Fix thing')

  expect(calls.map(c => c.slice(0, 2).join(' '))).toContain('git add')
  expect(calls).toContainEqual(['git', 'commit', '-m', 'Fix thing'])
  expect(calls).toContainEqual(['git', 'push'])
  expect(result.text).toContain('committed 2 files: Fix thing')
})

test('/ship without a message builds one from the file names', async ($, on) => {
  const calls = fakeGit(on, status({ upstream: 'origin/main', ab: '+0 -0', files: ['src/a.ts'] }))
  await runShip($, '')

  expect(calls).toContainEqual(['git', 'commit', '-m', 'Update a.ts'])
})

test('/ship only pushes when the tree is clean but ahead', async ($, on) => {
  const calls = fakeGit(on, status({ upstream: 'origin/main', ab: '+2 -0' }))
  await runShip($, '')

  expect(calls.some(c => c[1] === 'commit')).toBe(false)
  expect(calls).toContainEqual(['git', 'push'])
})

test('/ship sets the upstream when there is none', async ($, on) => {
  const calls = fakeGit(on, status({ files: ['a.ts'] }))
  await runShip($, 'x')

  expect(calls).toContainEqual(['git', 'push', '-u', 'origin', 'main'])
})

test('/ship refuses likely secrets and stages nothing', async ($, on) => {
  const calls = fakeGit(on, status({ upstream: 'origin/main', ab: '+0 -0', files: ['a.ts', '.env'] }))
  const result = await runShip($, 'x')

  expect(result.text).toContain('refusing to stage likely secrets: .env')
  expect(calls.some(c => c[1] === 'add')).toBe(false)
})

test('/ship does nothing on a clean, synced tree', async ($, on) => {
  const calls = fakeGit(on, status({ upstream: 'origin/main', ab: '+0 -0' }))
  const result = await runShip($, '')

  expect(result.text).toBe('ship: nothing to ship.')
  expect(calls.some(c => c[1] === 'push')).toBe(false)
})

test('status line shows branch, changes and ahead count', async ($, on) => {
  const lines: Array<string | undefined> = []
  on('ui.status', async (_$, e, next) => {
    lines.push(e.text)
    return next(e)
  })
  fakeGit(on, status({ upstream: 'origin/main', ab: '+2 -1', files: ['a.ts'] }))
  await runShip($, '').catch(() => {})

  expect(lines).toContain('⎇ main ●1 ↑2 ↓1')
})

const response = (usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | null) => ({
  turnId: 't1',
  index: 0,
  answer: '',
  toolUses: [],
  stopReason: 'end_turn' as const,
  usage: usage && { ...usage, model: 'test-model' },
})

test('git and cache hit rate share one status line', async ($, on) => {
  const lines: Array<string | undefined> = []
  on('ui.status', async (_$, e, next) => {
    lines.push(e.text)
    return next(e)
  })
  fakeGit(on, status({ upstream: 'origin/main', ab: '+1 -0', files: ['a.ts'] }))
  on('turn.step', async function* () {
    return response({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 })
  })
  await runShip($, '').catch(() => {})

  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'test-model', messageCount: 1 })
  for await (const _ of stream) { /* drain */ }

  expect(lines.at(-1)).toBe('⎇ main ●1 ↑1 · cache 80% hit · 800 read · 100 written')
})

test('no cache part when the step carries no usage', async ($, on) => {
  const lines: Array<string | undefined> = []
  on('ui.status', async (_$, e, next) => {
    lines.push(e.text)
    return next(e)
  })
  fakeGit(on, status({ upstream: 'origin/main', ab: '+0 -0' }))
  on('turn.step', async function* () {
    return response(null)
  })
  await runShip($, '').catch(() => {})
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'test-model', messageCount: 1 })
  for await (const _ of stream) { /* drain */ }

  expect(lines.at(-1)).toBe('⎇ main ✓')
})
