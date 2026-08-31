import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Shell from './components/layout/Shell'
import AdminShell from './components/layout/AdminShell'
import PublicEmployeeForm from './pages/PublicEmployeeForm'
import { LangProvider } from './lib/i18n.jsx'
import UpdateBanner from './components/UpdateBanner'


// Safety net: if a lazy chunk 404s (stale bundle after deploy), reload once.
// Guarded to prevent an infinite reload loop if the failure is not deploy-related.
if (typeof window !== 'undefined' && !window.__ambriaChunkReloadTried) {
  window.addEventListener('vite:preloadError', function (e) {
    if (window.__ambriaChunkReloadTried) return
    window.__ambriaChunkReloadTried = true
    e.preventDefault()
    window.location.reload()
  })
}

function App() {
  var params = new URLSearchParams(window.location.search)
  if (params.get('form') === 'employee') {
    // Legacy URL — form now lives outside PWA scope. Delete this block in v78.
    window.location.replace('https://finance381.github.io/employee-form/')
    return null
  }

  var { user, profile, loading, signIn, signOut } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    )
  }

  if (!user || !profile) {
    return <Login />
  }

  // Per-surface profile enrichment (v100 / Phase 4).
  // permsNew: raw new-key array per surface — all perm checks read this via hasPerm().
  // dataScopes: JSONB for row-scope-aware components.
  function surfaceProfile(p, surface) {
    var raw = (surface === 'desktop' ? p.desktop_permissions : p.mobile_permissions) || []
    return Object.assign({}, p, {
      permsNew:    raw,
      dataScopes:  p.data_scopes || {},
    })
  }

  var _isPrivileged = profile.role === 'admin' || profile.role === 'auditor'
  var _hasDesktopPerms = (profile.desktop_permissions || []).some(function (k) { return k !== 'personal.profile' })
  if (params.get('view') === 'admin' && (_isPrivileged || _hasDesktopPerms)) {
    return <LangProvider><AdminShell profile={surfaceProfile(profile, 'desktop')} onSignOut={signOut} /><UpdateBanner /></LangProvider>
  }

  return <LangProvider><Shell profile={surfaceProfile(profile, 'mobile')} onSignOut={signOut} /><UpdateBanner /></LangProvider>
}

export default App