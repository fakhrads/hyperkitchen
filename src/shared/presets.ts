// Recipe presets: ready-made operation lists the user applies in one click. Everything here is
// self-contained (no external files); GApps and other apps are added afterwards.

import type { Operation } from './recipe'

// CN-only apps that are safe to remove from stock OS3.0.305.0.WOLCNXM, confirmed package by
// package against the unpacked onyx tree (not guessed from names). Theme manager
// (com.android.thememanager) and Weather (com.miui.weather2) are deliberately NOT here: both are
// kept (just relocated to product/priv-app on global builds), so a subtractive debloat must
// leave them in place. The CN Theme STORE (com.miui.themestore) is removed. GMS-swap parts
// (com.android.vending updater, the gmsconfig overlay) belong to the GApps step, not here. The
// two core-UID removals go in CN_BLOAT_CORE below.
/** CN-only apps safe to remove from stock OS3.0.305.0.WOLCNXM, minus core apps and GMS-swap parts. */
export const CN_BLOAT = [
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

/** Safe to remove even though they share a core UID; kept as a separate, forced operation. */
export const CN_BLOAT_CORE = ['com.miui.tsmclient', 'com.xiaomi.aiasst.service']

/**
 * The stock smali patch sets this kitchen applies by default for a CN-to-global daily driver:
 * the framework/battery/notification fixes plus the CN app patches that every build wants
 * (installer-no-ads). Each is still a checkbox in the recipe, so any one can be turned off.
 */
export const CN_GLOBAL_PATCH_SETS = [
  'cn-notifications',
  'global-shortcuts',
  'greezer-gms',
  'no-drm-broadcast',
  'powerkeeper-gms',
  'joyose-off',
  'installer-no-ads',
  'launcher-no-ads'
]

/** Full cleanup: debloat (incl. forced core apps), CN GMS unlock with GNSS, all patch sets. */
export function cleanupPreset(): Operation[] {
  return [
    {
      id: 'cleanup-debloat',
      type: 'debloat',
      enabled: true,
      params: { packages: CN_BLOAT, force: false }
    },
    {
      id: 'cleanup-debloat-core',
      type: 'debloat',
      enabled: true,
      params: { packages: CN_BLOAT_CORE, force: true }
    },
    {
      id: 'cleanup-unlock-cn-gms',
      type: 'unlock-cn-gms',
      enabled: true,
      params: { includeGnss: true }
    },
    ...CN_GLOBAL_PATCH_SETS.map((s): Operation => ({
      id: `cleanup-${s}`,
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
 * files. Debloat, drop the CN Google services restriction, the notification/background and
 * battery patches, and (optionally) the ROM name. GApps and other apps are added afterwards
 * because they need files the user provides.
 */
export function cnToGlobalDaily(opts: { romName?: string } = {}): Operation[] {
  const ops: Operation[] = [
    {
      id: 'daily-debloat',
      type: 'debloat',
      enabled: true,
      params: { packages: CN_BLOAT, force: false }
    },
    {
      id: 'daily-unlock-cn-gms',
      type: 'unlock-cn-gms',
      enabled: true,
      params: { includeGnss: false }
    },
    ...CN_GLOBAL_PATCH_SETS.map((s): Operation => ({
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
      'Add any other app (a keyboard, a Google app) from an APK with Replace or add an app.',
      'Set a boot animation or wallpapers in the Branding section.',
      'First install with a data format (install_and_format_data) when the Play Store stub is replaced.'
    ]
  },
  {
    id: 'full-cleanup',
    title: 'Full debloat + patches',
    description:
      "HyperKitchen's own stock patches: debloat, forced core debloat, CN GMS unlock with GNSS, and all six smali patch sets, all applied to stock.",
    build: () => cleanupPreset(),
    followUp: [
      'Add Google apps with a MindTheGapps zip (GApps section).',
      'Add any other app (a keyboard, a Google app) from an APK with Replace or add an app.',
      'Set a boot animation, wallpapers or the ROM name in Branding.'
    ]
  }
]
