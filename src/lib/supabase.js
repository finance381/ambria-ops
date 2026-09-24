import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    db: { schema: 'public' },
  })

export async function fetchAll(query, pageSize) {
  pageSize = pageSize || 1000
  var all = []
  var from = 0
  while (true) {
    var { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw error
    all = all.concat(data || [])
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return all
}

// supabase.functions.invoke()'s error.message is always the generic
// "Edge Function returned a non-2xx status code" — the function's actual
// { error: "..." } response body lands in error.context (the raw Response)
// instead, unread by default. Every edge-fn error handler in this app was
// showing that generic line and throwing away the real reason. Use this
// wherever a functions.invoke() call's error is shown to a user.
export async function edgeFnErrorMessage(error) {
  if (!error) return ''
  try {
    if (error.context && typeof error.context.json === 'function') {
      var body = await error.context.clone().json()
      if (body && (body.error || body.message)) return body.error || body.message
    }
  } catch (_) {}
  return error.message || 'Request failed'
}

export function getImageUrl(path) {
  if (!path) return null
  if (path.startsWith('http') || path.startsWith('data:')) return path
  return import.meta.env.VITE_SUPABASE_URL + '/storage/v1/object/public/images/' + path
}