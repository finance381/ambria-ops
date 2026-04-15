var timer = null

export function translateToHindi(text, callback) {
  if (!text || !text.trim()) return
  clearTimeout(timer)
  timer = setTimeout(function () {
    fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text.trim()) + '&langpair=en|hi')
      .then(function (res) { return res.json() })
      .then(function (data) {
        var translated = data?.responseData?.translatedText
        if (translated && translated !== text) callback(translated)
      })
      .catch(function () {})
  }, 600)
}