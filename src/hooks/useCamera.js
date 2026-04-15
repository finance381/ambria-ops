import { useState, useRef } from 'react'

export function useCamera() {
  var videoRef = useRef(null)
  var [stream, setStream] = useState(null)
  var [isOpen, setIsOpen] = useState(false)

  async function openCamera() {
    try {
      var mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      })
      setStream(mediaStream)
      setIsOpen(true)
      return mediaStream
    } catch (err) {
      console.error('Camera error:', err)
      return null
    }
  }

  function capturePhoto(video) {
    var canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    var ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.85)
  }

  function closeCamera() {
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop() })
    }
    setStream(null)
    setIsOpen(false)
  }

  return { videoRef, stream, isOpen, openCamera, capturePhoto, closeCamera }
}