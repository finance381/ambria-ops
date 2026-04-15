import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { 'Cache-Control': 'max-age=30' },
    },
    db: { schema: 'public' },
  })

export function getImageUrl(path) {
  if (!path) return null
  if (path.startsWith('http') || path.startsWith('data:')) return path
  return import.meta.env.VITE_SUPABASE_URL + '/storage/v1/object/public/images/' + path
}