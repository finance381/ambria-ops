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
  if (trimmed.length < 3) return true
  if (/^[\d\s.,₹#%:→←\/×·—–\-()@]+$/.test(trimmed)) return true
  if (/^[A-Z]{2,5}[-_]\d+/.test(trimmed)) return true
  if (/^https?:|@/.test(trimmed)) return true
  if (/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]+$/u.test(trimmed)) return true
  if (/[\u0900-\u097F]/.test(trimmed)) return true
  var lower = trimmed.toLowerCase()
  if (SKIP_WORDS.includes(lower)) return true
  if (/^[A-Z][a-z]+$/.test(trimmed) && trimmed.length < 12) return true
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
      if (tag === 'INPUT' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })
  while (walker.nextNode()) nodes.push(walker.currentNode)
  return nodes
}

function translateInputs(root, lang) {
  var inputs = root.querySelectorAll('input[placeholder], textarea[placeholder]')
  inputs.forEach(function (el) {
    if (lang === 'hi') {
      var origPh = el.getAttribute('data-orig-ph')
      if (!origPh) { el.setAttribute('data-orig-ph', el.placeholder); origPh = el.placeholder }
      var cached = getCached(origPh)
      if (cached) el.placeholder = cached
    } else {
      var orig = el.getAttribute('data-orig-ph')
      if (orig) { el.placeholder = orig; el.removeAttribute('data-orig-ph') }
    }
  })
}

function translateOptions(root, lang) {
  var options = root.querySelectorAll('select option')
  options.forEach(function (el) {
    var text = el.textContent.trim()
    if (!text || shouldSkip(text)) return
    if (lang === 'hi') {
      if (!el.getAttribute('data-orig')) el.setAttribute('data-orig', el.textContent)
      var cached = getCached(text)
      if (cached) el.textContent = cached
    } else {
      var orig = el.getAttribute('data-orig')
      if (orig) { el.textContent = orig; el.removeAttribute('data-orig') }
    }
  })
}

async function callTranslateFunction(texts) {
  try {
    var res = await fetch(TRANSLATE_FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
      },
      body: JSON.stringify({ texts: texts }),
    })
    if (!res.ok) return {}
    var data = await res.json()
    return data.results || {}
  } catch (e) {
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

  // Fire all batches in parallel
  var promises = batches.map(function (batch) {
    return callTranslateFunction(batch).then(function (results) {
      Object.keys(results).forEach(function (key) {
        allResults[key] = results[key]
        setCache(key, results[key])
      })
    })
  })
  await Promise.all(promises)
  return allResults
}

async function translatePage(root) {
  var textNodes = getTextNodes(root)
  var nodeMap = {}
  var uncached = []

  textNodes.forEach(function (node) {
    var text = node.textContent.trim()
    if (shouldSkip(text)) return
    if (!node[ORIG_KEY]) node[ORIG_KEY] = node.textContent
    var cached = getCached(text)
    if (cached) {
      node.textContent = node.textContent.replace(text, cached)
    } else {
      if (!nodeMap[text]) { nodeMap[text] = []; uncached.push(text) }
      nodeMap[text].push(node)
    }
  })

  translateInputs(root, 'hi')
  translateOptions(root, 'hi')

  if (uncached.length > 0) {
    var unique = [...new Set(uncached)]
    var results = await batchTranslate(unique)
    Object.keys(results).forEach(function (original) {
      var translated = results[original]
      ;(nodeMap[original] || []).forEach(function (node) {
        if (node[ORIG_KEY] && node.parentElement) {
          node.textContent = node[ORIG_KEY].replace(original, translated)
        }
      })
    })
  }
}

function restorePage(root) {
  var textNodes = getTextNodes(root)
  textNodes.forEach(function (node) {
    if (node[ORIG_KEY]) {
      node.textContent = node[ORIG_KEY]
      delete node[ORIG_KEY]
    }
  })
  translateInputs(root, 'en')
  translateOptions(root, 'en')
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
