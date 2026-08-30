import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Shell from './components/layout/Shell'
import AdminShell from './components/layout/AdminShell'
import PublicEmployeeForm from './pages/PublicEmployeeForm'
import { LangProvider } from './lib/i18n.jsx'
import UpdateBanner from './components/UpdateBanner'
import { expandToLegacy } from './lib/permissions'

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

  // Per-surface profile enrichment (Phase 3 / v98).
  // `permissions` (legacy array) is what all existing perms.indexOf(...) checks
  // read. We rebuild it per-surface from mobile_permissions / desktop_permissions
  // so mobile users only see mobile-scoped features and vice versa.
  // `permsNew` exposes the raw new-key array for granular checks (LedgersHub).
  // `dataScopes` exposes the JSONB for row-scope-aware components.
  function surfaceProfile(p, surface) {
    var raw = (surface === 'desktop' ? p.desktop_permissions : p.mobile_permissions) || []
    return Object.assign({}, p, {
      permissions: expandToLegacy(raw),
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