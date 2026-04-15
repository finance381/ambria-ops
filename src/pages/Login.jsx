import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function Login() {
  var [loading, setLoading] = useState(false)
  var [error, setError] = useState('')
  var [installPrompt, setInstallPrompt] = useState(null)

  useEffect(function () {
    function handlePrompt(e) {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handlePrompt)
    return function () { window.removeEventListener('beforeinstallprompt', handlePrompt) }
  }, [])

  async function handleGoogleLogin() {
    setLoading(true)
    setError('')
    var { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://finance381.github.io/ambria-ops/',
      }
    })
    if (authError) {
      setError(authError.message)
      setLoading(false)
    }
  }

  async function handleInstall() {
    if (!installPrompt) return
    installPrompt.prompt()
    var result = await installPrompt.userChoice
    if (result.outcome === 'accepted') {
      setInstallPrompt(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-6 mb-8">
          <div className="bg-gray-900 rounded-2xl px-7 py-5 shadow-lg">
            <span className="text-white text-2xl font-bold tracking-tight">AMBRIA</span>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">Sign in to continue</h1>
            <p className="mt-1 text-sm text-gray-500">Sign in with your Google account to submit inventory items.</p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="flex items-center gap-3 px-6 py-3 bg-white border border-gray-300 rounded-lg shadow-sm hover:shadow-md hover:border-gray-400 transition-all disabled:opacity-50"
          >
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            <span className="text-sm font-medium text-gray-700">
              {loading ? 'Redirecting...' : 'Sign in with Google'}
            </span>
          </button>

          {installPrompt && (
            <button
              onClick={handleInstall}
              className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:border-gray-400 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15V3M12 15l-4-4M12 15l4-4"/>
                <path d="M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17"/>
              </svg>
              Install App
            </button>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-2 w-full text-center">
              {error}
            </div>
          )}
        </div>

        <p className="mt-8 text-center text-[11px] text-gray-300 tracking-wider">
          Ambria <span className="text-amber-400">●</span> Inventory Manager
        </p>
      </div>
    </div>
  )
}

export default Login