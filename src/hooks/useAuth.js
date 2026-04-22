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
    supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle()
      .then(function ({ data, error }) {
        if (data) {
          data.email = authUser.email
          setProfile(data)
          setLoading(false)
        } else {
          // New Google user — profile created by trigger, retry once
          setTimeout(function () {
            supabase
              .from('profiles')
              .select('*')
              .eq('id', authUser.id)
              .maybeSingle()
              .then(function ({ data: retryData }) {
                if (retryData) {
                  retryData.email = authUser.email
                  setProfile(retryData)
                }
                setLoading(false)
              })
          }, 1500)
        }
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