// Recipe presets. The PureCN preset reproduces the verified changes of the PureCN onyx ROM
// (PLAN.md 1.2b) except disabling encryption, which stays a separate opt-in.

import type { Operation } from './recipe'

/** Apps PureCN removes from stock OS3.0.305.0.WOLCNXM, minus core apps and Play Store parts. */
export const PURECN_DEBLOAT = [
  'android.miui.poco.launcher.res',
  'com.android.browser',
  'com.android.email',
  'com.android.quicksearchbox',
  'com.android.thememanager',
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
  'com.miui.weather2',
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
