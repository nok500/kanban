/**
 * Saves a same-origin URL to the user's device as `name`.
 *
 * Deliberately an anchor click rather than `window.open`: an installed PWA runs
 * standalone, so a same-origin, in-scope URL opens in the app's own window —
 * which has no tabs, no back button, and no way out of the file.
 */
function downloadUrl(url: string, name: string): void {
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function downloadBlob(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (e) {
      // Dismissing the sheet is a cancel, not a failure to fall back from.
      if (e instanceof DOMException && e.name === "AbortError") return
    }
  }

  const url = URL.createObjectURL(blob)
  downloadUrl(url, name)
  // Revoking straight away can cancel the download that just started.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

