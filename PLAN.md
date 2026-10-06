# HyperKitchen: PLAN

Status: M1 selesai (Linux x64 dan macOS arm64), M2 selesai (macOS arm64; Linux x64 belum dijalankan). Riset dilakukan 2026-10-04 terhadap clone shallow semua repo di bawah.

## 1. Hasil riset

### 1.1 Versi yang sudah diverifikasi (bukan dari ingatan)

| Komponen                  | Versi terbaru                         | Sumber verifikasi             | Catatan                                                                                    |
| ------------------------- | ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Electron                  | 44.5.1 (stable), 45 masih alpha       | `npm view electron dist-tags` | Spec benar soal 44                                                                         |
| electron-vite             | 5.0.0                                 | npm                           | Perintah scaffold diverifikasi dari docs saat M1                                           |
| electron-builder          | 26.15.3 (latest)                      | npm                           |                                                                                            |
| React / Vite / TypeScript | 19.3.0 / 8.3.2 / 7.0.2                | npm                           |                                                                                            |
| MIO-KITCHEN-SOURCE        | commit 0e54dcd (2026-10-02), AGPL-3.0 | git                           |                                                                                            |
| erofs-utils (sekaiacg)    | v1.8.10-251217                        | GitHub API                    | **Repo pindah ke `sekaiacg/erofs-tools`**. Ada Darwin_aarch64, Darwin_x86_64, Linux_x86_64 |
| mkfs.erofs bawaan MIO     | 1.9.4-gd5534429                       | `--version`                   | Lebih baru dari rilis sekaiacg                                                             |
| payload-dumper-go         | 2.1.0 (2026-09-23)                    | GitHub API                    | darwin_arm64, darwin_amd64, linux_amd64                                                    |
| APKEditor                 | 1.4.9 (2026-05-19), Apache-2.0        | GitHub API                    |                                                                                            |
| Apktool                   | **3.0.3** (2026-07-20)                | GitHub API                    | Spec menyebut 2.12, sudah ada major 3                                                      |
| MindTheGapps 16.0.0-arm64 | 20260915_222150, zip 511 MB           | GitHub API                    | Repo git-nya kosong (commit 2023), isi hanya di Release                                    |
| MindTheGapps 17.0.0-arm64 | 20260915_222140, zip 547 MB           | GitHub API                    |                                                                                            |
| FrameworkPatcher          | 3.0.0 (2026-04-28), AGPL-3.0          | VERSION file                  |                                                                                            |
| HyperOS-Port-Python       | c6351fd, Unlicense                    | git                           | Fork lyin888 **identik byte-per-byte** dengan toraidl                                      |

### 1.2 Temuan per repo

**MIO-KITCHEN-SOURCE** (`bin/<OS>/<arch>/`)

- Binary statis tersedia untuk Darwin arm64, Darwin x86_64, Linux x86_64: `lpmake, mkfs.erofs, extract.erofs, mke2fs, e2fsdroid, make_ext4fs, magiskboot, img2simg, brotli, zstd, mkfs.f2fs, sload.f2fs, dtc, cpio, busybox`. Linux x86_64 total sekitar 44 MB.
- **Tidak ada** `lpunpack`, `simg2img`, `avbtool` sebagai binary. MIO mengimplementasikannya di Python (`src/core/lpunpack.py`, `sparse_img.py`, `avb_disabler.py`). `extract.f2fs` hanya ada di Linux.
- Kunci round-trip: `extract.erofs -x` (fork sekaiacg) sekaligus menulis `config/<part>_fs_config` dan `config/<part>_file_contexts` (ada juga `--only-cfg`). Repack: `mkfs.erofs -z<algo> -T <utc> --mount-point=/<part> --product-out=<work> --fs-config-file=... --file-contexts=... out.img dir/`. Untuk super: `lpmake --metadata-size 65536 -super-name ... -metadata-slots 3 --group <g>_a:<size> --partition <p>_a:readonly:<size>:<g>_a --image ... [--virtual-ab] --out super.img`.
- `avb_disabler.py` di MIO hanya membuang flag `avb`, `avb=`, `avb_keys=`, `verify` dari fstab, bukan patch vbmeta.
- Plugin system (MSH) dan UI PySide6 tidak relevan untuk kita.

**HyperOS-Port-Python**

- Tujuan utamanya porting ROM antar device. Yang relevan: alur flash script (`bin/flash/update-binary`: tulis boot/dtbo ke slot a+b, ekstrak `super` dari zip via zstd), struktur config data-driven (`features.json`, `replacements.json`, `props_*.json`), dan modifier plugin (`eu_localization`, `feature_unlock`, `file_replacement`).
- Rebuild rantai AVB mereka memakai `avbtool` dari `otatools.zip` (Linux-only, diunduh dari release mereka). Tidak bisa dipakai native di macOS.
- `bin/linux/x86_64` berisi `lpunpack, simg2img, aapt2, payload-dumper` versi Linux saja.

**FrameworkPatcher**

- Implementasinya shell + Python inline di atas apktool 2.9.3 (`scripts/patcher_a16.sh`). Fitur: disable signature verification, CN notification fix, disable secure flag, Kaorios toolbox.
- CN notification fix (A16): regex `sget-boolean (vX|pX), Lmiui/os/Build;->IS_INTERNATIONAL_BUILD:Z` diganti `const/4 vX, 0x1` (atau `const/16` bila register > 15). **Register dipertahankan.** Dokumen `CN_NOTIFICATION_FIX.md` menulis `sget-boolean v4` menjadi `const/4 v0` untuk ProcessSceneCleaner; itu salah di dokumen, kodenya benar. Kita ikuti kode.
- Kodenya menambal lebih banyak dari yang didokumentasikan: selain `BroadcastQueueModernStubImpl`, `ActivityManagerServiceImpl`, `ProcessManagerService`, `ProcessSceneCleaner`, juga `JobServiceContextImpl` dan fungsi terpisah untuk `framework.jar` dan `services.jar`. Daftar lengkap akan saya port sebagai tabel data di M8.
- Repo menyertakan jar Xiaomi (`Sources/android16/china/*.jar`, ~100 MB). Itu proprietary; kita **tidak** menyalinnya. Hanya dipakai lokal sebagai fixture uji jika perlu.

**unlock-cn-gms (MWTJC, v3.8)**

- Logikanya sederhana dan pasti: di file-file berikut, hapus baris yang mengandung `cn.google.services` dan `services_updater`:
  `{system,vendor,product}/etc/permissions/services.cn.google.xml`, `{vendor,product}/etc/permissions/cn.google.services.xml`, `product/etc/sysconfig/cn_feature.xml`, `odm/etc/permissions/com.gnss.bds_preference.xml` (plus jalur OPPO yang tidak relevan).
- Kita lakukan ini di build time, langsung di pohon partisi. Tidak perlu modul.

**hyperos-fcm-fix (dingwen07) + dokumen investigasinya** (paling penting untuk M6)

- `MILLET_NO_RESTRICT_APP` **bukan** whitelist mandiri. Itu proyeksi yang dibangkitkan PowerKeeper dari DB privat `UserConfigure`. Setiap kali PowerKeeper rebuild proyeksi (install/uninstall app, user-ready, query policy pertama), entri GMS yang ditambahkan dari luar akan hilang. **Jadi menanam nilai Settings di ROM tidak akan bertahan.**
- Penyebab GMS dibekukan ada di `miui-services.jar` (`GreezeManagerService`): flag `mGmsLimitEnabled` default `true`, dan saat layar mati 10 detik setelah GMS aktif, GMS dihapus dari `mAllowList` lalu di-quick-freeze. Jalur kedua: `PowerStrategyMode` (`tobg`, `from system`). Keduanya mengecek `mNoRestrictAppSet` lebih dulu.
- `Settings.Global.aurogon_enable` ditulis ulang oleh `CloudDataUpdate` setelah init Greeze atau perubahan cloud data.
- Konsekuensi desain: perbaikan yang tahan lama di level ROM adalah **patch smali** (Greezer di `miui-services.jar`, PowerKeeper, Joyose), bukan default Settings. Lihat M6.

**miguel-rosso fixes**: skrip `adb` runtime (deviceidle whitelist, `cloud_memory_freeze_whitelist`, `cloud_network_priority_whitelist`, `cloud_lowlatency_whitelist`, appops `RUN_ANY_IN_BACKGROUND`/`WAKE_LOCK`). Ditulis oleh AI menurut README-nya sendiri. Berguna sebagai daftar kunci untuk companion opsional, bukan sumber kebenaran.

**UY-Scuti**: dua resep konkret yang bisa diverifikasi:

- Disable Joyose cloud control: di `Joyose.apk`, method yang berisi string `job exist, sync local...` di-stub menjadi `.registers 1` + `return-void`.
- GMS instant push: di `PowerKeeper.apk`, string `com.google.android.gms` di `MilletPolicy.smali` diganti `com.google.android.gms.keeplive` supaya GMS tidak cocok dengan daftar pembatasan.
- Keduanya rebuild dengan `apktool b -c` (menyalin `META-INF` asli) lalu `zipalign`. Disable vbmeta dilakukan lewat edit JSON hasil dekode `boot_editor` (flags = 3).

### 1.2b Bukti dari ROM mod nyata: PureCN onyx vs stock (2026-10-05)

Stock `OS3.0.305.0.WOLCNXM` (fastboot tgz) dibandingkan dengan PureCN `simple_ota` berbasis versi yang sama, file per file (sha256) dan smali per method (apktool 3.0.3).

- **Firmware**: 24 image firmware identik dengan stock (beda format saja: padding nol, raw vs sparse). `boot`, `init_boot`, `dtbo`, `vbmeta`, `vbmeta_system` identik. Hanya `vendor_boot` yang diubah (fstab first-stage tanpa flag avb; ramdisk hasil build M3 kita identik byte dengan milik PureCN).
- **Signature APK sistem**: 21 APK diubah isinya (dex), 20 tetap membawa blok signature asli Xiaomi (v1+v2+v3) yang kini **tidak valid** (`jarsigner`: `SHA-256 digest error for classes.dex`); 1 overlay di-resign. Ini boot karena AOSP `InstallPackageHelper` memakai `skipVerify = scanSystemPartition` ("APK verification can be skipped ... only if the file is in a verified partition"), dan `ParsingPackageUtils` lalu memanggil `ApkSignatureVerifier.unsafeGetCertsWithoutVerification`. Konsekuensi untuk M7: mode _stock-signature-safe_ (ubah isi, pertahankan blok signature asli) terverifikasi di source dan dipakai ROM nyata; identitas app (sharedUserId, izin signature) tetap. Resign app ber-`sharedUserId` gagal (`INSTALL_FAILED_SHARED_USER_INCOMPATIBLE`, `PackageManagerServiceUtils`); di stock 50 APK memakai `android.uid.system`, 19 `android.uid.phone`.
- **Patch miui-services.jar** (M8): `IS_INTERNATIONAL_BUILD` dipaksa true dengan menyisipkan `const/4 vX, 0x1` setelah `sget-boolean vX, Lmiui/os/Build;->IS_INTERNATIONAL_BUILD:Z` (register sama) di BroadcastQueueModernStubImpl (3x), ProcessSceneCleaner (2x), JobServiceContextImpl, ActivityManagerServiceImpl, ProcessManagerService, NotificationManagerServiceImpl, AlarmManagerServiceStubImpl, PackageManagerServiceImpl. Cocok dengan daftar FrameworkPatcher. `services.jar` dan `framework.jar` **tidak** diubah (tidak ada patch signature verification).
- **Greezer** (M6): `com/miui/server/greeze/PolicyManager` `<clinit>`: hasil `"CN".equals(region)` ditimpa `0`, jadi `CN_MODEL = false`.
- **PowerKeeper** (M6): `LocalUpdateUtils.startCloudSyncData` di-stub (`return-void`), `GmsObserver.isGmsControlEnabled` -> false, `GmsObserver.<init>` IS_INTERNATIONAL_BUILD -> true, `updateGoogleSync(Z)` parameter dipaksa true, `ThermalManager.getDisplayCtrlCode` -> 0.
- **Joyose** (M6): semua path `/sys/...` diganti `/gayos/...` (dan `/proc/gayos/...`) sehingga tuning CPU/GPU/thermal/FPS tidak menemukan node; dua `run()` di-stub.
- **Konfigurasi**: `product/etc/permissions/cn.google.services.xml` dihapus; `odm/etc/permissions/com.gnss.bds_preference.xml` dimatikan dengan merusak penutup komentar (`-->` jadi `--`, XML tidak valid); `vendor/etc/fstab.qcom`: `fileencryption`/`metadata_encryption` dihapus dari `/data` **dan** `ro.crypto.state=encrypted` ditambahkan di system_ext (data tidak terenkripsi tapi dilaporkan terenkripsi); `ro.miui.product.home` dari launcher global ke `com.miui.home`; sepolicy menambah domain `xeu_toolbox_exec` + label di `system_ext_file_contexts`.
- **Debloat/GApps**: 60 APK dihapus (termasuk `com.android.updater`), 29 ditambah (Phonesky, SetupWizard, GoogleRestore, Gemini, dll.). Dua app sistem diturunkan versionCode-nya (PackageInstaller 54200 -> 37, PersonalAssistant 253050 -> 253037); AOSP mengabaikan versi sistem bila versi di /data lebih tinggi ("updated version ... better than this", `InstallPackageHelper`).

### 1.3 Integrate vs reimplement

| Kebutuhan                                    | Keputusan                                                            | Alasan                                                                                                                                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| erofs extract/build                          | **Integrate** binary `extract.erofs`/`mkfs.erofs`                    | Fork sekaiacg menghasilkan fs_config + file_contexts. Ambil dari rilis `sekaiacg/erofs-tools` (versi jelas, ada Darwin), fallback MIO 1.9.4 jika rilis sekaiacg kurang fitur. Diputuskan di M2 setelah uji round-trip keduanya. |
| ext4 build                                   | Integrate `mke2fs` + `e2fsdroid` (MIO)                               | Sama dengan alur MIO                                                                                                                                                                                                            |
| ext4 extract tanpa mount                     | **Reimplement** di TS (port `imgextractor.py` MIO)                   | Tidak ada binary siap pakai di macOS yang juga menghasilkan fs_config/contexts. Prioritas rendah: partisi logical HyperOS modern semuanya erofs. Akan dikonfirmasi pada ROM onyx.                                               |
| payload.bin                                  | Integrate `payload-dumper-go` 2.1.0                                  | Ada build native Darwin + Linux                                                                                                                                                                                                 |
| super pack                                   | Integrate `lpmake` (MIO)                                             |                                                                                                                                                                                                                                 |
| super unpack (lpunpack)                      | **Reimplement** di TS (port `lpunpack.py` MIO)                       | Tidak ada binary Darwin. Format liblp metadata kecil dan terdokumentasi di AOSP `liblp/include/liblp/metadata_format.h`.                                                                                                        |
| sparse to raw (simg2img)                     | **Reimplement** di TS                                                | Tidak ada binary Darwin. Format sparse sederhana (AOSP `libsparse/sparse_format.h`). `img2simg` tetap pakai binary.                                                                                                             |
| vbmeta disable                               | **Reimplement** di TS: set field `flags` header vbmeta               | Setara `fastboot --disable-verity --disable-verification`. Offset field diverifikasi terhadap `libavb/avb_vbmeta_image.h` di M3 sebelum dipakai. Tidak perlu avbtool.                                                           |
| boot/vendor_boot                             | Integrate `magiskboot`                                               | Hanya bila nanti perlu edit ramdisk/fstab                                                                                                                                                                                       |
| APK decode/build                             | Integrate APKEditor 1.4.9 (utama), Apktool 3.0.3 (sekunder)          | Butuh Java, lihat 2.5                                                                                                                                                                                                           |
| smali untuk jar framework                    | Integrate smali/baksmali (jar)                                       | Flag dan versi diverifikasi di M8                                                                                                                                                                                               |
| APK inventory (package, versionCode, signer) | **Reimplement** di TS: parser zip + binary AXML + APK Signing Block  | Ribuan APK; spawn JVM per APK terlalu lambat. Kemungkinan bisa diambil dari `romdiff` milikmu.                                                                                                                                  |
| Framework patch engine                       | **Port** logika FrameworkPatcher ke engine patch berbasis data di TS | Patch jadi data (target, kelas, regex, jumlah match yang diharapkan, build yang sudah diverifikasi) sehingga bisa dites dan dilaporkan per patch                                                                                |
| GMS unlock, GApps inject, battery            | **Build sendiri** sebagai operasi recipe                             | Referensi di atas hanya runtime module atau skrip; kita butuh versi build time                                                                                                                                                  |
| UI                                           | Build sendiri (React)                                                | Sesuai keinginanmu. MIO tidak punya CLI/core yang bisa dipanggil bersih tanpa UI Qt-nya, jadi membungkus MIO justru lebih repot daripada menggerakkan binary langsung.                                                          |

## 2. Arsitektur

### 2.1 Stack

Electron 44 + electron-vite 5 + electron-builder 26, TypeScript strict, React 19, pnpm. Test: Vitest (unit, termasuk parser format biner dengan fixture kecil yang dibangkitkan sendiri) dan smoke test Electron (Playwright `_electron`) per milestone.

### 2.2 Proses

- **Main**: window, IPC, settings, project manager.
- **Job runner di `utilityProcess`**: semua kerja berat (spawn binary, parsing image, copy pohon file). Event progres terstruktur (`{jobId, step, pct, bytes, log}`) dikirim ke renderer. Bisa dibatalkan (kill process group). UI tidak pernah terblokir.
- **Renderer**: React. Akses hanya lewat `preload` dengan API bertipe (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).

### 2.3 Binaries manager

- Layout: `resources/bin/<darwin-arm64|darwin-x64|linux-x64>/` + `resources/bin/manifest.json` (nama, versi, sumber URL, sha256, lisensi).
- Binary **tidak di-commit**. Skrip `pnpm fetch-bins` mengunduh dari rilis upstream yang dipin (sha256 dicek) ke folder itu; electron-builder menyertakan folder platform yang sesuai lewat `extraResources`.
- Layar **Doctor**: cek tiap binary ada, executable, dan versinya (`--version`/`--help`), cek Java, cek ruang disk, cek filesystem mendukung clone (APFS/btrfs/xfs) atau tidak. Di macOS juga cek atribut quarantine pada binary.

### 2.4 Project model

```
<projects-root>/<nama>/
  project.json        metadata: device, versi ROM, fingerprint, hash sumber
  recipe.json         daftar operasi berurutan (data murni)
  source/             tempat ekstrak sementara untuk input arsip (tgz/zip); dikosongkan setelah unpack selesai.
                      Input asli hanya dicatat (path + sha256) dan tidak pernah diubah.
  stock/              hasil unpack (M2), read-only setelah ekstrak:
    images/<part>.img   image partisi raw (super dipecah per partisi logical, suffix slot dibuang)
    fs/<part>/          pohon erofs; fs/config/<part>_fs_config, _file_contexts, _fs_options
    firmware/           firmware + skrip flash dari paket asli, untuk output flashable (M3)
    stock.json          input, layout super (dari metadata stock), partisi, semua build.prop
    inventory.json      semua APK: package, versionCode/Name, signer SHA-256, skema signature
  work/               salinan pohon file tempat recipe dijalankan. Dibuang dan dibuat ulang tiap build.
  build/<timestamp>/  output, build.log, checksums.sha256, recipe snapshot
```

- Build selalu: salin `stock/` ke `work/` dengan clone copy-on-write bila filesystem mendukung, fallback copy biasa, lalu jalankan recipe, repack. ROM asli tidak pernah dimutasi.
  - Linux (btrfs/xfs): `fs.copyFile` dengan `COPYFILE_FICLONE` (libuv memakai `ioctl(FICLONE)`).
  - macOS (APFS): **jangan** pakai `fs.copyFile`. Terverifikasi di libuv 1.52.1 (`src/unix/fs.c`, `uv__fs_copyfile`): clone hanya lewat `ioctl(FICLONE)` yang khusus Linux, sehingga di macOS `COPYFILE_FICLONE_FORCE` selalu `ENOSYS` dan `COPYFILE_FICLONE` diam-diam menyalin penuh. Pakai `clonefile(2)` lewat `cp -c` (man cp: jatuh ke `copyfile(3)` bila clone tidak bisa). Implementasi di M3.
- Operasi recipe: `{id, type, enabled, params}`. Tipe: `debloat`, `set-props`, `remove-cn-gms-flag`, `inject-gapps`, `patch-framework`, `patch-apk`, `edit-apk`, `battery-defaults`, `branding`, `add-file`, `remove-file`. Setiap operasi menulis laporan perubahan (file tambah/hapus/ubah) untuk diff view.
- Tampilan: preset terpandu **dan** file tree mentah + editor recipe (JSON + form).

### 2.5 Java

APKEditor, Apktool, smali, apksigner butuh JRE 17+. Host ini belum punya Java. Usulan default: Doctor mendeteksi `java`; bila tidak ada, tawarkan unduh Temurin JRE ke folder data aplikasi (bukan dibundel di installer, supaya installer tetap kecil). Hanya M7 dan M8 (dan sebagian M6) yang butuh Java.

### 2.6 Testing di macOS

Verifikasi macOS arm64 dilakukan lokal di Mac (Apple Silicon) karena GitHub Actions tidak bisa jalan selama akun GitHub terkunci. Workflow `.github/workflows/ci.yml` (runner macOS arm64 dan Ubuntu: unit test, smoke test Electron, packaging) tetap disimpan untuk saat akun aktif lagi. Mac ini tidak punya Rosetta, jadi build macOS x64 hanya dipaket dan dicek signature-nya, belum dijalankan.

## 3. Lisensi

**AGPL-3.0-or-later.** Alasan: kita mem-port logika dari MIO-KITCHEN (`lpunpack.py`, `imgextractor.py`) dan FrameworkPatcher (tabel patch), keduanya AGPL-3.0, sehingga kode kita menjadi karya turunan. Binary yang dibundel (GPL-2.0 erofs-utils dan e2fsprogs, GPL-3.0 magiskboot, Apache-2.0 lpmake/payload-dumper-go/APKEditor, MIT brotli, BSD zstd) adalah program terpisah yang dipanggil lewat proses, kompatibel dengan AGPL. Semua dicatat di `THIRD_PARTY.md` dengan versi, lisensi, URL, sha256.

## 4. Milestone

Setiap milestone selesai bila: jalan di Linux x64 dan macOS arm64 (lokal, atau CI bila tersedia), ada smoke test, ada commit.

- [x] **M1 Foundation**: scaffold (perintah diverifikasi dari docs electron-vite), IPC + job runner utilityProcess dengan progres dan cancel, binaries manager + `fetch-bins` + Doctor, create/open project, settings. Paket `.AppImage` dan `.app`/`.dmg` (ad-hoc signed, tanpa notarisasi) yang bisa dibuka. CI GitHub Actions.
  - Status 2026-10-04: selesai dan terverifikasi di Linux x64 (unit test, smoke test dev + AppImage hasil paket, install JRE terkelola).
  - Status 2026-10-05: terverifikasi di macOS 27.0.1 arm64 (lokal): typecheck, lint, unit test, install JRE terkelola (layout `Contents/Home`), smoke test dev build dan `.app` hasil paket. Semua binary darwin-arm64 dieksekusi langsung (ad-hoc signed). `xattr -r -l` / `xattr -r -d com.apple.quarantine` diuji nyata: binary ber-quarantine di-SIGKILL, setelah atribut dihapus jalan normal. Perbaikan: deteksi clone di macOS (lihat 2.4) kini membaca tipe filesystem lewat `df -P` + `mount`; paket mac kini ad-hoc signed (`identity: '-'`, `hardenedRuntime: false`, keduanya dari schema electron-builder 26.15.3) karena `identity: null` meninggalkan signature yang tidak valid sehingga salinan unduhan dianggap "rusak". Build x64 dipaket dan lolos `codesign --verify`, belum dijalankan (tidak ada Rosetta).
- [x] **M2 Unpack**: input OTA zip / payload.bin / fastboot tgz / super.img / folder. lpunpack + simg2img di TS, erofs extract dengan config. UI: pohon partisi, build.prop per partisi, inventaris APK (package, versionCode, signer SHA-256). `romdiff.zip` belum ada; inventaris APK ditulis sendiri.
  - Status 2026-10-05: selesai dan terverifikasi di macOS arm64 (unit test, smoke test dev build dan `.app` hasil paket, plus dua ROM onyx asli di disk lokal). Linux x64 **belum dijalankan** di sesi ini (tidak ada host Linux); jalur khusus Linux hanya `cloneOrCopy` (FICLONE) dan GNU tar/unzip.
  - ROM uji: stock `onyx_images_OS3.0.305.0.WOLCNXM_..._cn` (fastboot tgz 10 GB) selesai dalam 238 detik: 8 partisi erofs, 421 APK. PureCN `simple_ota` (images zip 7,2 GB, zip64, super dipecah 11 bagian) selesai dalam 240 detik: 8 partisi, 390 APK.
  - Verifikasi silang: sparse dan liblp dicek terhadap output `img2simg` dan `lpmake` asli (unit test); signer 14/14 APK sampel cocok dengan `keytool -printcert -jarfile` (v1) dan APKEditor `-signatures` (v2/v3-only); package, versionCode, versionName 14/14 cocok dengan APKEditor `info`.
  - Temuan untuk M3:
    - Stock super: metadata v10.2, flag Virtual A/B, 3 slot, `metadata_max_size` 65536, block device `super` 11811160064 byte, alignment 1 MiB, grup `qti_dynamic_partitions_a/_b` max 11800674304. Hanya slot `_a` terisi. Tersimpan di `stock/stock.json` untuk lpmake.
    - Super PureCN memakai metadata v10.0 **tanpa** flag Virtual A/B, jadi mereka membangun ulang super tanpa `--virtual-ab`. Kita tetap mengikuti stock kecuali ada alasan terverifikasi.
    - `extract.erofs` menamai mount point dan file config dari nama file image, jadi image ditulis tanpa suffix slot (`system.img`, bukan `system_a.img`). File `config/<part>_fs_options` mencatat opsi `mkfs.erofs` asli (contoh mi_ext: `-zlz4hc -T 0 -U <uuid>`), untuk dipakai saat repack.
    - Partisi vendor/odm berbasis Android 15 (`AQ3A`), system/product Android 16 (`BP2A`). Device asli (`onyx`) hanya ada di `misc.txt`, odm, `*_dlkm`; vendor memakai `mivendor`, product `miproduct`, system `generic`.
    - Xiaomi menyertakan APK placeholder 0 byte (`mi_ext/product/app/messaging/messaging.apk`).
  - Split super dari PureCN: tiap bagian `super.img.N` punya `total_blks` berbeda (bagian N menutup `[0, akhir datanya)`), bukan pola split standar dengan ukuran sama. Reader menangani keduanya dan menolak extent di luar cakupan image.
  - Folder project harus case-sensitive (Doctor kini mengecek). exFAT tidak cocok; di Mac ini dipakai sparse bundle APFS (Case-sensitive) di disk eksternal.
- [x] **M3 Repack + output flashable** (paling berisiko): rebuild erofs/ext4 dengan fs_config + file_contexts asli, lpmake dengan geometri super dari metadata stock (bukan tebakan), vbmeta flags disable (dengan peringatan jelas). Output pertama: **paket fastboot** (images + `flash.sh` untuk mac/linux yang kamu jalankan sendiri, tool tidak pernah memanggil fastboot). Recovery zip menyusul. **Gerbang wajib:** unpack lalu repack tanpa perubahan, bandingkan isi file per file (bukan byte image), lalu kamu uji boot di onyx sebelum ada edit apa pun. Regenerasi payload.bin OTA ditunda (butuh `delta_generator`, hanya ada versi Linux).
  - Status 2026-10-05: kode selesai dan terverifikasi di macOS arm64 (unit test termasuk build penuh ROM sintetis, smoke test UI, build ROM onyx asli). **Uji boot di onyx LOLOS (2026-10-06)**: build no-change `20261006-111217` (verity fstab, 8/8 partisi terverifikasi) di-flash dari AOSP dengan format data, boot sampai home screen. Repack terbukti byte-correct dan bootable. Linux x64 belum dijalankan.
  - Gerbang no-change di ROM onyx asli: 8/8 partisi di-rebuild lalu diekstrak ulang; semua file (product 1709 file / 6,19 GiB, system 3714, system_ext 3246, vendor 3505, odm 1990, vendor_dlkm 404, system_dlkm 213, mi_ext 60) identik isi, tipe, ukuran, target symlink; `fs_config` (termasuk capabilities) dan `file_contexts` identik. `super.img` dibaca ulang: geometri, grup, atribut, flag Virtual A/B cocok dengan stock, data tiap partisi = image hasil build. Firmware lain identik byte dengan stock. Durasi sekitar 6 menit.
  - Parameter repack dibaca dari superblock erofs stock, bukan dari `fs_options`: blocksize 4096 (**wajib eksplisit**: default `mkfs.erofs` = page size host, 16 KiB di Apple Silicon), epoch 1230768000 (2009-01-01; `fs_options` keliru menulis `-T 0`), UUID per partisi.
  - Verity: partisi hasil rebuild tidak punya hashtree/footer AVB. Dua mode, keduanya hanya boot dengan bootloader unlocked:
    - `fstab` (default): hapus `avb`, `avb=`, `avb_keys=`, `avb_hashtree_digest=` dari fstab first-stage di ramdisk `vendor_boot` (magiskboot unpack, decompress lz4_legacy, cpio add, compress, repack), vbmeta tetap stock. Ini persis yang dilakukan PureCN onyx: ramdisk hasil kita identik byte dengan ramdisk PureCN (21 baris berubah). Dasar AOSP: `first_stage_mount.cpp` `SetUpDmVerity` hanya memasang verity untuk entri dengan flag tersebut.
    - `vbmeta-flags`: set flags 3 di `vbmeta.img` (offset 120, big endian, `avb_vbmeta_image.h`), setara `fastboot --disable-verity --disable-verification`. `fs_avb.cpp` lalu melewati setup hashtree untuk semua partisi. Belum ada bukti nyata di onyx.
  - Skrip flash dibangkitkan dari urutan skrip stock: blok `crclist`/`sparsecrclist` dibuang (CRC super stock pasti menolak super baru), `grep -oP` diganti sed (BSD grep di macOS tidak punya `-P`), varian `oem lock` tidak dibuat, ditambah cek device, cek bootloader unlocked, cek anti-rollback, konfirmasi `yes`. Cek security patch level stock (pakai `date -d` GNU) tidak dibawa.
  - Paket gaya xiaomi.eu (2026-10-05): satu zip (`images/`, `bin/{macos,linux,windows}` berisi fastboot platform-tools r37.0.1 yang dipin sha256, sama persis dengan yang dibundel xiaomi.eu; skrip `install_upgrade`/`install_and_format_data`/`format_data_only` per OS) yang juga bisa dipasang dari TWRP/OrangeFox lewat `update-binary` HyperKitchen (Go, `installer/updater`, protokol diverifikasi dari source TWRP). Updater memeriksa device, tool recovery, `super` tidak ter-mount, firmware di kedua slot (per region, termasuk image sparse) dan hash semua image sebelum menulis apa pun; menulis boot-chain ke kedua slot dan `super`, membaca ulang setiap tulisan, tidak pernah menulis recovery atau firmware bootloader. Simulasi instal recovery dengan paket onyx asli di host (partisi palsu berupa file): lolos, 8 partisi di super identik dengan image build. Skrip Windows belum dijalankan di host Windows. Belum: input OTA/payload tanpa skrip stock, partisi ext4.
- [ ] **M4 Debloat + props**: hapus app per package/path, peringatan dependensi (shared lib, `uses-library`, priv-app permission xml, overlay target), editor build.prop lintas partisi, kontrol region/locale, diff view.
  - Status 2026-10-05: mesin recipe selesai (`src/worker/recipe/`): `WorkTree` menjaga `fs_config`/`file_contexts` tetap sinkron (round-trip lossless; entri baru mewarisi label SELinux leluhur terdekat), operasi `remove-paths`, `debloat` (menolak package ber-sharedUserId inti kecuali `force`), `set-props`, `unlock-cn-gms` (hapus baris feature, XML tetap valid), `disable-encryption` (opt-in, default mati). Preset PureCN di-build pada ROM onyx asli: 9 operasi, 8/8 partisi lolos gerbang file-per-file, debloat identik dengan PureCN kecuali 2 APK GMS yang ditunda ke M5. Belum diuji boot.
- [ ] **M5 GApps**: baca layout zip MindTheGapps 16 asli (511 MB, diunduh saat M5) sebelum menulis path apa pun. Inject ke `product` (atau `system_ext`) beserta permission + sysconfig xml, hapus flag `cn.google.services`/`services_updater`, dedupe dengan "Basic Google Services" bawaan CN ROM.
  - Status 2026-10-05 (mengikuti PureCN, permintaanmu): operasi `import-from-rom` menyalin path dari project ROM lain milikmu (PureCN yang sudah di-unpack) dengan owner/mode/capabilities/label SELinux persis dari `fs_config`/`file_contexts` ROM sumber; penggantian file stock hanya diizinkan bila versi basis sama, dan odex/vdex basi dari file yang diganti dihapus. Tidak ada APK Google yang dibundel atau diunduh HyperKitchen. Empat kelompok preset: global-compat (APK modifikasi PureCN: SystemUI, Settings, AOD, Home, Contacts, TeleService, SecurityCenter, PackageInstaller, overlay, `device_features/onyx.xml`; 69 method di 8 APK, semuanya buatan PureCN sendiri, bukan dari xiaomi.eu), gapps (Play Store internasional menggantikan stub CN `GooglePlayServicesUpdater` yang signer-nya berbeda, Google app, Gemini, Gboard, SetupWizard, dst. + prop GMS identik nilai dengan PureCN + hapus izin GMS CN), global-apps (Weather/Themes/Health global), microsoft (Link to Windows). Build stock + preset PureCN + 4 kelompok: 17 operasi, 8/8 partisi lolos gerbang; dibanding PureCN hanya tersisa yang sengaja tidak diikutkan (xiaomi.eu components, `resetprop` yang memalsukan status bootloader terkunci, `pm disable` analytics di rc vendor, branding, tema/wallpaper/font, enkripsi off, odex basi). Instal pertama build dengan GApps dari stock: `install_and_format_data` (perilaku PackageManager untuk app sistem yang ganti signer dengan data lama belum saya telusuri tuntas). Belum diuji boot.
  - Status 2026-10-05 (MindTheGapps): operasi `gapps` membaca zip MindTheGapps yang kamu unduh sendiri (HyperKitchen tidak mengunduh). Aturan dari installer MindTheGapps sendiri (`update-binary`, branch `baklava`): `system/product/**` ke `/product`, `system/system_ext/**` ke `/system_ext`, file 0644, direktori 0755, root, label `system_file` (diwarisi; native lib mendapat `system_lib_file` seperti saudaranya), cek `version=` (SDK) dan `arch=`. Penyesuaian untuk basis CN onyx, semua dicek di ROM: GmsCore (253830035 vs MTG 251532035) dan GSF (sama) dipertahankan versi ROM karena signer sama; stub CN `GooglePlayServicesUpdater` (signer `f0fd6c…`) diganti Phonesky (`7ce83c…`), install pertama wajib format data; file yang sudah ada dipertahankan (`sysconfig/google.xml` versi ROM lebih baru); VelvetTitan (khusus Pixel Tablet), SetupWizard (MTG menghapus Provision, HyperOS membutuhkannya) dan overlay setup wizard LineageOS dikecualikan default. `GmsCnConfigOverlay` tidak dihapus: isinya konfigurasi GMS standar (forceQueryable, credential provider, sertifikat attestation), bukan pembatas CN; overlay MTG melengkapinya.
  - Gerbang build baru: **allowlist privapp** (`src/worker/privapp.ts`). Dari source AOSP: bila `ro.control_privapp_permissions=enforce`, app privileged yang meminta izin privileged milik platform tanpa entri di allowlist partisinya sendiri membuat PackageManager melempar exception saat boot (bootloop). Pemeriksa membaca tampilan runtime dari overlayfs di fstab ROM (`/product/priv-app` = `mi_ext/product/priv-app` + `product/priv-app`, `/system/etc/permissions` = `mi_ext` + `product/pangu` + `system`), izin privileged dari framework-res (flag 0x10), dan file allowlist per partisi. Validasi: stock onyx 112 app 0 pelanggaran, PureCN 0, xiaomi.eu 73 (xiaomi.eu menghapus prop tersebut sehingga tidak enforce). Gerbang ini menemukan bug di preset impor PureCN saya: ThemePicker tanpa `privapp_whitelist_com.android.wallpaper.xml`; build `20261005-163050` dan `20261005-172044` diberi `DO_NOT_FLASH.txt`. Setelah perbaikan: preset PureCN 121 app 0 pelanggaran, stock + MindTheGapps 119 app 0 pelanggaran.

- [ ] **M6 Battery/notifikasi**: berdasarkan temuan 1.2, mekanisme utama adalah patch smali build time, masing-masing toggle dengan penjelasan trade-off:
  - Status 2026-10-05: mesin patch smali selesai (`src/worker/recipe/patcher.ts`, `patchsets.ts`): apktool decode, aturan per class+method dengan jumlah kecocokan wajib, build ulang, ganti hanya `classesN.dex` yang berubah lewat penulis zip yang mempertahankan perataan dan signing block asli (293/293 APK/jar stock round-trip identik byte), gerbang decode ulang, hapus odex/vdex/art/`.fsv_meta` target, tolak jar bootclasspath. Enam patch set PureCN (cn-notifications, global-shortcuts, greezer-gms, no-drm-broadcast, powerkeeper-gms, joyose-off) pada stock onyx menghasilkan smali **identik** dengan PureCN: 12.810 file smali, 0 berbeda. Belum diuji boot.
  1. Greezer GMS limiter di `miui-services.jar` (`mGmsLimitEnabled` jadi false). Pola smali pasti ditentukan dari jar onyx yang sebenarnya, belum saya tebak sekarang.
  2. GMS selalu dianggap no-restrict (pendekatan UY-Scuti di `PowerKeeper.apk` `MilletPolicy`, atau injeksi ke parsing `mNoRestrictAppSet` di Greezer; dipilih setelah membaca smali onyx).
  3. Disable Joyose cloud control (stub method `job exist, sync local...`).
  4. Default deviceidle whitelist via sysconfig xml (`<allow-in-power-save package=...>`), ini mekanisme AOSP yang memang dibaca saat boot.
  5. Companion opsional (skrip Shizuku) untuk hal yang murni runtime, dengan penjelasan kenapa diperlukan.
     CN notification fix (`IS_INTERNATIONAL_BUILD`) ditempatkan di M8 tapi aktif default untuk base CN.
- [ ] **M7 APK editor**: decode, edit strings/drawables/layouts/smali, rebuild, before/after. Dua mode tanda tangan, ditampilkan jelas per app:
  - _Stock-signature-safe_ (default, terverifikasi di source AOSP): `InstallPackageHelper` memakai `skipVerify = scanSystemPartition`, jadi APK di partisi sistem hanya dibaca sertifikatnya (`unsafeGetCertsWithoutVerification`), tidak diverifikasi. Signing block asli dipertahankan; identitas app tetap.
  - _Re-sign dengan project key_ (untuk `adb install`, keputusanmu 2026-10-05: HyperKitchen hanya membuat APK + skrip, kamu yang menjalankan): tombol **adb package** menulis `mods/<id>/adb-package/` berisi APK hasil mod yang ditandatangani ulang dengan kunci project (`<project>/keys/hk-project.p12`, RSA 4096, dibuat sekali dengan `keytool` dari JRE, password acak di file mode 600), adb platform-tools 37.0.1 (macOS/Linux/Windows, sha256 dipin) dan skrip `{macos,linux}_adb_install.sh` / `windows_adb_install.bat` (tunggu device, cek `ro.product.device`, konfirmasi `yes`, `adb install -r`; bila ditolak karena signer berbeda, skrip menjelaskan dan menampilkan perintah `adb uninstall` tanpa menjalankannya). Signing pakai `apksigner` 0.9 dari build-tools 37.0.0 (sha1 cocok dengan index resmi Google), diverifikasi `apksigner verify --print-certs`: satu signer, v1 lama diganti. App ber-`sharedUserId` ditolak, jar ditolak. App sistem yang masih ada di ROM tetap tidak bisa di-`adb install` dengan signer lain (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`); hanya berguna untuk app yang dihapus dari ROM atau app `data-app`. App yang ditandatangani ulang tidak lagi menerima update store/OTA; UI menandai ini merah. Uji nyata: paket File Manager onyx lolos verify, Settings (`android.uid.system`) ditolak.
  - Status 2026-10-05: editor per-app selesai (`src/worker/appmod/`, tab **App editor**). Mod = `mods/<id>/mod.json` + overlay (file decode yang diubah/ditambah/dihapus beserta sha256 file stock asalnya); cache decode boleh dihapus. Build menerapkan overlay ke decode baru dari file di `work/`, menolak bila file yang diedit berbeda dari versi asal mod. Yang diganti hanya `classesN.dex` yang berubah; bila resource diubah, `AndroidManifest.xml` + `resources.arsc` (stored, rata 4) + seluruh `res/*` hasil aapt2 (nama path obfuscated berubah). Resource provider di-install otomatis per project: semua APK dengan package ID selain 0x7f/0x00 (onyx: framework-res 0x01, framework-ext-res 0x11, miuisystem 0x12, MiuiHome 0x2b, RtMiCloudSDK 0x60, miuix 0x66, HybridPlatform 0x70, screen_recorder 0x80); tanpa miuisystem, File Manager gagal decode. Gerbang: decode ulang hasil, smali per `normalizeSmali`, `res/values*` sebagai himpunan baris (aapt2 mengurutkan ulang item enum/flag), `public.xml` wajib mempertahankan semua ID lama (hanya boleh menambah ID untuk resource baru), file lain identik byte. UI: file tree, pencarian, editor teks + diff vs stock, stub method per tipe return, editor string (escape sesuai aturan Android). Uji nyata: File Manager onyx (`AdUtil.isShowAd()` di-stub false, string baru), signer dan skema tanda tangan identik dengan stock. Patch set M6 kini memakai jalur rebuild + gerbang yang sama. Belum diuji boot.
- [~] **M8 Framework patcher**: engine patch berbasis data sudah ada (`patchsets.ts`/`patcher.ts`, jenis aturan force-sget/sput/return, stub, delete, string-replace, wrap-call, add-class; tiap aturan punya jumlah kecocokan wajib dan gerbang decode-ulang). CN notification fix sudah ada (`cn-notifications`, aktif via preset). 
  - Status 2026-10-06: `disable-secure-flag` ditambahkan sebagai patch set **opsional, default mati, dengan peringatan keras**. Dari FrameworkPatcher A16, diverifikasi di jar onyx: stub `com/android/server/wm/WindowState.isSecureLocked()Z` di `services.jar` dan `com/android/server/wm/WindowManagerServiceImpl.notAllowCaptureDisplay(...)Z` di `miui-services.jar` jadi `return 0`. Keduanya di systemserverclasspath (bukan bootclasspath), jadi aman dipatch; gerbang rebuild lolos, privapp bersih. Widevine L1 tidak terpengaruh.
  - **Tidak dibuat (keputusan sadar):** signature verification bypass di framework/services (mematikan proteksi tanda tangan untuk semua app; HyperKitchen justru dirancang mempertahankan signing block asli, jadi tidak membutuhkannya) dan Play Integrity / device spoofing (Kaorios). Editor credits/about masuk M9.
- [~] **M9 Branding**: bootanimation, about/credits, prop nama/versi ROM, wallpaper.
  - Status 2026-10-05: nama ROM di About phone. Dari smali Settings onyx: kartu versi (`MiuiVersionCard.refreshVersionName` memanggil `MiuiAboutPhoneUtils.getSimpleOSVersion`) dan halaman detail (`MiuiMyDeviceDetailSettings.setVersionCode` memanggil `addVersionSuffix`) hanya menampilkan teks (`setText`, content description); `MiuiSettingsReceiver` memakai string versi yang sama untuk data, jadi tidak disentuh, begitu pula fungsi utilitas yang hasilnya di-parse regex `\d+\.\d+\.\d+\.\d+`. Patch set `branding-about` menambah class `com/hyperkitchen/Brand` (`apply(s)` = `s | <ro.hyperkitchen.rom.display>` bila prop di-set) dan membungkus dua panggilan tersebut (jenis aturan baru `add-class` dan `wrap-call`). Nama ROM berasal dari prop di `product/etc/build.prop`, bisa diganti tanpa patch ulang. xiaomi.eu sendiri hanya memakai prop (`ro.build.host=xiaomi.eu`, `ro.product.mod_device`), tidak mengubah kode versi Settings. Uji: Settings stock (hanya `classes3.dex` diganti, gerbang lolos) dan Settings PureCN (jumlah kecocokan sama, ditandai unverified). Gerbang smali kini menganggap `const-string` = `const-string/jumbo` (assembler memilih sesuai indeks string). Belum: bootanimation, wallpaper.
  - Status 2026-10-06 (media): operasi `media` mengganti `product/media/bootanimation.zip`, wallpaper home (`product/media/wallpaper/wallpaper_<warna>.jpg`, semua varian) dan lock (`product/media/theme/default/lock_wallpaper`). Boot animation: format dari AOSP `cmds/bootanimation/FORMAT.md`, dicek (desc.txt, ukuran frame vs trim.txt, tipe gambar); entry terkompresi ditulis ulang stored karena `BootAnimation.cpp` menolak zip yang tidak sepenuhnya stored. Bisa juga dari satu logo (`p 0 0 part0 <bg>`, tampil di tengah sampai boot selesai). Pembaca header gambar PNG/JPEG/WebP sendiri (tanpa dekode piksel). Wallpaper onyx ternyata PNG walau ber-ekstensi .jpg, jadi validasi berdasar isi. Diverifikasi di tree onyx: 6 file diganti, zip statis terbentuk benar, bootanimation stock dan varian China Mobile lolos cek. Credits/about: dilayani editor per-app (edit string Settings), tidak ada editor khusus. Belum: shutdownanimation dan bootaudio (opsional).
- [~] **M10 Recipe + build reproducible**: simpan/muat recipe, rebuild satu klik, build log, checksum output, template "CN to global daily driver".
  - Status 2026-10-06: simpan/muat recipe (`recipe.json` per project) dan rebuild satu klik sudah ada sejak M3/M4; build menulis `build.log`, `checksums.sha256`, `README.txt`, `build.json`. Tambahan M10: build kini menyalin **recipe persis** yang dipakai ke `build/<id>/recipe.json` dan menyimpannya di `build.json` (reproducible). Dua template siap-pakai (`presets.ts` `TEMPLATES`): "CN to global daily driver" (mandiri tanpa file eksternal: debloat, unlock CN GMS, enam patch set notifikasi/background/baterai, opsional nama ROM; GApps dan impor global menyusul karena butuh file) dan "PureCN (full reproduction)". UI: pemilih template dengan daftar langkah lanjutan, plus **Export/Import** recipe ke/dari file JSON untuk dibagikan. Catatan: recipe yang dibagikan hanya portabel untuk bagian tanpa file (path ROM referensi dan zip bersifat lokal). Uji: build nyata dengan template menulis recipe.json di folder build.

## 5. Aturan keamanan (implementasi)

- Tidak ada kode yang memanggil `fastboot`, `adb`, `dd`, `mkfs` ke device, atau format/partisi disk host. Lint rule + test yang memastikan string perintah tersebut hanya muncul di template skrip output.
- Semua path tulis divalidasi berada di dalam folder project.
- Operasi destruktif di UI selalu konfirmasi, dan semuanya reversible karena hanya mengubah recipe.
- Patch yang belum saya pahami efeknya diberi label "belum terverifikasi" di kode dan UI.

## 6. Repo dan push

- Nama: `hyperkitchen`. Root repo: `~/projects/hyperos-tools` di server Linux, `~/Projects/hyperkitchen` di Mac.
- Token: di server, key `GITHUB_TOKEN` di `~/.hermes/.env`, dipakai hanya untuk auth remote saat push lewat credential helper sementara, tidak ditulis ke `.git/config`, tidak dicetak, tidak di-commit. Di Mac memakai credential git yang sudah ada (osxkeychain).
- `.gitignore`: `node_modules`, `out/`, `dist/`, `release/`, `resources/bin/*/` (binary diunduh), `*.img`, `*.bin`, `*.zip`, `*.tgz`, `*.zst`, `*.br`, `*.dat`, folder project, `.env*`.

## 7. Yang perlu darimu

1. **Visibilitas repo GitHub**: usulan saya _private_.
2. **ROM onyx CN** untuk M2/M3: path lokal ke fastboot tgz atau OTA zip (lebih suka fastboot tgz). Saya tidak akan mengunduh ROM sendiri tanpa diminta.
3. **`romdiff.zip`** saat M2.
4. **Java**: setuju dengan usulan 2.5 (unduh Temurin on-demand dari Doctor)?
5. **CI macOS** lewat GitHub Actions: setuju?
