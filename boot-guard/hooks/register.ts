import type { EngineInterface, Register } from 'claude-code'

const CONFIG = 'root'
const ACK_MS = 10 * 60 * 1000

const KERNELISH = /^(linux[a-z0-9._-]*|.*-dkms|dkms|limine[a-z0-9-]*|mkinitcpio[a-z-]*|nvidia[a-z0-9._-]*|.*firmware.*|systemd-boot.*|grub.*)$/
const PROTECTED =
  /(^|[\s'"=])(\/boot(\/|\s|$|'|")|\/etc\/(modprobe\.d|modules-load\.d|mkinitcpio(\.d|\.conf)|default\/limine|limine[^\s'"]*|kernel\/)|\/sys\/bus\/[^\s'"]*\/(un)?bind|\/sys\/module\/|\/proc\/sys\/kernel)/
const WRITER = />|\btee\b|\bsed\s+(-\w*i|--in-place)|\b(cp|mv|rm|install|ln|truncate|dd|chattr)\b/

const DKMS_CHANGES = new Set(['install', 'build', 'add', 'remove', 'autoinstall', 'uninstall', 'unbuild'])
const MODPROBE_SAFE = new Set(['-n', '--dry-run', '-c', '--showconfig', '--show-config', '-D', '--show-depends', '-R', '--resolve-alias', '-h', '--help', '-V', '--version'])
const INITRAMFS_SAFE = new Set(['-h', '--help', '-V', '--version', '-L', '--listhooks', '-H', '--hookhelp', '-M', '--automods'])
const EFI_WRITE = /^(-[a-zA-Z]*[cBoOnNaAtT][a-zA-Z]*|--(create|create-only|delete-bootnum|bootorder|delete-bootorder|bootnext|delete-bootnext|active|inactive|timeout|delete-timeout))$/
const PACKAGERS = new Set(['pacman', 'yay', 'paru'])
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'nohup', 'time', 'exec'])

function stripNoise(segment: string): string {
  return segment.replace(/\d*>&\d+/g, ' ').replace(/\d*>\s*\/dev\/null/g, ' ')
}

function classifyTokens(tokens: string[]): string | null {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]!
    if (WRAPPERS.has(t) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || (t.startsWith('-') && i > 0)) i++
    else break
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
  return null
}

function classify(command: string): string | null {
  for (const raw of command.split(/&&|\|\||[;|\n]/)) {
    const segment = stripNoise(raw).trim()
    if (!segment) continue

    const inner = /\b(?:ba|z)?sh\s+-c\s+(['"])([\s\S]*)\1/.exec(segment)
    if (inner) {
      const found = classify(inner[2]!)
      if (found) return found
    }

    const tokens = segment.split(/\s+/).map(t => t.replace(/^['"]|['"]$/g, ''))
    const found = classifyTokens(tokens)
    if (found) return found

    if (WRITER.test(segment) && PROTECTED.test(segment)) return 'boot config'
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
