# HyperKitchen

A desktop ROM kitchen for customizing official Xiaomi HyperOS **China** ROMs on
Qualcomm Xiaomi, Redmi and POCO devices: unpack, debloat, add Google apps, fix
notifications, patch the framework, rebrand and repack into a flashable ROM.
The reference target is the POCO F7 (`onyx`), but device info is always read
from the ROM itself.

> Status: **M3 (repack)**. A stock ROM can be unpacked, inspected and rebuilt
> into a verified fastboot package. Modifications (debloat, props, GApps, ...)
> arrive from M4. See [`PLAN.md`](PLAN.md) for the full roadmap and research
> notes.

## Supported hosts

| Host                        | Status                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| macOS arm64 (Apple Silicon) | supported, tested locally (unit, smoke test of dev build and packaged app) |
| macOS x64 (Intel)           | supported, packaged and signature checked; not yet run on an Intel host    |
| Linux x64                   | supported, tested locally (unit, smoke test of dev build and AppImage)     |

Windows is not supported.

## Development

Requirements: Node.js 22+, pnpm 11+, `tar` and `unzip` on PATH.

```sh
pnpm install
pnpm fetch-bins            # download pinned host binaries for this platform (sha256 checked)
pnpm build-updater         # recovery update-binary (needs Go)
pnpm dev                   # electron-vite dev with HMR
```

Java 17+ is only needed for the APK and framework editors (M6 onward). If none
is found, the Doctor screen offers to download a Temurin 21 JRE into the app
data folder. It never touches a system Java.

### Tests

```sh
pnpm typecheck && pnpm lint
pnpm test                  # unit tests (probes real binaries once fetched)
pnpm build && pnpm test:e2e        # smoke test of the real app (use xvfb-run on headless Linux)
HK_NET_TESTS=1 pnpm test   # also runs the network test that installs a real JRE
# unpack a real ROM into <projects>/<name> (never part of pnpm test):
HK_ROM_INPUT=<rom.tgz|zip|folder> HK_PROJECTS=<dir> HK_PROJECT=<name> \
  npx vitest run --config tests/local/vitest.config.ts
```

### Building installers

```sh
pnpm build:linux                               # release/<version>/*.AppImage
pnpm fetch-bins --platform darwin-arm64,darwin-x64
pnpm build:mac                                 # release/<version>/*.dmg for the host arch (run on macOS)
pnpm build && npx electron-builder --mac --x64  # Intel .dmg from an Apple Silicon Mac
```

macOS builds are ad-hoc signed, not notarized. A copy you build yourself opens
directly. A downloaded copy is blocked by Gatekeeper on first launch: allow it
in System Settings > Privacy & Security (Open Anyway), or remove the quarantine
attribute with `xattr -r -d com.apple.quarantine /Applications/HyperKitchen.app`.
The Doctor's "Clear quarantine" button does the same for the bundled tools.

## How it works

- **Main process**: windows, settings, projects, IPC with validated inputs.
- **Job runner**: a separate Electron utility process runs every long task
  (spawning tools, hashing, copying ROM trees) and streams progress. Jobs can
  be cancelled; the whole child process group is killed.
- **Binaries manager**: pinned tools in `resources/bin/<platform>/`, listed with
  URL, SHA-256 and license in `resources/bin/manifest.json`.
- **Projects**: a folder with `project.json`, `recipe.json` and `source/`,
  `stock/`, `work/`, `build/`, `logs/`. A build always starts from a fresh copy
  of `stock/`; the original ROM is never modified.
- **Unpack**: accepts a fastboot `.tgz`, an images zip, an OTA zip or
  `payload.bin`, an extracted folder, or a single `super.img`. Sparse images
  (including split `super.img.0..N`) and the logical partition metadata of
  `super` are read in TypeScript, since `simg2img` and `lpunpack` have no macOS
  builds. Partitions are written to `stock/images/`, erofs trees with their
  `fs_config` and `file_contexts` to `stock/fs/`, and the super layout, every
  `build.prop` and an APK inventory (package, version, signer SHA-256, read
  without Java) to `stock/stock.json` and `stock/inventory.json`.

- **Build**: `work/` is a fresh clone of `stock/`; every erofs partition is
  rebuilt with `mkfs.erofs` using the stock block size, timestamp and UUID and
  the original `fs_config`/`file_contexts`, then (by default) extracted again
  and compared file by file. `lpmake` packs `super.img` with the stock layout,
  which is read back and checked. The output in `build/<id>/` holds the
  firmware, `super.img`, flash scripts derived from the stock ones, a README and
  `checksums.sha256`. Rebuilt partitions have no AVB hashtree, so the build
  either removes the avb flags from the vendor_boot first-stage fstab (default)
  or sets the disable flags in `vbmeta.img`. Either way the package only boots
  with an unlocked bootloader. HyperKitchen never runs the scripts; you do.
- **Package** (like xiaomi.eu): one zip with `images/`, pinned Google
  platform-tools `fastboot` for macOS, Linux and Windows in `bin/`, and
  `{macos,linux}_*.sh` / `windows_*.bat` scripts in three variants
  (`install_upgrade`, `install_and_format_data`, `format_data_only`). The same
  zip installs from TWRP/OrangeFox through HyperKitchen's own `update-binary`
  (`installer/updater`, Go): it checks the device, the firmware already on both
  slots and every image hash before writing anything, writes the boot images to
  both slots and `super`, reads every write back, and never touches the
  recovery partition or the bootloader firmware.
- **Recipe**: debloat, build.prop edits, CN Google services unlock and smali
  patch sets (notifications, Greezer, PowerKeeper, Joyose), with a PureCN
  preset. Smali patches keep the original APK signature blocks; Android does
  not verify APKs on system partitions, so the apps keep their identity.
- **App editor**: open any APK or jar of the ROM (apktool, with every resource
  provider of the ROM installed as a framework), browse and search the decode,
  edit smali and resources, stub methods (e.g. an ad check that returns false)
  and edit strings. Saving records an overlay in `mods/<id>/`: only the files
  that differ from the stock decode, each with the hash of the file it was made
  on. An `app-mod` recipe operation applies it at build time to a fresh decode,
  replaces only the changed dex (and the resources when they were edited),
  keeps the stock signing block, and decodes the result again to check it.

Put the projects folder on a **case-sensitive** filesystem: Android trees can
hold names that differ only in case. On macOS, an APFS (Case-sensitive) volume
or disk image works; exFAT is not suitable (case-insensitive, no hard links,
`._*` metadata files).

## Scope and legal

- Personal use on your own device with an **unlocked bootloader**.
- HyperKitchen only produces files. It never runs `fastboot` or `adb`, never
  writes to a device, and never formats or partitions a disk. Flashing is done
  by you, manually.
- Not affiliated with, endorsed by or connected to Xiaomi, Google or any ROM
  project mentioned here. ROM images, Google apps and Xiaomi framework files
  are not included and must not be committed to this repository.

## License

AGPL-3.0-or-later. See [`LICENSE`](LICENSE) and [`THIRD_PARTY.md`](THIRD_PARTY.md)
for bundled tools and why this license was chosen (ported code from AGPL
projects).
