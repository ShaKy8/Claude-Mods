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
  'sudo cp limine.conf "/boot/limine.conf"',
  'sudo install -m644 limine.conf /boot/limine.conf',
  'sudo sed --in-place "s/a/b/" /etc/mkinitcpio.conf',
  "printf 'options ov9734 x=1\\n' > /etc/modprobe.d/ov9734.conf",
  'echo Y >/sys/module/usbcore/parameters/autosuspend',
  'echo ov9734 | sudo tee -a /etc/modules-load.d/camera.conf > /dev/null',
  'sudo dd if=limine-bios.sys of=/boot/limine-bios.sys',
  "sudo find /boot -name '*.old' -delete",
  "sudo find /etc/modprobe.d -name '*.bak' -exec rm {} +",
  "sudo tee /etc/modprobe.d/ov9734.conf <<'EOF'\noptions ov9734 x=1\nEOF",
  "bash -lc 'modprobe -r ov9734; modprobe ov9734'",
  'sudo -u root tee /boot/limine.conf',
  'sudo -u root modprobe -r ov9734',
  'sudo -n modprobe -r ov9734',
  'doas -u root mkinitcpio -P',
  'nice cp limine.conf /boot/limine.conf',
  'nice -n 19 cp limine.conf /boot/limine.conf',
  'echo $(sudo cp limine.conf /boot/limine.conf)',
  'git commit -m "notes $(sudo mkinitcpio -P)"',
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
  'git commit -m "Catch tee writes to /etc/modprobe.d"',
  'git commit -m "boot-guard: also catch cp into /boot"',
  'echo "sudo sed -i s/a/b/ /boot/limine.conf" > notes.txt',
  'grep -n "install" /etc/mkinitcpio.conf',
  'grep -rn "rm /boot" docs/',
  'cat /etc/modprobe.d/blacklist.conf > /tmp/blacklist.conf',
  "find /boot -name '*.conf'",
  'git commit -m "Catch tee writes; also cp into /boot"',
  "cat > notes.md <<'EOF'\nsudo sed -i s/a/b/ /boot/limine.conf\nEOF",
  'sudo -u root ls /boot',
  'nice -n 19 grep -rn timeout /boot/limine.conf',
  "echo '$(sudo cp limine.conf /boot/limine.conf)'",
  'echo "$(cat /boot/limine.conf)" > /tmp/limine.conf',
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
