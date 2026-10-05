// App mods: edits to one APK or jar of the ROM, made on its apktool decode.
//
// <project>/mods/<id>/
//   mod.json        what is edited (ModSchema)
//   overlay.json    the edits: every changed, added or deleted decoded file (OverlaySchema)
//   overlay/<path>  content of changed and added files
//   cache/          base (pristine decode) and edit (working copy); can be deleted any time
//
// mod.json + overlay are the source of truth and are applied again at every build, onto a
// fresh decode of the file in work/, so a mod is reproducible and survives cache cleanup.

import { z } from 'zod'

export const MOD_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

const RelPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'must be a relative path')

export const ModSchema = z.object({
  schema: z.literal(1),
  id: z.string().regex(MOD_ID),
  /** Tree path of the APK or jar, e.g. product/app/MIUIFileExplorer/MIUIFileExplorer.apk. */
  target: RelPath,
  packageName: z.string().nullable(),
  /** sha256 of the stock file the mod was made on. */
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Decode resources (needs the ROM frameworks); otherwise only smali, resources stay raw. */
  resources: z.boolean(),
  note: z.string().default('')
})
export type ModInfo = z.infer<typeof ModSchema>

export const OverlayChangeSchema = z.object({
  /** Path in the apktool decode, e.g. smali_classes2/com/x/Ads.smali or res/values/strings.xml. */
  path: RelPath,
  kind: z.enum(['modified', 'added', 'deleted']),
  /** sha256 of the decoded stock file (null when added). */
  baseSha256: z.string().nullable(),
  /** sha256 of the new content (null when deleted). */
  sha256: z.string().nullable()
})
export type OverlayChange = z.infer<typeof OverlayChangeSchema>

export const OverlaySchema = z.object({
  schema: z.literal(1),
  changes: z.array(OverlayChangeSchema)
})
export type Overlay = z.infer<typeof OverlaySchema>

/** Files apktool writes for itself; never part of an overlay. */
export const DECODE_META = new Set(['apktool.yml', 'original', 'build'])

export function modDir(projectPath: string, id: string): string {
  return `${projectPath}/mods/${id}`
}

export interface ModSummary {
  mod: ModInfo
  changes: OverlayChange[]
  /** cache/edit exists and can be browsed. */
  open: boolean
}
