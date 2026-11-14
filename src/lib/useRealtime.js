import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

export function useRealtime(tables, onEvent) {
  var timer = useRef(null)
  // The channel is set up once, but the handler is a new function every
  // render. Calling the first one forever meant it read the filters/page from
  // the first render, so any change on the table reloaded the list unfiltered
  // at page 1 while the filter chips still showed the old filter. The ref
  // always holds the latest handler.
  var handlerRef = useRef(onEvent)
  handlerRef.current = onEvent
  useEffect(function () {
    if (!tables || tables.length === 0) return
    function debounced() {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(function () { if (handlerRef.current) handlerRef.current() }, 500)
    }
    var channel = supabase.channel('rt-' + tables.join('-'))
    tables.forEach(function (t) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, debounced)
    })
    channel.subscribe()
    return function () { if (timer.current) clearTimeout(timer.current); supabase.removeChannel(channel) }
  }, [tables.join(',')])
}