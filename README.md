# HyperKitchen

A desktop ROM kitchen for customizing official Xiaomi HyperOS **China** ROMs on
Qualcomm Xiaomi, Redmi and POCO devices: unpack, debloat, add Google apps, fix
notifications, patch the framework, rebrand and repack into a flashable ROM.
The reference target is the POCO F7 (`onyx`), but device info is always read
from the ROM itself.

> Status: **M1 (foundation)**. The app shell, job runner, binaries manager and
> doctor work. Unpacking and building ROMs arrive in M2 and M3. See
> [`PLAN.md`](PLAN.md) for the full roadmap and research notes.

## Supported hosts

| Host | Status |
|---|---|
| macOS arm64 (Apple Silicon) | supported, tested locally (unit, smoke test of dev build and packaged app) |
| macOS x64 (Intel) | supported, packaged and signature checked; not yet run on an Intel host |
| Linux x64 | supported, tested locally (unit, smoke test of dev build and AppImage) |

Windows is not supported.

## Development

Requirements: Node.js 22+, pnpm 11+, `tar` and `unzip` on PATH.

```sh
pnpm install
pnpm fetch-bins            # download pinned host binaries for this platform (sha256 checked)
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
