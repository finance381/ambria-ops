import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Shell from './components/layout/Shell'
import AdminShell from './components/layout/AdminShell'
import { LangProvider } from './lib/i18n.jsx'

function App() {
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

  var params = new URLSearchParams(window.location.search)
  if (params.get('view') === 'admin' && (profile.role === 'admin' || profile.role === 'auditor')) {
    return <LangProvider><AdminShell profile={profile} onSignOut={signOut} /></LangProvider>
  }

  return <LangProvider><Shell profile={profile} onSignOut={signOut} /></LangProvider>
}

export default App