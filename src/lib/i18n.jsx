import { createContext, useContext, useState, useEffect, useCallback } from 'react'

var CACHE_PREFIX = 'hi_'
var DEBOUNCE_MS = 400
var ORIG_KEY = '__orig_text__'
var DONE_KEY = '__hi_text__'
var BATCH_SIZE = 40

// Your Supabase Edge Function
var TRANSLATE_FN = 'https://ptksdithbytzrznplfiq.supabase.co/functions/v1/translate'
var ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Brand and technical names only. Anything in here can NEVER be translated,
// so a plain English word does not belong: 'events' was on this list and it
// is the label on a menu tile, which is why Events sat in English beside
// Inventory and Finance in Hindi. The table name it was presumably guarding
// is not user-visible text and never reaches this function.
var SKIP_WORDS = [
  'ambria', 'ops', 'admin', 'lms', 'pwa', 'csv', 'pdf', 'ppt', 'pptx',
  'supabase', 'google', 'whatsapp', 'gmail', 'upi',
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

// MyMemory answers from a public translation memory, so for a short or ambiguous
// label it can return an unrelated sentence from its corpus ("Inventory" came
// back as a Hindi exam question) or a phrase in another language ("Discount" ->
// "Prisavslag"). Junk like that has to be caught against the source string, not
// just scanned for provider warnings.
function looksBadTranslation(src, hi) {
  if (!hi || isErrorResponse(hi)) return true
  var t = String(hi).trim()
  if (!t || t.toLowerCase() === String(src).toLowerCase()) return true
  if (!/[ऀ-ॿ]/.test(t)) return true
  if (t.length > Math.max(24, String(src).length * 4)) return true
  if (/&(gt|lt|amp|quot);/.test(t)) return true
  var latin = (t.match(/[A-Za-z]/g) || []).length
  var deva = (t.match(/[ऀ-ॿ]/g) || []).length
  if (latin > deva) return true
  return false
}

// The shipped dictionary: built by scripts/build-hi-dict.mjs from the app's own
// source, so switching to Hindi is a lookup instead of a network round trip per
// string. Loaded on demand — English sessions never pay for it.
var DICT = {}
var dictPromise = null
function loadDict() {
  if (!dictPromise) {
    dictPromise = import('./hi.json')
      .then(function (m) { DICT = (m && m.default) || m || {}; return DICT })
      .catch(function () { return {} })
  }
  return dictPromise
}

// localStorage.getItem is synchronous disk I/O, and this ran once per TEXT
// NODE rather than once per unique string. Ninety wallet rows repeat the same
// dozen labels, so a single pass made hundreds of identical reads, each one
// followed by the regexes in looksBadTranslation — and the observer reruns the
// whole pass on every burst of React commits.
//
// Misses are remembered too. Without that, every string the app has no
// translation for goes back to storage on every pass, for the life of the tab,
// and those are exactly the strings there are most of.
var memo = new Map()

function getCached(text) {
  // dictionary first: it is curated and cannot go stale behind a bad API answer
  if (DICT[text]) return DICT[text]
  if (memo.has(text)) return memo.get(text)
  var out = null
  try {
    var val = localStorage.getItem(CACHE_PREFIX + text)
    // Junk cached before this check existed is dropped on read, so a browser
    // that already stored a bad answer repairs itself instead of showing it.
    if (val && looksBadTranslation(text, val)) localStorage.removeItem(CACHE_PREFIX + text)
    else out = val
  } catch (e) { out = null }
  memo.set(text, out)
  return out
}

function setCache(text, val) {
  if (looksBadTranslation(text, val)) return
  // The memo has to learn it here too, or the pass that just fetched this
  // string would read a stale miss on its next run.
  memo.set(text, val)
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

async function batchTranslate(strings, onBatch) {
  var allResults = {}

  // Split into batches of BATCH_SIZE
  var batches = []
  for (var i = 0; i < strings.length; i += BATCH_SIZE) {
    batches.push(strings.slice(i, i + BATCH_SIZE))
  }

  function run(batch) {
    return callTranslateFunction(batch).then(function (results) {
      var fresh = {}
      Object.keys(results).forEach(function (key) {
        if (looksBadTranslation(key, results[key])) return
        allResults[key] = results[key]
        fresh[key] = results[key]
        setCache(key, results[key])
      })
      // Paint what this batch answered instead of waiting for the slowest
      // batch and the retry sleep behind it.
      if (onBatch && Object.keys(fresh).length > 0) onBatch(fresh)
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
  // Painting the dictionary is synchronous once it is in memory, so the switch
  // is instant for every string the app ships a translation for. Only the
  // leftovers wait on a network round trip, and they now arrive in pieces.
  await loadDict()
  var nodeMap = {}
  var targetMap = {}
  var uncached = []

  getTextNodes(root).forEach(function (node) {
    // React reuses text nodes rather than rebuilding them. Switching the
    // expense list from Mine to All rewrites the same nodes with different
    // content, so the original recorded on the first pass belongs to a row
    // that is gone — and replace() could not find the NEW text inside that
    // stale original, so the node was rewritten with the OLD row's words.
    // That is what "Hindi is wrong on All" was: not a missing translation,
    // a correct translation of the previous screen.
    //
    // Content that is neither the English we recorded nor the Hindi we
    // painted means the node has been recycled; forget what we knew.
    if (node[ORIG_KEY] != null &&
        node.textContent !== node[ORIG_KEY] &&
        node.textContent !== node[DONE_KEY]) {
      delete node[ORIG_KEY]
      delete node[DONE_KEY]
    }
    var text = node.textContent.trim()
    // The dictionary outranks the guards. shouldSkip is heuristics — an
    // all-caps token is probably an acronym, a word on SKIP_WORDS is
    // probably a brand — and heuristics have no way to know that HR and
    // Admin are menu labels while LMS and GST are not. A dictionary entry is
    // somebody deciding on purpose, so it wins; anything nobody has decided
    // about still falls to the guards.
    if (!DICT[text] && shouldSkip(text)) return
    if (!node[ORIG_KEY]) node[ORIG_KEY] = node.textContent
    var cached = getCached(text)
    if (cached) {
      node.textContent = node[ORIG_KEY].replace(text, cached)
      node[DONE_KEY] = node.textContent
      return
    }
    if (!nodeMap[text]) { nodeMap[text] = []; uncached.push(text) }
    nodeMap[text].push(node)
  })

  collectAttrTargets(root).forEach(function (t) {
    var text = readTarget(t).trim()
    if (!text || (!DICT[text] && shouldSkip(text))) return
    var cached = getCached(text)
    if (cached) { writeTarget(t, text, cached); return }
    if (!targetMap[text]) { targetMap[text] = []; uncached.push(text) }
    targetMap[text].push(t)
  })

  if (uncached.length === 0) return

  function paint(results) {
    Object.keys(results).forEach(function (original) {
      var translated = results[original]
      if (looksBadTranslation(original, translated)) return
      ;(nodeMap[original] || []).forEach(function (node) {
        if (node[ORIG_KEY] && node.parentElement) {
          node.textContent = node[ORIG_KEY].replace(original, translated)
          node[DONE_KEY] = node.textContent
        }
      })
      ;(targetMap[original] || []).forEach(function (t) {
        writeTarget(t, original, translated)
      })
    })
  }

  var unique = [...new Set(uncached)]
  await batchTranslate(unique, paint)
}

function restorePage(root) {
  getTextNodes(root).forEach(function (node) {
    if (node[ORIG_KEY]) {
      node.textContent = node[ORIG_KEY]
      delete node[ORIG_KEY]
      delete node[DONE_KEY]
    }
  })
  collectAttrTargets(root).forEach(restoreTarget)
}

var LangContext = createContext()

export function LangProvider({ children }) {
  var [lang, setLang] = useState(function () {
    var saved
    try { saved = localStorage.getItem('ambria_lang') || 'en' } catch (e) { saved = 'en' }
    // A session that reloads in Hindi used to import the dictionary only once
    // the first translate pass asked for it, which put the whole first screen
    // behind a module fetch. Start it here instead, before anything renders.
    if (saved === 'hi') loadDict()
    return saved
  })

  var translateRef = useCallback(function () {
    if (lang === 'hi') {
      translatePage(document.body)
    } else {
      restorePage(document.body)
    }
  }, [lang])

  useEffect(function () {
    // Immediate on a language change; the debounce below is only for the
    // observer, which fires in bursts as React commits.
    translateRef()
    var timeout = null
    var observer = new MutationObserver(function (mutations) {
      if (lang !== 'hi') return
      // characterData as well as addedNodes. A list that swaps its data
      // without changing its shape — Mine to All, a status filter, the next
      // page of results — rewrites existing text nodes in place and adds
      // none, so watching only for new nodes meant those screens were never
      // re-translated at all.
      //
      // This cannot loop on our own writes: what we write is Devanagari, and
      // shouldSkip rejects Devanagari, so the pass a write triggers changes
      // nothing and produces no further mutations.
      var hasNewContent = mutations.some(function (m) {
        return m.addedNodes.length > 0 || m.type === 'characterData'
      })
      if (hasNewContent) {
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(function () { translatePage(document.body) }, DEBOUNCE_MS)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return function () {
      if (timeout) clearTimeout(timeout)
      observer.disconnect()
    }
  }, [lang, translateRef])

  function switchLang(newLang) {
    if (newLang === lang) return
    if (newLang === 'hi') loadDict()
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
