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

// ---- Imports from an unpacked PureCN ROM of the same base version (the user's own files).

/** PureCN's patched copies of stock apps and configs (global compatibility, 69 methods in 8 APKs). */
export const PURECN_GLOBAL_COMPAT = [
  'odm/overlay/FrameworksResTarget_Vendor_OnyxCn.apk',
  'odm/overlay/FrameworksResTarget_Vendor_OnyxGlobal.apk',
  'odm/overlay/FrameworksResTarget_Vendor_OnyxIn.apk',
  'product/priv-app/MiuiHome/MiuiHome.apk',
  'product/priv-app/MIUISecurityCenter/MIUISecurityCenter.apk',
  'product/priv-app/MIUIPersonalAssistantPhoneOS3/MIUIPersonalAssistantPhoneOS3.apk',
  'product/priv-app/MIUIPackageInstaller/MIUIPackageInstaller.apk',
  'product/priv-app/MIUIContactsT/MIUIContactsT.apk',
  'product/priv-app/MIUIAod/MIUIAod.apk',
  'product/overlay/AospFrameworkResOverlay.apk',
  'product/overlay/MIWallpaperOverlay.apk',
  'product/overlay/MiuiFrameworkTelephonyResOverlay.apk',
  'product/overlay/MiuiSystemUIResOverlay.apk',
  'system/system/priv-app/TeleService/TeleService.apk',
  'system/system/priv-app/HTMLViewer/HTMLViewer.apk',
  'system_ext/priv-app/Settings/Settings.apk',
  'system_ext/priv-app/Provision/Provision.apk',
  'system_ext/priv-app/MiuiSystemUI/MiuiSystemUI.apk',
  'product/etc/device_features/onyx.xml',
  'system_ext/etc/init/init.miui.ext.rc',
  'vendor/etc/init/hw/init.target.rc',
  // The About phone spec card: values (the patched Settings reads them) and the market name
  // that odm/etc/build.prop imports through the SKU props set in init.target.rc.
  'product/etc/device_info.json',
  'odm/etc/onyx_7.19.0.prop'
]

/** Google apps PureCN adds, with their permission and sysconfig files. */
export const PURECN_GAPPS = [
  'product/app/Gemini_arm64',
  'product/app/GoogleCalendarSyncAdapter',
  'product/app/GoogleContactsSyncAdapter',
  'product/app/LatinImeGoogle',
  'product/app/SpeechServicesByGoogle',
  'product/app/SoundPickerGoogle',
  'product/priv-app/AndroidAutoStub',
  'product/priv-app/FamilyLinkParentalControls',
  'product/priv-app/GoogleRestore',
  'product/priv-app/HotwordEnrollmentXGoogleHEXAGON_WIDEBAND',
  'product/priv-app/HotwordEnrollmentYGoogleHEXAGON_WIDEBAND',
  'product/priv-app/Phonesky',
  'product/priv-app/VelvetCtS',
  'system_ext/priv-app/GoogleFeedback',
  'system_ext/priv-app/SetupWizard',
  'product/overlay/CircleToSearchOverlay.apk',
  'product/overlay/GmsConfigOverlayCommon.apk',
  'product/overlay/GmsConfigOverlayGSA.apk',
  'product/overlay/GmsConfigOverlayGeotz.apk',
  'product/overlay/GoogleDocumentsUIOverlay.apk',
  'product/usr/share/ime/google',
  'product/etc/permissions/com.google.android.contextual_search.xml',
  'product/etc/permissions/com.google.lens.integration.xml',
  'product/etc/permissions/privapp-permissions-gms-international-product.xml',
  'product/etc/sysconfig/gemini_shell.xml',
  'system_ext/etc/permissions/android.software.contextualsearch.xml',
  'system_ext/etc/permissions/privapp-permissions-gms-international-system-ext.xml'
]

/** Props PureCN adds to product/etc/build.prop for the Google apps. */
export const PURECN_GAPPS_PROPS: Record<string, string> = {
  'ro.setupwizard.rotation_locked': 'true',
  'setupwizard.feature.baseline_setupwizard_enabled': 'true',
  'setupwizard.theme': 'glif_v3_light',
  'ro.opa.eligible_device': 'true',
  'ro.com.google.gmsversion': '16_202512',
  'ro.com.google.ime.system_lm_dir': 'product/usr/share/ime/google/d3_lms/',
  'ro.com.google.lens.oem_camera_package': 'com.android.camera',
  'ro.com.google.lens.oem_image_package': 'com.miui.gallery'
}

/** Global versions of Xiaomi apps that replace removed CN ones, plus the style pickers. */
export const PURECN_GLOBAL_APPS = [
  'product/priv-app/MIUIWeather',
  'product/priv-app/MIUIThemeManager',
  'product/app/MIUIHealthGlobal',
  'product/app/ThemesStub',
  'system_ext/priv-app/ThemePicker',
  'system_ext/etc/default-permissions',
  'product/overlay/MiuiThemeManagerCnOverlay.apk',
  'product/etc/permissions/privapp-permissions-product.xml'
]

export const PURECN_MICROSOFT = [
  'product/priv-app/LinkToWindows',
  'product/priv-app/DeviceIntegrationService',
  'system_ext/app/CrossDeviceServiceBroker',
  'product/etc/sysconfig/microsoft.xml'
]

export type ImportGroup = 'global-compat' | 'gapps' | 'global-apps' | 'microsoft'

/** Operations importing the chosen groups from an unpacked PureCN project. */
export function purecnImportOps(project: string, groups: ImportGroup[]): Operation[] {
  const ops: Operation[] = []
  const imp = (
    paths: string[],
    replace: string[]
  ): { project: string; paths: string[]; replace: string[] } => ({
    project,
    paths,
    replace
  })
  if (groups.includes('global-compat')) {
    ops.push({
      id: 'purecn-import-global-compat',
      type: 'import-from-rom',
      enabled: true,
      params: imp(PURECN_GLOBAL_COMPAT, PURECN_GLOBAL_COMPAT)
    })
    ops.push({
      id: 'purecn-visual-level',
      type: 'set-props',
      enabled: true,
      params: {
        file: 'product/etc/build.prop',
        set: { 'persist.sys.advanced_visual_release': '4' },
        remove: []
      }
    })
    ops.push({
      id: 'purecn-mi-ext-props',
      type: 'set-props',
      enabled: true,
      params: {
        file: 'mi_ext/etc/build.prop',
        set: {},
        remove: ['ro.miui.support.system.app.uninstall.v2']
      }
    })
  }
  if (groups.includes('gapps')) {
    // The CN Play Store stub and CN GMS config give way to the international ones.
    ops.push({
      id: 'purecn-gapps-remove-cn',
      type: 'debloat',
      enabled: true,
      params: {
        packages: ['com.android.vending', 'com.google.android.overlay.gmsconfig'],
        force: false
      }
    })
    ops.push({
      id: 'purecn-gapps-remove-cn-perms',
      type: 'remove-paths',
      enabled: true,
      params: {
        paths: [
          'system_ext/etc/permissions/privapp-permissions-gms-cn-system-ext.xml',
          'product/etc/permissions/privapp-permissions-gms-cn-product.xml'
        ]
      }
    })
    ops.push({
      id: 'purecn-import-gapps',
      type: 'import-from-rom',
      enabled: true,
      params: imp(PURECN_GAPPS, [])
    })
    ops.push({
      id: 'purecn-gapps-props',
      type: 'set-props',
      enabled: true,
      params: { file: 'product/etc/build.prop', set: PURECN_GAPPS_PROPS, remove: [] }
    })
  }
  if (groups.includes('global-apps')) {
    ops.push({
      id: 'purecn-import-global-apps',
      type: 'import-from-rom',
      enabled: true,
      params: imp(PURECN_GLOBAL_APPS, [
        'product/overlay/MiuiThemeManagerCnOverlay.apk',
        'product/etc/permissions/privapp-permissions-product.xml'
      ])
    })
  }
  if (groups.includes('microsoft')) {
    ops.push({
      id: 'purecn-import-microsoft',
      type: 'import-from-rom',
      enabled: true,
      params: imp(PURECN_MICROSOFT, [])
    })
  }
  return ops
}
