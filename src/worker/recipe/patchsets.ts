// Smali patch sets, as data. Every rule names the class and method it touches and how many
// matches it expects; the patcher fails when the count differs, so a patch never applies
// partially or to the wrong code on another build.
//
// Source: per-method diff of a reference global onyx ROM against stock OS3.0.305.0.WOLCNXM (both
// decoded with apktool 3.0.3), recorded in PLAN.md 1.2b. `verifiedSha256` is the stock target
// the rules were checked against; on other builds the expected counts still have to match and
// the result is reported as unverified.

export type SmaliRule =
  /** After `sget-boolean vX, <field>`, insert `const/4 vX, <value>` (register preserved). */
  | { kind: 'force-sget'; cls: string; method: string; field: string; value: 0 | 1; expect: number }
  /** Before `sput-boolean vX, <field>`, insert `const/4 vX, <value>`. */
  | { kind: 'force-sput'; cls: string; method: string; field: string; value: 0 | 1; expect: number }
  /** Before every `return vX`, insert `const/4 vX, <value>`. */
  | { kind: 'force-return'; cls: string; method: string; value: 0 | 1; expect: number }
  /** Replace the whole body: `.locals 0` plus return-void, or `const/4 p0, v` + return p0. */
  | { kind: 'stub'; cls: string; method: string; returns: 'void' | 0 | 1 }
  /** Delete lines matching `pattern` (a regex over consecutive lines). */
  | { kind: 'delete'; cls: string; method: string; pattern: string; expect: number }
  /** Replace a substring inside every const-string literal of the whole file. */
  | { kind: 'string-replace'; from: string; to: string; expect: number }
  /**
   * After `invoke-* {...}, <call>` + `move-result-object vX`, pass vX through a static
   * `helper` (String -> String): `invoke-static {vX}, <helper>` + `move-result-object vX`.
   */
  | {
      kind: 'wrap-call'
      cls: string
      method: string
      call: string
      helper: string
      expect: number
    }
  /** Add a new class, in the same dex as `nextTo` (the class must not exist yet). */
  | { kind: 'add-class'; cls: string; nextTo: string; smali: string }

export interface PatchTarget {
  /** Tree path of the jar or APK. */
  path: string
  verifiedSha256: string
  rules: SmaliRule[]
}

export interface PatchSet {
  id: string
  title: string
  description: string
  targets: PatchTarget[]
}

const BUILD = 'Lmiui/os/Build;->IS_INTERNATIONAL_BUILD:Z'
const GLOBAL = 'Lmiui/os/Build;->IS_GLOBAL_BUILD:Z'
const MIUI_SERVICES = 'system_ext/framework/miui-services.jar'
const SERVICES = 'system/system/framework/services.jar'
const SERVICES_SHA = '37d4e57a9753441264128ded9fbe7ecf6f810c91ea0126457010fecb9a521e9a'
const MIUI_SERVICES_SHA = '0cd1ee6229a54618d88702c6e96521c3e746bb8da1f28a4df118f642de8ec4dc'
const intl = (cls: string, method: string, expect = 1): SmaliRule => ({
  kind: 'force-sget',
  cls,
  method,
  field: BUILD,
  value: 1,
  expect
})

/**
 * Helper added to Settings by the branding patch set: `apply(s)` returns s, or
 * "s | <ro.hyperkitchen.rom.display>" when that prop is set. Written in the form baksmali prints
 * it (labels :cond_N) so the rebuild gate compares it line for line.
 */
export const BRAND_PROP = 'ro.hyperkitchen.rom.display'
const BRAND_CLASS = 'com/hyperkitchen/Brand'
const BRAND_APPLY = `L${BRAND_CLASS};->apply(Ljava/lang/String;)Ljava/lang/String;`
const BRAND_SMALI = [
  `.class public final L${BRAND_CLASS};`,
  '.super Ljava/lang/Object;',
  '.source "Brand.java"',
  '',
  '',
  '# direct methods',
  '.method public static apply(Ljava/lang/String;)Ljava/lang/String;',
  '    .locals 2',
  '',
  '    if-eqz p0, :cond_0',
  '',
  `    const-string v0, "${BRAND_PROP}"`,
  '',
  '    const-string v1, ""',
  '',
  '    invoke-static {v0, v1}, Landroid/os/SystemProperties;->get(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;',
  '',
  '    move-result-object v0',
  '',
  '    invoke-virtual {v0}, Ljava/lang/String;->isEmpty()Z',
  '',
  '    move-result v1',
  '',
  '    if-nez v1, :cond_0',
  '',
  '    new-instance v1, Ljava/lang/StringBuilder;',
  '',
  '    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V',
  '',
  '    invoke-virtual {v1, p0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;',
  '',
  '    const-string p0, " | "',
  '',
  '    invoke-virtual {v1, p0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;',
  '',
  '    invoke-virtual {v1, v0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;',
  '',
  '    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;',
  '',
  '    move-result-object p0',
  '',
  '    :cond_0',
  '    return-object p0',
  '.end method',
  ''
].join('\n')
const ABOUT = 'com/android/settings/device/MiuiAboutPhoneUtils'

export const PATCH_SETS: PatchSet[] = [
  {
    id: 'cn-notifications',
    title: 'Notifications and background like global builds',
    description:
      'Makes system_server take the international path where CN builds kill or block apps in the background: broadcasts to non-running apps, auto start, swipe kill, job cancelling, alarms, full screen intents, force dark list. Fixes delayed or missing notifications from apps that are not on the CN allow lists.',
    targets: [
      {
        path: MIUI_SERVICES,
        verifiedSha256: MIUI_SERVICES_SHA,
        rules: [
          intl(
            'com/android/server/ForceDarkAppListManager',
            'getDarkModeAppList(JI)Lcom/miui/darkmode/DarkModeAppData;'
          ),
          intl(
            'com/android/server/alarm/AlarmManagerServiceStubImpl',
            'init(Lcom/android/server/alarm/AlarmManagerService;)V'
          ),
          intl(
            'com/android/server/am/BroadcastQueueModernStubImpl',
            'checkApplicationAutoStart(Lcom/android/server/am/BroadcastQueue;Lcom/android/server/am/BroadcastRecord;Landroid/content/pm/ResolveInfo;)Z'
          ),
          intl(
            'com/android/server/am/BroadcastQueueModernStubImpl',
            'checkReceiverAppDealBroadcast(Lcom/android/server/am/BroadcastQueue;Lcom/android/server/am/BroadcastRecord;Lcom/android/server/am/ProcessRecord;Z)Z'
          ),
          intl(
            'com/android/server/am/BroadcastQueueModernStubImpl',
            'isInternationalSpecialAction(Ljava/lang/String;Landroid/content/pm/ResolveInfo;)Z'
          ),
          intl('com/android/server/am/BroadcastQueueModernStubImpl', 'updateBlockBroadcast()V'),
          intl(
            'com/android/server/am/ProcessManagerService',
            'isForceStopEnable(Lcom/android/server/am/ProcessRecord;I)Z'
          ),
          intl(
            'com/android/server/am/ProcessSceneCleaner',
            'handleSwipeKill(Lmiui/process/ProcessConfig;)Z'
          ),
          intl(
            'com/android/server/am/ProcessSceneCleaner',
            'killAppForHasOtherTask(ILmiui/process/ProcessConfig;)Z'
          ),
          intl(
            'com/android/server/job/JobServiceContextImpl',
            'checkIfCancelJob(Lcom/android/server/job/JobServiceContext;Landroid/content/Context;Landroid/content/Intent;Landroid/content/Context$BindServiceFlags;Lcom/android/server/job/controllers/JobStatus;)Z'
          ),
          intl(
            'com/android/server/notification/NotificationManagerServiceImpl',
            'checkFullScreenIntent(Landroid/app/Notification;Landroid/app/AppOpsManager;ILjava/lang/String;)V'
          ),
          intl(
            'miui/app/ActivitySecurityHelper',
            'getCheckStartActivityIntent(Landroid/content/pm/ApplicationInfo;Landroid/content/pm/ApplicationInfo;Landroid/content/Intent;ZIZII)Landroid/content/Intent;'
          ),
          {
            kind: 'force-sget',
            cls: 'com/android/server/pm/PackageManagerServiceImpl',
            method: 'isAllowedToGetInstalledApps(ILjava/lang/String;Ljava/lang/String;)Z',
            field: 'Lcom/android/server/pm/PackageManagerServiceImpl;->IS_INTERNATIONAL_BUILD:Z',
            value: 1,
            expect: 1
          }
        ]
      }
    ]
  },
  {
    id: 'global-shortcuts',
    title: 'Global power key and shortcut behaviour',
    description:
      'Uses the global build behaviour for the long press power key (assistant) and the shortcut settings observers, so Google Assistant/Gemini can be bound to the power key.',
    targets: [
      {
        path: MIUI_SERVICES,
        verifiedSha256: MIUI_SERVICES_SHA,
        rules: [
          {
            kind: 'force-sget',
            cls: 'com/android/server/policy/BaseMiuiPhoneWindowManager',
            method: 'interceptKeyBeforeQueueingInternal(Landroid/view/KeyEvent;IZ)I',
            field: GLOBAL,
            value: 1,
            expect: 1
          },
          {
            kind: 'force-sget',
            cls: 'com/android/server/policy/MiuiShortcutObserver',
            method: 'enableLongPressPowerLaunchAssistant(Ljava/lang/String;)Z',
            field: GLOBAL,
            value: 1,
            expect: 1
          },
          {
            kind: 'force-sget',
            cls: 'com/android/server/policy/MiuiShortcutTriggerHelper$ShortcutSettingsObserver',
            method: 'initShortcutSettingsObserver()V',
            field: GLOBAL,
            value: 1,
            expect: 1
          },
          {
            kind: 'force-sget',
            cls: 'com/android/server/policy/MiuiShortcutTriggerHelper$ShortcutSettingsObserver',
            method: 'onChange(Z)V',
            field: GLOBAL,
            value: 1,
            expect: 1
          },
          {
            kind: 'force-sget',
            cls: 'com/android/server/policy/MiuiShortcutTriggerHelper$ShortcutSettingsObserver',
            method: 'onChange(ZLandroid/net/Uri;)V',
            field: GLOBAL,
            value: 1,
            expect: 1
          }
        ]
      }
    ]
  },
  {
    id: 'greezer-gms',
    title: 'Stop Greezer from freezing Google Play services',
    description:
      'Greezer (miui-services) treats the device as a non-CN model, so its CN-only GMS limiter that freezes Google Play services shortly after the screen turns off does not run.',
    targets: [
      {
        path: MIUI_SERVICES,
        verifiedSha256: MIUI_SERVICES_SHA,
        rules: [
          {
            kind: 'force-sput',
            cls: 'com/miui/server/greeze/PolicyManager',
            method: '<clinit>()V',
            field: 'Lcom/miui/server/greeze/PolicyManager;->CN_MODEL:Z',
            value: 0,
            expect: 1
          }
        ]
      }
    ]
  },
  {
    id: 'no-drm-broadcast',
    title: 'Skip the MIUI DRM broadcast at boot',
    description:
      'Removes the DrmBroadcast.broadcast() call from ActivityManagerServiceImpl.finishBooting.',
    targets: [
      {
        path: MIUI_SERVICES,
        verifiedSha256: MIUI_SERVICES_SHA,
        rules: [
          {
            kind: 'delete',
            cls: 'com/android/server/am/ActivityManagerServiceImpl',
            method: 'finishBooting()V',
            pattern:
              '\\n\\s*iget-object (v\\d+), p0, Lcom/android/server/am/ActivityManagerServiceImpl;->mContext:Landroid/content/Context;\\s*\\n(\\s*\\.line \\d+\\s*\\n)?\\s*invoke-static \\{\\1\\}, Lmiui/drm/DrmBroadcast;->getInstance\\(Landroid/content/Context;\\)Lmiui/drm/DrmBroadcast;\\s*\\n\\s*move-result-object \\1\\s*\\n(\\s*\\.line \\d+\\s*\\n)?\\s*invoke-virtual \\{\\1\\}, Lmiui/drm/DrmBroadcast;->broadcast\\(\\)V',
            expect: 1
          }
        ]
      }
    ]
  },
  {
    id: 'powerkeeper-gms',
    title: 'PowerKeeper: no cloud control, no GMS restriction',
    description:
      'Stops PowerKeeper from syncing Xiaomi cloud power policies, takes the international path in GmsObserver, reports GMS control as disabled, and returns 0 for the thermal display control code.',
    targets: [
      {
        path: 'system_ext/app/PowerKeeper/PowerKeeper.apk',
        verifiedSha256: 'c37003454c33edfbda7e8f6db143c5d138dc1801aa4bb5c1577f92d521663754',
        rules: [
          {
            kind: 'stub',
            cls: 'com/miui/powerkeeper/cloudcontrol/LocalUpdateUtils',
            method: 'startCloudSyncData(Landroid/content/Context;Z)V',
            returns: 'void'
          },
          {
            kind: 'stub',
            cls: 'com/miui/powerkeeper/feedbackcontrol/ThermalManager',
            method: 'getDisplayCtrlCode()I',
            returns: 0
          },
          {
            kind: 'force-sget',
            cls: 'com/miui/powerkeeper/utils/GmsObserver',
            method: '<init>(Landroid/content/Context;)V',
            field: BUILD,
            value: 1,
            expect: 1
          },
          {
            kind: 'force-sget',
            cls: 'com/miui/powerkeeper/utils/GmsObserver',
            method: 'updateGoogleSync(Z)V',
            field: BUILD,
            value: 1,
            expect: 1
          },
          {
            kind: 'force-return',
            cls: 'com/miui/powerkeeper/utils/GmsObserver',
            method: 'isGmsControlEnabled()Z',
            value: 0,
            expect: 1
          }
        ]
      }
    ]
  },
  {
    id: 'joyose-off',
    title: 'Neutralise Joyose performance and thermal tuning',
    description:
      'Points every /sys/ path Joyose writes to (CPU, GPU, thermal, FPS, game boost) at /gayos/, which does not exist, and stubs two background tasks.',
    targets: [
      {
        path: 'product/pangu/system/app/Joyose/Joyose.apk',
        verifiedSha256: 'cd710e5a9181d449d7d2a6aabb8d06f40706587618bc50b007298bf541d46609',
        rules: [
          { kind: 'string-replace', from: '/sys/', to: '/gayos/', expect: 121 },
          { kind: 'stub', cls: 'f/h$c', method: 'run()V', returns: 'void' },
          { kind: 'stub', cls: 'f/h$a', method: 'run()V', returns: 'void' },
          { kind: 'stub', cls: 'e0/c0', method: 'c2()Z', returns: 1 }
        ]
      }
    ]
  },
  {
    id: 'branding-about',
    title: 'ROM name in About phone',
    description: `Shows "<version> | <ROM name>" on the About phone version card and the device details page. The name comes from the ${BRAND_PROP} prop, so it can change without patching again. Only the two places that display the version are touched; the version strings other code parses stay as they are.`,
    targets: [
      {
        path: 'system_ext/priv-app/Settings/Settings.apk',
        verifiedSha256: '667d4f2b0c2e3aeb6c232fe229048f9917ae141969aaee243ccb70e3a320ef14',
        rules: [
          {
            kind: 'add-class',
            cls: BRAND_CLASS,
            nextTo: 'com/android/settings/device/MiuiVersionCard',
            smali: BRAND_SMALI
          },
          {
            kind: 'wrap-call',
            cls: 'com/android/settings/device/MiuiVersionCard',
            method: 'refreshVersionName()V',
            call: `L${ABOUT};->getSimpleOSVersion(Landroid/content/Context;)Ljava/lang/String;`,
            helper: BRAND_APPLY,
            expect: 1
          },
          {
            kind: 'wrap-call',
            cls: 'com/android/settings/device/MiuiMyDeviceDetailSettings',
            method: 'setVersionCode()V',
            call: `L${ABOUT};->addVersionSuffix(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;`,
            helper: BRAND_APPLY,
            expect: 1
          }
        ]
      }
    ]
  },
  {
    id: 'disable-secure-flag',
    title: 'Allow screenshots in apps that block them (FLAG_SECURE)',
    description:
      'OPTIONAL, off by default. Makes the window manager ignore FLAG_SECURE so screenshots and screen recording work everywhere, including banking and DRM apps. This removes a protection apps opt into to keep sensitive screens off recordings; turn it on only for your own device and know what it weakens. DRM video (Widevine L1) is not affected by this.',
    targets: [
      {
        path: SERVICES,
        verifiedSha256: SERVICES_SHA,
        rules: [
          {
            kind: 'stub',
            cls: 'com/android/server/wm/WindowState',
            method: 'isSecureLocked()Z',
            returns: 0
          }
        ]
      },
      {
        path: MIUI_SERVICES,
        verifiedSha256: MIUI_SERVICES_SHA,
        rules: [
          {
            kind: 'stub',
            cls: 'com/android/server/wm/WindowManagerServiceImpl',
            method: 'notAllowCaptureDisplay(Lcom/android/server/wm/RootWindowContainer;I)Z',
            returns: 0
          }
        ]
      }
    ]
  }
]

export function patchSet(id: string): PatchSet {
  const s = PATCH_SETS.find((p) => p.id === id)
  if (!s) throw new Error(`unknown patch set ${id}`)
  return s
}
