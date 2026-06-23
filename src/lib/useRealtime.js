import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

export function useRealtime(tables, onEvent) {
  var timer = useRef(null)
  useEffect(function () {
    if (!tables || tables.length === 0) return
    function debounced() {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(onEvent, 500)
    }
    var channel = supabase.channel('rt-' + tables.join('-'))
    tables.forEach(function (t) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, debounced)
    })
    channel.subscribe()
    return function () { supabase.removeChannel(channel) }
  }, [tables.join(',')])
}