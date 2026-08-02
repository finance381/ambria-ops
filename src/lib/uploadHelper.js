import { compressImage } from './imageCompress'

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