# HyperKitchen: PLAN

Status: M1 selesai (Linux x64 dan macOS arm64). Riset dilakukan 2026-10-04 terhadap clone shallow semua repo di bawah.

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
  source/             input asli, read-only (atau hanya referensi path + hash)
  stock/              image partisi hasil ekstrak + config/ (fs_config, file_contexts). Read-only setelah ekstrak.
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
- [ ] **M2 Unpack**: input OTA zip / payload.bin / fastboot tgz / super.img / folder. lpunpack + simg2img di TS, erofs extract dengan config. UI: pohon partisi, build.prop per partisi, inventaris APK (package, versionCode, signer SHA-256). Minta `romdiff.zip` darimu di awal M2.
- [ ] **M3 Repack + output flashable** (paling berisiko): rebuild erofs/ext4 dengan fs_config + file_contexts asli, lpmake dengan geometri super dari metadata stock (bukan tebakan), vbmeta flags disable (dengan peringatan jelas). Output pertama: **paket fastboot** (images + `flash.sh` untuk mac/linux yang kamu jalankan sendiri, tool tidak pernah memanggil fastboot). Recovery zip menyusul. **Gerbang wajib:** unpack lalu repack tanpa perubahan, bandingkan isi file per file (bukan byte image), lalu kamu uji boot di onyx sebelum ada edit apa pun. Regenerasi payload.bin OTA ditunda (butuh `delta_generator`, hanya ada versi Linux).
- [ ] **M4 Debloat + props**: hapus app per package/path, peringatan dependensi (shared lib, `uses-library`, priv-app permission xml, overlay target), editor build.prop lintas partisi, kontrol region/locale, diff view.
- [ ] **M5 GApps**: baca layout zip MindTheGapps 16 asli (511 MB, diunduh saat M5) sebelum menulis path apa pun. Inject ke `product` (atau `system_ext`) beserta permission + sysconfig xml, hapus flag `cn.google.services`/`services_updater`, dedupe dengan "Basic Google Services" bawaan CN ROM.
- [ ] **M6 Battery/notifikasi**: berdasarkan temuan 1.2, mekanisme utama adalah patch smali build time, masing-masing toggle dengan penjelasan trade-off:
  1. Greezer GMS limiter di `miui-services.jar` (`mGmsLimitEnabled` jadi false). Pola smali pasti ditentukan dari jar onyx yang sebenarnya, belum saya tebak sekarang.
  2. GMS selalu dianggap no-restrict (pendekatan UY-Scuti di `PowerKeeper.apk` `MilletPolicy`, atau injeksi ke parsing `mNoRestrictAppSet` di Greezer; dipilih setelah membaca smali onyx).
  3. Disable Joyose cloud control (stub method `job exist, sync local...`).
  4. Default deviceidle whitelist via sysconfig xml (`<allow-in-power-save package=...>`), ini mekanisme AOSP yang memang dibaca saat boot.
  5. Companion opsional (skrip Shizuku) untuk hal yang murni runtime, dengan penjelasan kenapa diperlukan.
     CN notification fix (`IS_INTERNATIONAL_BUILD`) ditempatkan di M8 tapi aktif default untuk base CN.
- [ ] **M7 APK editor**: decode APKEditor, edit strings/drawables/layouts/smali, rebuild, before/after. Dua mode tanda tangan, ditampilkan jelas per app:
  - _Stock-signature-safe_: tidak menyentuh APK sama sekali, atau (bila memang diubah) mempertahankan sertifikat asli seperti UY-Scuti `-c`. Apakah PackageManager Android 16 menerima APK sistem dengan blok signing v2/v3 yang sudah tidak cocok **belum terverifikasi**; akan saya cek di source AOSP (`ApkSignatureVerifier`, alur scan partisi sistem) dan uji di device sebelum mode ini dianggap aman.
  - _Re-sign dengan project key_: app itu tidak bisa lagi diupdate dari store/OTA. UI menandai ini merah.
- [ ] **M8 Framework patcher**: engine patch berbasis data (port FrameworkPatcher). CN notification fix default on untuk base CN. Secure-flag opsional. Signature verification default OFF dengan peringatan keras. Editor credits/about. Setiap patch melaporkan jumlah match vs yang diharapkan dan gagal keras bila tidak cocok.
- [ ] **M9 Branding**: bootanimation, about/credits, prop nama/versi ROM, wallpaper.
- [ ] **M10 Recipe + build reproducible**: simpan/muat recipe, rebuild satu klik, build log, checksum output, template "CN to global daily driver" yang meniru fitur ZKOS/Xiaomi.EU/PureCN.

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
