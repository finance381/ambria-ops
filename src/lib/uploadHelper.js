import { compressImage } from './imageCompress'
import { supabase } from './supabase'

// Wrap file uploads: compress images to target KB; pass PDFs / non-images through.
// Never throws — falls back to original file if compression fails.
export async function prepUpload(file, targetKB) {
  if (!file) return null
  var kb = targetKB || 100
  var isImage = file.type && file.type.indexOf('image/') === 0
  if (!isImage) return file
  try {
    var out = await compressImage(file, kb)
    return out || file
  } catch (e) {
    return file
  }
}

// Upload with a timeout + one silent retry, for flaky/low-bandwidth
// connections where a plain upload() can hang indefinitely with no
// feedback (no default browser timeout on the underlying fetch). The retry
// reuses the same path with upsert, so a first attempt that actually
// completes after the timeout just gets overwritten by the second — never
// a duplicate file.
export async function uploadWithRetry(bucket, path, file, opts, timeoutMs) {
  var ms = timeoutMs || 20000
  function attempt() {
    return Promise.race([
      supabase.storage.from(bucket).upload(path, file, opts),
      new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ error: { message: 'Upload timed out — check your connection and try again' } })
        }, ms)
      })
    ])
  }
  var first = await attempt()
  if (!first.error) return first
  return attempt()
}

// Route employee file paths to the correct storage bucket.
// Public-form submissions land under `submissions/` prefix (public bucket).
// All other paths (including approved/admin-added docs) → employee-docs.
export function bucketForEmployeeFile(path) {
  if (path && path.indexOf('submissions/') === 0) return 'employee-public-submissions'
  return 'employee-docs'
}

// A receipt/proof file is stored by extension only — no separate "is this a
// voice note" column — so this is the one place that decides it, rather than
// each caller re-deriving (and disagreeing on) the same check.
export function isVoiceNotePath(path) {
  return !!(path && /\.(webm|ogg|mp3|wav|m4a)$/i.test(path))
}

// Public URL for a file in the shared `receipts` bucket. Every caller building
// this URL by hand risks pointing at the wrong bucket name if it ever changes.
export function getReceiptUrl(path) {
  if (!path) return null
  return supabase.storage.from('receipts').getPublicUrl(path).data?.publicUrl || null
}