import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  var fetchedId = { current: null }

  useEffect(function () {
    var ignore = false

    const { data: { subscription } } = supabase.auth.onAuthStateChange(function (_event, session) {
      if (ignore) return
      if (session?.user) {
        setUser(session.user)
        if (fetchedId.current !== session.user.id) {
          fetchedId.current = session.user.id
          fetchProfile(session.user)
        }
      } else {
        fetchedId.current = null
        setUser(null)
        setProfile(null)
        setLoading(false)
      }
    })

    return function () { ignore = true; subscription.unsubscribe() }
  }, [])

  // supabase-js's own auto-refresh runs on a setTimeout scheduled ahead of the
  // access token's expiry -- browsers throttle/pause that timer while the tab
  // is backgrounded (common for a PWA people leave open and come back to), so
  // the token can sit expired until the user reopens the app and immediately
  // taps something, firing a request with the stale token before a refresh
  // gets a chance to run. getSession() re-validates (and refreshes if needed)
  // on every foreground, closing that window. Same pattern UpdateBanner.jsx
  // already uses for its own update check on visibilitychange.
  useEffect(function () {
    function onVisible() {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession().catch(function () {})
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return function () { document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  function fetchProfile(authUser) {
    supabase.rpc('ensure_profile').then(function ({ data, error }) {
      if (error) {
        console.error('ensure_profile failed:', error)
        setLoading(false)
        return
      }
      var row = Array.isArray(data) ? data[0] : data
      if (row) {
        row.email = authUser.email
        setProfile(row)
      }
      setLoading(false)
    })
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signOut() {
    try { sessionStorage.removeItem('ambria_nav'); sessionStorage.removeItem('ambria.admin.nav') } catch (_) {}
    await supabase.auth.signOut()
  }

  return { user, profile, loading, signIn, signOut }
}