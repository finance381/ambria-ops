/**
 * Builds src/lib/hi.json — the Hindi dictionary shipped with the app.
 *
 * Runtime translation was one network round trip per string once Google started
 * rate-limiting the edge function's IP, so switching to Hindi crawled and left
 * gaps. This pulls the UI's own strings out of the source, translates them once,
 * and commits the result; at runtime the switch is then a lookup.
 *
 * Usage:  node scripts/build-hi-dict.mjs            (fills what is missing)
 *         node scripts/build-hi-dict.mjs --all      (retranslates everything)
 *
 * Reads VITE_SUPABASE_ANON_KEY from .env.production (or the environment).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

// --dir limits extraction to a few folders, so a first pass can cover the
// guest-facing screens without spending the fallback provider's daily quota on
// the whole app.
const dirArg = process.argv.find(function (a) { return a.startsWith('--dir=') })
const SRC_DIRS = dirArg ? dirArg.slice(6).split(',') : ['src']
const OUT = 'src/lib/hi.json'
const FN = 'https://ptksdithbytzrznplfiq.supabase.co/functions/v1/translate'
const BATCH = 40
const RETRIES = 3

// ── the same guards the runtime uses, so the dictionary holds only what the
//    runtime would actually try to translate
const SKIP_WORDS = [
  'ambria', 'ops', 'admin', 'lms', 'pwa', 'csv', 'pdf', 'ppt', 'pptx',
  'supabase', 'google', 'whatsapp', 'gmail', 'upi', 'events',
]
function shouldSkip(t) {
  const trimmed = t.trim()
  if (trimmed.length < 2) return true
  if (/^[\d\s.,₹#%:→←/×·—–()@-]+$/.test(trimmed)) return true
  if (/^[A-Z]{2,5}[-_]\d+/.test(trimmed)) return true
  if (/^https?:|@/.test(trimmed)) return true
  if (/[ऀ-ॿ]/.test(trimmed)) return true
  if (SKIP_WORDS.includes(trimmed.toLowerCase())) return true
  if (/^[A-Z0-9]{2,6}$/.test(trimmed)) return true
  if (/^\+?[\d\s-]{7,}$/.test(trimmed)) return true
  return false
}

// ── code-shaped strings: colours, css, identifiers, paths, template bits
function looksLikeCode(t) {
  if (!/[A-Za-z]/.test(t)) return true
  if (/[#{}<>$`\\|]/.test(t)) return true
  if (/^(rgba?|var|calc|linear-gradient|translate)/i.test(t)) return true
  if (/\d(px|rem|vh|vw|%)\b/.test(t)) return true
  if (/^[a-z][a-zA-Z0-9]*$/.test(t)) return true          // camelCase / single lowercase word
  if (/^[a-z0-9-]+$/.test(t)) return true                  // kebab-case, css class
  if (/\.(jsx?|tsx?|json|css|svg|png)$/i.test(t)) return true
  if (/^[a-z]+(_[a-z0-9]+)+$/.test(t)) return true         // snake_case keys
  if (/(=>|function|return |import |export )/.test(t)) return true
  // fragments of string concatenation in the HTML/PDF builders, e.g. "' + escHtml(r.name) + '"
  if (/(^|\s)\+(\s|$)/.test(t)) return true
  if (/['"]\s*\+|\+\s*['"]/.test(t)) return true
  if (/\w\(/.test(t)) return true
  if (/escHtml|encodeURI|JSON\.|toFixed|padStart/.test(t)) return true
  // a quote or an unbalanced comma-separated list means the regex ran across
  // several literals, e.g. "Valencia', 'Dwarka Exp', 'live"
  if (/["']/.test(t.slice(1, -1).replace(/(\w)'(\w)/g, '$1$2'))) return true
  if (/&&|\|\||===|!==|\.length|=\s|sans-serif|system-ui/.test(t)) return true
  // PascalCase compounds are code identifiers, not copy: ArrowDown, KeyPress
  if (/^[A-Z][a-z]+[A-Z]/.test(t)) return true
  if (/^(Bearer|POST|GET|PATCH|DELETE|Content-Type|Authorization)$/.test(t)) return true
  return false
}

// MyMemory answers from a public translation memory: for a short or ambiguous
// input it happily returns an unrelated sentence from its corpus, or a phrase in
// another language. Anything that fails these checks is left untranslated rather
// than shipped into the UI.
function looksBadTranslation(src, hi) {
  if (!hi) return true
  const t = hi.trim()
  if (!t || t.toLowerCase() === src.toLowerCase()) return true
  if (!/[ऀ-ॿ]/.test(t)) return true                       // no Devanagari at all
  if (t.length > Math.max(24, src.length * 4)) return true // corpus sentence, not a label
  if (/&(gt|lt|amp|quot);/.test(t)) return true
  if (/MYMEMORY|QUOTA|LIMIT|INVALID|TRANSLATION/i.test(t)) return true
  const latin = (t.match(/[A-Za-z]/g) || []).length
  const deva = (t.match(/[ऀ-ॿ]/g) || []).length
  if (latin > deva) return true                            // mostly English came back
  return false
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (['.jsx', '.js'].includes(extname(p))) out.push(p)
  }
  return out
}

function extract(code) {
  const found = new Set()
  const add = (raw) => {
    if (!raw) return
    const t = raw.replace(/\s+/g, ' ').trim()
    if (!t || t.length > 90) return
    if (shouldSkip(t) || looksLikeCode(t)) return
    found.add(t)
  }

  // JSX text between tags
  for (const m of code.matchAll(/>([^<>{}\n]{2,90})</g)) add(m[1])
  // user-facing attributes
  for (const m of code.matchAll(/(?:placeholder|title|aria-label|label)=["']([^"'\n]{2,90})["']/g)) add(m[1])
  // quoted labels that read like UI copy: start with a capital, no code shapes
  for (const m of code.matchAll(/['"]([A-Z][A-Za-z0-9 ,.'/&+()–—-]{1,88})['"]/g)) add(m[1])

  return found
}

async function translateBatch(texts, key) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const res = await fetch(FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key,
      },
      body: JSON.stringify({ texts }),
    })
    if (res.ok) {
      const data = await res.json()
      const got = Object.keys(data.results || {}).length
      if (got > 0 || attempt === RETRIES) {
        return { results: data.results || {}, provider: data.provider, note: data.note }
      }
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt))
  }
  return { results: {} }
}

function readKey() {
  if (process.env.VITE_SUPABASE_ANON_KEY) return process.env.VITE_SUPABASE_ANON_KEY
  for (const f of ['.env.production', '.env.local']) {
    if (!existsSync(f)) continue
    const m = readFileSync(f, 'utf8').match(/VITE_SUPABASE_ANON_KEY\s*=\s*(.+)/)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  throw new Error('VITE_SUPABASE_ANON_KEY not found')
}

const all = process.argv.includes('--all')
const dry = process.argv.includes('--dry')
const key = dry ? '' : readKey()
const existing = !all && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}

const strings = new Set()
for (const dir of SRC_DIRS) for (const file of walk(dir)) for (const s of extract(readFileSync(file, 'utf8'))) strings.add(s)

const todo = [...strings].filter((s) => !existing[s]).sort()
console.log(`${strings.size} strings found, ${Object.keys(existing).length} already translated, ${todo.length} to do`)

if (dry) {
  // dump every extracted string, not just the missing ones, so the list can
  // be audited against what the dictionary holds
  writeFileSync('hi-strings.txt', [...strings].sort().join('\n') + '\n')
  console.log('wrote hi-strings.txt (no translation performed)')
  process.exit(0)
}

const dict = { ...existing }
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH)
  const { results, provider, note } = await translateBatch(batch, key)
  let kept = 0
  let rejected = 0
  for (const [src, hi] of Object.entries(results)) {
    if (looksBadTranslation(src, hi)) { rejected++; continue }
    dict[src] = hi
    kept++
  }
  const done = Math.min(i + BATCH, todo.length)
  console.log(`  ${done}/${todo.length}  +${kept}${rejected ? ' (-' + rejected + ' junk)' : ''} via ${provider || '-'}${note ? ' (' + note + ')' : ''}`)
}

const sorted = {}
for (const k of Object.keys(dict).sort()) sorted[k] = dict[k]
writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n')
console.log(`wrote ${OUT} with ${Object.keys(sorted).length} entries (${todo.length - (Object.keys(dict).length - Object.keys(existing).length)} still missing)`)
