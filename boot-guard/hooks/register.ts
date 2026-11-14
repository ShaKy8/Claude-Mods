import type { EngineInterface, Register } from 'claude-code'

const CONFIG = 'root'
const ACK_MS = 10 * 60 * 1000

const KERNELISH = /^(linux[a-z0-9._-]*|.*-dkms|dkms|limine[a-z0-9-]*|mkinitcpio[a-z-]*|nvidia[a-z0-9._-]*|.*firmware.*|systemd-boot.*|grub.*)$/
const PROTECTED =
  /(^|[\s'"=])(\/boot(\/|\s|$|'|")|\/etc\/(modprobe\.d|modules-load\.d|mkinitcpio(\.d|\.conf)|default\/limine|limine[^\s'"]*|kernel\/)|\/sys\/bus\/[^\s'"]*\/(un)?bind|\/sys\/module\/|\/proc\/sys\/kernel)/
const WRITERS = new Set(['tee', 'cp', 'mv', 'rm', 'install', 'ln', 'truncate', 'dd', 'chattr'])
const SED_IN_PLACE = /^(-[a-zA-Z]*i|--in-place)/
const FIND_RUNS = new Set(['-exec', '-execdir', '-ok', '-okdir'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])
const SHELL_COMMAND = /^-[a-zA-Z]*c$/

const DKMS_CHANGES = new Set(['install', 'build', 'add', 'remove', 'autoinstall', 'uninstall', 'unbuild'])
const MODPROBE_SAFE = new Set(['-n', '--dry-run', '-c', '--showconfig', '--show-config', '-D', '--show-depends', '-R', '--resolve-alias', '-h', '--help', '-V', '--version'])
const INITRAMFS_SAFE = new Set(['-h', '--help', '-V', '--version', '-L', '--listhooks', '-H', '--hookhelp', '-M', '--automods'])
const EFI_WRITE = /^(-[a-zA-Z]*[cBoOnNaAtT][a-zA-Z]*|--(create|create-only|delete-bootnum|bootorder|delete-bootorder|bootnext|delete-bootnext|active|inactive|timeout|delete-timeout))$/
const PACKAGERS = new Set(['pacman', 'yay', 'paru'])
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'nohup', 'time', 'exec', 'nice'])
const WRAPPER_VALUES: Record<string, Set<string>> = {
  sudo: new Set(['-u', '-g', '-C', '-D', '-p', '-r', '-t', '-T', '-U', '--user', '--group', '--close-from', '--chdir', '--prompt', '--role', '--type', '--command-timeout', '--other-user']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '--unset', '--chdir']),
  nice: new Set(['-n', '--adjustment']),
}

type Segment = { words: string[]; targets: string[] }
type Slot = 'words' | 'targets' | 'drop' | 'delimiter'

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

function lex(command: string): { segments: Segment[]; substitutions: string[] } {
  const segments: Segment[] = []
  const substitutions: string[] = []
  const delimiters: string[] = []
  let segment: Segment = { words: [], targets: [] }
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
    else if (slot !== 'drop') segment[slot].push(word)
    slot = 'words'
    word = ''
    inWord = false
  }
  const endSegment = () => {
    endWord()
    if (segment.words.length > 0 || segment.targets.length > 0) segments.push(segment)
    segment = { words: [], targets: [] }
    slot = 'words'
  }

  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote !== "'" && command.startsWith('$(', i)) {
      const end = substitutionEnd(command, i + 2)
      substitutions.push(command.slice(i + 2, end))
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
      } else slot = 'targets'
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
    } else {
      add(c)
    }
  }
  endSegment()
  return { segments, substitutions }
}

function writes(cmd: string, args: string[]): boolean {
  return WRITERS.has(cmd) || (cmd === 'sed' && args.some(a => SED_IN_PLACE.test(a)))
}

function classifyTokens(tokens: string[]): string | null {
  let i = 0
  let wrapper = ''
  while (i < tokens.length) {
    const t = tokens[i]!
    if (WRAPPERS.has(t)) wrapper = t
    else if (t.startsWith('-') && i > 0) i += WRAPPER_VALUES[wrapper]?.has(t) ? 1 : 0
    else if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) break
    i++
  }
  const cmd = tokens[i]?.split('/').pop()
  if (!cmd) return null
  const args = tokens.slice(i + 1)

  if (cmd === 'dkms') return DKMS_CHANGES.has(args.find(a => !a.startsWith('-')) ?? '') ? 'dkms' : null
  if (cmd === 'modprobe') return args.some(a => MODPROBE_SAFE.has(a)) ? null : 'kernel module'
  if (cmd === 'insmod' || cmd === 'rmmod') return 'kernel module'
  if (cmd.startsWith('limine')) return args.some(a => a === '--help' || a === '--version') ? null : 'limine'
  if (['mkinitcpio', 'dracut', 'update-initramfs'].includes(cmd)) {
    return args.some(a => INITRAMFS_SAFE.has(a)) ? null : 'initramfs'
  }
  if (cmd === 'efibootmgr') return args.some(a => EFI_WRITE.test(a)) ? 'EFI boot entries' : null
  if (PACKAGERS.has(cmd)) {
    const op = args.find(a => /^-[SUR]/.test(a))
    if (!op || /[silgpw]/.test(op.slice(2)) || args.includes('--print')) return null
    const packages = args.filter(a => !a.startsWith('-'))
    const hit = op.includes('u') || packages.some(p => KERNELISH.test(p.split('/').pop()!.replace(/-\d.*$/, '')))
    return hit ? 'kernel package' : null
  }
  if (cmd === 'find') {
    const run = args.findIndex(a => FIND_RUNS.has(a))
    const changes = args.includes('-delete') || (run >= 0 && writes(args[run + 1]?.split('/').pop() ?? '', args.slice(run + 2)))
    return changes && args.some(a => PROTECTED.test(a)) ? 'boot config' : null
  }
  return writes(cmd, args) && args.some(a => PROTECTED.test(a)) ? 'boot config' : null
}

function classify(command: string): string | null {
  const { segments, substitutions } = lex(command)
  for (const inner of substitutions) {
    const found = classify(inner)
    if (found) return found
  }

  for (const { words, targets } of segments) {
    const shell = words.findIndex((w, j) => SHELLS.has(w.split('/').pop()!) && SHELL_COMMAND.test(words[j + 1] ?? ''))
    if (shell >= 0) {
      const found = classify(words[shell + 2] ?? '')
      if (found) return found
    }

    const found = classifyTokens(words)
    if (found) return found

    if (targets.some(t => PROTECTED.test(t))) return 'boot config'
  }
  return null
}

let ackedUntil = 0
let lastSnapshot: number | undefined

async function snapshot($: EngineInterface, description: string) {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(
      ['snapper', '-c', CONFIG, 'create', '--type', 'single', '--print-number', '--description', description],
      { timeoutMs: 60_000 },
    )
    const number = Number(stdout.trim())
    return exitCode === 0 && Number.isInteger(number)
      ? { number }
      : { error: (stderr || stdout).trim() || `snapper exited ${exitCode}` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

const SETUP = `sudo snapper -c ${CONFIG} set-config ALLOW_USERS=$USER SYNC_ACL=yes`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guard-ack',
      description: 'Let risky boot commands through for 10 minutes (you took a snapshot yourself)',
    })
    return next(e)
  })

  on('command.run', { command: 'guard-ack' }, async $ => {
    ackedUntil = (await $.clock.now()) + ACK_MS
    return { text: 'boot-guard: risky boot commands allowed for 10 minutes. Take your own snapshot first.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const reason = classify(e.command)
    if (!reason) return next(e)

    if ((await $.clock.now()) < ackedUntil) return next(e)

    const description = `boot-guard: ${reason}: ${e.command.replace(/\s+/g, ' ').slice(0, 100)}`
    const snap = await snapshot($, description)
    if ('error' in snap) {
      return {
        deny:
          `boot-guard: this command changes ${reason}, and no snapper snapshot could be taken first ` +
          `(${snap.error}). Nothing was run. Tell the user: either enable snapshots for their account once with ` +
          `\`${SETUP}\`, or have them run \`sudo snapper -c ${CONFIG} create -d "before ${reason}"\` and then ` +
          `/guard-ack, and retry.`,
      }
    }

    lastSnapshot = snap.number
    $.ui.toast(`boot-guard: snapshot #${snap.number} before ${reason}`)
    $.ui.status(`boot-guard: #${lastSnapshot} · undo: sudo snapper -c ${CONFIG} undochange ${lastSnapshot}..0`)
    return next(e)
  }).catch(($, e, next) =>
    next.called || !classify(e.command)
      ? next(e)
      : { deny: 'boot-guard: its check failed, so this boot-affecting command was not run.' },
  )
}
