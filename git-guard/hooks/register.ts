import type { EngineInterface, Register } from 'claude-code'

const BUNDLE_DIR = '.cache/git-guard'
const KEEP_PER_REPO = 10
const KEEP_MS = 30 * 24 * 60 * 60 * 1000
const BUNDLE_TIMEOUT_MS = 180_000
const WORKTREE_REF = 'refs/git-guard/worktree'

const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix'])
const GIT_ELSEWHERE = /^--(git-dir|work-tree)(=|$)/
const GIT_ENV = /^GIT_(DIR|WORK_TREE)=/
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{'])
const WRAPPERS = new Set(['env', 'command', 'nohup', 'time', 'exec', 'nice', 'timeout', 'sudo', 'doas'])
const WRAPPER_VALUES: Record<string, Set<string>> = {
  sudo: new Set(['-u', '-g', '-C', '-D', '-p', '-r', '-t', '-T', '-U', '--user', '--group', '--chdir', '--prompt']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '--unset', '--chdir']),
  nice: new Set(['-n', '--adjustment']),
  timeout: new Set(['-k', '-s', '--kill-after', '--signal']),
}
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])
const SHELL_COMMAND = /^-[a-zA-Z]*c$/
const SHORT_FLAGS = /^-[a-zA-Z]+$/
const BUNDLE_NAME = /^(.+)-(\d{8}-\d{6})-([a-z-]+)\.bundle$/

type Slot = 'words' | 'drop' | 'delimiter'
type Segment = { words: string[]; subs: string[]; mark?: '(' | ')' }
export type Found = { reason: string; dir: string | null }

function bodyEnd(command: string, from: number, delimiter: string): number {
  let start = from
  while (start < command.length) {
    const newline = command.indexOf('\n', start)
    const stop = newline < 0 ? command.length : newline
    if (command.slice(start, stop).trim() === delimiter) return stop
    start = stop + 1
  }
  return command.length
}

function substitutionEnd(command: string, from: number): number {
  let depth = 1
  let quote = ''
  for (let i = from; i < command.length; i++) {
    const c = command[i]!
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"') i++
    } else if (c === "'" || c === '"') quote = c
    else if (c === '\\') i++
    else if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return command.length
}

function lex(command: string): Segment[] {
  const segments: Segment[] = []
  const delimiters: string[] = []
  let segment: string[] = []
  let subs: string[] = []
  let word = ''
  let inWord = false
  let slot: Slot = 'words'
  let quote = ''

  const add = (c: string) => {
    word += c
    inWord = true
  }
  const endWord = () => {
    if (!inWord) return
    if (slot === 'delimiter') delimiters.push(word)
    else if (slot === 'words') segment.push(word)
    slot = 'words'
    word = ''
    inWord = false
  }
  const endSegment = () => {
    endWord()
    if (segment.length > 0 || subs.length > 0) segments.push({ words: segment, subs })
    segment = []
    subs = []
    slot = 'words'
  }

  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote !== "'" && command.startsWith('$(', i)) {
      const end = substitutionEnd(command, i + 2)
      subs.push(command.slice(i + 2, end))
      add(command.slice(i, end + 1))
      i = end
    } else if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"' && i + 1 < command.length) {
        i++
        add(command[i]!)
      } else add(c)
    } else if (c === "'" || c === '"') {
      quote = c
      inWord = true
    } else if (c === '\\' && i + 1 < command.length) {
      i++
      if (command[i] !== '\n') add(command[i]!)
    } else if (c === '\n') {
      endSegment()
      for (const delimiter of delimiters.splice(0)) i = bodyEnd(command, i + 1, delimiter)
    } else if (/\s/.test(c)) {
      endWord()
    } else if (command.startsWith('&&', i) || command.startsWith('||', i)) {
      endSegment()
      i++
    } else if (c === '>' || command.startsWith('&>', i)) {
      if (c === '&') i++
      else if (/^\d+$/.test(word)) {
        word = ''
        inWord = false
      }
      endWord()
      while (command[i + 1] === '>' || command[i + 1] === '|') i++
      if (command[i + 1] === '&') {
        while (/[&\d-]/.test(command[i + 1] ?? '')) i++
      } else slot = 'drop'
    } else if (c === '<') {
      endWord()
      if (command.startsWith('<<<', i)) {
        i += 2
        slot = 'drop'
      } else if (command.startsWith('<<', i)) {
        i += command[i + 2] === '-' ? 2 : 1
        slot = 'delimiter'
      } else slot = 'drop'
    } else if (c === ';' || c === '|' || c === '&') {
      endSegment()
    } else if ((c === '(' && !inWord) || c === ')') {
      endSegment()
      segments.push({ words: [], subs: [], mark: c })
    } else {
      add(c)
    }
  }
  endSegment()
  return segments
}

function commandStart(words: string[]): number {
  let i = 0
  let wrapper = ''
  while (i < words.length) {
    const t = words[i]!
    if (KEYWORDS.has(t)) wrapper = ''
    else if (WRAPPERS.has(t)) wrapper = t
    else if (t.startsWith('-') && wrapper) i += WRAPPER_VALUES[wrapper]?.has(t) ? 1 : 0
    else if (wrapper === 'timeout' && /^\d+(\.\d+)?[smhd]?$/.test(t)) wrapper = ''
    else if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) break
    i++
  }
  return i
}

function resolve(path: string, from: string | null, home: string): string | null {
  const p = path.replace(/^\$HOME(?=\/|$)/, home).replace(/^\$\{HOME\}(?=\/|$)/, home)
  if (/[$`*?[]/.test(p)) return null
  if (p === '~' || p.startsWith('~/')) return home ? `${home}${p.slice(1)}` : null
  if (p.startsWith('/')) return p
  return from === null ? null : `${from.replace(/\/+$/, '')}/${p}`
}

const has = (args: string[], ...flags: string[]) => args.some(a => flags.includes(a))
const short = (args: string[], letter: string) => args.some(a => SHORT_FLAGS.test(a) && a.includes(letter))

function gitReason(sub: string, args: string[]): string | null {
  if (sub === 'push') {
    if (has(args, '--dry-run') || short(args, 'n')) return null
    if (has(args, '--force', '--mirror', '--force-if-includes') || short(args, 'f') || args.some(a => a.startsWith('--force-with-lease') || (a.startsWith('+') && a.length > 1))) return 'force push'
    if (has(args, '--delete', '--prune') || short(args, 'd') || args.some(a => a.startsWith(':') && a.length > 1)) return 'remote delete'
    return null
  }
  if (sub === 'filter-repo') return has(args, '--analyze', '--help', '-h', '--version') ? null : 'history rewrite'
  if (sub === 'filter-branch') return 'history rewrite'
  if (sub === 'reset') return has(args, '--hard') ? 'reset hard' : null
  if (sub === 'branch') {
    const deletes = has(args, '--delete') || short(args, 'd') || short(args, 'D')
    const forced = short(args, 'D') || has(args, '--force') || (deletes && short(args, 'f'))
    return deletes && forced ? 'branch delete' : null
  }
  if (sub === 'tag') {
    if (has(args, '--delete') || short(args, 'd')) return 'tag delete'
    if (has(args, '--force') || short(args, 'f')) return 'tag overwrite'
    return null
  }
  if (sub === 'update-ref') return has(args, '-d', '--delete') ? 'ref delete' : null
  return null
}

export function classify(command: string, cwd: string | null, home: string, depth = 0): Found[] {
  if (depth > 3) return []
  const found: Found[] = []
  let dir: string | null = cwd
  let elsewhere = false
  const subshells: (string | null)[] = []
  const pushed: (string | null)[] = []
  for (const { words, subs, mark } of lex(command)) {
    if (mark === '(') subshells.push(dir)
    if (mark === ')') {
      const back = subshells.pop()
      if (back !== undefined) dir = back
    }
    for (const inner of subs) found.push(...classify(inner, dir, home, depth + 1))
    const start = commandStart(words)
    if (words.slice(0, start).some(w => GIT_ENV.test(w)) && start === words.length) elsewhere = true
    const cmd = words[start]?.split('/').pop()
    if (!cmd) continue
    const args = words.slice(start + 1)
    if (cmd === 'export' && args.some(a => GIT_ENV.test(a))) elsewhere = true
    if (cmd === 'cd' || cmd === 'pushd') {
      const target = args.find(a => a === '-' || !a.startsWith('-'))
      if (cmd === 'pushd') pushed.push(dir)
      dir = target === undefined ? (cmd === 'cd' ? home || null : null) : target === '-' ? null : resolve(target, dir, home)
      continue
    }
    if (cmd === 'popd') {
      dir = pushed.pop() ?? null
      continue
    }
    if (SHELLS.has(cmd)) {
      const c = args.findIndex(a => SHELL_COMMAND.test(a))
      const body = c >= 0 ? args[c + 1] : undefined
      if (body) found.push(...classify(body, dir, home, depth + 1))
      continue
    }
    if (cmd !== 'git') continue
    let at: string | null = elsewhere || words.slice(0, start).some(w => GIT_ENV.test(w)) ? null : dir
    let j = 0
    while (j < args.length && args[j]!.startsWith('-')) {
      const a = args[j]!
      if (GIT_ELSEWHERE.test(a)) at = null
      if (a === '-C') {
        const target = args[j + 1]
        at = target === undefined ? at : resolve(target, at, home)
        j += 2
      } else if (GIT_VALUE_OPTIONS.has(a)) j += 2
      else j++
    }
    const sub = args[j]
    const reason = sub ? gitReason(sub, args.slice(j + 1)) : null
    if (reason) found.push({ reason, dir: at })
  }
  return found
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function stamp(ms: number) {
  const t = new Date(ms)
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`
}

function tilde(path: string, home: string) {
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

const slug = (reason: string) => reason.replace(/[^a-z]+/g, '-')

function repoName(root: string) {
  const parts = root.split('/').filter(Boolean)
  const last = parts.pop() ?? ''
  return (last === '.git' ? parts.pop() ?? '' : last.replace(/\.git$/, '')) || 'repo'
}

type Bundle = { file: string; top: string; reason: string; missing: string }
type Saved = Bundle | { skip: string } | { error: string }

async function save($: EngineInterface, dir: string, reason: string, home: string, done: Set<string>): Promise<Saved> {
  const git = (...args: string[]) => $.process.run(['git', '-C', dir, ...args], { timeoutMs: 30_000 })
  const gitDir = await git('rev-parse', '--absolute-git-dir')
  if (gitDir.exitCode !== 0) return { skip: 'not a git repository' }
  const top = await git('rev-parse', '--show-toplevel')
  const root = top.exitCode === 0 ? top.stdout.trim() : gitDir.stdout.trim()
  if (done.has(root)) return { skip: 'already saved' }
  const run = (...args: string[]) => $.process.run(['git', '-C', root, ...args], { timeoutMs: 30_000 })
  if ((await run('rev-parse', '-q', '--verify', 'HEAD')).exitCode !== 0) return { skip: 'no commits yet' }
  const folder = `${home}/${BUNDLE_DIR}`
  const file = `${folder}/${repoName(root)}-${stamp(await $.clock.now())}-${slug(reason)}.bundle`
  const stash = top.exitCode === 0 ? await run('stash', 'create') : undefined
  const worktree = stash?.exitCode === 0 ? stash.stdout.trim() : ''
  const missing = stash && stash.exitCode !== 0 ? stash.stderr.trim().split('\n').pop() || `git stash create exited ${stash.exitCode}` : ''
  if (worktree) {
    const ref = await run('update-ref', WORKTREE_REF, worktree)
    if (ref.exitCode !== 0) return { error: `could not keep uncommitted changes: ${ref.stderr.trim()}` }
  }
  try {
    const made = await $.process.run(['mkdir', '-p', folder], { timeoutMs: 10_000 })
    if (made.exitCode !== 0) return { error: made.stderr.trim() || `could not create ${folder}` }
    const bundle = await $.process.run(['git', '-C', root, 'bundle', 'create', file, '--all'], { timeoutMs: BUNDLE_TIMEOUT_MS })
    if (bundle.exitCode !== 0) return { error: bundle.stderr.trim().split('\n').pop() || `git bundle exited ${bundle.exitCode}` }
  } finally {
    if (worktree) await run('update-ref', '-d', WORKTREE_REF)
  }
  await prune($, folder, repoName(root))
  return { file, top: root, reason, missing }
}

async function prune($: EngineInterface, folder: string, repo: string) {
  try {
    const now = await $.clock.now()
    const ours = (await $.fs.list(folder))
      .filter(f => f.kind === 'file' && BUNDLE_NAME.exec(f.name)?.[1] === repo)
      .sort((a, b) => b.name.localeCompare(a.name))
    const old = ours.filter((f, i) => i >= KEEP_PER_REPO || now - f.mtimeMs > KEEP_MS)
    if (old.length > 0) await $.process.run(['rm', '-f', ...old.map(f => `${folder}/${f.name}`)], { timeoutMs: 10_000 })
  } catch {
    return
  }
}

function restoreLine(s: { file: string; top: string }, home: string) {
  return `git -C ${tilde(s.top, home)} fetch ${tilde(s.file, home)} '+refs/*:refs/git-guard/restore/*'`
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? ''
    const found = classify(e.command, await $.session.cwd(), home)
    if (found.length === 0) return next(e)

    const unknown = found.find(f => f.dir === null)
    if (unknown) {
      return {
        deny:
          `git-guard: this command would ${unknown.reason}, and git-guard could not tell which repository it runs in ` +
          '(a variable, a glob, `cd -` or `popd` in the path, or `GIT_DIR`, `GIT_WORK_TREE`, `--git-dir` or `--work-tree` naming another one), ' +
          'so it saved no bundle and nothing was run. ' +
          'Run it again with the repository named by an absolute path: `git -C /path/to/repo ...` or `cd /path/to/repo && ...`.',
      }
    }

    const saved: Bundle[] = []
    const tops = new Set<string>()
    for (const f of found) {
      const result = await save($, f.dir!, f.reason, home, tops)
      if ('skip' in result) continue
      if ('error' in result) {
        return {
          deny:
            `git-guard: this command would ${f.reason} in ${tilde(f.dir!, home)}, and no bundle could be saved first ` +
            `(${result.error}). Nothing was run. Tell the user: if they still want it, they can save one with ` +
            `\`git -C ${tilde(f.dir!, home)} bundle create ~/${BUNDLE_DIR}/manual.bundle --all\` and run the command in their own terminal.`,
        }
      }
      tops.add(result.top)
      saved.push(result)
    }

    for (const s of saved) {
      const after = s.reason === 'history rewrite' ? ' It still holds what the rewrite removes: delete it once the rewrite is verified.' : ''
      const missing = s.missing ? ` Uncommitted changes are not in it: git stash create failed (${s.missing}).` : ''
      $.ui.toast(`git-guard: saved ${tilde(s.top, home)} before ${s.reason} as ${tilde(s.file, home)}.${missing}${after}`)
    }
    const last = saved[saved.length - 1]
    if (last) $.ui.status(`git-guard: ${repoName(last.top)} · restore: ${restoreLine(last, home)}`)
    return next(e)
  }).catch(($, e, next) =>
    next.called || classify(e.command, null, '').length === 0
      ? next(e)
      : { deny: 'git-guard: its check failed, so this history-changing git command was not run.' },
  )
}
