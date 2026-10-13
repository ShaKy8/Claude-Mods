import { test, expect, mock } from 'claude-code/testing'

type Call = readonly string[]
const done = (exitCode: number, stdout = '', stderr = '') => ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

function setup(on: any, snapper: ReturnType<typeof done>) {
  const clock = mock.clock(on)
  const calls: Call[] = []
  const ran: string[] = []
  on('process.run', async (_$: unknown, e: { argv: Call }) => {
    calls.push(e.argv)
    return { value: snapper }
  })
  on('tool.call', async () => {
    ran.push('ran')
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  return { calls, ran, clock }
}

const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })

const RISKY = [
  'sudo dkms install surface-laptop2-camera/1.0 -k 7.2.5',
  'sudo modprobe -r ov9734',
  "sudo sh -c 'echo i2c-OVTI9734:00 > /sys/bus/i2c/drivers/ov9734/bind'",
  'echo "blacklist ov9734" | sudo tee /etc/modprobe.d/blacklist-ov9734.conf',
  'sudo limine-update',
  'sudo sed -i "s/timeout: 5/timeout: 10/" /boot/limine.conf',
  'sudo mkinitcpio -P',
  'sudo efibootmgr -B -b 0003',
  'sudo pacman -S linux-headers',
  'sudo pacman -Syu',
  'cd /tmp && sudo rmmod ov9734',
]

const SAFE = [
  'ls /boot',
  'dkms status',
  'modprobe -n -v ov9734',
  'sudo sed -n "1,40p" /boot/limine.conf',
  'sudo grep -n timeout /boot/limine.conf 2>/dev/null',
  'efibootmgr -v',
  'pacman -Q linux',
  'pacman -Ss dkms',
  'sudo pacman -S htop',
  'mkinitcpio --listhooks',
  'git commit -m "update dkms notes"',
]

for (const command of RISKY) {
  test(`snapshots before: ${command}`, async ($, on) => {
    const { calls, ran } = setup(on, done(0, '42\n'))
    await bash($, command)

    expect(calls.some(c => c[0] === 'snapper' && c.includes('create'))).toBe(true)
    expect(ran).toEqual(['ran'])
  })
}

for (const command of SAFE) {
  test(`leaves alone: ${command}`, async ($, on) => {
    const { calls, ran } = setup(on, done(0, '42\n'))
    await bash($, command)

    expect(calls.length).toBe(0)
    expect(ran).toEqual(['ran'])
  })
}

test('denies and runs nothing when snapper has no permission', async ($, on) => {
  const { ran } = setup(on, done(1, '', 'No permissions.'))
  const result = await bash($, 'sudo dkms install foo/1 -k 7')

  expect(result.deny).toContain('No permissions.')
  expect(result.deny).toContain('ALLOW_USERS')
  expect(ran).toEqual([])
})

test('/guard-ack lets a risky command through for ten minutes only', async ($, on) => {
  const { calls, ran, clock } = setup(on, done(1, '', 'No permissions.'))
  await $.command.run({
    command: 'guard-ack',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

  await bash($, 'sudo limine-update')
  expect(ran).toEqual(['ran'])
  expect(calls.length).toBe(0)

  await clock.advance(11 * 60 * 1000)
  const result = await bash($, 'sudo limine-update')
  expect(result.deny).toContain('No permissions.')
  expect(ran).toEqual(['ran'])
})
