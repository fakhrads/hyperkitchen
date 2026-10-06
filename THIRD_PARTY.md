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
| apksigner | 0.9, from Android SDK Build-Tools 37.0.0 (`lib/apksigner.jar`) | Apache-2.0 (NOTICE.txt in the build-tools archive) | https://developer.android.com/tools/apksigner |

## Copied into generated packages

| Component | Version | License | Source |
|---|---|---|---|
| fastboot, adb (macOS, Linux, Windows) with AdbWinApi.dll, AdbWinUsbApi.dll | Android SDK Platform-Tools 37.0.1 | Apache-2.0 (the archive's NOTICE.txt is copied next to them) | https://developer.android.com/tools/releases/platform-tools |

fastboot goes into ROM packages; adb into the adb install packages of app mods. HyperKitchen
never runs either of them.

## Downloaded on request

| Component | Version | License | Source |
|---|---|---|---|
| Eclipse Temurin JRE | latest 21 LTS at install time | GPL-2.0 with Classpath Exception | https://adoptium.net (via api.adoptium.net, checksum verified) |

## Projects studied or ported

| Project | License | How it is used |
|---|---|---|
| MIO-KITCHEN-SOURCE | AGPL-3.0 | Binaries above; repack command lines; ext4 extraction logic may be ported later |
| FrameworkPatcher (FrameworksForge) | AGPL-3.0 | Framework smali patch definitions will be ported (M8) |
| HyperOS-Port-Python (toraidl) | Unlicense | Reference for flash scripts and data-driven device config |
| UY-Scuti | see repository | Reference for Joyose and PowerKeeper patches |
| unlock-cn-gms (MWTJC / fei-ke) | see repository | Reference for the `cn.google.services` permission edits |
| hyperos-fcm-fix (dingwen07) | GPL-3.0 | Reference for the Greezer / MILLET_NO_RESTRICT_APP investigation |
| MindTheGapps (vendor_gapps) | see repository | Its installer (update-binary) defines where GApps files go and their permissions; HyperKitchen reads a zip the user provides and bundles none |
| PureCN onyx ROM | used as a reference with the author's permission | Its vendor_boot first-stage fstab was compared with stock to confirm the avb flag edit; no files are copied |

## Format specifications implemented

These readers in `src/worker/formats/` were written from the format definitions
below. No code was copied.

| Format | Specification |
|---|---|
| Android sparse image | AOSP `system/core/libsparse/sparse_format.h` (Apache-2.0) |
| Logical partitions (super) | AOSP `system/core/fs_mgr/liblp/include/liblp/metadata_format.h`, offsets from `liblp/utility.cpp` (Apache-2.0) |
| Binary XML (AndroidManifest.xml) | AOSP `frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h` and `ResourceTypes.cpp` (Apache-2.0) |
| APK Signing Block (v2, v3, v3.1) | AOSP `tools/apksig` (Apache-2.0) |
| PKCS#7 SignedData (v1 signatures) | RFC 5652 |
| ZIP | PKWARE APPNOTE.TXT |
| erofs superblock (magic, block size, epoch, UUID), ext4 magic | erofs-utils `include/erofs_fs.h`, Linux `fs/ext4/ext4.h` |
| vbmeta header flags | AOSP `external/avb/libavb/avb_vbmeta_image.h` (Apache-2.0 / MIT) |
| fstab avb flags and first-stage dm-verity | AOSP `system/core/init/first_stage_mount.cpp`, `fs_mgr/libfs_avb/fs_avb.cpp` (Apache-2.0) |

## npm dependencies

Electron (MIT), React (MIT), zod (MIT), @electron-toolkit/* (MIT). The full
dependency tree is in `pnpm-lock.yaml`.
