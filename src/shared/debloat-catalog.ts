// Debloat recommendations catalog, derived from the Universal Android Debloater
// Next Generation (UAD-ng) package lists (the data Canta uses), scoped to Xiaomi/MIUI
// packages plus every package present in the onyx base that UAD knows. 'removal' is UAD's
// safety tier; 'ad' flags built-in ad/recommendation/analytics bloat (prioritised for
// removal). Reference data only: no app is bundled, nothing is downloaded.
//
// Source: github.com/Universal-Debloater-Alliance/universal-android-debloater-next-generation

export type DebloatRemoval = 'recommended' | 'advanced' | 'expert' | 'unsafe'

export interface DebloatEntry {
  /** UAD safety tier: recommended = safe bloat, up to unsafe = may bootloop. */
  removal: DebloatRemoval
  /** Built-in ad / recommendation / analytics app: prioritised for removal. */
  ad: boolean
  /** One-line description of what the app is and the removal effect. */
  description: string
}

/** 361 packages. */
export const DEBLOAT_CATALOG: Record<string, DebloatEntry> = {
  android: {
    removal: 'unsafe',
    ad: false,
    description:
      'Android System Android system framework? Apk file name: framework-res Could be THE core of the android system. Probably very unsafe to disable.'
  },
  'android.ext.shared': {
    removal: 'unsafe',
    ad: false,
    description: 'Android Shared Library, removing may cause a bootloop.'
  },
  'android.miui.home.launcher.res': {
    removal: 'advanced',
    ad: false,
    description:
      "Config to default icons/placeholder widgets in MIUI launcher. It's used only first time run MIUI launcher app like com.mi.globallayout."
  },
  'android.miui.overlay': {
    removal: 'unsafe',
    ad: false,
    description:
      'Refers to a specific package within the MIUI overlay, The package contains various resources and components that are used to customize the appearance and behavior of the MIUI interface. https://source.android.com/docs/core/runtime/rros'
  },
  'android.miui.overlay.telephony': {
    removal: 'unsafe',
    ad: false,
    description:
      'Likely an important overlay for telephony services and com.android.providers.telephony, specific for devices running HyperOS/MIUI. Not safe to delete.'
  },
  'android.miui.poco.launcher.res': {
    removal: 'advanced',
    ad: false,
    description:
      "Config to default icons/placeholder widgets in MIUI launcher. It's used only first time run MIUI launcher app like com.mi.globallayout."
  },
  'cn.wps.moffice_eng.xiaomi.lite': {
    removal: 'recommended',
    ad: false,
    description: 'Chinese WPS Office'
  },
  'com.android.DeviceAsWebcam': {
    removal: 'advanced',
    ad: false,
    description:
      'Using smartphone as webcam. Dependency for Private space on Pixel devices. https://source.android.com/docs/security/features/private-space'
  },
  'com.android.apps.tag': {
    removal: 'advanced',
    ad: false,
    description:
      'Support for NFC tags interactions (5 permissions, Contacts/Phone On by default). NFC Tags are for instance used in buses to validate your transport card with your phone. Other example: https://en.wikipedia.org/wiki/TecTile You will still be able to connect to a NFC device (e.g a speaker) with this disabled.'
  },
  'com.android.avatarpicker': {
    removal: 'advanced',
    ad: false,
    description:
      'Lets you assign pictures to contacts. It has two options: take picture from the camera, or choose from the gallery. Source code: https://android.googlesource.com/platform/packages/apps/AvatarPicker'
  },
  'com.android.backupconfirm': {
    removal: 'expert',
    ad: false,
    description:
      'Restores Google settings with Google Backup restore. Displays confirmation popup when doing ADB backup. Disabling this package breaks ADB Backup.'
  },
  'com.android.bips': {
    removal: 'expert',
    ad: false,
    description:
      'Disabling this can cause Settings app to crash and general device slowness. Tested on Sony Xperia X, Fairphone 4 and Lenovo Yoga tab. Default Print Service. Generic printing service that should work with most printers. Will break printing functionality if disabled, but other replacement print services can be downloaded from the Play Store.'
  },
  'com.android.bluetoothmidiservice': {
    removal: 'advanced',
    ad: false,
    description:
      "Provides classes for using the MIDI protocol over Bluetooth. Safe to remove if you don't plan to connect MIDI devices."
  },
  'com.android.browser': {
    removal: 'advanced',
    ad: true,
    description:
      'Mi Browser and browser for the LDPlayer emulator You really should use something else. FYI https://www.xda-developers.com/xiaomi-mi-web-browser-pro-mint-collecting-browsing-data-incognito-mode/'
  },
  'com.android.calendar': {
    removal: 'advanced',
    ad: false,
    description:
      'AOSP Calendar app NOTE: Some OEMs (like Huawei & Xiaomi) use the same package name for their app.'
  },
  'com.android.calllogbackup': {
    removal: 'advanced',
    ad: false,
    description:
      'Call Logs Backup/Restore feature. Runs in the background. https://android.googlesource.com/platform/packages/providers/CallLogProvider/+/refs/heads/master/src/com/android/calllogbackup'
  },
  'com.android.camera': {
    removal: 'advanced',
    ad: false,
    description:
      'The stock AOSP camera app on many phones. However, on some Xiaomi phones, it is actually the Xiaomi Camera app. Deleting this will result in no camera app. Try Open Camera as an open source alternative: https://play.google.com/store/apps/details?id=net.sourceforge.opencamera&hl=en&gl=US'
  },
  'com.android.cameraextensions': {
    removal: 'advanced',
    ad: false,
    description:
      "CameraExtensionsProxy. Camera-related third-party apps can call Android camera extensions such as Portrait, Night Mode, and HDR, which doesn't seem to work significantly on MIUI. https://developer.android.com/media/camera/camera-extensions"
  },
  'com.android.captiveportallogin': {
    removal: 'advanced',
    ad: false,
    description:
      'Support for captive portal: https://en.wikipedia.org/wiki/Captive_portal A captive portal login is a web page where users have to log in or accept terms of use. Common for public wifi networks.'
  },
  'com.android.carrierconfig': {
    removal: 'advanced',
    ad: false,
    description:
      'Dynamically provides configuration for the carrier network. The config contains: Roaming networks, Voicemail settings, SMS/MMS settings, VoLTE/IMS settings, and more. If a carrier app is installed it will be queried for overrides to these settings. Seems to run on boot and when you swap SIM? https://source.android.com/devices/tech/config/carrier https://cs.android.com/android/platform/superproject/+/master:packages/apps/CarrierConfig/src/com/android/carrierconfig/DefaultCarrierConfigService.java'
  },
  'com.android.cellbroadcastreceiver': {
    removal: 'expert',
    ad: false,
    description:
      'Cell broadcast is designed to deliver messages to multiple users in an area. This is notably used by ISPs to send Emergency/Government alerts. Runs at boot time and is also triggered after exiting airplane mode. https://en.wikipedia.org/wiki/Cell_Broadcast https://www.androidcentral.com/amber-alerts-and-android-what-you-need-know https://android.googlesource.com/platform/packages/apps/CellBroadcastReceiver/+/refs/heads/master/src/com/android/cellbroadcastreceiver'
  },
  'com.android.cellbroadcastservice': {
    removal: 'expert',
    ad: false,
    description:
      'is designed to deliver messages to multiple users in an area. This is notably used by ISPs to send Emergency/Government alerts. Runs in the background. https://en.wikipedia.org/wiki/Cell_Broadcast https://www.androidcentral.com/amber-alerts-and-android-what-you-need-know'
  },
  'com.android.certinstaller': {
    removal: 'unsafe',
    ad: false,
    description:
      'Certificate installer Used for accepting and revoking Internet certificates. Certificates identify ownership of public keys, for use in secure communications. Breaks Wi-Fi if disabled.'
  },
  'com.android.companiondevicemanager': {
    removal: 'advanced',
    ad: false,
    description:
      "Companion Device Manager This handles connections to nearby (usually not remote) devices, desktop Operating Systems, etc... WARNING: removing this package may result in the inability to read the SD card from your computer's file manager (via USB)."
  },
  'com.android.contacts': {
    removal: 'advanced',
    ad: false,
    description:
      'AOSP Contacts Some OEMs(for example Xiaomi) use the same package name for their app.'
  },
  'com.android.credentialmanager': {
    removal: 'advanced',
    ad: false,
    description: 'Credential Manager Manages with Passwords, passkeys.'
  },
  'com.android.deskclock': {
    removal: 'advanced',
    ad: false,
    description:
      'AOSP Clock app Some OEMs (like Huawei & Xiaomi) use the same package name for their app.'
  },
  'com.android.devicediagnostics': {
    removal: 'advanced',
    ad: false,
    description: 'Device diagnostics and health check tools for Android devices.'
  },
  'com.android.dreams.basic': {
    removal: 'advanced',
    ad: false,
    description:
      'Daydream (not Google Daydream VR) is an interactive screensaver mode built into Android. With it turned on, it activates and shows the screensaver of your choice when you dock or charge your device. Can display the time, weather, quotes, photos, news, tweets, or anything else Daydream app developers can think of. https://developer.android.com/reference/android/service/dreams/DreamService'
  },
  'com.android.dynsystem': {
    removal: 'expert',
    ad: false,
    description:
      "Dynamic System Updates Runs on boot, but doesn't seem to run in the background beyond that. Treble gives the ability to boot an AOSP Generic System Image (GSI) on any supported device. Dynamic System Updates allows to boot into a Generic System Image (GSI) without interfering with the current installation. That means the bootloader doesn’t need to be unlocked and the user data doesn’t need to be wiped. https://developer.android.com/topic/dsu"
  },
  'com.android.egg': {
    removal: 'recommended',
    ad: false,
    description: "Android's easter egg feature (spam-tap on the android version in the settings)"
  },
  'com.android.email': {
    removal: 'recommended',
    ad: false,
    description:
      'Xiaomi closed-source email app based on the AOSP version. Really confusing package name.'
  },
  'com.android.emergency': {
    removal: 'advanced',
    ad: false,
    description:
      "Emergency rescue Shows emergency info on lockscreen and power menu. Safe to disable if you don't want it. Loads on device unlock/lockscreen and power menu, so it's basically always cached in RAM, but shouldn't use much/any battery, so the main thing gained from disabling this package is the ~9MB RAM it uses. Removing this will break Safety and Emergency in Settings and you will miss SOS alerts."
  },
  'com.android.externalstorage': {
    removal: 'expert',
    ad: false,
    description: 'Needed by apps to access external storage (like memory cards).'
  },
  'com.android.fileexplorer': {
    removal: 'advanced',
    ad: false,
    description:
      "Xiaomi/Mi File Explorer (Again it's a really poor choice for a package name considering it is not the AOSP File explorer) It's a Closed-source app based on the AOSP version."
  },
  'com.android.htmlviewer': {
    removal: 'expert',
    ad: false,
    description:
      'Allows apps to load URLs into the WebView, which allows web content to be displayed directly in the app. WARNING: Removing this causes a bootloop on some MIUI 12.5.4+ phones.'
  },
  'com.android.incallui': {
    removal: 'expert',
    ad: false,
    description:
      "Xiaomi Phone 11 Xiaomi's phone (dialer, incallui, etc.) app. Fetches APN lists on some phones. Package name is highly misleading."
  },
  'com.android.inputdevices': {
    removal: 'expert',
    ad: false,
    description:
      'Only contains a receiver named"Android keyboard", possibly for an external keyboard. Locates available keyboard layouts. Apps can offer additional keyboard layouts to the user by declaring a suitable broadcast receiver in their manifest. WARNING: If you are using the default Samsung keyboard, then deleting this package on some phones may cause the keyboard to completely stop working. You may get locked out of your phone if the only method to authenticate yourself is using password.'
  },
  'com.android.intentresolver': {
    removal: 'expert',
    ad: false,
    description:
      "'Share' functionality will be disabled after uninstalling this package on Android 14 and up. Additionally, motion photos will become broken."
  },
  'com.android.keychain': {
    removal: 'unsafe',
    ad: false,
    description:
      'Enables apps to use system wide credential KeyChain (shared credentials between apps) https://security.stackexchange.com/questions/216716/android-keychain-what-is-a-system-wide-credential'
  },
  'com.android.localtransport': {
    removal: 'unsafe',
    ad: false,
    description:
      'Backup transport for stashing stuff into a known location on disk, and later restoring from there. Needed for storing backup data locally on a device? This package also provides the backup confirmation UI. https://developer.android.com/guide/topics/data/testingbackup'
  },
  'com.android.location.fused': {
    removal: 'expert',
    ad: false,
    description:
      "Manages underlying location technologies, such as GPS and Wi-Fi. Uninstalling it may unlikely cause a bootloop, although, you probably shouldn't uninstall it unless you deleted Google Play Services, and don't have a GPS sensor."
  },
  'com.android.managedprovisioning': {
    removal: 'expert',
    ad: false,
    description:
      "Work Setup/Work profile setup Manages Android user account profiles. The typical use-case is setting up a corporate profile that is controlled by the employer on an employee's personal device, to keep personal and work data separate. https://support.google.com/work/android/answer/6191949? https://developers.google.com/android/work/requirements/work-profile Needed for sandbox's apps like Shelter/Island."
  },
  'com.android.mms': {
    removal: 'advanced',
    ad: false,
    description:
      'AOSP SMS app. Occasionally runs in the background. Some OEMs (like Huawei, Xiaomi, Vivo, Oppo) use the same package name for their app. QKSMS is a good FOSS replacement: https://f-droid.org/en/packages/com.moez.QKSMS/'
  },
  'com.android.modulemetadata': {
    removal: 'unsafe',
    ad: false,
    description:
      "It's used to manage and store metadata about installed modules, and is accessed by the system server. Breaks some core functionality if disabled."
  },
  'com.android.mtp': {
    removal: 'unsafe',
    ad: false,
    description:
      'MTP Host Handles MTP(Media Transfer Protocol), a protocol for transfering files between the device and a connected PC.'
  },
  'com.android.musicfx': {
    removal: 'advanced',
    ad: false,
    description:
      'Audio EQ(equalizer). Some 3rd-party music apps can use it to provide you EQ features.'
  },
  'com.android.nfc': {
    removal: 'expert',
    ad: false,
    description:
      'NFC Service Runs in the background as part of the System. I assume NFC breaks when disabled. Will probably run even if disabled, like most system packages. So disabling/uninstalling is probably pointless.'
  },
  'com.android.ons': {
    removal: 'expert',
    ad: false,
    description:
      "Opportunistic Network Service From what I can glean in the source code it seems like this provides a list of available networks and assigns each network a priority. I've never seen it run on its own, so this might be part of some automatic network switching setting that I have turned off. https://cs.android.com/android/platform/superproject/+/master:packages/services/AlternativeNetworkAccess/src/com/android/ons/OpportunisticNetworkService.java https://developer.android.com/reference/android/telephony/AvailableNetworkInfo https://cs.android.com/android/platform/superproject/+/master:frameworks/base/telephony/java/android/telephony/AvailableNetworkInfo.java"
  },
  'com.android.packageinstaller': {
    removal: 'unsafe',
    ad: false,
    description: 'Handles installation, upgrade, and removal of applications.'
  },
  'com.android.pacprocessor': {
    removal: 'expert',
    ad: false,
    description:
      "PAC (Proxy Auto-Config) is a file which defines how an app can automatically find the correct proxy server for fetching an URL. Should be safe to remove if you don't use Auto-proxy (with PAC file config) https://en.wikipedia.org/wiki/Proxy_auto-config"
  },
  'com.android.phone': {
    removal: 'expert',
    ad: false,
    description:
      'AOSP Dialer Removing this package breaks the software update/download and install screen on Samsung. WARNING: for me, it breaks the phone app completely with call routing enabled. Not sure about other cases.'
  },
  'com.android.printservice.recommendation': {
    removal: 'advanced',
    ad: true,
    description:
      'Recommends 3rd-party print services apps in the PlayStore. Printing will probably still works without (by using the default print service).'
  },
  'com.android.printspooler': {
    removal: 'expert',
    ad: false,
    description:
      'Print Spooler Manages the printing process. Runs on boot, but not beyond that. WARNING: Disabling breaks the connection preferences submenu in the settings app on most devices, but other than that it only breaks printing functionality and is safe to disable.'
  },
  'com.android.providers.blockednumber': {
    removal: 'expert',
    ad: false,
    description:
      'Handles blocked number storage. On some devices this seems to be tied to the recent apps menu (see https://gitlab.com/W1nst0n/universal-android-debloater/-/issues/6) Content providers encapsulate data, providing centralized management of data shared between apps. https://developer.android.com/guide/topics/providers/content-providers.html'
  },
  'com.android.providers.calendar': {
    removal: 'expert',
    ad: false,
    description:
      'Calendar Storage Necessary for the stock Calendar app to work correctly. Content providers encapsulate data, providing centralized management of data shared between apps. https://developer.android.com/guide/topics/providers/content-providers.html'
  },
  'com.android.providers.contactkeys': {
    removal: 'advanced',
    ad: false,
    description: 'Contact key manager for Android interactions.'
  },
  'com.android.providers.contacts': {
    removal: 'expert',
    ad: true,
    description:
      'Contacts Storage Provider for contact data. Content providers encapsulate data, providing centralized management of data shared between apps. https://developer.android.com/guide/topics/providers/content-providers.html Breaks contact functionality if disabled. Not recommended to disable if you plan to use your device as a phone. On POCO Pad M1, disabling this will cause Bluetooth to malfunction, turning on and off continuously.'
  },
  'com.android.providers.downloads': {
    removal: 'unsafe',
    ad: false,
    description:
      'Downloads Manager Provider for downloaded files. Content providers encapsulate data, providing centralized management of data shared between apps. https://developer.android.com/guide/topics/providers/content-providers.html'
  },
  'com.android.providers.downloads.ui': {
    removal: 'advanced',
    ad: true,
    description:
      "Downloads User interface for downloads. On some OEM's this app has ads, tracking things."
  },
  'com.android.providers.media': {
    removal: 'expert',
    ad: false,
    description:
      'Provider of media files (images, videos and such). Scans the device for media files and allows permitted apps access to them. Content providers encapsulate data, providing centralized management of data shared between apps. https://developer.android.com/guide/topics/providers/content-providers.html'
  },
  'com.android.providers.partnerbookmarks': {
    removal: 'recommended',
    ad: false,
    description: 'Provides bookmarks about partners of Google in Chrome.'
  },
  'com.android.providers.settings': {
    removal: 'unsafe',
    ad: false,
    description:
      'Provider for settings app data. Content providers encapsulate data, providing centralized management of data shared between apps. https://developer.android.com/guide/topics/providers/content-providers.html'
  },
  'com.android.providers.telephony': {
    removal: 'unsafe',
    ad: false,
    description:
      'Provider for telephony data. Handles phone-related data such as text messages, APN list, etc. Content providers encapsulate data, providing centralized management of data shared between apps. https://developer.android.com/guide/topics/providers/content-providers.html'
  },
  'com.android.providers.userdictionary': {
    removal: 'expert',
    ad: false,
    description:
      'Handles user dictionary for keyboard apps. Content providers encapsulate data, providing centralized management of data shared between apps. https://developer.android.com/guide/topics/providers/content-providers.html. WARNING: Removing this package may cause settings menu to crash on some Huawei phones'
  },
  'com.android.provision': {
    removal: 'unsafe',
    ad: false,
    description:
      "Provisioning is the process of setting up a network connection that will allow new users. This service is for example needed when the user's phone moves from one cell-tower to another."
  },
  'com.android.proxyhandler': {
    removal: 'expert',
    ad: false,
    description: "Handles proxy config. Safe to remove if you don't use a proxy."
  },
  'com.android.quicksearchbox': {
    removal: 'recommended',
    ad: false,
    description: 'Google quick search box. OEMs (e.g. Xiaomi) can modify this for their use.'
  },
  'com.android.se': {
    removal: 'expert',
    ad: false,
    description:
      'SecureElementApplication Runs in the background as part of the system. NOTE: ColorOS password lock requires this package. Underlying implementation for the OMAPI SE service. Enables apps to use the OpenMobile API to access secure elements(SE) to enable smart-card payments and other secure services. An SE is a special chip (e.g SIM-card) for storing cryptographic secrets in a way that makes illicit use hard. The Open Mobile Alliance (OPA) is a standards organization which develops open standards for the mobile phone industry.'
  },
  'com.android.server.telecom': {
    removal: 'unsafe',
    ad: false,
    description: 'Manages calls via your network provider or SIM and controls the phone modem?'
  },
  'com.android.settings': { removal: 'unsafe', ad: false, description: 'AOSP Settings app.' },
  'com.android.settings.intelligence': {
    removal: 'expert',
    ad: false,
    description:
      "Settings Suggestions Handles the search and suggestions features in the settings app. Disabling this package makes the Settings app crash when you tap on search. Doesn't run in the background, so there's little benefit in disabling. Uses location, nearby devices, notifications permissions by default https://gitlab.com/W1nst0n/universal-android-debloater/-/issues/51"
  },
  'com.android.sharedstoragebackup': {
    removal: 'advanced',
    ad: false,
    description:
      "Used during backup. Backs up the shared storage? (files accessible by every app with STORAGE permission) Things have changed with Android 10. Don't know if this package is still relevant for new phones. https://blog.mindorks.com/understanding-the-scoped-storage-in-android."
  },
  'com.android.shell': {
    removal: 'unsafe',
    ad: false,
    description:
      'Shell Unix shell that receives ADB commands sent from a PC. This is what UAD-ng uses to execute commands on Android devices. Probably a bad idea to disable ;)'
  },
  'com.android.simappdialog': {
    removal: 'expert',
    ad: false,
    description:
      "Sim App Dialog Creates a pop-up asking if the user wants to install the carrier app when a SIM is inserted. Seems to be event-triggered, i.e: doesn't run in the background. https://android.googlesource.com/platform/frameworks/base/+/master/packages/SimAppDialog/src/com/android/simappdialog/InstallCarrierAppActivity.java"
  },
  'com.android.smspush': {
    removal: 'advanced',
    ad: false,
    description:
      'This service is used to push/send specially formatted SMS messages that display an alert message to the user, and give them the option of connecting directly to a particular app. For instance, an SMS notifying the user of a new e-mail, with a URL link to connect directly to the e-mail app. https://web.archive.org/web/20200915164901/https://www.nowsms.com/doc/submitting-sms-messages/sending-wap-push-messages'
  },
  'com.android.soundpicker': {
    removal: 'expert',
    ad: false,
    description:
      'Google Sounds. Needed to pick up a phone ringtone. No weird permissions. Pithus analysis: https://beta.pithus.org/report/f5f7c265c6d98666c78267b91643bbfb635021d5d4f85c93407079ba4aad88ee'
  },
  'com.android.soundrecorder': {
    removal: 'advanced',
    ad: false,
    description:
      'AOSP Sound recorder OEMs often use their own solution NOTE: On some phones, Huawei & Xiaomi also use this package name for their own browser app.'
  },
  'com.android.statementservice': {
    removal: 'unsafe',
    ad: false,
    description:
      'Intent Filter Verification Service A Statement protocol allows websites to certify that some assets represent them. Android package can to subscribe to handling chosen URIs. This package will then be called to query the website and verify that it allows this. Android package can subscribe to handling chosen URIs. This package will then be called to query the website and verify that it allows this. Sources: - https://developer.android.com/reference/android/content/Intent - https://developer.android.com/guide/components/intents-filters - https://android.stackexchange.com/questions/191163/what-does-the-intent-filter-verification-service-app-from-google-do - https://github.com/google/digitalassetlinks/blob/master/well-known/details.md - https://android.googlesource.com/platform/frameworks/base/+/6a34bb2'
  },
  'com.android.stk': {
    removal: 'advanced',
    ad: false,
    description:
      'SIM toolkit Enables carriers to initiate"value-added services". Basically, some operators provide SIM-cards with applications installed on them. https://en.wikipedia.org/wiki/SIM_Application_Toolkit#cite_note-CellularZA-1 Has been abused: - SimJacker: https://thehackernews.com/2019/09/simjacker-mobile-hacking.html - WIBattack: https://www.zdnet.com/article/new-sim-card-attack-disclosed-similar-to-simjacker/ WARNING: do mind that disabling/uninstalling this package will break mobile identity management which could be used by apps (for example your Bank) to authenticate you. See https://en.wikipedia.org/wiki/Mobile_identity_management NOTE: removing this package removes the launcher icon. `com.android.stk` relies on `com.android.stk2` and vice-versa.'
  },
  'com.android.storagemanager': {
    removal: 'advanced',
    ad: false,
    description:
      'Storage manager (Maintenance/Storage panel in the settings) Clean up unused files, show size of files regrouped by categories...'
  },
  'com.android.systemui': {
    removal: 'unsafe',
    ad: false,
    description: "Everything you see in Android that's not an app. User interface of Android"
  },
  'com.android.systemui.accessibility.accessibilitymenu': {
    removal: 'recommended',
    ad: false,
    description:
      'Hidden menu that only shows 2 buttons: Large buttons - that increases size of accessibility menu buttons, and Help - that redirects to support google com site accessibility.'
  },
  'com.android.thememanager': {
    removal: 'advanced',
    ad: false,
    description:
      'MIUI Themes (manager) Xiaomi seems to love confusing package names. Lets you select and apply themes provided by Xiaomi. NOTE: Disabling will break the ability to change the lock-screen wallpaper and ringtones in the OEM clock app. Has a lot trackers. Running in the background.'
  },
  'com.android.traceur': {
    removal: 'recommended',
    ad: false,
    description:
      "System Tracing Recording device activity over a short period of time is known as system tracing. System tracing produces a trace file that can be used to generate a system report. Not useful if you're not a developer. https://developer.android.com/topic/performance/tracing"
  },
  'com.android.updater': {
    removal: 'expert',
    ad: false,
    description:
      "Mi Updater Provides system updates REMOVING THIS WILL BOOTLOOP YOUR DEVICE! Doesn't bootloop on MIUI 13 and above."
  },
  'com.android.vending': { removal: 'expert', ad: false, description: 'Google Play Store' },
  'com.android.vpndialogs': {
    removal: 'expert',
    ad: false,
    description:
      "Provide VPN support to Android https://en.wikipedia.org/wiki/Dialog_(software) Safe to remove if you don't plan to use a VPN."
  },
  'com.android.wallpaper.livepicker': {
    removal: 'advanced',
    ad: false,
    description:
      'Enables you to pick a live wallpaper. Removing it will break some weather applications (especially ones with widgets) and wallpaper applications like Muzei.'
  },
  'com.android.wallpaperbackup': {
    removal: 'advanced',
    ad: false,
    description:
      'Wallpaper Backup Backs up and restores wallpaper and metadata related to it. This agent has its own package because it does full backup as opposed to SystemBackupAgent which does key/value backup. This class stages wallpaper files for backup by copying them into its own directory because of the following reasons: Non-system users don\'t have permission to read the directory that the system stores the wallpaper files in BackupAgent enforces that backed up files must live inside the package\'s getFilesDir() There are 3 files to back up: The"wallpaper info" file which contains metadata like the crop applied to the wallpaper or the live wallpaper component name. The"system" wallpaper file. An optional"lock" wallpaper, which is shown on the lockscreen instead of the system wallpaper if set. On restore, the metadata file is parsed and WallpaperManager APIs are used to set the wallpaper. Note that if there\'s a live wallpaper, the live wallpaper package name will be part of the metadata file and the wallpaper will be applied when the package it\'s installed. https://android.googlesource.com/platform/frameworks/base/+/master/packages/WallpaperBackup/src/com/android/wallpaperbackup/WallpaperBackupAgent.java'
  },
  'com.android.wallpapercropper': {
    removal: 'advanced',
    ad: false,
    description: 'Wallpaper cropper.'
  },
  'com.android.wifi.dialog': {
    removal: 'unsafe',
    ad: false,
    description: 'Needed for wifi dialogs. Can brick basic functionality android.'
  },
  'com.baidu.input_mi': {
    removal: 'advanced',
    ad: false,
    description:
      'Baidu IME (Baidu keyboard) YOU SHOULD NEVER USE A CLOSED-SOURCE KEYBOARD ! https://www.techrepublic.com/blog/asian-technology/japanese-government-warns-baidu-ime-is-spying-on-users/ Archive : https://web.archive.org/save/https://www.techrepublic.com/blog/asian-technology/japanese-government-warns-baidu-ime-is-spying-on-users/ NOTE: Make sure you have installed another keyboard before removing this package.'
  },
  'com.bsp.catchlog': {
    removal: 'recommended',
    ad: false,
    description: 'bsp = Board support package Used to catch log files obviously.'
  },
  'com.duokan.phone.remotecontroller': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Remote Controller (https://play.google.com/store/apps/details?id=com.duokan.phone.remotecontroller) Control your electric appliances with your phone using Mi Remote.'
  },
  'com.duokan.reader': {
    removal: 'recommended',
    ad: true,
    description:
      'MIUIDuokanReader Chinese app that has too much tracking and ads. May be uninstalled without ADB.'
  },
  'com.fido.asm': {
    removal: 'advanced',
    ad: false,
    description:
      "FIDO UAF1.0 ASM Related to app fingerprint unlocking and payments. Safe to remove if you don't use password-less authentication to access online services."
  },
  'com.goodix.fingerprint.setting': {
    removal: 'recommended',
    ad: false,
    description:
      'In-Display Fingerprint test Hidden testing Fingerprint not available for normal users.'
  },
  'com.google.android.accessibility.switchaccess': {
    removal: 'recommended',
    ad: false,
    description:
      'Switch Access https://play.google.com/store/apps/details?id=com.google.android.accessibility.switchaccess&hl=en_US'
  },
  'com.google.android.configupdater': {
    removal: 'expert',
    ad: false,
    description:
      'Config Update Intents used to provide unbundled updates of system data. All require the UPDATE_CONFIG permission. Updates: - system wide certificate pins for TLS connections. - System wide Intent firewall. - List of permium SMS short codes. - List of carrier provisioning URLs. - Set of trusted logs used for Certificate Transparency support for TLS connections language detection model file - Smart selection model file - Conversation actions model file - Network watchlist config file - Intent action indicating that the updated carrier id config is available - The emergency number database into the devices - An integer to indicate the numeric version of the new data -- devices should only install if the update version is newer than the current one - Hash of the database, which is encoded by base-16 SHA512. https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/os/ConfigUpdate.java'
  },
  'com.google.android.documentsui': {
    removal: 'unsafe',
    ad: false,
    description:
      'Occasionally runs in the background. File selector for other apps. Storage Access Framework (SAF) will break if this is disabled.'
  },
  'com.google.android.ext.shared': {
    removal: 'unsafe',
    ad: false,
    description:
      "Android Shared Library. Maybe people thinking it's safe to remove or it's useless because it's empty. but it cause bootloop on my miui 14."
  },
  'com.google.android.gms': {
    removal: 'expert',
    ad: false,
    description:
      'Google Play Services GMS = Google Mobile Services. It is a layer that sits on top of the OS and provides a lot of proprietary Google APIs, giving apps access to various Google Services, such as:"fused"-location (internet and GPS chip), QR Code scanner, 2FA, G-Drive storage, Firebase API, Cloud Messaging, etc... If you remove it, all the apps relying on it will either: - detect the lack of Play-Services and refuse to run - detect the lack of Play-Services but allow you to run (improperly) by dismissing an annoying popup Removing Google Play Services can boot-loop some devices, so be careful. Disabling this package will improve battery life significantly, as it always runs in the background. IMPORTANT: You need to uncheck"Find My Device" from the"Device admin apps" settings panel to be able to disable this package. Search"admin" in the Settings-app search bar, or go to the Security category.'
  },
  'com.google.android.gms.location.history': {
    removal: 'recommended',
    ad: false,
    description:
      'Google Location History This app has nothing in the code. Only png logo google and name.'
  },
  'com.google.android.gms.policy_sidecar_aps': {
    removal: 'advanced',
    ad: false,
    description:
      "Not sure what purpose it has, but it gets some network and phone data and connects to some Google domains, but never on its own; it has no permissions and never runs on its own, it likely exists as a helper package for other Google services. Doesn't seem to exist in newer versions of Android; it's not in Android 11, but it is in 9. Needs a Google Account and Google Play Services to work. Given its name it could be related to Android auto? Seems safe to remove, noticed no breakage (didn't test Android Auto tho). https://beta.pithus.org/report/60835b97f38d9e64d4f554a73dab71c892153486a8e0fd81461c3d85359d9fae"
  },
  'com.google.android.gsf': {
    removal: 'expert',
    ad: true,
    description:
      "Google Services Framework Supports the Play Services application in application updates, user authentication, location services, user searches & more. https://android.stackexchange.com/questions/216176/what-is-the-exact-functionality-of-google-play-services-google-services-framew https://stackoverflow.com/questions/37337448/what-is-the-difference-between-google-service-frameworkgsfgoogle-mobile-servi Same recommendation as com.google.android.gms except I've never seen a bootloop because of deleting this package."
  },
  'com.google.android.marvin.talkback': {
    removal: 'advanced',
    ad: false,
    description:
      'Android Accessibility Suite (https://play.google.com/store/apps/details?id=com.google.android.marvin.talkback) Helps blind and visually impaired users. WARNING: Causes com.motorola.dynamicvolume to not display individual apps and their respective volumes when volume button pressed. Seems to revert to an older (maybe testing) version of the dynamicvolume pkg?'
  },
  'com.google.android.onetimeinitializer': {
    removal: 'recommended',
    ad: false,
    description: 'Provides first time setup, safe to remove.'
  },
  'com.google.android.printservice.recommendation': {
    removal: 'advanced',
    ad: true,
    description:
      'I think this has to do with recommending a printservice app you can get from the Play store. I think printing still works with this off.'
  },
  'com.google.android.webview': {
    removal: 'expert',
    ad: false,
    description:
      'Android System WebView (https://play.google.com/store/apps/details?id=com.google.android.webview) enables Android apps to display web content within the app itself, based on Chrome. If you delete WebView, make sure to install a replacement. Many third-party apps, such as banks, VPNs, GitHub, Discord and Reddit use web-based content and will crash without it. It can cause notifications problems'
  },
  'com.iflytek.inputmethod.miui': {
    removal: 'advanced',
    ad: false,
    description: 'Chinese Keyboard to Miui China'
  },
  'com.jiiov.fingerprint_factorytest': {
    removal: 'recommended',
    ad: false,
    description:
      "A factory test app for Jiiov fingerprint scanners (Jiiov fingerprint scanners are mostly used on devices such as Xiaomi, Redmi, POCO, etc..). Mostly not needed for daily phone use, might be needed in service centers during repair or when you'll want to test your fingerprint scanner. Not sure how to even access it."
  },
  'com.lbe.security.miui': {
    removal: 'unsafe',
    ad: false,
    description: 'Permission manager Lets you monitor apps permission requests.'
  },
  'com.mfashiongallery.emag': {
    removal: 'recommended',
    ad: true,
    description: 'Wallpapers by Xiaomi'
  },
  'com.mi.health': {
    removal: 'recommended',
    ad: false,
    description:
      'Heart Rate Hidden app, not available for users. https://www.reddit.com/r/Xiaomi/comments/v0uhhx/found_hidden_heart_rate_app_in_miui_1304_i_opened/ In HyperOS, this app is deprecated and there are no hidden activities like in miui 14: https://www.apkmirror.com/apk/xiaomi-inc/mi-health/mi-health-1-0-6-release/mi-health-1-0-6-android-apk-download/'
  },
  'com.milink.service': {
    removal: 'advanced',
    ad: false,
    description:
      "UniPlay Service MIUI screen casting service. If removed, you'll have to use Android's native casting services which can be accessed through a 3rd party app."
  },
  'com.mipay.wallet': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Pay (https://play.google.com/store/apps/details?id=com.mipay.in.wallet) Contactless NFC-based mobile payment system that supports credit, debit and public transportation cards in China. https://www.mi-pay.com/ # .in = Mi Pay for India .id = My Pay for Indonesia'
  },
  'com.miui.accessibility': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Ditto Accesibility feature. Dictation (TTS) and speech output, making mobile devices more convenient for people who have difficulties using conventionally designed smartphones.'
  },
  'com.miui.analytics': {
    removal: 'recommended',
    ad: true,
    description:
      "Xiaomi Analytics This app is shady. According to a guy who tried to reverse engineer the app, Xiaomi Analytics can replace any (signed?) package they want silently on your device within 24 hours. Maybe that no longer the case now but... you don't want analytics anyway. Source : http://blog.thijsbroenink.com/2016/09/xiaomis-analytics-app-reverse-engineered/"
  },
  'com.miui.android.fashiongallery': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Wallpaper Carousel (https://play.google.com/store/apps/details?id=com.miui.android.fashiongallery) A lockscreen customization app. Displays a new photo every on your lock screen every time you turn ON your screen.'
  },
  'com.miui.antispam': {
    removal: 'recommended',
    ad: true,
    description:
      'MIUI Antispam spam phone numbers filter (blacklist). Suspicious analytics inside and has access to internet. Cloud backup possible. At quick glance it is not a private antispam app. Can someone check what data are collected/transfered?'
  },
  'com.miui.aod': {
    removal: 'advanced',
    ad: false,
    description:
      'Always-on display and Lock screen editor Safe to remove if you don\'t use"Always-on display" and"Lock screen editor" features in settings. Required for the fingerprint scanner if you want without double-tapping or pressing the power button.'
  },
  'com.miui.audioeffect': {
    removal: 'recommended',
    ad: false,
    description:
      'AudioEffect from Xiaomi (https://developer.android.com/reference/android/media/audiofx/AudioEffect) Used by the equalizer (to be confirmed)'
  },
  'com.miui.audiomonitor': {
    removal: 'advanced',
    ad: false,
    description:
      'Recording Assistant. Voice Call Recorder (only in MIUI dialer app). Unused on Global, EEA MIUI'
  },
  'com.miui.backup': {
    removal: 'recommended',
    ad: false,
    description:
      'MIUI Backup Local Backup/Restore feature (Settings > Additional Settings > Local backups) It seems this app can communicate with Mi Drop This app has 73 permissions and can obviously do everything it wants.'
  },
  'com.miui.bugreport': {
    removal: 'recommended',
    ad: false,
    description: 'Mi Feedback Used to send bug report to devs'
  },
  'com.miui.calculator': {
    removal: 'recommended',
    ad: false,
    description:
      'MIUI Calculator (https://play.google.com/store/apps/details?id=com.miui.calculator)'
  },
  'com.miui.carlink': {
    removal: 'recommended',
    ad: false,
    description: 'CarWith Not supported for most cars and only Chinese.'
  },
  'com.miui.carrierinstructions': {
    removal: 'recommended',
    ad: false,
    description: "Manual Shortcut to the carrier's online manual."
  },
  'com.miui.catcherpatch': {
    removal: 'recommended',
    ad: false,
    description: 'Needed for Application Extension Service (com.miui.contentcatcher).'
  },
  'com.miui.cit': {
    removal: 'recommended',
    ad: false,
    description:
      'Hardware tests Secret codes (https://web.archive.org/web/20220520051328/https://twitter.com/fs0c131y/status/933037531066785797). Lets you run hardware tests. https://c.mi.com/thread-1744085-1-0.html'
  },
  'com.miui.cleaner': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Cleaner Shady Xiaomi cleaner app developed by Cheetah mobile which has previously been caught in ad fraud and user data theft with this app in 2018 (previously called com.miui.cleanmaster and banned from the PlayStore). This"new" app is still full of trackers https://www.gadgets360.com/apps/news/banned-security-app-clean-master-by-cheetah-mobile-collected-user-private-data-report-2189633 Pithus analysis: https://beta.pithus.org/report/f7f7ee425a8dc928db75105bd8f52e9b02f11dec3b398aac9fef1d42809d8ec1'
  },
  'com.miui.cleanmaster': {
    removal: 'recommended',
    ad: false,
    description:
      "Mi Cleaner Shady Xiaomi cleaner app developed by Cheetah mobile which has previously been caught in ad fraud and user data theft in 2018. The app has been banned from the PlayStore and then reintroduced under the package name 'com.miui.cleaner'. https://www.gadgets360.com/apps/news/banned-security-app-clean-master-by-cheetah-mobile-collected-user-private-data-report-2189633"
  },
  'com.miui.cloudbackup': {
    removal: 'recommended',
    ad: false,
    description: 'Mi Cloud backup Needed for Xiaomi cloud backup.'
  },
  'com.miui.cloudservice': {
    removal: 'recommended',
    ad: false,
    description:
      'Dependency for synchronizing data with Xiaomi Cloud, including photos, contacts, messages, etc. This feature is essential for Xiaomi phone users in China, as Xiaomi Cloud is their primary cloud storage service.'
  },
  'com.miui.cloudservice.sysbase': {
    removal: 'recommended',
    ad: false,
    description: 'Another Mi Cloud dependency'
  },
  'com.miui.compass': {
    removal: 'recommended',
    ad: false,
    description: 'Mi Compass I think you understand its purpose...'
  },
  'com.miui.contentcatcher': {
    removal: 'recommended',
    ad: false,
    description:
      "Application Extension Service It's a password manager in settings, requires Mi Account to Autofill and it syncs to your account."
  },
  'com.miui.contentextension': {
    removal: 'recommended',
    ad: false,
    description:
      "Taplus It's disabled on default in settings. It allows you to analyze images and text by pressing and holding items on your screen to get contextual info."
  },
  'com.miui.core': {
    removal: 'expert',
    ad: true,
    description:
      "MIUI SDK It is obiously needed for MIUI to work correctly. FYI, it manages the MIUI Analytics service (`tracking.miui.com`), autoinstall MIUI apps updates (?). Related to GetApps 'com.xiaomi.market' China Mi App Store), DropboxManager where is temp clean code, a lot of logs. Found things related to Quick Apps 'com.miui.hybrid', DataUpdateManager (related to micloud?). Telocation update, app looks like tracking everything. Can be disabled and uninstalled with MIUI 13.0.6, MIUI 14, see https://github.com/0x192/universal-android-debloater/issues/632 NOTE: uninstalling this package causes the Settings app to crash when searching in Settings, so better disable this app instead. If you want to test, disable this app and open an issue if anything isn't working. Another weird thing is normal user can disable this app using hidden Settings to manage app by in Google Play. No effects after disable, but not sure if its required for Miui updates or gestures."
  },
  'com.miui.core.internal.assistant': {
    removal: 'recommended',
    ad: false,
    description: 'Needed for Chinese Mi AI (com.miui.voiceassist).'
  },
  'com.miui.core.internal.editor.services': {
    removal: 'expert',
    ad: false,
    description:
      "I only found: config_enableHapticTextHandle true What is this mean? it's used to permission MIUIOP 10008 in some apps. MIUIOP = miui optimization? it's useless or important? No effects after removing, it's probably a feature of Touch Assistant, but its used on 'com.miui.core'?"
  },
  'com.miui.core.internal.services': {
    removal: 'expert',
    ad: false,
    description:
      "I only found: array name= config_deviceSpecificSystemServices item: com.miui.me.server.auto_install.InstallService What does this mean? I have to check com.miui.core what it does and it's for autoinstall miui apps updates from GetApps 'com.xiaomi.market'."
  },
  'com.miui.cotaservice': {
    removal: 'advanced',
    ad: false,
    description:
      "MIUI's COTA (Configuration Over-The-Air) service. Pretty much the same as com.google.configupdater but for miui services. Unlike google's config updater, it constantly connects to the web and sends/receives data from an unknown source. Might cause obscure issues with telephony and Xiaomi services. Safe to delete if you've deleted all Xiaomi services like Xiaomi Cloud, GetApps, xmsf, etc... and !!! have logged out of your Xiaomi Account !!! Pretty much all is same as with com.google.configupdater. Deleting it on HyperOS 2.0 causes no issues."
  },
  'com.miui.daemon': {
    removal: 'recommended',
    ad: false,
    description:
      'MIUI daemon Collects a lot of data and sends them to China. See: https://web.archive.org/web/20210923050136/https://twitter.com/fs0c131y/status/938872347087564800'
  },
  'com.miui.easygo': {
    removal: 'recommended',
    ad: false,
    description: "For me, this app means nothing. A lot of useless code that you can't use."
  },
  'com.miui.enbbs': {
    removal: 'recommended',
    ad: false,
    description: 'Xiaomi Forums old package. Now com.mi.global.bbs.'
  },
  'com.miui.euicc': {
    removal: 'advanced',
    ad: false,
    description:
      "The LPA app that is constantly running in background, consuming RAM and battery. This app is the core of all the eSIM services on Xiaomi devices, runs and drains resources even if you have no eSIM. Constantly being found in running processes list. No issues appeared after removing it on HyperOS 2.0 and using it for over a month. Telephony and all settings stayed intact, worth deleting this if you don't use an eSIM."
  },
  'com.miui.extraphoto': {
    removal: 'recommended',
    ad: false,
    description:
      "Bokeh The document mode of the Xiaomi camera (for taking IDs), deleting it doesn't affect the editing of albums."
  },
  'com.miui.face': {
    removal: 'advanced',
    ad: false,
    description: 'MIUI Biometric Face Unlock feature'
  },
  'com.miui.face.overlay.miui': {
    removal: 'advanced',
    ad: false,
    description: 'MiuiBiometricResOverlay Face Unlock feature will be unavailable.'
  },
  'com.miui.fm': { removal: 'recommended', ad: false, description: 'MIUI FM Radio app' },
  'com.miui.fmservice': {
    removal: 'recommended',
    ad: false,
    description: 'FM Radio Service Needed by com.miui.fm to work correctly'
  },
  'com.miui.freeform': {
    removal: 'advanced',
    ad: false,
    description:
      'Floating window I think the name of the app is pretty straightforward You can make apps appear above other applications https://forum.xda-developers.com/android/miui/floating-windows-miui-12-t4125661 On some phones even if you uninstalled it, floating window still works.'
  },
  'com.miui.gallery': {
    removal: 'advanced',
    ad: false,
    description:
      'MIUI Gallery app. Note: Removing the Gallery will break the send screenshot feature (swipe 3 fingers to show the screenshot preview). It has several trackers and sometimes connects to micloud, even if the account is not added.'
  },
  'com.miui.global.packageinstaller': {
    removal: 'expert',
    ad: false,
    description:
      'MIUI Package Installer. Provides sideload apps virus checker when installing APKs. Removal causes bootloop on Xiaomi.EU custom ROMs. Use the built-in com.android.packageinstaller instead.'
  },
  'com.miui.greenguard': {
    removal: 'recommended',
    ad: false,
    description:
      'Security Guard Service The app includes three different antivirus brands built in that the user can choose from to keep their phone protected: Avast, AVL, and Tencent. Upon selecting the app, the user selects one of these providers as the default Anti-Virus engine to scan the device. It the app that scans an app before installing it NOTE : A vulnerability was found in 2019 : https://research.checkpoint.com/2019/vulnerability-in-xiaomi-pre-installed-security-app/'
  },
  'com.miui.guardprovider': {
    removal: 'advanced',
    ad: false,
    description:
      "Guard Provider security app The app includes 3 different antivirus brands built in that the user can choose (Avast, AVL and Tencent). This app notably performs a virus scan of any apps you want to install. A serious vulnerability was found in 2019 Worth reading : https://research.checkpoint.com/2019/vulnerability-in-xiaomi-pre-installed-security-app/ You may want to remove this app from a privacy stance. https://beta.pithus.org/report/797a7e405bc8e767deebbbcab3e06a19b05156de44292c918b582dff3078d7b8 IMPORTANT NOTE: Removing this package will very likely break any app installation/update. Before removing, disable security things in MIUI security app. On HyperOS this module is responsible for showing the 'Install via USB' prompt when installing apps via ADB (enabled through developer options, requires Mi account the first time). On MIUI 12, it broke app installation from APKs, and made app installation from Google Play be 2-5 minutes long. Apps were uninstallable properly though."
  },
  'com.miui.home': {
    removal: 'expert',
    ad: false,
    description:
      "MIUI System Launcher It's basically the home screen, the way icons and apps are organized and displayed. Note: If you remove this package on devices based on MIUI 12+ with Android 11+, you will lose navigation gestures and recent apps view EVEN with a 3rd party launcher... https://web.archive.org/web/20220926221620/https://libreddit.spike.codes/r/Xiaomi/comments/o6vk5z/miui_12125_and_android_11_gestures/ DON'T REMOVE THIS IF YOU DIDN'T INSTALL ANOTHER LAUNCHER!"
  },
  'com.miui.huanji': {
    removal: 'recommended',
    ad: false,
    description:
      "Mi Mover (https://play.google.com/store/apps/details?id=com.miui.huanji) Lets you transfer your contacts, messages, personal files, all the installed apps (but not it's data). Also all the settings (app + system) from an Android phone to a Xiaomi phone. The two phones will establish a direct Wi-Fi connection."
  },
  'com.miui.hybrid': {
    removal: 'recommended',
    ad: true,
    description:
      "Quick Apps It's basically an app which shows you ads and tracks you... Funny thing, Xiaomi's Quick Apps was reportedly being blocked by Google Play Protect. https://www.androidpolice.com/2019/11/19/xiaomi-quick-apps-flagged-blocked-google-play-protect/ # Reverse engineering of the app : https://medium.com/@gags.gk/reverse-engineering-quick-apps-from-xiaomi-a1c9131ae0b7 Spoiler : you really should delete this package."
  },
  'com.miui.hybrid.accessory': {
    removal: 'recommended',
    ad: true,
    description:
      'Xiaomi Hybrid Accessory Smartphone accessories support for Quick Apps (com.miui.hybrid)'
  },
  'com.miui.klo.bugreport': {
    removal: 'recommended',
    ad: false,
    description:
      'KLO Bugreport This app registers system failures and Android applications errors and sends bugs to Xiaomi servers.'
  },
  'com.miui.maintenancemode': {
    removal: 'recommended',
    ad: false,
    description:
      'Maintenance Mode The maintenance mode of the cell phone, the cell phone maintenance time into an empty user data system mode, to ensure the safety of cell phone data. Also has child mode. Not useful if you are not in China.'
  },
  'com.miui.mediaeditor': {
    removal: 'advanced',
    ad: false,
    description:
      "Xiaomi Gallery Editor Extension for MIUI Gallery that's used to edit photos and videos."
  },
  'com.miui.mediafeature': {
    removal: 'recommended',
    ad: false,
    description: 'MediaFeature合集 Is this something for media? Unused app, probably for China.'
  },
  'com.miui.mediaviewer': {
    removal: 'advanced',
    ad: false,
    description: 'Media viewer Old? Mi Video.'
  },
  'com.miui.metoknlp': {
    removal: 'recommended',
    ad: true,
    description: 'Network location provider Useless, only for China, have analytics things.'
  },
  'com.miui.micloudsync': {
    removal: 'recommended',
    ad: false,
    description:
      'Dependency for synchronizing data with Xiaomi Cloud, including photos, contacts, messages, etc. This feature is essential for Xiaomi phone users in China, as Xiaomi Cloud is their primary cloud storage service.'
  },
  'com.miui.miinput': {
    removal: 'advanced',
    ad: false,
    description: 'Removing this package breaks"Gesture shortcuts" under"Additional settings".'
  },
  'com.miui.miservice': {
    removal: 'recommended',
    ad: false,
    description:
      "Services & feedback Used to send feedbacks (and data) to Xiaomi. Integration in Wechat Seems to be able to launch 'Baidu location service' Has too many permissions, runs in the background all the time and can be removed without issue."
  },
  'com.miui.mishare.connectivity': {
    removal: 'advanced',
    ad: false,
    description:
      'Mi Share Unified file sharing service between Xiaomi, Oppo, Realme and Vivo devices using Wifi-direct Settings -> Connection & sharing -> Mi Share FYI : Wifi direct allows 2 devices to establish a direct Wi-Fi connection without requiring a wireless router.'
  },
  'com.miui.misightservice': {
    removal: 'recommended',
    ad: true,
    description:
      "Telemetry and diagnostics collector app that sends analytics to Xiaomi servers and has almost no use for user. Something on the level of com.miui.msa or com.miui.daemon. Worth deleting. Constantly connects somewhere and sends/receives up to 100KB of data per day to/from an unknown source. This also means it often runs in background. It's labeled as Blur and has orange-white MI icon, but it just hides under it. No blur/ui/any other issues seen after around a month of use of HyperOS 2.0 with this removed."
  },
  'com.miui.misound': {
    removal: 'advanced',
    ad: false,
    description:
      "Earphones (it's the name of the app) Provides the sounds section in Settings and is needed for the equalizing and the per app mixer feature Some people removed this package but I personaly don't think it's worth it. This package isn't really an issue (no dangerous permissions and does not run in the background all the time) You can still remove it. You'll be just fine if you really don't need it."
  },
  'com.miui.miwallpaper': {
    removal: 'expert',
    ad: false,
    description:
      'Mi Wallpaper app, causes a lot of UI damage when removed, but not bootloop. Removing this makes it impossible to set a lock or home screen wallpaper, resulting in a black solid wallpaper everywhere. Note: it may also result in longer boot times (~+10s) because the system tries to call Mi Wallpaper during boot. On HyperOS 2.0, The fingerprint outline disappears on lock screen after removing this. The fingerprint recognicion itself works properly. Everything in the status bar is becoming colored black on the lock screen after removing this, and you can only see the battery color. Elsewhere the status bar is colored properly. On HyperOS 2.0, you will have to remove this package and reboot 3-5 times. It constantly restores itself after each reboot until around 3rd-5th attempt. It vanishes fully only around 3-5 attempts. On HyperOS 2.0, the default color for system icons is also being reset to brown after removing this package. Similar behavior to as described here might also be observed on other devices.'
  },
  'com.miui.miwallpaper.config.overlay': {
    removal: 'advanced',
    ad: true,
    description:
      'Another overlay for com.miui.miwallpaper. Since all other overlays related to it are listed in recommended and marked as useless empty apps, this one is most likely the same.'
  },
  'com.miui.miwallpaper.earth': {
    removal: 'recommended',
    ad: false,
    description: 'SuperWallpaperEARTH / SuperWallpaperMARS Live/animated Xiaomi wallaper'
  },
  'com.miui.miwallpaper.mars': {
    removal: 'recommended',
    ad: false,
    description: 'SuperWallpaperEARTH / SuperWallpaperMARS Live/animated Xiaomi wallaper'
  },
  'com.miui.miwallpaper.overlay': {
    removal: 'advanced',
    ad: false,
    description:
      "App that doesn't do anything, no code. Safe to remove. You will need to remove it twice."
  },
  'com.miui.miwallpaper.overlay.customize': {
    removal: 'advanced',
    ad: false,
    description: "App that doesn't do anything, no code. Safe to remove."
  },
  'com.miui.miwallpaper.overlay.lundun': {
    removal: 'advanced',
    ad: false,
    description:
      'app that doesnt do anything, no code. Safe to remove. You will need remove it 2 times.'
  },
  'com.miui.miwallpaper.overlay.qr': {
    removal: 'advanced',
    ad: false,
    description: 'Useless app to default lock wallpaper path? Probably unused. Safe to remove.'
  },
  'com.miui.miwallpaper.telcel.overlay': {
    removal: 'advanced',
    ad: false,
    description: 'Useless app to telcel wallpaper? Probably unused. Safe to remove.'
  },
  'com.miui.msa.global': {
    removal: 'recommended',
    ad: true,
    description:
      'Main System Ads Analyzation of user behaviors to show you ads. Yeah Xiaomi phones has ads... https://www.theverge.com/2018/9/19/17877970/xiaomi-ads-settings-menu-android-phones'
  },
  'com.miui.newhome': {
    removal: 'recommended',
    ad: true,
    description: 'Content Service A lot bloated. Only useful in China.'
  },
  'com.miui.newmidrive': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Drive (Chinese version) Lets you upload and sync your files on the (Mi) Cloud. Always run in background'
  },
  'com.miui.nextpay': {
    removal: 'recommended',
    ad: false,
    description: 'Smart cards Web Extension Only for Chinese.'
  },
  'com.miui.notes': { removal: 'recommended', ad: false, description: 'Mi Notes' },
  'com.miui.notification': {
    removal: 'expert',
    ad: true,
    description:
      'Notifications are working without this app. It is possible to access the app notification settings by long pressing on the notification without the app. However notification settings in the settings menu will be broken without this package. The app is mandatory to enable notifications of apps that have been disabled before. Note: embeds a tracking statistics service (usage tracking : `id`,`pkgName`,`latestSentTime`,`sentCount`,`avgSentDaily`,`avgSentWeekly)'
  },
  'com.miui.otaprovision': {
    removal: 'recommended',
    ad: true,
    description: 'OtaProvision Useless, only for China, have analytics things.'
  },
  'com.miui.packageinstaller': {
    removal: 'advanced',
    ad: false,
    description:
      "Package installer Hardcoded in Xiaomi China Rom. Causes BOOTLOOP on Chinese ROM When remove. It's weird when after a month this app is gone from my phone for no reason and Android enabled stock package installer."
  },
  'com.miui.permissioncontroller.overlay': {
    removal: 'unsafe',
    ad: false,
    description:
      'Presumably a MIUI/HyperOS overlay for com.gooogle.android.permissioncontroller. Not safe to delete.'
  },
  'com.miui.personalassistant': {
    removal: 'recommended',
    ad: false,
    description:
      'Seems to be App Vault on some phones (https://play.google.com/store/apps/details?id=com.mi.android.globalpersonalassistant) https://c.mi.com/thread-1017547-1-0.html'
  },
  'com.miui.phone.carriers.customized.overlay': {
    removal: 'recommended',
    ad: false,
    description:
      'Something about WiFi calling"vowifi","volte","notification on keyguard" It\'s unused.'
  },
  'com.miui.phone.carriers.overlay': {
    removal: 'recommended',
    ad: false,
    description: "Preferred network type to Vodafone 5G/4G/3G/2G auto. It's unused."
  },
  'com.miui.phone.carriers.overlay.h3g': {
    removal: 'recommended',
    ad: false,
    description: "Preferred network type to h3g 5G/4G/3G/2G auto. It's unused."
  },
  'com.miui.phone.carriers.overlay.vodafone': {
    removal: 'recommended',
    ad: false,
    description: "Preferred network type to Vodafone 5G/4G/3G/2G auto. It's unused."
  },
  'com.miui.phrase': {
    removal: 'recommended',
    ad: false,
    description:
      'Frequent Phrases This adds a button next to paste on input fields containing a list of phrases you can edit and paste at any time. In any case it has access to internet, is linked to MiCloud and contains a weird CloudTelephonyManager java class in the code.'
  },
  'com.miui.player': {
    removal: 'recommended',
    ad: true,
    description: 'Mi Music (https://play.google.com/store/apps/details?id=com.miui.player)'
  },
  'com.miui.powerkeeper': {
    removal: 'expert',
    ad: false,
    description:
      "Battery and Performance (aggressive) MIUI power management (https://dontkillmyapp.com/xiaomi) That's a weird app that also contains a DRM Manager and a service related to Cloud Backup Has obviously a lot of dangerous permissions. I guess removing this package will decrease the battery performance. Is it that noticeable? Can someone try? NOTE: REMOVING THIS PACKAGE CAUSES A BOOTLOOP ON THE REDMI PAD. To not get bootloop, log out from Mi Account."
  },
  'com.miui.privacycomputing': {
    removal: 'recommended',
    ad: false,
    description:
      "MIUI Privacy Components Unknown app from Miui China. There's something about keys, key status code."
  },
  'com.miui.providers.weather': {
    removal: 'recommended',
    ad: false,
    description:
      'Provider for MI Weather app (com.miui.weather) Content providers encapsulate data, providing centralized management of data shared between apps. https://developer.android.com/guide/topics/providers/content-providers.html'
  },
  'com.miui.qr': { removal: 'recommended', ad: false, description: 'MUI Qr code scanner' },
  'com.miui.rom': {
    removal: 'unsafe',
    ad: false,
    description: 'Core package of MIUI DO NOT REMOVE THIS'
  },
  'com.miui.safetycenter.config.overlay': {
    removal: 'expert',
    ad: false,
    description:
      'An overlay for com.miui.safetycenter providing configurations and preferences. Safe to delete if com.miui.safetycenter is removed.'
  },
  'com.miui.safetycenter.res.overlay': {
    removal: 'expert',
    ad: false,
    description:
      'An overlay for com.miui.safetycenter providing resources and preferences. Safe to delete if com.miui.safetycenter is removed.'
  },
  'com.miui.screenrecorder': {
    removal: 'recommended',
    ad: false,
    description: 'Mi Screen Recorder'
  },
  'com.miui.screenshot': {
    removal: 'expert',
    ad: false,
    description: 'MIUI Screenshot Screenshots will not work.'
  },
  'com.miui.securityadd': {
    removal: 'expert',
    ad: false,
    description:
      'Related to the MIUI Security app REMOVING THIS WILL MOST LIKELY BOOTLOOP YOUR DEVICE BELOW MIUI 13! This may depend on your MIUI version and device, see https://github.com/0x192/universal-android-debloater/issues/641'
  },
  'com.miui.securitycenter': {
    removal: 'expert',
    ad: false,
    description:
      'MIUI Security app Provides"protection and optimization tools" App lock, Data usage, Security scan, Cleaner, Battery saver, Blocklist and other features. This package is mostly the front-end (UI). https://beta.pithus.org/report/f8c24ccfc526389ff9084505c60fba3d3463565f92e2015190e2974b370e7c4e NOTE: REMOVING THIS WILL MOST LIKELY BOOTLOOP YOUR DEVICE! Uninstalling this on the Redmi Pad or Miui 13 and above is not causing any bootloop, but you will lose some functionality like the battery status/usage page, as well as the app usage/removal page.'
  },
  'com.miui.securitycenter.securitycenter_phone_overlay.config.overlay': {
    removal: 'advanced',
    ad: false,
    description: "'Security tools' name app only found"
  },
  'com.miui.securitycore': {
    removal: 'expert',
    ad: false,
    description:
      'Core features of the"com.miui.securitycenter" Provides Enterprise Mode, Dual App, Second Space, Fingerprint Add, Gesture Settings REMOVING THIS MAY BOOTLOOP YOUR DEVICE! Depends on your MIUI version and device, see https://github.com/0x192/universal-android-debloater/issues/641 On MIUI 13 and above it doesn\'t bootloop and performance appears similar, but this app shows annoying notifications when running new apps.'
  },
  'com.miui.securityinputmethod': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Secure Keyboard A useless keyboard used to secure your password when logging in.'
  },
  'com.miui.settings.rro.device.config.overlay': {
    removal: 'unsafe',
    ad: false,
    description:
      'Presumably a MIUI/HyperOS overlay com.android.settings providing device-specific configurations for system settings. Likely not something you would want to remove. Will likely cause issues.'
  },
  'com.miui.settings.rro.device.hide.statusbar.overlay': {
    removal: 'recommended',
    ad: false,
    description: '.webp files, and one config for me it means nothing. Only Chinese.'
  },
  'com.miui.settings.rro.device.systemui.overlay': {
    removal: 'unsafe',
    ad: false,
    description:
      "A device-specific overlay for com.android.settings on Xiaomi devices customizing the system UI. Likely not something that's safe to remove."
  },
  'com.miui.settings.rro.device.type.overlay': {
    removal: 'recommended',
    ad: false,
    description: "I found only PNG files and it's Chinese. Only Chinese."
  },
  'com.miui.smsextra': {
    removal: 'recommended',
    ad: false,
    description:
      "Dependency for MIUI Messaging (MIUI SMS app misleadingly called (`com.android.mms`) You can remove it if you don't use the default SMS app (and you shouldn't). Run in the background once the phone is booted, has access to the internet and interact with Cloud Manager."
  },
  'com.miui.spock': {
    removal: 'recommended',
    ad: true,
    description:
      'Analytics app which constantly runs in the background. Sends identifiable data to Xiaomi servers. See https://www.virustotal.com/gui/file/70400d0055e1924966fb8367cafddc175dee914bbdc227342c9dd86fb3aa829f/details It leaks system version, device model, exact firmware build + some few mysterious IDs'
  },
  'com.miui.sysopt': {
    removal: 'recommended',
    ad: false,
    description:
      "SysoptApplication Strange app with no permissions. By looking at the code it seems to be some kind of debug app. The app doesn't seem to do any interesting stuff."
  },
  'com.miui.system': {
    removal: 'unsafe',
    ad: false,
    description:
      "Called 'MIUI System Launcher' but it's not the launcher itself (com.miui.home is) This package is another core MIUI app you can't remove. It centralizes a lot of default configuration values"
  },
  'com.miui.system.overlay': {
    removal: 'recommended',
    ad: false,
    description: 'App without code and safe to remove.'
  },
  'com.miui.systemAdSolution': {
    removal: 'recommended',
    ad: true,
    description:
      'Spyware which analyses user behavior for targeted ads. Yeah Xiaomi phones has ads... https://www.theverge.com/2018/9/19/17877970/xiaomi-ads-settings-menu-android-phones'
  },
  'com.miui.systemui.carriers.overlay': {
    removal: 'unsafe',
    ad: false,
    description: 'You will lose LTE. Important overlay to LTE connection.'
  },
  'com.miui.systemui.devices.overlay': {
    removal: 'advanced',
    ad: false,
    description:
      'The empty space between the status bar and the edges of the screen Elements at edges ignore screen fillets and cutouts when removed.'
  },
  'com.miui.systemui.overlay.devices.android': {
    removal: 'expert',
    ad: false,
    description:
      "Config doze Component 'com.miui.aod' and ext media ready notification 'Tap to safely remove device'."
  },
  'com.miui.thirdappassistant': {
    removal: 'recommended',
    ad: false,
    description: "Third party app problems It's boring app."
  },
  'com.miui.touchassistant': {
    removal: 'recommended',
    ad: false,
    description:
      'Quick Ball/Touch Assistant Touch assistant with a combination of five unique shortcuts which aimed to give easy and quick access to functions and apps you use frequently.'
  },
  'com.miui.translation.kingsoft': {
    removal: 'recommended',
    ad: false,
    description: 'Translation stuff by Kingsoft (https://en.wikipedia.org/wiki/Kingsoft)'
  },
  'com.miui.translation.xmcloud': {
    removal: 'recommended',
    ad: false,
    description: 'Translation stuff. Does not impact global translation for non-Chinese users.'
  },
  'com.miui.translation.youdao': {
    removal: 'recommended',
    ad: false,
    description: 'Translation stufff by Youdao (https://en.wikipedia.org/wiki/Youdao)'
  },
  'com.miui.translationservice': {
    removal: 'recommended',
    ad: false,
    description: 'Translation stuff. Does not impact global translation for non-Chinese users.'
  },
  'com.miui.tsmclient': {
    removal: 'recommended',
    ad: false,
    description: 'Smart cards Only for Chinese.'
  },
  'com.miui.tv.analytics': {
    removal: 'recommended',
    ad: true,
    description: 'Analytics Weird analytics app with a lot random stuff found in resources.'
  },
  'com.miui.uireporter': {
    removal: 'recommended',
    ad: false,
    description: 'UIReporter This Chinese app has some secret code: 847, 1130.'
  },
  'com.miui.userguide': { removal: 'recommended', ad: false, description: 'Xiaomi User guide' },
  'com.miui.video': {
    removal: 'recommended',
    ad: true,
    description: 'Mi Video with a different package name. Has a lot of ads, tracking.'
  },
  'com.miui.videoplayer': {
    removal: 'recommended',
    ad: true,
    description:
      'Mi Video (https://play.google.com/store/apps/details?id=com.miui.videoplayer) Has a lot of ads, tracking.'
  },
  'com.miui.videoplayer.overlay': {
    removal: 'advanced',
    ad: false,
    description: 'Mi Video overlay Overlays are usually themes.'
  },
  'com.miui.vipservice': {
    removal: 'recommended',
    ad: false,
    description: 'My services Customer support maybe not be available for users.'
  },
  'com.miui.virtualsim': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Roaming It enables users to connect to roaming data on-demand via virtual SIM technology. https://alertify.eu/xiaomi-mi-roaming/'
  },
  'com.miui.voiceassist': {
    removal: 'recommended',
    ad: false,
    description: 'Mi AI Chinese voice assist.'
  },
  'com.miui.voiceassistoverlay': {
    removal: 'advanced',
    ad: false,
    description:
      "Overlay to Mi AI 'com.miui.voiceassist'. The overlay won't show up when you trigger it, which makes the voice-to-command features largely inaccessible."
  },
  'com.miui.voicetrigger': {
    removal: 'recommended',
    ad: false,
    description: 'Wake with voice Not needed if you removed Chinese Mi AI.'
  },
  'com.miui.vpnsdkmanager': {
    removal: 'recommended',
    ad: false,
    description: 'MiuiVpnSdkManager Vpn to game service?'
  },
  'com.miui.vsimcore': {
    removal: 'recommended',
    ad: false,
    description: 'Virtual Sim core service'
  },
  'com.miui.wallpaper.overlay': {
    removal: 'advanced',
    ad: false,
    description:
      'App that doesnt do anything, no code. Safe to remove. You will need remove it 2 times.'
  },
  'com.miui.wallpaper.overlay.customize': {
    removal: 'advanced',
    ad: false,
    description: 'App that doesnt do anything, no code. Safe to remove.'
  },
  'com.miui.weather2': { removal: 'recommended', ad: false, description: 'Mi Weather app' },
  'com.miui.wmsvc': {
    removal: 'recommended',
    ad: true,
    description:
      'WMService Runs at boot and has access to internet + GPS I quickly looked at the decompiled code and saw some unsanitized SQL inputs, which is BAD! (vulnerable to SQL injection) Tries to get your android unique Google advertising ID from Google Play Services. Feeds and launches the spying/analytics app"com.miui.hybrid". Doesn\'t seem to do anything important, only tracking. WARNING: It does not seem to affect any functionality or cause bootloop.'
  },
  'com.miui.yellowpage': {
    removal: 'recommended',
    ad: false,
    description:
      'Yellow Page from MIUI. REMINDER : Yellow pages contain phone numbers of companies and services. They are provided by Xiaomi partners or businesses themselves.'
  },
  'com.miui.zman': {
    removal: 'advanced',
    ad: false,
    description:
      'Mi Secure sharing Provides an option in the settings of the Xiaomi Gallery to automatically remove location and metadata from images you want to share. This do not remove metadata of the picture in the gallery but only the shared copy. There\'s also a"Secure sharing" watermark that shows up when you share photos on WeChat without metadata. The question is does this really remove all EXIF tags? Can someone test? This is a useful app anyway but do not forget that all your photos/vidoes taken with the Xiaomi camera are still geo-tagged (+ all others exif tags) by default. What you can do is at least revoke the GPS permission to the camera. FOSS alternative to this app : https://f-droid.org/fr/packages/com.jarsilio.android.scrambledeggsif/ https://f-droid.org/fr/packages/de.kaffeemitkoffein.imagepipe/'
  },
  'com.miuix.editor': {
    removal: 'recommended',
    ad: false,
    description:
      "textaction It's probably used for FrequentPhrase(`com.miui.phrase`) but also Frequent Phrases is unknown app so it's safe to remove."
  },
  'com.mobiletools.systemhelper': {
    removal: 'recommended',
    ad: false,
    description: 'SystemHelper Not available for users, has something about dual sim, App Info.'
  },
  'com.qti.dcf': {
    removal: 'recommended',
    ad: false,
    description:
      "I found only: DCF Allows an application to share content using Bluetooth. The application is only allowed to broadcast the content as it already has access to remote devices. These things are not available for users. Qualcomm only said these things, but where is the code? This app is without code so it's safe to remove."
  },
  'com.qti.dpmserviceapp': {
    removal: 'expert',
    ad: false,
    description:
      "Data Power Manager for the radio? Used to improve energy efficiency? In code I found something like this: dpm hal server, read procid it's still unknown."
  },
  'com.qti.ltebc': {
    removal: 'advanced',
    ad: false,
    description: 'LTE Broadcast Manager Runs on boot, but not in the background beyond that.'
  },
  'com.qti.qcc': {
    removal: 'recommended',
    ad: true,
    description:
      "QCC Have a lot of stuff about logs, testing framework for Android with Robolectric, LTE Broadcast. Introduced in android 13. Have png file qdma = Qualcomm Device Management and Analytics. So it's only spyware."
  },
  'com.qti.service.colorservice': {
    removal: 'recommended',
    ad: false,
    description:
      "Allows the application to directly affect the device's display paramter. Well I only know the no one app uses it."
  },
  'com.qualcomm.qti.cne': {
    removal: 'expert',
    ad: false,
    description:
      'CneApp (Connectivity Engine) Runs in the background as part of the System. Enables seamless hand-off between mobile data and Wi-Fi networks. Can also dynamically measure network performance to prioritize using the best one (I think that\'s part of"Intelligently select the best Wi-Fi" in settings). Probably worth keeping on; I noticed connection reliability getting worse when I disabled it. https://www.qualcomm.com/news/onq/2013/07/02/qualcomms-cne-bringing-smarts-3g4g-wi-fi-seamless-interworking https://programmersought.com/article/35091829299/'
  },
  'com.qualcomm.qti.dynamicddsservice': {
    removal: 'advanced',
    ad: false,
    description:
      "Dynamic DDS Service DDS = Direct Digital Synthesizer. Supposedly useful for testing, communication and frequency sweep applications. Some apps may use this for local communication between devices? I'm guessing this is related to sending data through audio(a bunch of rapid beeps outside of the range of human hearing), which I believe Google Home used(still uses?) at one point as an option to connect to a Chromecast. https://www.qualcomm.com/news/releases/1996/05/07/qualcomm-introduces-new-high-speed-dual-direct-digital-synthesizer Info about DDS: https://www.allaboutcircuits.com/technical-articles/direct-digital-synthesis/"
  },
  'com.qualcomm.qti.poweroffalarm': {
    removal: 'expert',
    ad: false,
    description:
      'Probably what enables alarms to start the device from an off state. Runs on boot and when you open a clock app.'
  },
  'com.qualcomm.qti.powersavemode': {
    removal: 'recommended',
    ad: false,
    description: 'It have hidden power saving modes. Users cant use it.'
  },
  'com.qualcomm.qti.qcolor': {
    removal: 'recommended',
    ad: false,
    description:
      "QColor QTI enhanced color mode? I found 1 png file, color service, it's not needed for any app."
  },
  'com.qualcomm.qti.qms.service.connectionsecurity': {
    removal: 'recommended',
    ad: false,
    description:
      'Telemetry service qms = quality management service Background-Connection to tls.telemetry.swe.quicinc.com (Host/Domain belongs to Qualcomm)'
  },
  'com.qualcomm.qti.qms.service.trustzoneaccess': {
    removal: 'recommended',
    ad: false,
    description: 'QMS always spying. Trust Zone in this app means nothing more than logs.'
  },
  'com.qualcomm.qti.server.qtiwifi': {
    removal: 'recommended',
    ad: true,
    description:
      "it's made for analytics. This service can be used to have OEM specific feature development. Currently this service is being used to collect CSI data from cfrtool via hidl and then pass the data to application(user level)."
  },
  'com.qualcomm.qti.services.systemhelper': {
    removal: 'expert',
    ad: false,
    description:
      'System Helper Service Runs"SysHelperService" in the background as part of the system. Permissions: DEVICE_POWER, READ_PHONE_STATE, READ_PRIVILEGED_PHONE_STATE, RECEIVE_BOOT_COMPLETED, WRITE_SETTINGS, WAKE_LOCK and ACCESS_SURFACE_FLINGER. Android simple network firewall utility service. On a RedMi Note 13 running HyperOS 2.6.0, no application is running after uninstalling this package.'
  },
  'com.qualcomm.qti.uceShimService': {
    removal: 'expert',
    ad: false,
    description:
      'The Qualcomm telephony support service that acts as a shim layer between IMS and qualcomm modem stack. Will likely break RCS, VoLTE, VoWiFi and some carrier preference customizations. Not worth deleting.'
  },
  'com.qualcomm.qti.workloadclassifier': {
    removal: 'expert',
    ad: false,
    description:
      "Runs\"WLCService\" in the background. I assume this has to do with CPU scheduling. Probably important for efficiency, if not basic operation. In code I found: it's for performance and security? it categorize apps maybe for optimization. it's named workloadclassifier so it should do that. reads the list of installed applications, storage space. it's still unknown."
  },
  'com.qualcomm.qti.xrcb': {
    removal: 'recommended',
    ad: false,
    description:
      "Receive xrcb network signals for radio side. it's about emergency alerts, weather alerts, public announcements, and other information."
  },
  'com.qualcomm.qti.xrvd.service': {
    removal: 'recommended',
    ad: false,
    description:
      "XRVD The real name of this app is XRVDTest. It has accessibility testing, collects some data? It's something for developers probably."
  },
  'com.qualcomm.qtil.aptxacu': {
    removal: 'recommended',
    ad: false,
    description: 'Hidden aptxals Audio Bluetooth sample improvement. Useless 96kHz sample.'
  },
  'com.qualcomm.timeservice': {
    removal: 'expert',
    ad: false,
    description:
      'Qualcomm Time Service Updates time-services user time offset when user changes time of the day and Android sends a TIME_CHANGED or DATE_CHANGED intents. Time-services restores the time of the day after reboot using this offset: https://github.com/bcyj/android_tools_leeco_msm8996/blob/master/time-services/src/com/qualcomm/timeservice/TimeServiceBroadcastReceiver.java'
  },
  'com.qualcomm.wfd.service': {
    removal: 'advanced',
    ad: false,
    description:
      'Wfd Service Provides a way to cast your screen to a TV (Miracast) https://en.wikipedia.org/wiki/Miracast Or it is WiFi Direct.'
  },
  'com.sohu.inputmethod.sogou.xiaomi': {
    removal: 'recommended',
    ad: false,
    description: 'Sogou keyboard for chinese only.'
  },
  'com.tencent.soter.soterserver': {
    removal: 'recommended',
    ad: false,
    description:
      "Soter is a biometric authentication standard and platform by Tencent. https://github.com/Tencent/soter Provides biometric authentication for WeChat Pay. Safe to disable if you don't use it."
  },
  'com.unionpay.tsmservice.mi': {
    removal: 'recommended',
    ad: false,
    description: 'UnionPay Only for China.'
  },
  'com.wapi.wapicertmanage': {
    removal: 'recommended',
    ad: false,
    description:
      "WAPI certificate manager WAPI = WLAN Authentication and Privacy Infrastructure. A Chinese national standard for Wireless LAN within a limited area such as a home. Not very useful if you don't live in China. https://en.wikipedia.org/wiki/WLAN_Authentication_and_Privacy_Infrastructure Digital certificates identify devices and apps for security. Just like your driver’s license shows that you can legally drive, a digital certificate identifies your device and confirms that it should be able to access something. https://security.stackexchange.com/questions/102550/what-are-wifi-certificates-used-for-what-are-they"
  },
  'com.xiaomi.NetworkBoost': {
    removal: 'recommended',
    ad: true,
    description:
      "Network Boost Network acceleration not available in settings wifi? People said it's placebo and it doesn't speed up the network. It has a lot of Chinese code and has permission to MIUI analytics."
  },
  'com.xiaomi.ab': {
    removal: 'recommended',
    ad: false,
    description: 'Mi Store System Components Something about login, paying in Mi Store China.'
  },
  'com.xiaomi.account': {
    removal: 'advanced',
    ad: false,
    description:
      "Mi Account Has a LOT of permissions + Facebook trackers. Collects many information, including your phone number, your unique International mobile subscriber identity (IMSI) and your clipboard). You should remove this if you don't have or don't want a Mi account. WARNING: Make sure to log out of your Mi Account and unbind your phone from it. If you don't you could be locked out from your phone after removing this package. Remove Mi Account: https://xiaomiui.net/how-to-remove-mi-account-7606/ Pithus analysis: https://beta.pithus.org/report/3f5abc9d7215dd0be5c3ac137b0cd528217640b5778e9f849a9beb0a34eda8dc"
  },
  'com.xiaomi.aiasst.service': {
    removal: 'recommended',
    ad: false,
    description: 'AI Call Assistant. Useless Call settings.'
  },
  'com.xiaomi.aiasst.vision': {
    removal: 'recommended',
    ad: false,
    description: 'AiasstVision. Not needed if you removed AI Call Assistant.'
  },
  'com.xiaomi.aicr': {
    removal: 'advanced',
    ad: false,
    description:
      'Mi AI Engine Another app to Mi AI from MIUI China. Might break the ability to set wallpapers See https://github.com/Universal-Debloater-Alliance/universal-android-debloater-next-generation/issues/1110 https://hyperosupdates.com/apps/com.xiaomi.aicr/'
  },
  'com.xiaomi.aireco': {
    removal: 'recommended',
    ad: true,
    description: 'XiaoaiRecommendation This app does nothing, totally random frameworks unused.'
  },
  'com.xiaomi.aiservice': {
    removal: 'advanced',
    ad: true,
    description:
      "Xiaomi on-device AI inference engine (HyperOS/MIUI). Runs many ML models (OCR, translation, etc.) in isolated per-model processes. Embeds Xiaomi's OneTrack SDK, which collects OAID, android_id, device fingerprint, region, network type, and per-event usage data, then uploads it encrypted to tracking.*.miui.com. Also embeds XCrash for crash reporting. Downloads AI model updates silently via Android DownloadManager (probably has to do with AI Core). Removing probably breaks HyperOS AI features (I haven't tested) but does not affect core phone, SMS, or data functions."
  },
  'com.xiaomi.android.tvsetup.partnercustomizer': {
    removal: 'recommended',
    ad: false,
    description: 'SetupCustomizer On first boot setup installs bloatware.'
  },
  'com.xiaomi.aon': {
    removal: 'recommended',
    ad: true,
    description:
      "'I always on' found in code and a lot statistics. Also Miui analytics permissions. Region of the tracking device, found things Mi Face, spy on your face and everything you do on your phone? AONEventTracking uses and sends to 'com.miui.analytics'."
  },
  'com.xiaomi.barrage': {
    removal: 'recommended',
    ad: false,
    description:
      "Bullet screen notifications Pop-up notifications (feature inside the game service) Have a lot of Chinese things in this code but it's for the game service, NOT gamespace. So it's for China only."
  },
  'com.xiaomi.bluetooth': {
    removal: 'recommended',
    ad: false,
    description:
      'MIUI Bluetooth Extension. Doesn\'t seem to affect bluetooth functionality. Can introduce a ~1s delay when switching audio playback apps; uninstalling fixes this issue. Tested on Poco M4 Pro 5G HyperOS 1.0.1.0. Note: If you deleted (com.xiaomi.xmsf) this package will likely send"Bluetooth extension stopped working" errors, uninstalling it removes them.'
  },
  'com.xiaomi.bluetooth.overlay': {
    removal: 'advanced',
    ad: false,
    description:
      'It has only unused png files, webp. Images in it: wireless headphones from all angles.'
  },
  'com.xiaomi.bluetooth.rro.device.config.overlay': {
    removal: 'expert',
    ad: false,
    description:
      'A device-specific overlay for com.xiaomi.bluetooth. Safe to remove if com.xiaomi.bluetooth is removed.'
  },
  'com.xiaomi.bsp.gps.nps': {
    removal: 'advanced',
    ad: false,
    description:
      "GPS location I think bsp = board system package (https://en.wikipedia.org/wiki/Board_support_package) Not sure about nps (It might be Non-Permanent GPS station) It's a small package which seems to display a notification when an app is using GPS. More precisely, there is a receiver (GnssEventReceiver) which listen to com.xiaomi.bsp.gps.nps.GetEvent This event most likely happen when an app use the GPS and refers to the state of the communication with the GNSS: FIX, LOSE, RECOVER, START, STOP It's safe to remove if you really want to."
  },
  'com.xiaomi.bttester': {
    removal: 'recommended',
    ad: false,
    description: 'BTCIT Bluetooth Test Service'
  },
  'com.xiaomi.calendar': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Calendar. Google trackers inside and needs 48 permissions! Obviously talks to Xiaomi servers. The com.mi.health.provider.permission.read_menstruation permissions is really creepy... There are better alternatives. Pithus analysis: https://beta.pithus.org/report/6c68ddd1f9e2d1f9e1df2eab572c07f1e34c4a6490c0ba98554a7356ca2a351d Note: Since MIUI 12, you can no longer uninstall this app. Disabling it still works fine.'
  },
  'com.xiaomi.cameramind': {
    removal: 'advanced',
    ad: false,
    description:
      "The core of all AI features for Xiaomi's camera app. Won't impact other camera apps' AI features. Safe to delete if you use another camera app, otherwise, removal may cause background connection issues."
  },
  'com.xiaomi.cameratools': {
    removal: 'recommended',
    ad: false,
    description: 'CameraTools Camera calibration. Deleting it does not affect the camera.'
  },
  'com.xiaomi.channel': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Talk Mi instant messaging app that lets you do practically the same thing as Whatsapp. NOTE: You should use Signal or Wire instead Whatsapp/Mi Talk for more privacy.'
  },
  'com.xiaomi.digitalkey': {
    removal: 'recommended',
    ad: false,
    description: 'digitalkey Smart door locks, can also be used as a car key. Only for China.'
  },
  'com.xiaomi.discover': {
    removal: 'expert',
    ad: false,
    description:
      'System Apps Updater WARNING: Disable System app updates (but not firmware updates)'
  },
  'com.xiaomi.entitlement.o2': {
    removal: 'recommended',
    ad: false,
    description:
      "Unknown, seems to be United Kingdom, Germany specific to the O2 carrier. https://en.wikipedia.org/wiki/O2_(brand) If you don't use O2 carrier, it's safe to remove."
  },
  'com.xiaomi.finddevice': {
    removal: 'expert',
    ad: true,
    description:
      "Find My Device feature (in the Settings) Allows you to locate a lost phone and wipe it remotely, provided it has an active Wi-Fi/mobile data connection. Before uninstalling, !!! log out of your Mi Account !!! Removing this breaks factory reset from UI, the Security Status page in Settings, and prevents Mi Account sign-in. Confirmed not to bootloop on HyperOS 1.0 and HyperOS 2.0, but other MIUI versions/devices may still bootloop see https://github.com/0x192/universal-android-debloater/issues/641 Sends and receives around 1,5MB-2MB of data per day to/from an unknown source on HyperOS 2.0, even with Data Saver on and on mobile data. The UI blocks you from denying any kind of mobile data access. Consider replacing it with Google's find device. It's much more optimized, has offline location tracking feature and is already preinstalled even on the devices with Xiaomi's Find Device."
  },
  'com.xiaomi.gamecenter': {
    removal: 'recommended',
    ad: true,
    description: 'Games Another app with a lot tracking and not needed for gamespace.'
  },
  'com.xiaomi.gamecenter.sdk.service': {
    removal: 'recommended',
    ad: false,
    description:
      "Game Service Not needed for gamespace. Disabled in settings on default. Have activities about alipay, login to account. I'm not sure what it's needed for."
  },
  'com.xiaomi.glgm': {
    removal: 'recommended',
    ad: false,
    description: 'Xiaomi Games Not sure if this app still exists.'
  },
  'com.xiaomi.joyose': {
    removal: 'expert',
    ad: false,
    description:
      'GPU Tuner Optimizes your game for gaming. Some people have noticed that it locks the fps at 60 after selecting 90. https://youtu.be/gavEuH3Ck5o?t=550. If you want, you can test it by yourself.'
  },
  'com.xiaomi.jr': {
    removal: 'recommended',
    ad: false,
    description: 'Help you getting loans when shopping.'
  },
  'com.xiaomi.lens': {
    removal: 'recommended',
    ad: false,
    description:
      "Related to camera app ? Safe to remove (according to a lot of users) I'd like to have more info about it. Can a Xiaomi user help ?"
  },
  'com.xiaomi.location.fused': {
    removal: 'recommended',
    ad: true,
    description: 'It has china location, ads & analytics. You dont need it for location.'
  },
  'com.xiaomi.macro': {
    removal: 'recommended',
    ad: false,
    description:
      'MiMacro is an automation task from Xiaomi like touch on MIUI Game Turbo. Has INTERNET and READ_PHONE_STATE permission allowing access to the phone number, serial number, whether a call is active, the number that a call is connected to... What is sure (from the code) is that the app collects the IMEI. Pithus analysis: https://beta.pithus.org/report/2b056ed84fe500552a58184035b962ba68af29457c24930c0aa8c9eba4af7bcf'
  },
  'com.xiaomi.market': {
    removal: 'advanced',
    ad: true,
    description:
      'GetApps China Mi App Store. Essential for installing the Google Play Store and updating key system applications, such as the System Launcher.'
  },
  'com.xiaomi.mbnloader': {
    removal: 'advanced',
    ad: false,
    description: 'Modem Config Hidden app for Choosing Country vowifi?'
  },
  'com.xiaomi.metoknlp': {
    removal: 'recommended',
    ad: true,
    description: 'Network location provider Useless, only for China, have analytics things.'
  },
  'com.xiaomi.mi_connect_service': {
    removal: 'recommended',
    ad: false,
    description:
      'MiConnectService Handles connection to IoT stuff Seems to be linked to Mi Home (com.xiaomi.smarthome)'
  },
  'com.xiaomi.miaudiovisual': {
    removal: 'recommended',
    ad: false,
    description: 'MiAudioVisual Safe to remove if you not use audio visuals when screen is off.'
  },
  'com.xiaomi.mibrain.speech': {
    removal: 'recommended',
    ad: false,
    description: 'Mi AI Speech Engine Another app to Mi AI Chinese app.'
  },
  'com.xiaomi.micloud.sdk': {
    removal: 'unsafe',
    ad: false,
    description:
      'Mi Cloud sdk sdk = Software development kit Seems to be a dependency for"com.miui.gallery" (MIUI auto reboots android after remove this package)'
  },
  'com.xiaomi.midrop': {
    removal: 'recommended',
    ad: false,
    description:
      'Share Me (Mi Drop) (https://play.google.com/store/apps/details?id=com.xiaomi.midrop) P2P file transfer tool.'
  },
  'com.xiaomi.midrop.overlay': {
    removal: 'advanced',
    ad: false,
    description: 'Mi Drop overlay Overlays are usually themes.'
  },
  'com.xiaomi.migameservice': {
    removal: 'recommended',
    ad: false,
    description: 'Mi Game Service Chinese app made to test game service things.'
  },
  'com.xiaomi.mipicks': {
    removal: 'recommended',
    ad: true,
    description:
      'Mi Picks (becomed Mi Apps Store and now Get Apps -- Xiaomi app store) I believe this package is discontinued. https://play.google.com/store/apps/details?id=com.mi.global.shop'
  },
  'com.xiaomi.miplay_client': {
    removal: 'advanced',
    ad: false,
    description:
      'MiPlay Client Provides support for Miracast (https://en.wikipedia.org/wiki/Miracast). It provides the Wireless Display feature (Settings - Connection & sharing - Cast).'
  },
  'com.xiaomi.mircs': {
    removal: 'recommended',
    ad: false,
    description: 'Mi RCS Hidden unused Xiaomi free web messaging.'
  },
  'com.xiaomi.mirecycle': {
    removal: 'recommended',
    ad: false,
    description:
      "Mi Recycle Xiaomi has extended its partnership with Cashify to launch the 'Mi Recycle' feature through its MIUI Security app. It will let Xiaomi phone users check the health of their smartphone and get their resale value directly from Cashify, the online re-commerce company based out of New Delhi. Source : https://gadgets.ndtv.com/mobiles/news/xiaomi-mi-recycle-cashify-miui-security-app-2018024"
  },
  'com.xiaomi.mirror': {
    removal: 'recommended',
    ad: false,
    description:
      'MIUI+ Beta Transfer files, sync copy text to PC without USB. https://plus.miui.com'
  },
  'com.xiaomi.mis': {
    removal: 'recommended',
    ad: false,
    description: 'Xiaomi Connected Car Service for China.'
  },
  'com.xiaomi.misettings': { removal: 'unsafe', ad: false, description: 'Xiaomi Settings app' },
  'com.xiaomi.mitv.res': {
    removal: 'expert',
    ad: false,
    description: 'MiUtilRes Looks like mitv api. Probably Unsafe to remove.'
  },
  'com.xiaomi.mtb': {
    removal: 'recommended',
    ad: false,
    description:
      'Rueban(MTB)V2.4 Hidden debugging baseband tools, not available for users. https://i.postimg.cc/GpSxmNyj/Bez-n-zvu.png'
  },
  'com.xiaomi.o2o': {
    removal: 'recommended',
    ad: false,
    description:
      'o2o = online-to-offline ==> Describes systems enticing consumers within a digital environment to make purchases of goods or services from physical businesses. https://en.wikipedia.org/wiki/Online_to_offline NOTE: This package can make phone calls without user intervention.'
  },
  'com.xiaomi.oobhelper': {
    removal: 'recommended',
    ad: false,
    description: 'OOBHelper Useless frameworks and logs.'
  },
  'com.xiaomi.otrpbroker': {
    removal: 'recommended',
    ad: false,
    description:
      'TAMservice OTRP Protocol Negotiation Program (Internet of Things) Only useful in China.'
  },
  'com.xiaomi.oversea.ecom': {
    removal: 'recommended',
    ad: false,
    description: 'Xiaomi ShopPlus. Given its name I think this package is useless.'
  },
  'com.xiaomi.pass': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Pass is an App allows Xiaomi NFC phones to replace cards and keys in real life usage. Support NFC payment, bus card, key card, door and car lock features all together.'
  },
  'com.xiaomi.payment': {
    removal: 'recommended',
    ad: false,
    description:
      'Old package name for Mi Credit (https://play.google.com/store/apps/details?id=com.micredit.in.gp) Mi Credit is a personal loan platform from Xiaomi.'
  },
  'com.xiaomi.phone': {
    removal: 'expert',
    ad: false,
    description:
      "A MIUI/HyperOS extension for telephony services. Called HyperPhone (at least on HyperOS), I don't know how is it named in MIUI, if you know, please edit this package and add it's MIUI name here. (in GitHub) It's similar to com.xiaomi.bluetooth by it's purpose, but here it's a Xiaomi extension for telephony services. Deleting it caused no data loss or issues with telephony, calls, mobile data, and other on HyperOS 2.0."
  },
  'com.xiaomi.phone.overlay': {
    removal: 'expert',
    ad: false,
    description:
      'An overlay needed for com.xiaomi.phone. Safe to remove if com.xiaomi.phone has been removed.'
  },
  'com.xiaomi.powerchecker': {
    removal: 'expert',
    ad: false,
    description:
      "Power Detector Security> Battery> Activity Control. Detects abnormal power usage by apps (not all. Some Xiaomi apps are whitelisted) Needed for 'com.miui.powerkeeper' to work."
  },
  'com.xiaomi.providers.appindex': {
    removal: 'recommended',
    ad: false,
    description:
      "Provider for app index? I believe it is a provider for the settings but can't confirm (I don't have a Xiaomi device). A lot of people debloat this but I'd like to know more about this one. Content providers encapsulate data, providing centralized management of data shared between apps. https://developer.android.com/guide/topics/providers/content-providers.html"
  },
  'com.xiaomi.scanner': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Scanner QR code scanner with a lot of questionable permissions : `ACCESS_FINE_LOCATION`, `CALL_PHONE`, `READ_CONTACTS`, `REQUEST_INSTALL_PACKAGES`, `QUERY_ALL_PACKAGES`, `FOREGROUND_SERVICE`, `INTERNET`'
  },
  'com.xiaomi.security.onetrack': {
    removal: 'recommended',
    ad: true,
    description: 'SecurityOnetrackService Only uses MIUI analytics.'
  },
  'com.xiaomi.shop': {
    removal: 'recommended',
    ad: false,
    description:
      "Xiaomi app store (I thinks it's discontinued) Now com.mi.global.shop (https://play.google.com/store/apps/details?id=com.mi.global.shop)"
  },
  'com.xiaomi.simactivate.service': {
    removal: 'recommended',
    ad: false,
    description:
      "Xiaomi SIM Activation Service SIM authentication process to access exclusive features in certain MIUI applications. For the activation to work you need to send a international SMS to China. Your carrier may block this by default and/or you'll probably need to pay extra for this. After SIM activation, you can send text messages (Mi Messages) to other Mi users using internet connection (like i-messages). You will be able to synchronize your messages into Mi Cloud and this also enables the Mi Find Device feature which allows you to track your phone’s location from your online Mi account. Note: To enable/disable Mi Messages go to Settings -> System Apps -> Messaging and reboot"
  },
  'com.xiaomi.smarthome': {
    removal: 'recommended',
    ad: false,
    description:
      'Mi Home (https://play.google.com/store/apps/details?id=com.xiaomi.smarthome) IoT. Lets you control with Xiaomi Smart Home Suite devices.'
  },
  'com.xiaomi.touchservice': {
    removal: 'recommended',
    ad: true,
    description: 'No activities, uses miui analytics looks like a tracking touch.'
  },
  'com.xiaomi.trustservice': {
    removal: 'recommended',
    ad: false,
    description: "MiTrustService IFAASecCam, security things or 'Remote Control trust'."
  },
  'com.xiaomi.ugd': {
    removal: 'expert',
    ad: false,
    description:
      "GPU Driver Updater It's weird when this app cameback on HyperOS(from MIUI 12). Updates GPU driver."
  },
  'com.xiaomi.upnp': {
    removal: 'recommended',
    ad: false,
    description:
      'UpnpService UPnP = Universal Plug and Play It’s a protocol that lets UPnP-enabled devices on your network automatically discover and communicate with each other For example it works with the Xiaomi Network Speaker (and probably a lot more Xiaomi IoT stuff) UPnP has a lot of security issues and you proably should disable it on your router. https://nakedsecurity.sophos.com/2020/06/10/billions-of-devices-affected-by-upnp-vulnerability/ This package is the Xiaomi implementation on Android (no AOSP support)'
  },
  'com.xiaomi.vipaccount': {
    removal: 'recommended',
    ad: false,
    description: 'Xiaomi VIP account https://www.mi.com/in/service/privilegefaq/'
  },
  'com.xiaomi.xaee': {
    removal: 'recommended',
    ad: false,
    description: 'XiaoaiEdgeEngine This app has something to Mi AI.'
  },
  'com.xiaomi.xmsf': {
    removal: 'expert',
    ad: false,
    description:
      "Xiaomi Service Framework Contains a set of API's for Xiaomi apps. Expect widespread breakage of Xiaomi apps/functionality if disabled. Disabling will mess with Alarm clock functionality(according to issue#136) and break Mi Cloud and Mi account (and all features that depend on them). I don't know about now, but in 2016 this app constantly tried to establish tcp connections in the background."
  },
  'com.xiaomi.xmsfkeeper': {
    removal: 'recommended',
    ad: false,
    description: "Xiaomi Service Framework Keeper Logger service for 'com.xiaomi.xmsf'"
  },
  'com.xiaomi.youpin': {
    removal: 'recommended',
    ad: false,
    description: 'Xiaomi Yipin Mi Shop China.'
  },
  'miui.systemui.plugin': {
    removal: 'advanced',
    ad: false,
    description:
      'System UI Plug-in. When using HyperOS, removing this package breaks the iOS-style quick settings and Android will use the AOSP-version of the volume bar & reboot screen (AKA the option to power off/reboot your device). If your device is using MIUI, only the volume bar will change. WARNING: On Redmi Note 11 (Android 13, MIUI 14), it broke the entire status bar making it unable to draw the notification panel including the quick action menu.'
  },
  'miuix.stub': {
    removal: 'recommended',
    ad: false,
    description: 'It has something to unknown miuix FrequentPhrase, Chinese things found.'
  },
  'org.ifaa.aidl.manager': {
    removal: 'recommended',
    ad: false,
    description:
      "IfaaManagerService IFAA = (China’s) Internet Finance Authentication Alliance Provides biometric authentication for Alipay. Probably safe to disable if you don't use it."
  },
  'vendor.qti.data.txpwradmin': {
    removal: 'advanced',
    ad: false,
    description:
      'This app is from qualcomm, in androidmanifest.xml I found things like com.qualcomm.qti.qmsdataservices, qms is spyware, permissions uses: access wifi state, quary all packages, package usage stats. So hidden network stats, more about it is this code is just logs, takes apm, wifi, bt status.'
  },
  'vendor.qti.hardware.cacert.server': {
    removal: 'unsafe',
    ad: false,
    description:
      'CACertApp Occasionally runs in the background. Handles CACert certificates? http://www.cacert.org/ CACert is a community-driven CA that issues certificates to the public at large for free. CA = Certificate Authority, an entity that certifies the ownership of a public key that can be used for secure communications. Probably a bad idea to disable; could mess with device security.'
  },
  'vendor.qti.imsdatachannel': { removal: 'advanced', ad: false, description: 'Needed for IMS.' },
  'vendor.qti.iwlan': {
    removal: 'advanced',
    ad: false,
    description:
      'Used for VoLTE/VoWifi (Wifi-calling) IwLAN = Interworking wLAN. Support for mobile data offloading (use of complementary network technologies for delivering data originally targeted for cellular networks) It means your phone will use the Wi-Fi connection instead of the cellular data connection. https://en.wikipedia.org/wiki/Mobile_data_offloading'
  }
}
