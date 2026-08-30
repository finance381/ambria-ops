import { useState } from 'react'
import { PERM_GROUPS, DATA_SCOPE_OPTIONS } from '../lib/permissions'

function toggleInArray(arr, key) {
  var next = (arr || []).slice()
  var i = next.indexOf(key)
  if (i >= 0) next.splice(i, 1)
  else next.push(key)
  return next
}

function Toggle(props) {
  if (!props.enabled) {
    return <span className="text-gray-300 text-xs">—</span>
  }
  return (
    <button type="button" onClick={props.onClick} disabled={props.readOnly}
      className={"w-8 h-4 rounded-full transition-colors relative inline-block " +
        (props.on ? "bg-indigo-500" : "bg-gray-300") +
        (props.readOnly ? " opacity-60 cursor-not-allowed" : " cursor-pointer")}>
      <span className={"absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform " +
        (props.on ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  )
}

function ScopeChip(props) {
  var [open, setOpen] = useState(false)
  if (props.inherited) {
    return <span className="text-[10px] text-gray-400 italic">inherits</span>
  }
  var pick = DATA_SCOPE_OPTIONS.find(function (o) { return o.value === props.value }) || DATA_SCOPE_OPTIONS[0]
  return (
    <span className="relative inline-block">
      <button type="button" onClick={function () { if (!props.readOnly) setOpen(!open) }} disabled={props.readOnly}
        className={"text-[11px] px-2 py-0.5 bg-white border border-gray-200 rounded-full text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1 " +
          (props.readOnly ? "opacity-60 cursor-not-allowed" : "")}>
        <i className={"ti " + pick.icon} style={{ fontSize: '10px' }} aria-hidden="true" />
        <span>{pick.label}</span>
        <i className="ti ti-chevron-down" style={{ fontSize: '10px' }} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[150px]">
          {DATA_SCOPE_OPTIONS.map(function (o) {
            return (
              <button key={o.value} type="button"
                onClick={function () { props.onChange(o.value); setOpen(false) }}
                className={"w-full text-left px-3 py-1.5 text-[12px] hover:bg-gray-50 flex items-center gap-2 " +
                  (o.value === props.value ? "bg-indigo-50 text-indigo-700 font-medium" : "text-gray-700")}>
                <i className={"ti " + o.icon} style={{ fontSize: '12px' }} aria-hidden="true" />
                <span className="flex-1">{o.label}</span>
                <span className="text-[10px] text-gray-400">{o.note}</span>
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}

function NodeRow(props) {
  var node = props.node
  var value = props.value
  var onChange = props.onChange
  var indent = props.indent || 0
  var parentScope = props.parentScope
  var readOnly = props.readOnly

  var [expanded, setExpanded] = useState(true)

  var hasChildren = Array.isArray(node.children) && node.children.length > 0
  var scope = node.scope || 'both'
  var showMobile = scope === 'mobile' || scope === 'both'
  var showDesktop = scope === 'desktop' || scope === 'both'
  var mobileOn = (value.mobile || []).indexOf(node.key) !== -1
  var desktopOn = (value.desktop || []).indexOf(node.key) !== -1

  function commitMobile() {
    if (readOnly) return
    onChange(Object.assign({}, value, { mobile: toggleInArray(value.mobile, node.key) }))
  }
  function commitDesktop() {
    if (readOnly) return
    onChange(Object.assign({}, value, { desktop: toggleInArray(value.desktop, node.key) }))
  }
  function setNodeScope(v) {
    if (readOnly) return
    var nextScopes = Object.assign({}, value.scopes || {})
    if (v === 'all') delete nextScopes[node.key]
    else nextScopes[node.key] = v
    onChange(Object.assign({}, value, { scopes: nextScopes }))
  }
  function toggleOptional(optKey) {
    if (readOnly) return
    var inMob = (value.mobile || []).indexOf(optKey) !== -1
    var inDesk = (value.desktop || []).indexOf(optKey) !== -1
    var nextMob = value.mobile || []
    var nextDesk = value.desktop || []
    if (inMob || inDesk) {
      nextMob = nextMob.filter(function (k) { return k !== optKey })
      nextDesk = nextDesk.filter(function (k) { return k !== optKey })
    } else {
      if (showMobile) nextMob = nextMob.concat([optKey])
      if (showDesktop) nextDesk = nextDesk.concat([optKey])
    }
    onChange(Object.assign({}, value, { mobile: nextMob, desktop: nextDesk }))
  }

  var scopeValue = (value.scopes && value.scopes[node.key]) || parentScope || 'all'
  var inheritsScope = !(value.scopes && value.scopes[node.key]) && !!parentScope
  var padLeft = 12 + indent

  return (
    <div>
      <div className="grid items-center bg-white border-b border-gray-100"
        style={{ gridTemplateColumns: '1fr 130px 60px 60px', paddingLeft: padLeft + 'px', paddingRight: '12px', paddingTop: '6px', paddingBottom: '6px' }}>
        <div className="text-[12px] flex items-center gap-1">
          {hasChildren ? (
            <button type="button" onClick={function () { setExpanded(!expanded) }}
              className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-700">
              <i className={"ti " + (expanded ? "ti-chevron-down" : "ti-chevron-right")} style={{ fontSize: '13px' }} aria-hidden="true" />
            </button>
          ) : <span style={{ display: 'inline-block', width: '16px' }} />}
          <span className={mobileOn || desktopOn ? "text-gray-800" : "text-gray-500"}>{node.label}</span>
          {node.note && (
            <span className="text-[10px] text-amber-600 ml-1" title={node.note}>ℹ</span>
          )}
        </div>
        <div className="text-center">
          {node.dataScope ? (
            <ScopeChip value={scopeValue} inherited={inheritsScope} readOnly={readOnly} onChange={setNodeScope} />
          ) : null}
        </div>
        <div className="text-center">
          <Toggle enabled={showMobile} on={mobileOn} onClick={commitMobile} readOnly={readOnly} />
        </div>
        <div className="text-center">
          <Toggle enabled={showDesktop} on={desktopOn} onClick={commitDesktop} readOnly={readOnly} />
        </div>
      </div>

      {node.optional && node.optional.length > 0 && (mobileOn || desktopOn) && (
        <div className="bg-gray-50 border-b border-gray-100 flex flex-wrap gap-x-4 gap-y-1"
          style={{ paddingLeft: (28 + indent) + 'px', paddingRight: '12px', paddingTop: '4px', paddingBottom: '4px' }}>
          {node.optional.map(function (opt) {
            var optChecked = (value.mobile || []).indexOf(opt.key) !== -1 || (value.desktop || []).indexOf(opt.key) !== -1
            return (
              <label key={opt.key} className={"flex items-center gap-1.5 text-gray-600 " + (readOnly ? "" : "cursor-pointer")}>
                <input type="checkbox" checked={optChecked} disabled={readOnly}
                  onChange={function () { toggleOptional(opt.key) }}
                  className="w-3 h-3 accent-indigo-600" style={{ fontSize: '16px' }} />
                <span className="text-[11px]">{opt.label}</span>
              </label>
            )
          })}
        </div>
      )}

      {hasChildren && expanded && node.children.map(function (child) {
        return (
          <NodeRow key={child.key} node={child} value={value} onChange={onChange}
            indent={indent + 20} parentScope={node.dataScope ? scopeValue : parentScope} readOnly={readOnly} />
        )
      })}
    </div>
  )
}

function PermMatrix(props) {
  var value = props.value || { mobile: [], desktop: [], scopes: {} }
  var onChange = props.onChange || function () {}
  var readOnly = !!props.readOnly

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="grid items-center bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-500 uppercase tracking-wider"
        style={{ gridTemplateColumns: '1fr 130px 60px 60px', padding: '8px 12px' }}>
        <div>Feature</div>
        <div className="text-center">Data scope</div>
        <div className="text-center"><i className="ti ti-device-mobile" style={{ fontSize: '12px' }} aria-hidden="true" /> <span>Mobile</span></div>
        <div className="text-center"><i className="ti ti-device-desktop" style={{ fontSize: '12px' }} aria-hidden="true" /> <span>Desktop</span></div>
      </div>

      {PERM_GROUPS.map(function (grp) {
        return (
          <div key={grp.group}>
            <div className="bg-indigo-50 border-b border-indigo-100 text-[12px] font-bold text-indigo-800 flex items-center gap-2"
              style={{ padding: '6px 12px' }}>
              <span>{grp.icon}</span>
              <span>{grp.group}</span>
              <span className="text-[10px] font-normal text-indigo-500">{grp.children.length}</span>
            </div>
            {grp.children.map(function (feat) {
              return (
                <NodeRow key={feat.key} node={feat} value={value} onChange={onChange} indent={0} readOnly={readOnly} />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export default PermMatrix