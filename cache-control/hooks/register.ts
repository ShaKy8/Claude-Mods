import type { Register } from 'claude-code'

export const register: Register = on => {
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const { usage } = response
    if (usage) {
      const total = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      const rate = total > 0 ? Math.round((usage.cache_read_input_tokens / total) * 100) : 0
      $.ui.status(`cache ${rate}% hit · ${usage.cache_read_input_tokens} read · ${usage.cache_creation_input_tokens} written`)
    }
    return response
  })
}
