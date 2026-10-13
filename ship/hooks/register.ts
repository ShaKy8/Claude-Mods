import type { EngineInterface, Register } from 'claude-code'

type Run = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>

type Repo = {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  changed: string[]
}

const SECRETS = /(^|\/)(\.env(\..*)?|id_(rsa|ed25519|ecdsa)|.*\.(pem|key|p12|pfx)|credentials(\.json)?|\.netrc)$/i

const git = (run: Run, ...args: string[]) => run(['git', ...args])

async function inspect(run: Run): Promise<Repo | null> {
  const { exitCode, stdout } = await git(run, 'status', '--porcelain=v2', '--branch', '--untracked-files=all')
  if (exitCode !== 0) return null

  const repo: Repo = { branch: null, upstream: null, ahead: 0, behind: 0, changed: [] }
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length)
      repo.branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.upstream ')) {
      repo.upstream = line.slice('# branch.upstream '.length)
    } else if (line.startsWith('# branch.ab ')) {
      const [, ahead, behind] = /\+(\d+) -(\d+)/.exec(line) ?? []
      repo.ahead = Number(ahead)
      repo.behind = Number(behind)
    } else if (line.startsWith('1 ') || line.startsWith('u ')) {
      repo.changed.push(line.split(' ').slice(8).join(' '))
    } else if (line.startsWith('2 ')) {
      repo.changed.push(line.split('\t')[0]!.split(' ').slice(9).join(' '))
    } else if (line.startsWith('? ')) {
      repo.changed.push(line.slice(2))
    }
  }
  return repo
}

function summarize(repo: Repo): string {
  const parts = [`⎇ ${repo.branch ?? 'detached'}`]
  if (repo.changed.length > 0) parts.push(`●${repo.changed.length}`)
  if (repo.ahead > 0) parts.push(`↑${repo.ahead}`)
  if (repo.behind > 0) parts.push(`↓${repo.behind}`)
  if (repo.branch && !repo.upstream) parts.push('no upstream')
  if (parts.length === 1 && repo.upstream) parts.push('✓')
  return parts.join(' ')
}

function autoMessage(files: string[]): string {
  const names = files.map(f => f.split('/').pop()!)
  const shown = names.slice(0, 3).join(', ')
  return names.length > 3 ? `Update ${shown} and ${names.length - 3} more` : `Update ${shown}`
}

const fail = (text: string) => ({ text: `ship: ${text}`, exitCode: 1 })

async function ship(run: Run, message: string) {
  const repo = await inspect(run)
  if (!repo) return fail('not a git repository.')
  if (!repo.branch) return fail('HEAD is detached; check out a branch first.')
  if (repo.changed.length === 0 && repo.ahead === 0) return { text: 'ship: nothing to ship.' }

  const secrets = repo.changed.filter(f => SECRETS.test(f))
  if (secrets.length > 0) {
    return fail(`refusing to stage likely secrets: ${secrets.join(', ')}. Ignore or commit them by hand.`)
  }

  const lines: string[] = []

  if (repo.changed.length > 0) {
    const added = await git(run, 'add', '-A')
    if (added.exitCode !== 0) return fail(`git add failed: ${added.stderr.trim()}`)

    const msg = message || autoMessage(repo.changed)
    const committed = await git(run, 'commit', '-m', msg)
    if (committed.exitCode !== 0) {
      return fail(`git commit failed: ${(committed.stderr || committed.stdout).trim()}`)
    }
    lines.push(`committed ${repo.changed.length} file${repo.changed.length === 1 ? '' : 's'}: ${msg}`)
  }

  const pushed = repo.upstream
    ? await git(run, 'push')
    : await git(run, 'push', '-u', 'origin', repo.branch)
  if (pushed.exitCode !== 0) {
    lines.push(`push failed: ${pushed.stderr.trim()}`)
    return { text: `ship: ${lines.join('\n')}`, exitCode: 1 }
  }
  lines.push(`pushed ${repo.branch}${repo.upstream ? '' : ' (set upstream to origin)'}`)

  return { text: `ship: ${lines.join('\n')}` }
}

let gitPart: string | undefined
let cachePart: string | undefined

function publish($: EngineInterface) {
  const line = [gitPart, cachePart].filter(Boolean).join(' · ')
  $.ui.status(line || undefined)
}

async function refresh($: EngineInterface) {
  try {
    const repo = await inspect(argv => $.process.run(argv))
    gitPart = repo ? summarize(repo) : undefined
  } catch {
    gitPart = undefined
  }
  publish($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ship',
      description: 'Stage everything, commit and push the current branch',
      argumentHint: '[commit message]',
    })
    void refresh($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const { usage } = response
    if (usage) {
      const total = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      const rate = total > 0 ? Math.round((usage.cache_read_input_tokens / total) * 100) : 0
      cachePart = `cache ${rate}% hit · ${usage.cache_read_input_tokens} read · ${usage.cache_creation_input_tokens} written`
      publish($)
    }
    return response
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($)
    return done
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bgit\b/.test(e.command)) await refresh($)
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'ship' }, async ($, e) => {
    const result = await ship(argv => $.process.run(argv), e.args.trim())
    await refresh($)
    return result
  })
}
