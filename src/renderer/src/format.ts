export function formatSize(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${n} B`
}

/** IPC errors arrive as "Error invoking remote method '...': Error: msg". */
export function errorText(e: unknown): string {
  return String((e as Error).message).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  )
}
