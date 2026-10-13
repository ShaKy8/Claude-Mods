# boot-guard

Takes a `snapper` snapshot before any Bash command that can change what boots: `dkms`, kernel modules, `limine`, the initramfs, EFI entries and kernel packages. If the snapshot can't be taken, the command is refused and does not run.

```
/plugin install boot-guard --marketplace ShaKy8/Claude-Mods
```

## What counts as risky

| Reason | Examples |
| --- | --- |
| `dkms` | `dkms install/build/add/remove/autoinstall` (not `dkms status`) |
| `kernel module` | `modprobe` (not `-n`, `-c`, `-D`), `modprobe -r`, `insmod`, `rmmod` |
| `limine` | any `limine*` command |
| `initramfs` | `mkinitcpio`, `dracut`, `update-initramfs` (not `--listhooks`) |
| `EFI boot entries` | `efibootmgr` with a write flag (not `efibootmgr -v`) |
| `kernel package` | `pacman`/`yay`/`paru` `-S/-U/-R` on kernel, `*-dkms`, limine, nvidia, firmware packages, or any `-Syu` |
| `boot config` | writes (`>`, `tee`, `sed -i`, `cp`, `mv`, `rm`...) to `/boot`, `/etc/modprobe.d`, `/etc/modules-load.d`, `/etc/mkinitcpio*`, `/etc/default/limine`, `/sys/bus/*/bind`, `/sys/module` |

Reads such as `ls /boot`, `sed -n ... /boot/limine.conf`, `pacman -Q` and `grep` are left alone. It also looks inside `sh -c '...'` and across `&&`, `;` and pipes.

## What happens

- **Snapshot works:** it runs `snapper -c root create`, shows a toast with the snapshot number, and pins `boot-guard: #N · undo: sudo snapper -c root undochange N..0` in the status line. Then the command runs.
- **Snapshot fails:** the command is refused. Claude is told the reason and the two ways forward.

## One-time setup

`snapper` needs root by default, and a mod can't type a sudo password. Allow your user once:

```
sudo snapper -c root set-config ALLOW_USERS=$USER SYNC_ACL=yes
```

Without that, use `/guard-ack` after taking a snapshot yourself (`sudo snapper -c root create -d "before ..."`). It lets risky commands through for 10 minutes.

## Limits

- It only sees commands Claude runs through its Bash tool. Commands you run yourself in another terminal, or with `!`, are not checked.
- It matches command text, so an unusual wrapper or a script that does the risky thing inside can slip past it.
- Fails closed: if the guard itself errors on a boot-affecting command, that command is refused. Other commands are unaffected.

## Develop

```
claude plugin validate .
claude plugin test .
```
