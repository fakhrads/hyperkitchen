// Recipe: the ordered list of operations a build applies to work/. Pure data, kept in
// <project>/recipe.json. Shared by main (validation), worker (execution) and renderer (editor).

import { z } from 'zod'
import { MOD_ID } from './appmod'

/** A path inside the extracted trees, starting with the partition, e.g. product/app/Foo. */
const TreePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'must be a relative path')

/** An absolute file on the host, chosen by the user. */
const HostFile = z
  .string()
  .min(1)
  .refine((p) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p), 'must be an absolute path')
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/)

export const OperationSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('remove-paths'),
    enabled: z.boolean().default(true),
    params: z.object({ paths: z.array(TreePath).min(1) })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('debloat'),
    enabled: z.boolean().default(true),
    params: z.object({
      packages: z.array(z.string().min(1)).min(1),
      /** Allow removing packages on the protected list. */
      force: z.boolean().default(false)
    })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('set-props'),
    enabled: z.boolean().default(true),
    params: z.object({
      file: TreePath,
      set: z.record(z.string(), z.string()).default({}),
      remove: z.array(z.string()).default([])
    })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('unlock-cn-gms'),
    enabled: z.boolean().default(true),
    params: z.object({
      /** Also edit odm/etc/permissions/com.gnss.bds_preference.xml (GNSS, off by default). */
      includeGnss: z.boolean().default(false)
    })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('disable-encryption'),
    enabled: z.boolean().default(false),
    params: z.object({
      /** Must be true: the user accepted that /data is stored unencrypted. */
      acknowledged: z.literal(true)
    })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('patch'),
    enabled: z.boolean().default(true),
    params: z.object({ patchSet: z.string().min(1) })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('import-from-rom'),
    enabled: z.boolean().default(true),
    params: z.object({
      /** Another HyperKitchen project whose stock/fs is the source (e.g. an unpacked reference ROM). */
      project: z.string().min(1),
      /** Tree paths to copy (files or whole directories). */
      paths: z.array(TreePath).min(1),
      /** Tree paths that may replace an existing file in work/. */
      replace: z.array(TreePath).default([])
    })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('app-mod'),
    enabled: z.boolean().default(true),
    params: z.object({
      /** A mod in <project>/mods/<mod> (see shared/appmod.ts). */
      mod: z.string().regex(MOD_ID)
    })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('device-feature'),
    enabled: z.boolean().default(true),
    params: z.object({
      /** The device_features XML, e.g. product/etc/device_features/onyx.xml. */
      file: TreePath,
      bools: z.record(z.string().min(1), z.boolean()).default({}),
      ints: z.record(z.string().min(1), z.number().int()).default({})
    })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('spec-card'),
    enabled: z.boolean().default(true),
    params: z.object({
      /** One entry per region code (hwc); writes product/etc/device_info.json. */
      entries: z
        .array(
          z.object({
            /** Region code(s) this entry applies to, e.g. "GL" or ["CN", "IN"]. */
            hwc: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
            basic: z.record(z.string().min(1), z.string()).default({}),
            camera: z.record(z.string().min(1), z.string()).default({})
          })
        )
        .min(1)
    })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('add-app'),
    enabled: z.boolean().default(true),
    params: z.object({
      /** External APK on the host to add to the ROM. */
      apk: HostFile,
      sha256: Sha256,
      /** New .apk path in the ROM, e.g. product/app/LatinImeGoogle/LatinImeGoogle.apk. */
      target: TreePath
    })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('app-replace'),
    enabled: z.boolean().default(true),
    params: z.object({
      /** External APK on the host (a modded launcher, SystemUI, etc.). */
      apk: HostFile,
      sha256: Sha256,
      /** Existing .apk path in the ROM to replace. */
      target: TreePath
    })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('media'),
    enabled: z.boolean().default(true),
    params: z
      .object({
        /** product/media/bootanimation.zip from a zip, or a static one from a logo image. */
        bootanimation: z
          .object({
            file: HostFile,
            sha256: Sha256,
            kind: z.enum(['zip', 'image']),
            background: z
              .string()
              .regex(/^#[0-9a-fA-F]{6}$/)
              .default('#000000')
          })
          .optional(),
        /** PNG or JPEG for every product/media/wallpaper/wallpaper_<colour>.jpg (stock holds PNG). */
        wallpaper: z.object({ file: HostFile, sha256: Sha256 }).optional(),
        /** PNG for product/media/theme/default/lock_wallpaper. */
        lockWallpaper: z.object({ file: HostFile, sha256: Sha256 }).optional()
      })
      .refine((p) => p.bootanimation || p.wallpaper || p.lockWallpaper, 'nothing to replace')
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('gapps'),
    enabled: z.boolean().default(true),
    params: z.object({
      /** Absolute path of a MindTheGapps zip on the host (the user downloads it). */
      zip: z.string().min(1),
      /** sha256 of the zip when it was added; the build refuses another file. */
      sha256: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
      /** App folder names or overlay APK names to leave out. */
      exclude: z
        .array(z.string().min(1))
        .default(['VelvetTitan', 'SetupWizard', 'GmsSetupWizardOverlay.apk']),
      /** Replace a ROM app with the same package but another signer (the CN Play Store stub). */
      replaceDifferentSigner: z.boolean().default(true)
    })
  })
])

export type Operation = z.infer<typeof OperationSchema>
export type OperationType = Operation['type']

export const RecipeSchema = z.object({
  schema: z.literal(1),
  operations: z.array(OperationSchema).default([])
})

export type Recipe = z.infer<typeof RecipeSchema>

export interface OperationReport {
  id: string
  type: OperationType
  added: string[]
  removed: string[]
  modified: string[]
  warnings: string[]
}
