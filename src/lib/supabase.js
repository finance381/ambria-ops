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

export function getImageUrl(path) {
  if (!path) return null
  if (path.startsWith('http') || path.startsWith('data:')) return path
  return import.meta.env.VITE_SUPABASE_URL + '/storage/v1/object/public/images/' + path
}