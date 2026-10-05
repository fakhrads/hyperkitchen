// Recipe: the ordered list of operations a build applies to work/. Pure data, kept in
// <project>/recipe.json. Shared by main (validation), worker (execution) and renderer (editor).

import { z } from 'zod'

/** A path inside the extracted trees, starting with the partition, e.g. product/app/Foo. */
const TreePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'must be a relative path')

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
      /** Another HyperKitchen project whose stock/fs is the source (e.g. an unpacked PureCN). */
      project: z.string().min(1),
      /** Tree paths to copy (files or whole directories). */
      paths: z.array(TreePath).min(1),
      /** Tree paths that may replace an existing file in work/. */
      replace: z.array(TreePath).default([])
    })
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('gapps'),
    enabled: z.boolean().default(true),
    params: z.object({
      /** Absolute path of a MindTheGapps zip on the host. */
      zip: z.string().min(1)
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
