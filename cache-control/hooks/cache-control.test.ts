import { test, expect } from 'claude-code/testing'

const response = (usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | null) => ({
  turnId: 't1',
  index: 0,
  answer: '',
  toolUses: [],
  stopReason: 'end_turn' as const,
  usage: usage && { ...usage, model: 'test-model' },
})

test('status line shows hit rate, read and written tokens', async ($, on) => {
  const lines: Array<string | undefined> = []

  on('ui.status', async (_$, e, next) => {
    lines.push(e.text)
    return next(e)
  })
  on('turn.step', async function* () {
    return response({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 })
  })

  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'test-model', messageCount: 1 })
  for await (const _ of stream) { /* drain */ }

  expect(lines).toEqual(['cache 80% hit · 800 read · 100 written'])
})

test('no status line when the step carries no usage', async ($, on) => {
  const lines: Array<string | undefined> = []

  on('ui.status', async (_$, e, next) => {
    lines.push(e.text)
    return next(e)
  })
  on('turn.step', async function* () {
    return response(null)
  })

  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'test-model', messageCount: 1 })
  for await (const _ of stream) { /* drain */ }

  expect(lines).toEqual([])
})
