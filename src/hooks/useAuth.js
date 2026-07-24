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
    await supabase.auth.signOut()
  }

  return { user, profile, loading, signIn, signOut }
}