import { test, expect, mock } from 'claude-code/testing'

type Call = readonly string[]
const done = (exitCode: number, stdout = '', stderr = '') => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const HOME = '/home/u'
const REPO = '/home/u/code/app'
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000

type World = {
  cwd?: string
  repos?: Record<string, string>
  empty?: boolean
  stash?: string
  bundle?: ReturnType<typeof done>
  files?: { name: string; mtimeMs: number }[]
  mkdir?: ReturnType<typeof done>
  bare?: string[]
  stashFails?: boolean
  broken?: boolean
}

function setup(on: any, world: World = {}) {
  mock.clock(on, { now: NOW })
  const repos = world.repos ?? { [REPO]: REPO }
  const calls: Call[] = []
  const ran: string[] = []
  const toasts: string[] = []
  const status: (string | undefined)[] = []
  on('session.cwd', () => ({ value: world.cwd ?? REPO }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.list', () => ({ value: (world.files ?? []).map(f => ({ ...f, kind: 'file', size: 1, isLink: false })) }))
  on('ui.toast', (_$: unknown, e: unknown) => {
    toasts.push(typeof e === 'string' ? e : JSON.stringify(e))
    return { value: undefined }
  })
  on('ui.status', (_$: unknown, e: unknown) => {
    status.push(typeof e === 'string' ? e : JSON.stringify(e))
    return { value: undefined }
  })
  on('process.run', async (_$: unknown, e: { argv: Call }) => {
    calls.push(e.argv)
    const a = e.argv
    if (a[0] === 'mkdir') return { value: world.mkdir ?? done(0) }
    if (a[0] !== 'git') return { value: done(0) }
    if (world.broken) return { value: null }
    const sub = a.slice(3).join(' ')
    const bare = (world.bare ?? []).find(dir => a[2] === dir || a[2]!.startsWith(`${dir}/`))
    const top = Object.entries(repos).find(([dir]) => a[2] === dir || a[2]!.startsWith(`${dir}/`))?.[1]
    if (sub === 'rev-parse --absolute-git-dir') {
      if (bare) return { value: done(0, `${bare}\n`) }
      return { value: top ? done(0, `${top}/.git\n`) : done(128, '', 'fatal: not a git repository') }
    }
    if (sub === 'rev-parse --show-toplevel') {
      if (bare) return { value: done(128, '', 'fatal: this operation must be run in a work tree') }
      return { value: top ? done(0, `${top}\n`) : done(128, '', 'fatal: not a git repository') }
    }
    if (sub === 'stash create' && world.stashFails) return { value: done(128, 'a: needs merge\n', 'a: unmerged (abc)\nCannot save the current index state') }
    if (sub === 'rev-parse -q --verify HEAD') return { value: world.empty ? done(1) : done(0, 'abc\n') }
    if (sub === 'stash create') return { value: done(0, world.stash ? `${world.stash}\n` : '') }
    if (a[3] === 'bundle') return { value: world.bundle ?? done(0) }
    return { value: done(0) }
  })
  on('tool.call', async () => {
    ran.push('ran')
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  return { calls, ran, toasts, status }
}

const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })
const bundles = (calls: Call[]) => calls.filter(c => c[0] === 'git' && c[3] === 'bundle')

const RISKY = [
  'git push --force origin main',
  'git push -f origin v0.1.1',
  'git push --force-with-lease',
  'git push --force-with-lease=main:abc123 origin main',
  'git push origin +main',
  'git push --mirror backup',
  'git push origin --delete old-branch',
  'git push origin :old-branch',
  'git push -fu origin main',
  'git filter-repo --path secrets.txt --invert-paths',
  "git filter-branch --tree-filter 'rm -f x' HEAD",
  'git reset --hard origin/main',
  'git reset --hard',
  'git branch -D feature',
  'git branch --delete --force feature',
  'git branch -d -f feature',
  'git tag -d v1.0',
  'git tag -f v0.1.1 HEAD',
  'git update-ref -d refs/scratch/pr3',
  'git -c core.pager=cat reset --hard HEAD~1',
  'git --no-pager branch -D feature',
  'cd /tmp && cd /home/u/code/app && git reset --hard',
  'git commit --amend -q -m x && git push -f',
  "bash -c 'git reset --hard HEAD~2'",
  'echo $(git push --force)',
  'git fetch && git reset --hard @{u}',
  'env GIT_TRACE=1 git push --force',
  'nice -n 5 git filter-repo --force --path a',
  "git tag -f v2 <<'EOF'\nnotes\nEOF",
  'if true; then git reset --hard; fi',
  'for b in x; do git branch -D y; done',
  '{ git push -f; }',
  '! git push -f',
  'while false; do :; done; until git push -f; do sleep 1; done',
  'timeout 60 git push -f',
  'timeout -s INT 5m git filter-repo --path a',
  'sudo git reset --hard',
  'sudo -u kyle git push --force',
]

const SAFE = [
  'git push',
  'git push origin main',
  'git push -u origin feature',
  'git push --tags',
  'git push --dry-run --force origin main',
  'git push -n -f',
  'git push --follow-tags',
  'git filter-repo --analyze',
  'git filter-repo --version',
  'git reset --soft HEAD~1',
  'git reset HEAD file.txt',
  'git branch -d merged-feature',
  'git branch feature',
  'git branch -a',
  'git tag v1.0',
  'git tag -l',
  'git update-ref refs/heads/x HEAD',
  'git status && git log --oneline -5',
  'git commit -m "git push --force later"',
  'git commit -m "reset --hard notes"',
  'echo git reset --hard',
  'grep -rn "branch -D" docs/',
  "echo '$(git push --force)'",
  "cat > notes.md <<'EOF'\ngit push --force origin main\nEOF",
  'gh pr create --title "Use git push -f less"',
  'git stash list',
  'if git diff --quiet; then git push; fi',
  'for b in x; do git branch -d y; done',
  '{ git push; }',
  'timeout 60 git push',
  'sudo git status',
  'GIT_DIR=/x/.git git log',
  'git --git-dir=/x/.git log --oneline',
]

for (const command of RISKY) {
  test(`saves a bundle before: ${command}`, async ($, on) => {
    const { calls, ran } = setup(on)
    await bash($, command)

    const made = bundles(calls)
    expect(made.length).toBe(1)
    expect(made[0]!.slice(0, 5)).toEqual(['git', '-C', REPO, 'bundle', 'create'])
    expect(made[0]![5]).toMatch(/^\/home\/u\/\.cache\/git-guard\/app-\d{8}-\d{6}-[a-z-]+\.bundle$/)
    expect(made[0]![6]).toBe('--all')
    expect(ran).toEqual(['ran'])
  })
}

for (const command of SAFE) {
  test(`leaves alone: ${command}`, async ($, on) => {
    const { calls, ran, toasts } = setup(on)
    await bash($, command)

    expect(calls.length).toBe(0)
    expect(toasts.length).toBe(0)
    expect(ran).toEqual(['ran'])
  })
}

test('bundles the repository named by git -C or cd, not the session folder', async ($, on) => {
  const repos = { [REPO]: REPO, '/home/u/other': '/home/u/other', '/srv/repo': '/srv/repo' }
  const { calls } = setup(on, { repos, cwd: '/home/u' })
  await bash($, 'git -C ~/other push -f')
  await bash($, 'cd /srv/repo/src && git reset --hard')
  await bash($, 'cd code/app && git branch -D x')

  expect(bundles(calls).map(c => c[2])).toEqual(['/home/u/other', '/srv/repo', REPO])
})

test('names the bundle after the repository, the time and the reason', async ($, on) => {
  const { calls } = setup(on)
  await bash($, 'git filter-repo --path a --invert-paths')

  expect(bundles(calls)[0]![5]).toMatch(/\/app-20261114-\d{6}-history-rewrite\.bundle$/)
})

test('refuses and runs nothing when it cannot tell which repository', async ($, on) => {
  const { calls, ran } = setup(on)
  const first = await bash($, 'cd "$S" && git reset --hard')
  const second = await bash($, 'cd - && git push -f')
  const third = await bash($, 'git -C ~/Projects/* push -f')

  for (const result of [first, second, third]) {
    expect(result.deny).toContain('git-guard:')
    expect(result.deny).toContain('nothing was run')
    expect(result.deny).toContain('git -C /path/to/repo')
  }
  expect(calls.length).toBe(0)
  expect(ran).toEqual([])
})

test('refuses and runs nothing when the bundle cannot be made', async ($, on) => {
  const { ran, toasts } = setup(on, { bundle: done(128, '', 'error: no space left on device') })
  const result = await bash($, 'git push --force')

  expect(result.deny).toContain('no space left on device')
  expect(result.deny).toContain('Nothing was run')
  expect(result.deny).toContain('bundle create')
  expect(ran).toEqual([])
  expect(toasts.length).toBe(0)
})

test('keeps uncommitted changes in the bundle under a temporary ref, removed after', async ($, on) => {
  const { calls } = setup(on, { stash: 'f00d' })
  await bash($, 'git reset --hard')

  const at = (argv: string) => calls.findIndex(c => c.join(' ') === argv)
  const add = at(`git -C ${REPO} update-ref refs/git-guard/worktree f00d`)
  const bundle = calls.findIndex(c => c[3] === 'bundle')
  const remove = at(`git -C ${REPO} update-ref -d refs/git-guard/worktree`)
  expect(add).toBeGreaterThan(-1)
  expect(add).toBeLessThan(bundle)
  expect(remove).toBeGreaterThan(bundle)
})

test('removes the temporary ref even when the bundle fails', async ($, on) => {
  const { calls, ran } = setup(on, { stash: 'f00d', bundle: done(1, '', 'fatal: disk') })
  const result = await bash($, 'git reset --hard')

  expect(result.deny).toContain('fatal: disk')
  expect(calls.some(c => c.join(' ') === `git -C ${REPO} update-ref -d refs/git-guard/worktree`)).toBe(true)
  expect(ran).toEqual([])
})

test('makes no temporary ref when the work tree is clean', async ($, on) => {
  const { calls } = setup(on)
  await bash($, 'git reset --hard')

  expect(calls.some(c => c.includes('update-ref'))).toBe(false)
})

test('lets the command through with nothing to save outside a repository or before the first commit', async ($, on) => {
  const { calls, ran, toasts } = setup(on, { repos: {} })
  await bash($, 'git push -f')
  expect(bundles(calls).length).toBe(0)
  expect(ran).toEqual(['ran'])
  expect(toasts.length).toBe(0)
})

test('lets the command through in a repository with no commits yet', async ($, on) => {
  const { calls, ran } = setup(on, { empty: true })
  await bash($, 'git branch -D x')
  expect(bundles(calls).length).toBe(0)
  expect(ran).toEqual(['ran'])
})

test('saves one bundle when one command changes the same repository twice', async ($, on) => {
  const { calls, toasts } = setup(on)
  await bash($, 'git tag -f v1 HEAD && git push -f origin v1')

  expect(bundles(calls).length).toBe(1)
  expect(toasts.length).toBe(1)
})

test('shows a toast and pins the restore command', async ($, on) => {
  const { toasts, status } = setup(on)
  await bash($, 'git push -f')

  expect(toasts[0]).toContain('git-guard: saved ~/code/app before force push as ~/.cache/git-guard/app-')
  expect(toasts[0]).not.toContain('delete it')
  expect(status[0]).toContain("restore: git -C ~/code/app fetch ~/.cache/git-guard/app-")
  expect(status[0]).toContain("'+refs/*:refs/git-guard/restore/*'")
})

test('says to delete a bundle taken before a history rewrite once it is verified', async ($, on) => {
  const { toasts } = setup(on)
  await bash($, 'git filter-repo --path secrets.txt --invert-paths')

  expect(toasts[0]).toContain('delete it once the rewrite is verified')
})

test('prunes only its own bundles for this repository past ten or thirty days', async ($, on) => {
  const files = [
    ...Array.from({ length: 11 }, (_, i) => ({ name: `app-202611${String(i + 1).padStart(2, '0')}-120000-force-push.bundle`, mtimeMs: NOW - DAY })),
    { name: 'app-20260901-120000-reset-hard.bundle', mtimeMs: NOW - 70 * DAY },
    { name: 'other-20260901-120000-reset-hard.bundle', mtimeMs: NOW - 70 * DAY },
    { name: 'app-notes.txt', mtimeMs: NOW - 70 * DAY },
    { name: 'manual.bundle', mtimeMs: NOW - 70 * DAY },
  ]
  const { calls } = setup(on, { files })
  await bash($, 'git push -f')

  const rm = calls.find(c => c[0] === 'rm')
  expect(rm).toEqual([
    'rm',
    '-f',
    '/home/u/.cache/git-guard/app-20261101-120000-force-push.bundle',
    '/home/u/.cache/git-guard/app-20260901-120000-reset-hard.bundle',
  ])
})

test('prunes a bundle older than thirty days even when there are fewer than ten', async ($, on) => {
  const files = [
    { name: 'app-20261110-120000-force-push.bundle', mtimeMs: NOW - DAY },
    { name: 'app-20261001-120000-force-push.bundle', mtimeMs: NOW - 44 * DAY },
  ]
  const { calls } = setup(on, { files })
  await bash($, 'git push -f')

  expect(calls.find(c => c[0] === 'rm')).toEqual(['rm', '-f', '/home/u/.cache/git-guard/app-20261001-120000-force-push.bundle'])
})

test('refuses and runs nothing when the bundle folder cannot be made', async ($, on) => {
  const { calls, ran } = setup(on, { mkdir: done(1, '', 'mkdir: Permission denied') })
  const result = await bash($, 'git push -f')

  expect(result.deny).toContain('Permission denied')
  expect(bundles(calls).length).toBe(0)
  expect(ran).toEqual([])
})

test('refuses a risky command when its own check breaks, and only a risky one', async ($, on) => {
  const { ran } = setup(on, { broken: true })
  const risky = await bash($, 'git push -f')
  expect(risky.deny).toContain('git-guard: its check failed')
  expect(ran).toEqual([])

  await bash($, 'git status')
  expect(ran).toEqual(['ran'])
})

test('follows subshells, pushd and popd, and $(...) where it sits', async ($, on) => {
  const repos = { [REPO]: REPO, '/srv/repo': '/srv/repo' }
  const { calls } = setup(on, { repos })
  await bash($, '(cd /srv/repo && make); git push -f')
  await bash($, 'pushd /srv/repo && make && popd && git reset --hard')
  await bash($, 'cd /srv/repo && echo $(git push -f)')
  await bash($, 'pushd /srv/repo >/dev/null; git branch -D x')

  expect(bundles(calls).map(c => c[2])).toEqual([REPO, REPO, '/srv/repo', '/srv/repo'])
})

test('refuses when GIT_DIR, GIT_WORK_TREE, --git-dir, --work-tree or a bare popd names the repository', async ($, on) => {
  const { calls, ran } = setup(on)
  for (const command of [
    'git --git-dir=/x/.git push -f',
    'git --work-tree /x reset --hard',
    'GIT_DIR=/x/.git git reset --hard',
    'env GIT_WORK_TREE=/x git reset --hard',
    'export GIT_DIR=/x/.git; git push -f',
    'popd && git push -f',
  ]) {
    const result = await bash($, command)
    expect(result.deny).toContain('could not tell which repository')
  }
  expect(calls.length).toBe(0)
  expect(ran).toEqual([])
})

test('bundles a bare repository by its git folder, with no work tree to record', async ($, on) => {
  const { calls, ran } = setup(on, { repos: {}, bare: ['/srv/mirror.git'], cwd: '/srv/mirror.git' })
  await bash($, 'git push --mirror backup')

  const made = bundles(calls)
  expect(made.length).toBe(1)
  expect(made[0]![2]).toBe('/srv/mirror.git')
  expect(made[0]![5]).toMatch(/\/mirror-\d{8}-\d{6}-force-push\.bundle$/)
  expect(calls.some(c => c.includes('stash'))).toBe(false)
  expect(ran).toEqual(['ran'])
})

test('bundles from inside a .git folder, named after the repository', async ($, on) => {
  const { calls } = setup(on, { repos: {}, bare: ['/home/u/code/app/.git'], cwd: '/home/u/code/app/.git' })
  await bash($, 'git update-ref -d refs/heads/x')

  expect(bundles(calls)[0]![5]).toMatch(/\/app-\d{8}-\d{6}-ref-delete\.bundle$/)
})

test('still saves the bundle when git cannot record uncommitted changes, and says so', async ($, on) => {
  const { calls, ran, toasts } = setup(on, { stashFails: true })
  await bash($, 'git reset --hard')

  expect(bundles(calls).length).toBe(1)
  expect(calls.some(c => c.includes('update-ref'))).toBe(false)
  expect(toasts[0]).toContain('Uncommitted changes are not in it: git stash create failed (Cannot save the current index state).')
  expect(ran).toEqual(['ran'])
})
