async function compressImage(file, maxKB) {
  if (!file || !file.type || file.type.indexOf('image/') !== 0) return file
  if (file.size <= maxKB * 1024) return file
  try {
    var url = URL.createObjectURL(file)
    var img = new Image()
    await new Promise(function (res, rej) { img.onload = res; img.onerror = rej; img.src = url })
    URL.revokeObjectURL(url)
    var maxDim = 1600
    var scale = Math.min(maxDim / img.width, maxDim / img.height, 1)
    var canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    var ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    var quality = 0.88
    var blob = null
    for (var i = 0; i < 8; i++) {
      blob = await new Promise(function (res) { canvas.toBlob(res, 'image/jpeg', quality) })
      if (!blob) break
      if (blob.size <= maxKB * 1024) break
      quality = quality * 0.72
    }
    if (!blob) return file
    var newName = (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() })
  } catch (_) {
    return file
  }
}

export { compressImage }