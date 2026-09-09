import { useState, lazy, Suspense } from 'react'
import { hasPerm } from '../../lib/permissions'

// Shell.jsx (mobile) renders one component per tab, unlike AdminShell's
// TabbedSection mechanism — this wrapper gives the mobile shell the same
// Templates/Contacts/Campaigns/Inbox/Settings sub-nav AdminShell gets via
// SUB_TAB_CONFIG.broadcast. Not verified at narrow phone widths — these
// pages (tables, multi-column forms) were built desktop-first.
//
// Must stay lazy(): Shell.jsx is statically imported at the app root (not
// itself lazy), so a plain static import here would pull all 5 sub-pages
// into the main bundle for every user, not just those with broadcast perms.
var Templates = lazy(function () { return import('./Templates') })
var Contacts = lazy(function () { return import('./Contacts') })
var Campaigns = lazy(function () { return import('./Campaigns') })
var Inbox = lazy(function () { return import('./Inbox') })
var Settings = lazy(function () { return import('./Settings') })

var SUB_TABS = [
  { key: 'templates', label: 'Templates', component: Templates, perm: 'broadcast.templates.view' },
  { key: 'contacts', label: 'Contacts', component: Contacts, perm: 'broadcast.contacts.view' },
  { key: 'campaigns', label: 'Campaigns', component: Campaigns, perm: 'broadcast.campaigns.view' },
  { key: 'inbox', label: 'Inbox', component: Inbox, perm: 'broadcast.inbox.view' },
  { key: 'settings', label: 'Settings', component: Settings, perm: 'broadcast.settings' },
]

function BroadcastHub({ profile }) {
  var permsNew = (profile && profile.permsNew) || []
  var visible = SUB_TABS.filter(function (t) { return hasPerm(permsNew, t.perm) })
  var [sub, setSub] = useState(visible.length > 0 ? visible[0].key : null)
  var active = visible.find(function (t) { return t.key === sub })
  var ActiveComponent = active ? active.component : null

  if (visible.length === 0) return <p className="text-sm text-gray-400 text-center py-8">No access</p>

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 border-b border-gray-200 overflow-x-auto">
        {visible.map(function (t) {
          return (
            <button key={t.key} onClick={function () { setSub(t.key) }}
              className={"px-3 py-2 text-sm font-semibold border-b-2 whitespace-nowrap " + (sub === t.key ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500")}>
              {t.label}
            </button>
          )
        })}
      </div>
      {ActiveComponent && (
        <Suspense fallback={<p className="text-center text-sm text-gray-400 py-8">Loading...</p>}>
          <ActiveComponent profile={profile} />
        </Suspense>
      )}
    </div>
  )
}

export default BroadcastHub
