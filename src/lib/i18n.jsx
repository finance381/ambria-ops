import { createContext, useContext, useState, useEffect, useCallback } from 'react'

var CACHE_PREFIX = 'hi_'
var DEBOUNCE_MS = 400
var ORIG_KEY = '__orig_text__'
var BATCH_SIZE = 40

// Your Supabase Edge Function
var TRANSLATE_FN = 'https://ptksdithbytzrznplfiq.supabase.co/functions/v1/translate'
var ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

var SKIP_WORDS = [
  'ambria', 'ops', 'admin', 'lms', 'pwa', 'csv', 'pdf', 'ppt', 'pptx',
  'supabase', 'google', 'whatsapp', 'gmail', 'upi', 'events',
]

function shouldSkip(text) {
  var trimmed = text.trim()
  if (trimmed.length < 2) return true
  if (/^[\d\s.,₹#%:→←\/×·—–\-()@]+$/.test(trimmed)) return true
  if (/^[A-Z]{2,5}[-_]\d+/.test(trimmed)) return true
  if (/^https?:|@/.test(trimmed)) return true
  if (/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]+$/u.test(trimmed)) return true
  if (/[\u0900-\u097F]/.test(trimmed)) return true
  var lower = trimmed.toLowerCase()
  if (SKIP_WORDS.includes(lower)) return true
  // A single capitalised word under 12 characters used to be skipped, which is
  // most of the interface: Slot, Food, Venue, Dinner, Print, Draft, Included...
  // Only all-caps tokens (LMS, GST, AP) are treated as names now.
  if (/^[A-Z0-9]{2,6}$/.test(trimmed)) return true
  if (/^\+?[\d\s-]{7,}$/.test(trimmed)) return true
  if (/^\d{1,2}\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(trimmed)) return true
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed)) return true
  return false
}

function isErrorResponse(text) {
  if (!text) return true
  var upper = text.toUpperCase()
  if (upper.includes('MYMEMORY') || upper.includes('WARNING') || upper.includes('LIMIT') || upper.includes('HTTPS://')) return true
  return false
}

function getCached(text) {
  try {
    var val = localStorage.getItem(CACHE_PREFIX + text)
    if (val && isErrorResponse(val)) { localStorage.removeItem(CACHE_PREFIX + text); return null }
    return val
  } catch (e) { return null }
}

function setCache(text, val) {
  if (isErrorResponse(val)) return
  try { localStorage.setItem(CACHE_PREFIX + text, val) } catch (e) {}
}

function getTextNodes(root) {
  var nodes = []
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT
      var parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      var tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'CODE' || tag === 'PRE') return NodeFilter.FILTER_REJECT
      if (parent.closest('[data-notranslate]')) return NodeFilter.FILTER_REJECT
      if (parent.isContentEditable) return NodeFilter.FILTER_REJECT
      // <option> text is handled as an attribute target, so skip it here and
      // keep exactly one writer per string
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'OPTION') return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  while (walker.nextNode()) nodes.push(walker.currentNode)
  return nodes
}

// Placeholders, <option> labels and tooltips are attributes, not text nodes, so
// they need their own pass. They used to be filled from cache only, which meant
// a string never seen in body text stayed English for good; they now join the
// same batch request as everything else.
function collectAttrTargets(root) {
  var targets = []
  root.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(function (el) {
    targets.push({ el: el, kind: 'ph', key: 'data-orig-ph' })
  })
  root.querySelectorAll('select option').forEach(function (el) {
    targets.push({ el: el, kind: 'opt', key: 'data-orig' })
  })
  root.querySelectorAll('[title]').forEach(function (el) {
    targets.push({ el: el, kind: 'title', key: 'data-orig-title' })
  })
  return targets
}

function readTarget(t) {
  var stored = t.el.getAttribute(t.key)
  if (stored) return stored
  if (t.kind === 'ph') return t.el.placeholder || ''
  if (t.kind === 'opt') return t.el.textContent || ''
  return t.el.getAttribute('title') || ''
}

function writeTarget(t, orig, value) {
  if (!t.el.getAttribute(t.key)) t.el.setAttribute(t.key, orig)
  if (t.kind === 'ph') t.el.placeholder = value
  else if (t.kind === 'opt') t.el.textContent = value
  else t.el.setAttribute('title', value)
}

function restoreTarget(t) {
  var orig = t.el.getAttribute(t.key)
  if (!orig) return
  if (t.kind === 'ph') t.el.placeholder = orig
  else if (t.kind === 'opt') t.el.textContent = orig
  else t.el.setAttribute('title', orig)
  t.el.removeAttribute(t.key)
}


async function callTranslateFunction(texts) {
  try {
    var res = await fetch(TRANSLATE_FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The function gates on Authorization, not apikey: without the bearer
        // token it answered 401 for every batch, so nothing was ever translated
        // and the switch looked like it did nothing.
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + ANON_KEY,
      },
      body: JSON.stringify({ texts: texts }),
    })
    if (!res.ok) {
      try { console.warn('translate failed', res.status, await res.text()) } catch { /* body already read */ }
      return {}
    }
    var data = await res.json()
    // The function reports which provider answered and how many strings it
    // could not translate; surface that instead of treating an empty batch as
    // 'nothing needed translating'.
    if (data && data.failed) {
      try { console.warn('translate: ' + data.translated + '/' + data.requested + ' via ' + data.provider + (data.note ? ' (' + data.note + ')' : '')) } catch { /* console unavailable */ }
    }
    return (data && data.results) || {}
  } catch (e) {
    try { console.warn('translate error', e && e.message) } catch { /* console unavailable */ }
    return {}
  }
}

async function batchTranslate(strings) {
  var allResults = {}

  // Split into batches of BATCH_SIZE
  var batches = []
  for (var i = 0; i < strings.length; i += BATCH_SIZE) {
    batches.push(strings.slice(i, i + BATCH_SIZE))
  }

  function run(batch) {
    return callTranslateFunction(batch).then(function (results) {
      Object.keys(results).forEach(function (key) {
        allResults[key] = results[key]
        setCache(key, results[key])
      })
    })
  }

  // Fire all batches in parallel
  await Promise.all(batches.map(run))

  // Upstream throttling is usually a short burst limit, so give whatever came
  // back empty exactly one more chance rather than leaving those strings in
  // English until the user toggles the language again.
  var missing = strings.filter(function (t) { return !allResults[t] })
  if (missing.length > 0) {
    await new Promise(function (r) { setTimeout(r, 2000) })
    var retryBatches = []
    for (var j = 0; j < missing.length; j += BATCH_SIZE) retryBatches.push(missing.slice(j, j + BATCH_SIZE))
    await Promise.all(retryBatches.map(run))
  }
  return allResults
}

async function translatePage(root) {
  var nodeMap = {}
  var targetMap = {}
  var uncached = []

  getTextNodes(root).forEach(function (node) {
    var text = node.textContent.trim()
    if (shouldSkip(text)) return
    if (!node[ORIG_KEY]) node[ORIG_KEY] = node.textContent
    var cached = getCached(text)
    if (cached) {
      node.textContent = node[ORIG_KEY].replace(text, cached)
      return
    }
    if (!nodeMap[text]) { nodeMap[text] = []; uncached.push(text) }
    nodeMap[text].push(node)
  })

  collectAttrTargets(root).forEach(function (t) {
    var text = readTarget(t).trim()
    if (!text || shouldSkip(text)) return
    var cached = getCached(text)
    if (cached) { writeTarget(t, text, cached); return }
    if (!targetMap[text]) { targetMap[text] = []; uncached.push(text) }
    targetMap[text].push(t)
  })

  if (uncached.length === 0) return

  var unique = [...new Set(uncached)]
  var results = await batchTranslate(unique)
  Object.keys(results).forEach(function (original) {
    var translated = results[original]
    if (!translated) return
    ;(nodeMap[original] || []).forEach(function (node) {
      if (node[ORIG_KEY] && node.parentElement) {
        node.textContent = node[ORIG_KEY].replace(original, translated)
      }
    })
    ;(targetMap[original] || []).forEach(function (t) {
      writeTarget(t, original, translated)
    })
  })
}

function restorePage(root) {
  getTextNodes(root).forEach(function (node) {
    if (node[ORIG_KEY]) {
      node.textContent = node[ORIG_KEY]
      delete node[ORIG_KEY]
    }
  })
  collectAttrTargets(root).forEach(restoreTarget)
}

var LangContext = createContext()

export function LangProvider({ children }) {
  var [lang, setLang] = useState(function () {
    try { return localStorage.getItem('ambria_lang') || 'en' } catch (e) { return 'en' }
  })

  var translateRef = useCallback(function () {
    if (lang === 'hi') {
      translatePage(document.body)
    } else {
      restorePage(document.body)
    }
  }, [lang])

  useEffect(function () {
    var timeout = setTimeout(translateRef, DEBOUNCE_MS)
    var observer = new MutationObserver(function (mutations) {
      if (lang !== 'hi') return
      var hasNewContent = mutations.some(function (m) { return m.addedNodes.length > 0 })
      if (hasNewContent) {
        clearTimeout(timeout)
        timeout = setTimeout(function () { translatePage(document.body) }, DEBOUNCE_MS)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return function () {
      clearTimeout(timeout)
      observer.disconnect()
    }
  }, [lang, translateRef])

  function switchLang(newLang) {
    if (newLang === lang) return
    if (newLang === 'en') restorePage(document.body)
    setLang(newLang)
    try { localStorage.setItem('ambria_lang', newLang) } catch (e) {}
  }

  function t(key) {
    if (lang === 'en') return key
    return getCached(key) || key
  }

  return (
    <LangContext.Provider value={{ lang: lang, switchLang: switchLang, t: t }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}

export function T({ children }) {
  var { lang } = useContext(LangContext)
  if (lang === 'en') return children
  var text = typeof children === 'string' ? children : String(children || '')
  var cached = getCached(text)
  return cached || text
}
