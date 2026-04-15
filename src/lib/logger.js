import { supabase } from './supabase'

function logActivity(action, details) {
  supabase.rpc('log_activity', {
    p_action: action,
    p_details: typeof details === 'string' ? details : JSON.stringify(details),
  }).then(function (res) {
    if (res.error) console.warn('Log failed:', res.error.message)
  })
}

export { logActivity }