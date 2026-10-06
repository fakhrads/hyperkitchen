// Recipe presets. The PureCN preset reproduces the verified changes of the PureCN onyx ROM
// (PLAN.md 1.2b) except disabling encryption, which stays a separate opt-in.

import type { Operation } from './recipe'

// The exact packages PureCN removes from stock OS3.0.305.0.WOLCNXM, verified by diffing the
// unpacked onyx-stock and onyx-purecn trees (not guessed from names). Theme manager
// (com.android.thememanager) and Weather (com.miui.weather2) are NOT here: PureCN keeps both,
// it only relocates them (product/app or data-app to product/priv-app), so a subtractive
// debloat must leave them in place. The CN Theme STORE (com.miui.themestore) is genuinely
// removed. GMS-swap parts (com.android.vending updater, the gmsconfig overlay) are handled by
// the GApps step, not here. The two core-UID removals go in PURECN_DEBLOAT_CORE below.
/** Apps PureCN removes from stock OS3.0.305.0.WOLCNXM, minus core apps and GMS-swap parts. */
export const PURECN_DEBLOAT = [
  'android.miui.poco.launcher.res',
  'com.android.browser',
  'com.android.email',
  'com.android.quicksearchbox',
  'com.android.updater',
  'com.baidu.input_mi',
  'com.duokan.phone.remotecontroller',
  'com.duokan.reader',
  'com.iflytek.inputmethod.miui',
  'com.mfashiongallery.emag',
  'com.mi.health',
  'com.mipay.wallet',
  'com.miui.carlink',
  'com.miui.compass',
  'com.miui.greenguard',
  'com.miui.miservice',
  'com.miui.miwallpaper.overlay',
  'com.miui.miwallpaper.overlay.lundun',
  'com.miui.miwallpaper.overlay.qr',
  'com.miui.newhome',
  'com.miui.nextpay',
  'com.miui.notes',
  'com.miui.password',
  'com.miui.passwords',
  'com.miui.player',
  'com.miui.securityinputmethod',
  'com.miui.securitymanager',
  'com.miui.themestore',
  'com.miui.video',
  'com.miui.virtualsim',
  'com.miui.voiceassist',
  'com.miui.voiceassistProxy',
  'com.miui.voiceassistoverlay',
  'com.miui.voicetrigger',
  'com.miui.wallpaper.overlay',
  'com.sohu.inputmethod.sogou.xiaomi',
  'com.unionpay.tsmservice.mi',
  'com.xiaomi.ab',
  'com.xiaomi.aireco',
  'com.xiaomi.gamecenter',
  'com.xiaomi.gamecenter.sdk.service',
  'com.xiaomi.market',
  'com.xiaomi.mibrain.speech',
  'com.xiaomi.migameservice',
  'com.xiaomi.minigame',
  'com.xiaomi.scanner',
  'com.xiaomi.shop',
  'com.xiaomi.smarthome',
  'com.xiaomi.vipaccount',
  'com.xiaomi.youpin'
]

/** Removed by PureCN although they share a core UID; kept as a separate, forced operation. */
export const PURECN_DEBLOAT_CORE = ['com.miui.tsmclient', 'com.xiaomi.aiasst.service']

export const PURECN_PATCH_SETS = [
  'cn-notifications',
  'global-shortcuts',
  'greezer-gms',
  'no-drm-broadcast',
  'powerkeeper-gms',
  'joyose-off'
]

export function purecnPreset(): Operation[] {
  return [
    {
      id: 'purecn-debloat',
      type: 'debloat',
      enabled: true,
      params: { packages: PURECN_DEBLOAT, force: false }
    },
    {
      id: 'purecn-debloat-core',
      type: 'debloat',
      enabled: true,
      params: { packages: PURECN_DEBLOAT_CORE, force: true }
    },
    {
      id: 'purecn-unlock-cn-gms',
      type: 'unlock-cn-gms',
      enabled: true,
      params: { includeGnss: true }
    },
    ...PURECN_PATCH_SETS.map((s): Operation => ({
      id: `purecn-${s}`,
      type: 'patch',
      enabled: true,
      params: { patchSet: s }
    }))
  ]
}

/**
 * GApps from a MindTheGapps zip on a CN base: drop the cn.google.services restriction and add
 * the zip's apps (ROM copies of GmsCore/GSF stay when they are as new; the CN Play Store stub
 * is replaced). The build checks every privileged permission against the allowlists.
 */
export function mindTheGappsOps(zip: string, sha256: string, exclude: string[]): Operation[] {
  return [
    { id: 'unlock-cn-gms', type: 'unlock-cn-gms', enabled: true, params: { includeGnss: false } },
    {
      id: 'gapps-mtg',
      type: 'gapps',
      enabled: true,
      params: { zip, sha256, exclude, replaceDifferentSigner: true }
    }
  ]
}

// ---- Named templates (M10): ready-made recipes the user applies in one click. ----

export interface Template {
  id: string
  title: string
  description: string
  /** Operations that need no file or reference ROM; applied immediately. */
  build: (opts: { romName?: string }) => Operation[]
  /** Steps the user still has to do by hand (need a file or a reference ROM). */
  followUp: string[]
}

/**
 * CN to global daily driver: the self-contained CN-to-global essentials that need no external
 * files, in the spirit of ZKOS / xiaomi.eu / PureCN. Debloat, drop the CN Google services
 * restriction, the notification/background and battery patches, and (optionally) the ROM name.
 * GApps and global-app imports are added afterwards because they need files the user provides.
 */
export function cnToGlobalDaily(opts: { romName?: string } = {}): Operation[] {
  const ops: Operation[] = [
    {
      id: 'daily-debloat',
      type: 'debloat',
      enabled: true,
      params: { packages: PURECN_DEBLOAT, force: false }
    },
    {
      id: 'daily-unlock-cn-gms',
      type: 'unlock-cn-gms',
      enabled: true,
      params: { includeGnss: false }
    },
    ...PURECN_PATCH_SETS.map((s): Operation => ({
      id: `daily-${s}`,
      type: 'patch',
      enabled: true,
      params: { patchSet: s }
    }))
  ]
  if (opts.romName?.trim()) {
    ops.push(
      {
        id: 'branding-prop',
        type: 'set-props',
        enabled: true,
        params: {
          file: 'product/etc/build.prop',
          set: { 'ro.hyperkitchen.rom.display': opts.romName.trim() },
          remove: []
        }
      },
      {
        id: 'patch-branding-about',
        type: 'patch',
        enabled: true,
        params: { patchSet: 'branding-about' }
      }
    )
  }
  return ops
}

export const TEMPLATES: Template[] = [
  {
    id: 'cn-to-global-daily',
    title: 'CN to global daily driver',
    description:
      'Debloat, remove the CN Google services restriction, fix notifications and background limits, loosen the battery policy, and optionally set the ROM name. Uses only files already in the ROM. Add Google apps (needs a MindTheGapps zip) and any global-app imports afterwards.',
    build: cnToGlobalDaily,
    followUp: [
      'Add Google apps in the GApps section (download a MindTheGapps zip first).',
      'Optionally import global Xiaomi apps from an unpacked reference ROM.',
      'Set a boot animation or wallpapers in the Branding section.',
      'First install with a data format (install_and_format_data) when the Play Store stub is replaced.'
    ]
  },
  {
    id: 'purecn-style',
    title: 'PureCN-style (debloat + patches)',
    description:
      "HyperKitchen's own work, verified to match the PureCN onyx behavior: debloat, forced core debloat, CN GMS unlock with GNSS, and all six smali patch sets (all applied to stock, nothing copied from PureCN).",
    build: () => purecnPreset(),
    followUp: [
      'Add Google apps with a MindTheGapps zip (GApps section).',
      'Add any other app (a keyboard, a Google app) from an APK with Replace or add an app.',
      'Set a boot animation, wallpapers or the ROM name in Branding.'
    ]
  }
]
