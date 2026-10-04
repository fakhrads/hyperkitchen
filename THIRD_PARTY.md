# Third-party components

HyperKitchen is licensed under AGPL-3.0-or-later (see `LICENSE`). It bundles or
downloads the programs below. Native tools are separate executables invoked as
child processes; they are not linked into HyperKitchen.

Exact download URLs and SHA-256 hashes for every platform are pinned in
[`resources/bin/manifest.json`](resources/bin/manifest.json); `pnpm fetch-bins`
refuses any file whose hash does not match.

## Bundled host binaries

| Tool | Version | License | Source |
|---|---|---|---|
| mkfs.erofs, extract.erofs, fsck.erofs, dump.erofs | erofs-utils 1.8.10-gee46dd74 (sekaiacg build 251217) | GPL-2.0-or-later | https://github.com/sekaiacg/erofs-tools (upstream: https://git.kernel.org/pub/scm/linux/kernel/git/xiang/erofs-utils.git) |
| payload-dumper-go | 2.1.0 | Apache-2.0 | https://github.com/ssut/payload-dumper-go |
| lpmake | from MIO-KITCHEN-SOURCE @ 0e54dcd | Apache-2.0 (AOSP liblp) | https://github.com/ColdWindScholar/MIO-KITCHEN-SOURCE |
| mke2fs | 1.47.2, from MIO-KITCHEN-SOURCE @ 0e54dcd | GPL-2.0 (e2fsprogs) | same as above; upstream https://git.kernel.org/pub/scm/fs/ext2/e2fsprogs.git |
| e2fsdroid | from MIO-KITCHEN-SOURCE @ 0e54dcd | GPL-2.0 (e2fsprogs contrib, AOSP) | same as above |
| img2simg | from MIO-KITCHEN-SOURCE @ 0e54dcd | Apache-2.0 (AOSP libsparse) | same as above |
| magiskboot | from MIO-KITCHEN-SOURCE @ 0e54dcd | GPL-3.0-or-later | same as above; upstream https://github.com/topjohnwu/Magisk |
| brotli | 1.0.9, from MIO-KITCHEN-SOURCE @ 0e54dcd | MIT | same as above; upstream https://github.com/google/brotli |
| zstd | 1.5.5, from MIO-KITCHEN-SOURCE @ 0e54dcd | BSD-3-Clause OR GPL-2.0-only | same as above; upstream https://github.com/facebook/zstd |

The MIO-KITCHEN-SOURCE binaries are taken from its `bin/<OS>/<arch>/` folder at
commit `0e54dcd40c19299b235599e644bfdcc263564047`. License texts for these tools
are in that repository under `bin/licenses/`.

## Bundled Java tools

| Tool | Version | License | Source |
|---|---|---|---|
| APKEditor | 1.4.9 | Apache-2.0 | https://github.com/REAndroid/APKEditor |
| Apktool | 3.0.3 | Apache-2.0 | https://github.com/iBotPeaches/Apktool |

## Downloaded on request

| Component | Version | License | Source |
|---|---|---|---|
| Eclipse Temurin JRE | latest 21 LTS at install time | GPL-2.0 with Classpath Exception | https://adoptium.net (via api.adoptium.net, checksum verified) |

## Projects studied or ported

| Project | License | How it is used |
|---|---|---|
| MIO-KITCHEN-SOURCE | AGPL-3.0 | Binaries above; repack command lines; lpunpack and ext4 extraction logic will be ported in later milestones |
| FrameworkPatcher (FrameworksForge) | AGPL-3.0 | Framework smali patch definitions will be ported (M8) |
| HyperOS-Port-Python (toraidl) | Unlicense | Reference for flash scripts and data-driven device config |
| UY-Scuti | see repository | Reference for Joyose and PowerKeeper patches |
| unlock-cn-gms (MWTJC / fei-ke) | see repository | Reference for the `cn.google.services` permission edits |
| hyperos-fcm-fix (dingwen07) | GPL-3.0 | Reference for the Greezer / MILLET_NO_RESTRICT_APP investigation |

## npm dependencies

Electron (MIT), React (MIT), zod (MIT), @electron-toolkit/* (MIT). The full
dependency tree is in `pnpm-lock.yaml`.
