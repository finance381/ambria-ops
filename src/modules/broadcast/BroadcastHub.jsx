import { useState, useEffect, lazy, Suspense } from 'react'
import { hasPerm } from '../../lib/permissions'
import Icon from '../../components/ui/Icon'

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
  { key: 'templates', label: 'Templates', icon: 'fileText', component: Templates, perm: 'broadcast.templates.view' },
  { key: 'contacts', label: 'Contacts', icon: 'users', component: Contacts, perm: 'broadcast.contacts.view' },
  { key: 'campaigns', label: 'Campaigns', icon: 'send', component: Campaigns, perm: 'broadcast.campaigns.view' },
  { key: 'inbox', label: 'Inbox', icon: 'inbox', component: Inbox, perm: 'broadcast.inbox.view' },
  { key: 'settings', label: 'Settings', icon: 'settings', component: Settings, perm: 'broadcast.settings' },
]


function BroadcastHub({ profile, activeSubTab }) {
  var permsNew = (profile && profile.permsNew) || []
  var visible = SUB_TABS.filter(function (t) { return hasPerm(permsNew, t.perm) })
  var _initial = activeSubTab && visible.find(function (t) { return t.key === activeSubTab })
    ? activeSubTab
    : (visible.length > 0 ? visible[0].key : null)
  var [sub, setSub] = useState(_initial)

  // The admin shell can deep-link to a sub-tab, so follow that when it
  // changes rather than staying on whatever was opened first.
  useEffect(function () {
    if (activeSubTab && visible.find(function (t) { return t.key === activeSubTab })) setSub(activeSubTab)
  }, [activeSubTab])
  var active = visible.find(function (t) { return t.key === sub })
  var ActiveComponent = active ? active.component : null

  if (visible.length === 0) return <p className="text-sm text-slate-400 text-center py-8">No access</p>

  return (
    // -mx/-mt push the ground out to the shell's own padding and the padding
    // is re-applied inside, so the wash reaches the edges while the content
    // keeps its gutters.
    <div className="relative isolate flex flex-col space-y-4 -mx-4 px-4 -mt-4 pt-4 md:-mx-8 md:px-8 md:-mt-6 md:pt-6 lg:h-[calc(100dvh-var(--app-header-h,0px)-2rem)]">
      {/* The page header for this module, in both shells: admin suppresses
          its own generic heading for broadcast so this is the only one. It
          carries the icon and the line of context that a bare section title
          cannot. */}
      <div className="shrink-0 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="shrink-0 w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 inline-flex items-center justify-center">
            <Icon name="send" size={30} strokeWidth={2.1} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[23px] font-extrabold text-slate-900 tracking-[-0.025em] leading-tight">API Marketing</h2>
            <p className="text-[12.5px] text-slate-500 leading-snug mt-0.5">
              Create and manage message templates for your marketing campaigns
            </p>
          </div>
        </div>
        <div className="hidden lg:block text-right shrink-0">
          <p className="font-display text-[12.5px] font-extrabold text-indigo-600 leading-tight tracking-[-0.01em]">Create. Automate. Grow.</p>
          <p className="text-[11px] text-slate-400 leading-snug">Smarter campaigns. Stronger connections.</p>
        </div>
      </div>

      {/* Scrolls sideways rather than wrapping: a wrapped second row of tabs
          moves the content down and back up as you switch. On a phone it no
          longer has anything to scroll — see the icon rule below. */}
      <div className="shrink-0 flex gap-1 border-b border-slate-200 overflow-x-auto overflow-y-hidden sm:overflow-x-visible sm:overflow-y-visible">
        {visible.map(function (t) {
          var on = sub === t.key
          return (
            <button key={t.key} onClick={function () { setSub(t.key) }}
              className={"flex-1 justify-center inline-flex items-center gap-1.5 px-1.5 sm:px-3 py-2.5 text-[11.5px] sm:text-[13px] font-semibold border-b-2 -mb-px whitespace-nowrap origin-bottom transform-gpu transition-all duration-150 " +
                (on
                  ? "border-indigo-600 text-indigo-700"
                  // Rounded on the top corners only: the bottom edge carries
                  // the underline, and a full pill would lift the label off
                  // the rule the row is aligned to. origin-bottom keeps that
                  // border on the rule while the label grows upward.
                  : "border-transparent text-slate-500 rounded-t-lg hover:text-slate-900 hover:border-slate-300 hover:bg-slate-900/[0.04] hover:scale-[1.05]")}>
              {/* Hidden on a phone: five icons are the ~90px that pushed this
                  row off the screen, and the labels alone say the same thing. */}
              <span className="hidden sm:inline-flex"><Icon name={t.icon} size={14} /></span>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* min-h-0 is what lets a flex child actually shrink — without it the
          child keeps its content height and pushes the page into scrolling,
          which is the whole thing this layout is avoiding.

          overflow-y-auto is the backstop. Templates and Inbox size themselves
          to h-full and scroll internally, so nothing overflows here and no
          scrollbar appears. Settings and Campaigns are just tall documents —
          without this they overflowed the fixed shell and took the whole page
          scrolling with them, which pushed the page header and tabs out of
          sight. */}
      {ActiveComponent && (
        <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto ambria-thin-scroll lg:pr-1">
          <Suspense fallback={<p className="text-center text-[13px] text-slate-400 py-10">Loading…</p>}>
            <ActiveComponent profile={profile} />
          </Suspense>
        </div>
      )}
    </div>
  )
}

export default BroadcastHub
