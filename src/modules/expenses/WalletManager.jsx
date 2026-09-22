import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { formatDate, formatPoints } from '../../lib/format'
import { logActivity } from '../../lib/logger'
import { prepUpload, isVoiceNotePath, getReceiptUrl } from '../../lib/uploadHelper'
import SearchDropdown from '../../components/ui/SearchDropdown'
import BottomSheet from '../../components/ui/BottomSheet'
import EventDatePicker from '../../components/ui/EventDatePicker'
import { scrollToTopOf } from '../../lib/scrollToTop'
import { useVoice } from '../../hooks/useVoice'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'
import { generateCollectionReceiptPdf } from '../../lib/pdfReceipt'
// Imported rather than read out of public/, for the same reasons PageBackdrop
// gives: the base path is handled for us, and the content hash means a new
// backdrop is never served from a stale cache. It was a 1.05MB PNG; as WebP at
// quality 92 the same artwork is 23KB, which is why it used to be visibly
// absent for a moment every time the wallet opened.
import walletBg from '../../assets/wallet-bg.webp'
import { registerPdfFont } from '../../lib/pdfFont'
import { openOrSharePdf } from '../../lib/pdfOutput'
import { plainParticularsLines, plainDateLines, makeStatementCellHooks } from '../../lib/pdfStatementTable'
import ExpenseDetail from './ExpenseDetail'
import Icon, { glyphForLabel } from '../../components/ui/Icon'

// A colour per person, hashed from the name rather than taken from the row
// index — the same face has to be the same colour after a sort, a filter and
// a reload, or the colour is noise instead of a landmark.
// A <select> takes its width from the longest option it holds, not from the
// one selected — so "Name" sat in a box sized for "Balance high → low", with
// the arrow stranded at the far right. The visible part is drawn from this
// map instead, and the real select rides invisibly on top of it.
var SORT_LABELS = {
  name: 'Name',
  balance_desc: 'Balance high → low',
  balance_asc: 'Balance low → high',
  pending: 'Most pending',
  activity: 'Recent activity',
}

// The artwork every wallet screen sits on. It was inline in the list view,
// so opening a wallet dropped you onto flat grey — the same screen, minus
// its ground.
//
// fixed, so it holds still while the rows scroll. -z-10 works because the
// phone shell root is relative + isolate; without that stacking context it
// falls behind the body and disappears.
//
// 100% auto, not cover: cover sizes against both axes, and a fixed element
// on a phone changes height every time the URL bar hides — which rescaled
// the image mid-scroll and read as a zoom. Width cannot change while
// scrolling, so sizing to it makes that impossible. The colour finishes the
// bottom of a tall screen, where a width-sized image no longer reaches.
// A proof photo, and what to show when there is not one after all.
//
// A storage object that 404s — deleted, or never uploaded because the
// attach step failed — renders as the browser's broken-image glyph: a torn
// page icon that reads as a broken PAGE, not a missing file. onError swaps
// it for a placeholder that says which it is.
//
// alt was empty, so even the text fallback said nothing. It names the side
// of the transfer now, which is the one thing the thumbnail is there to
// tell you apart.
function ProofThumb({ url, label, tone, onOpen }) {
  var [failed, setFailed] = useState(false)
  // A transfer proof can be a voice note instead of a photo, and then it has
  // to play rather than be handed to <img> — which is the broken thumbnail
  // this component exists to stop.
  //
  // isVoiceNotePath is the one rule for that in this codebase; a second,
  // hand-rolled check here would be a place for the two to drift apart.
  var isVoice = isVoiceNotePath(url)
  if (isVoice) {
    return (
      /* w-full is what gives this a width at all. Without it the span is
         shrink-to-fit, so it takes its width from the audio inside it while the
         audio takes its width from the span — and the pair settle on nothing.
         The player vanished and left only the badge, which is absolute and so
         did not need a box to sit in.
         min-w-0 is still needed alongside it: a native audio player has an
         intrinsic minimum width of its own, and max-width cannot take it below
         that, so on a narrow phone the control pushed the row past the screen
         and the page could be swiped sideways into white space.
         No height, so the browser draws the whole control rather than a strip
         of one with the timeline dropped. */
      <span className="relative block w-full min-w-0 max-w-[260px]">
        <audio src={url} controls className="w-full min-w-0" />
        <span className={"absolute -top-1 -left-1 px-1 rounded text-[10px] font-bold text-white " + tone}>{label}</span>
      </span>
    )
  }
  return (
    <span className="relative inline-block shrink-0">
      {failed ? (
        <span title="Image unavailable"
          className="w-10 h-10 rounded-lg border border-slate-200 bg-slate-50 inline-flex items-center justify-center text-slate-300">
          <Icon name="gallery" size={16} />
        </span>
      ) : (
        <button type="button" onClick={onOpen} className="block" aria-label={label + ' proof, tap to enlarge'}>
          <img src={url} alt={label + ' proof'} loading="lazy"
            onError={function () { setFailed(true) }}
            className="w-10 h-10 rounded-lg border border-slate-200 bg-slate-50 object-cover" />
        </button>
      )}
      <span className={"absolute -top-1 -left-1 px-1 rounded text-[10px] font-bold text-white " + tone}>{label}</span>
    </span>
  )
}

// The artwork's own bottom edge, read off the file: a dark sliver at one side,
// a wash of #ecf0fd–#f4f6fe across the middle, and the leaf at the other. Laid
// out left to right it continues the picture downwards, so the artwork can stop
// where it stops and the screen still ends in the colours it was ending in.
var WALLET_BG_FOOT = 'linear-gradient(to right, ' + [
  '#a7b6ce 0%', '#edf0fd 4%', '#f4f6fe 25%', '#eef2fd 42%',
  '#ecf0fd 60%', '#ecf0fe 90%', '#a2bbaf 95%', '#8baa9c 100%',
].join(', ') + ')'

// EventDatePicker draws its own bordered box. Inside the shared pill that is a
// border within a border, so the trigger is flattened to just its contents —
// inline, because these have to beat the classes the component sets itself.
var DATE_TRIGGER = {
  border: 0, background: 'transparent', borderRadius: 0,
  padding: '12px 10px 12px 12px',
}

function WalletBackdrop({ inAdmin }) {
  // Nothing on the desktop. The wallet is one tab of Finance and the others
  // are plain, so a ground here made this one screen look like it belonged to
  // a different section.
  if (inAdmin) return null
  return (
    // Two pieces stacked, the foot taking whatever the artwork leaves. As
    // background layers the foot was painted across the whole element and the
    // artwork over the top of it, so until the artwork arrived — and it is a
    // megabyte — the edge colours it continues were the entire screen: a dark
    // stripe down one side and a green one down the other. It can only ever be
    // the part below the artwork, so it is laid out as that part.
    //
    // Nothing here is measured against height. The artwork is as wide as the
    // element and as tall as its own proportions make it, so the element
    // growing taller when the address bar retracts cannot resize it — that
    // rescaling, over and over as the bar slid in and out, was the background
    // appearing to zoom while the page scrolled. aspect-ratio means the box is
    // the right size before the file is there rather than after, which is what
    // keeps the foot at the foot while it loads.
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 flex flex-col overflow-hidden"
      style={{ backgroundColor: '#ecf0fd' }}>
      <img src={walletBg} alt="" fetchpriority="high" decoding="async"
        className="w-full shrink-0" style={{ aspectRatio: '977 / 1609' }} />
      <div className="flex-1" style={{ backgroundImage: WALLET_BG_FOOT }} />
    </div>
  )
}

import VoiceInput from '../../components/ui/VoiceInput'
import { DeptChip } from '../../components/ui/Badge'
import SearchField from '../../components/ui/SearchField'
import { pushBack, goBack } from '../../lib/backNav'
import PaymentProofThumbs from '../../components/ledger/PaymentProofThumbs'
import LedgerSourceMedia from '../../components/ledger/LedgerSourceMedia'
import CheckedStamp from '../../components/ui/CheckedStamp'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import { avatarTint } from '../../lib/avatarTint'

// Local (not UTC) y-m-d, same as the expense date picker — a straight
// toISOString() would roll a late-night transfer back to the wrong day
// for anyone west of Greenwich.
function toYMD(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

// One expense can have several wallet_transactions rows behind it — the
// original debit, an "Expense edited: +/-N" diff row if it was amended
// later, even a flag→refund→reinstate cycle. Each row is individually
// correct for the running balance (CSV/PDF exports and the balance math
// still want every row), but shown separately on screen they scatter one
// expense across N cards, each carrying only its own partial amount —
// which never matches the allocation breakdown attached to it, since that
// breakdown always reflects the expense's current, fully-settled total.
// This folds every row sharing one expense into a single card: the net
// amount across the whole group always reconciles with the current total
// by construction (every one of those RPCs exists specifically to keep the
// wallet in sync with the expense), and the balance snapshot comes from
// whichever row in the group happened most recently.
var TXN_PAGE_SIZES = [25, 50, 100]
var WALLET_PAGE_SIZES = [30, 60, 120]

function mergeExpenseWalletRows(txns) {
  var groups = {}
  var out = []
  txns.forEach(function (t) {
    var isExpRow = (t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id
    if (!isExpRow) { out.push(t); return }
    if (!groups[t.reference_id]) groups[t.reference_id] = []
    groups[t.reference_id].push(t)
  })
  Object.keys(groups).forEach(function (key) {
    var rows = groups[key].slice().sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at) })
    if (rows.length === 1) { out.push(rows[0]); return }
    var latest = rows[rows.length - 1]
    var net = rows.reduce(function (s, r) { return s + (r.type === 'credit' ? -(r.amount_paise || 0) : (r.amount_paise || 0)) }, 0)
    out.push(Object.assign({}, rows[0], {
      amount_paise: Math.abs(net),
      type: net < 0 ? 'credit' : 'debit',
      balance_after_paise: latest.balance_after_paise,
      _sortAt: latest.created_at,
    }))
  })
  return out
}

var REF_TYPE_LABELS = {
  expense: 'Expense',
  expense_refund: 'Refund',
  transfer: 'Transfer',
  issued: 'Issued',
  deducted: 'Deducted',
  collection: 'Collection',
  collection_cancel: 'Cancel',
  opening: 'Opening',
  vendor_payment: 'Vendor Payment',
  vendor_deduction: 'Vendor Deduction',
  salary_payment: 'Salary Payment',
  salary_adjustment: 'Salary Adjustment',
}

// The shape is shared and the tone is the kind's own — written once each,
// rather than a full class string per entry repeating the same seven words.
var CHIP = 'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border bg-white '
var CHIP_NEUTRAL = 'text-slate-700 border-slate-300'

// The hues these chips have always had — only the fill is gone.
var REF_TYPE_TONES = {
  expense: 'text-red-700 border-red-300',
  expense_refund: 'text-green-700 border-green-300',
  transfer: 'text-blue-700 border-blue-300',
  issued: 'text-purple-700 border-purple-300',
  deducted: 'text-orange-700 border-orange-300',
  collection: 'text-emerald-700 border-emerald-300',
  collection_cancel: 'text-rose-700 border-rose-300',
  opening: 'text-gray-700 border-gray-300',
  vendor_payment: 'text-red-700 border-red-300',
  vendor_deduction: 'text-amber-700 border-amber-300',
  salary_payment: 'text-red-700 border-red-300',
  salary_adjustment: 'text-amber-700 border-amber-300',
}

// The glyph and tint for a row's leading square. Same families as the chip
// above, so a row says the same thing twice in two ways — which is the point on
// a long ledger: the tile is what you scan, the chip is what you read.
var REF_TYPE_MARKS = {
  expense:           { icon: 'receipt',    tone: 'bg-red-50 text-red-600' },
  expense_refund:    { icon: 'undo',       tone: 'bg-green-50 text-green-600' },
  transfer:          { icon: 'transfer',   tone: 'bg-blue-50 text-blue-600' },
  issued:            { icon: 'plus',       tone: 'bg-purple-50 text-purple-600' },
  deducted:          { icon: 'minus',      tone: 'bg-orange-50 text-orange-600' },
  collection:        { icon: 'banknote',   tone: 'bg-emerald-50 text-emerald-600' },
  collection_cancel: { icon: 'close',      tone: 'bg-rose-50 text-rose-600' },
  opening:           { icon: 'wallet',     tone: 'bg-slate-100 text-slate-500' },
  vendor_payment:    { icon: 'creditCard', tone: 'bg-red-50 text-red-600' },
  vendor_deduction:  { icon: 'creditCard', tone: 'bg-amber-50 text-amber-600' },
  salary_payment:    { icon: 'bank',       tone: 'bg-red-50 text-red-600' },
  salary_adjustment: { icon: 'bank',       tone: 'bg-amber-50 text-amber-600' },
}


// A reading of the period. The four of them are the same shape on purpose —
// they are four answers to one question, and giving each its own size or its
// own filled panel made them look like four unrelated facts.
// A figure. Not a control — these report, and reporting is all they do.
//
// Translucent, so the ruled ground shows through rather than being covered by
// an opaque panel. No backdrop blur: there can be a hundred of these surfaces
// on one page and blurring each one is a GPU layer apiece, where plain alpha is
// free.
function StatTile({ icon, tone, label, value, valueClass }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 bg-white/75 border border-slate-200 rounded-xl">
      <span className={'shrink-0 w-9 h-9 rounded-lg inline-flex items-center justify-center ' + tone}>
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-slate-500 leading-none">{label}</p>
        <p className={'mt-1.5 text-[16px] font-bold tabular-nums leading-none ' + valueClass} data-notranslate>{value}</p>
      </div>
    </div>
  )
}

var TXN_SORTS = {
  latest: 'Latest',
  oldest: 'Oldest',
  amount: 'Highest amount',
}

// wallet_transactions rows created by pay_vendor/pay_employee — reference_id points at
// the ledger_entries row for that specific payment (proof images, deduction reason, etc.)
var PAYMENT_REF_TYPES = ['vendor_payment', 'vendor_deduction', 'salary_payment', 'salary_adjustment']

// expenses.status — mirrors Ledgers.jsx's drill-view badges so an expense's
// acknowledgment state is visible here too, not just after drilling into the ledger.
var EXP_STATUS_LABELS = { recorded: 'Recorded', flagged: 'Resubmit', acknowledged: 'Acknowledged', deducted: 'Deducted' }
var EXP_STATUS_COLORS = {
  recorded: 'bg-amber-100 text-amber-700',
  flagged: 'bg-orange-100 text-orange-700',
  acknowledged: 'bg-green-100 text-green-700',
  deducted: 'bg-indigo-100 text-indigo-700',
}

function WalletManager({ profile, isAdmin, isAuditor, myWallet, walletBalance, onClose, onBalanceChange, onOpenExpense, onNavigateToExpenses, inAdmin }) {
  var permsNew = (profile && profile.permsNew) || []
  var canCreateTentativeEvent = hasPerm(permsNew, 'events.list.create_tentative')
  var canMarkChecked = hasPerm(permsNew, 'finance.wallet.mark_checked')
  var [checkingTxnId, setCheckingTxnId] = useState(null)
  var [checkingExpId, setCheckingExpId] = useState(null)
  // Which transaction rows have their allocation breakdown expanded —
  // collapsed by default so the History list fits more rows on screen.
  var [expandedTxnIds, setExpandedTxnIds] = useState({})
  function toggleTxnExpanded(id, ev) {
    if (ev) ev.stopPropagation()
    setExpandedTxnIds(function (prev) { var next = Object.assign({}, prev); next[id] = !next[id]; return next })
  }
  // Master override: when on, every row's allocation breakdown shows
  // regardless of its own entry in expandedTxnIds.
  var [expandAllTxns, setExpandAllTxns] = useState(false)
  // A transaction row for a deleted expense stays in the ledger for audit
  // (the debit already happened), but clutters the everyday view.
  var [showDeletedTxns, setShowDeletedTxns] = useState(false)
  var activeVenues = useReferenceData().venues.filter(function (v) { return v.active }).slice().sort(function (a, b) { return (a.code || '').localeCompare(b.code || '') })
  var [walletView, setWalletView] = useState(null)
  var [allWallets, setAllWallets] = useState([])
  var [walletProfiles, setWalletProfiles] = useState({})
  var [selectedWallet, setSelectedWallet] = useState(null)
  var [walletTxns, setWalletTxns] = useState([])
  var [txnFrom, setTxnFrom] = useState('')
  var [txnTo, setTxnTo] = useState('')
  var [txnRefType, setTxnRefType] = useState('')
  // Sorted here rather than in the query: the period is already capped at 500
  // rows and they are all in hand, so reordering them is free and does not cost
  // a round trip every time somebody changes their mind.
  var [txnSort, setTxnSort] = useState('latest')

  // A busy wallet runs to five hundred rows, and each one of these carries
  // chips, thumbnails and an allocation block — so the browser was building
  // five hundred of them to show you the top twenty-five. Paging is done here
  // rather than in the query because the sort by amount, the deleted-expense
  // filter and the merge of an expense's several rows into one all need the
  // whole set in hand; a page fetched from the server would cut across them.
  var [txnPage, setTxnPage] = useState(0)
  var [txnPageSize, setTxnPageSize] = useState(25)
  var txnListRef = useRef(null)

  // Hold the page still while an overlay is open.
  //
  // These five are portalled straight to <body> rather than going through
  // BottomSheet, which is the only thing in this app that was locking the
  // page. So the page kept its scrollbar down the side of the overlay, and a
  // wheel over the dark ground scrolled the list behind it.
  //
  // The previous value is put back rather than cleared, because a sheet may be
  // holding its own lock underneath this one and clearing would let the page
  // go while that sheet is still up.
  var overlayOpen = !!(expenseDetailTarget || detailTarget || payDetailTarget || cancelTarget || enlargedWalletImg)
  useEffect(function () {
    if (!overlayOpen) return
    var previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return function () { document.body.style.overflow = previous }
  }, [overlayOpen])

  var [walletSearch, setWalletSearch] = useState('')
  var [walletRoleFilter, setWalletRoleFilter] = useState('')
  var [pdfBusy, setPdfBusy] = useState(false)
  var [walletBalanceState, setWalletBalanceState] = useState('all')
  var [walletPendingOnly, setWalletPendingOnly] = useState(false)
  var [walletSort, setWalletSort] = useState('name')
  var [walletPage, setWalletPage] = useState(0)
  var [walletPageSize, setWalletPageSize] = useState(30)
  var walletListRef = useRef(null)
  // Any of these changes the list, so page four of the old one is not a place
  // that exists any more.
  useEffect(function () { setWalletPage(0) },
    [walletSearch, walletRoleFilter, walletBalanceState, walletPendingOnly, walletSort])
  var [issueModal, setIssueModal] = useState(null)
  var [issueAmount, setIssueAmount] = useState('')
  var [issueDesc, setIssueDesc] = useState('')
  var [issueType, setIssueType] = useState('credit')
  var [issueSaving, setIssueSaving] = useState(false)
  var [bulkMode, setBulkMode] = useState(false)
  var [bulkSelected, setBulkSelected] = useState({})
  var [bulkAmount, setBulkAmount] = useState('')
  var [bulkDesc, setBulkDesc] = useState('')
  var [bulkSaving, setBulkSaving] = useState(false)
  var [issueImage, setIssueImage] = useState(null)
  var [receiveModal, setReceiveModal] = useState(null)
  var [receiveImage, setReceiveImage] = useState(null)
  var [receiveSaving, setReceiveSaving] = useState(false)
  var [enlargedWalletImg, setEnlargedWalletImg] = useState(null)
  var [pendingIncoming, setPendingIncoming] = useState([])
  var [pendingOutgoing, setPendingOutgoing] = useState([])
  var [pendingIssues, setPendingIssues] = useState([])
  var [transferModal, setTransferModal] = useState(false)
  var [transferUsers, setTransferUsers] = useState([])
  var [transferTo, setTransferTo] = useState('')
  var [transferToBalance, setTransferToBalance] = useState(null)
  var [transferAmount, setTransferAmount] = useState('')
  var [transferDate, setTransferDate] = useState('')
  var [transferDesc, setTransferDesc] = useState('')
  var [transferImage, setTransferImage] = useState(null)
  var transferRec = useAudioRecorder()
  var [transferSaving, setTransferSaving] = useState(false)
  var [transferConfirmModal, setTransferConfirmModal] = useState(null)
  var [transferConfirmImage, setTransferConfirmImage] = useState(null)
  var transferConfirmRec = useAudioRecorder()
  var [transferConfirmSaving, setTransferConfirmSaving] = useState(false)
  var [transferParties, setTransferParties] = useState({})
  var [expenseRefs, setExpenseRefs] = useState({})
  // Resolved display labels for lookup-type sub-type extra fields, keyed 'source:id' → label.
  var [expLookupLabels, setExpLookupLabels] = useState({})
  // ledger_entries rows for PAYMENT_REF_TYPES txns, keyed by ledger_entries.id (== t.reference_id)
  // — carries .metadata (payment_images / deduction_image) for inline proof thumbnails.
  var [paymentRefs, setPaymentRefs] = useState({})
  // EPC back-links: wallet_tx_id → { epc, isCancel }. Populated by loadRecentTxns / openWalletTxns.
  var [epcRefs, setEpcRefs] = useState({})
  var [cancelTarget, setCancelTarget] = useState(null)  // { txn, kind: 'collection' | 'epc' }
  var [cancelReason, setCancelReason] = useState('')
  var [cancelSaving, setCancelSaving] = useState(false)
  var [collectModal, setCollectModal] = useState(false)
  var [collectDate, setCollectDate] = useState('')
  var [collectEvents, setCollectEvents] = useState([])
  var [collectFunctionsLoading, setCollectFunctionsLoading] = useState(false)
  var [collectEventId, setCollectEventId] = useState('')
  var [collectMode, setCollectMode] = useState('')
  var [collectBalance, setCollectBalance] = useState(null)
  var [collectBalanceLoading, setCollectBalanceLoading] = useState(false)
  var [showActualCash, setShowActualCash] = useState(false)
  var [collectAmount, setCollectAmount] = useState('')
  var [collectDesc, setCollectDesc] = useState('')
  var [collectImage, setCollectImage] = useState(null)
  var [collectSaving, setCollectSaving] = useState(false)
  var collectVoice = useVoice()
  var [tentativeModal, setTentativeModal] = useState(false)
  var [tentativeGuestName, setTentativeGuestName] = useState('')
  var [tentativeVenue, setTentativeVenue] = useState('')
  var [tentativePax, setTentativePax] = useState('')
  var [tentativeFunctionType, setTentativeFunctionType] = useState('')
  var [tentativeSaving, setTentativeSaving] = useState(false)
  var [eventTypeOptions, setEventTypeOptions] = useState([])

  // ═══ one back control, not two ═══════════════════════════════════════════
  // The shell header already has an arrow, and it pops backNav. These views
  // are not routes — the same component swaps what it renders — so that arrow
  // used to leave the whole Wallet tab from any depth, and the page had to
  // carry its own button to step back one level. Two arrows, one above the
  // other, doing different things.
  //
  // Now going deeper registers a handler, so the shell arrow steps back the
  // way the page button did and the page button can go. Only on the phone:
  // the admin shell has a breadcrumb and no arrow, so there the page button
  // is still the only way out.
  var viewDepthRef = useRef('wallets')

  // Opening a wallet is a navigation, so the view switches on the click and
  // these fill it in behind. Two people opened in quick succession would
  // otherwise race — the slower first reply landing on top of the second — so
  // every open takes a ticket and only the current one is allowed to write.
  var txnReqRef = useRef(0)
  var [txnsLoading, setTxnsLoading] = useState(false)
  useEffect(function () {
    var DEPTH = { wallets: 0, dashboard: 1, transactions: 2 }
    var prev = viewDepthRef.current
    viewDepthRef.current = walletView
    if (inAdmin) return
    if ((DEPTH[walletView] || 0) > (DEPTH[prev] || 0)) pushBack(function () { handleBack() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletView, inAdmin])

  // Opening a wallet from row sixty left you sixty rows down the new screen:
  // the window keeps its scroll across a view swap, because nothing here
  // navigates — the same component just renders something else.
  //
  // Only on the way IN. Coming back to the list deliberately does not reset,
  // so you return to the row you tapped instead of the top of ninety.
  useEffect(function () {
    if (walletView === 'wallets') return
    try { window.scrollTo({ top: 0 }) } catch (e) { window.scrollTo(0, 0) }
  }, [walletView, selectedWallet && selectedWallet.id])

  useEffect(function () {
    if (isAdmin || isAuditor) {
      setWalletView('wallets')
      loadAllWallets()
    }
    loadTransfers()
  }, [])

  // For non-admin/auditor: land on dashboard once myWallet is available.
  // Handles race where WalletManager mounts before parent's async wallet fetch resolves.
  useEffect(function () {
    if (isAdmin || isAuditor) return
    if (!myWallet) return
    if (walletView === 'dashboard' || walletView === 'transactions') return
    setWalletProfiles(function (prev) { var n = Object.assign({}, prev); n[profile.id] = profile; return n })
    setSelectedWallet(myWallet)
    setWalletView('dashboard')
    loadRecentTxns(myWallet)
  }, [myWallet, isAdmin, isAuditor])

  function refreshBalance() {
    supabase.from('wallets').select('balance_paise').eq('user_id', profile.id).maybeSingle()
      .then(function (res) { onBalanceChange(res.data?.balance_paise || 0) })
  }

  function refreshView() {
    if (walletView === 'dashboard' && selectedWallet) {
      loadRecentTxns(selectedWallet)
    } else if (walletView === 'transactions' && selectedWallet) {
      openWalletTxns(null)
    } else if (walletView === 'wallets') {
      loadAllWallets()
    }
  }

  // Resolve lookup-type extra fields (vendor/staff/category/venue/job-department pickers)
  // defined on each expense's sub-type into display labels, keyed 'source:id'.
  function resolveExpenseLookups(eMap) {
    var bySource = {}
    Object.keys(eMap).forEach(function (eid) {
      var e = eMap[eid]
      var fields = (e.expense_sub_types && e.expense_sub_types.extra_fields) || []
      var meta = e.metadata || {}
      fields.forEach(function (f) {
        if (f.type !== 'lookup' || !f.source) return
        var v = meta[f.key]
        if (!v) return
        if (!bySource[f.source]) bySource[f.source] = []
        if (bySource[f.source].indexOf(v) === -1) bySource[f.source].push(v)
      })
    })
    var sources = Object.keys(bySource)
    if (sources.length === 0) return
    Promise.all(sources.map(function (src) {
      var ids = bySource[src]
      if (src === 'vendors') {
        return supabase.from('vendors').select('id, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (v) { return { id: String(v.id), label: v.name } }) } })
      }
      if (src === 'staff') {
        return supabase.from('profiles').select('id, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (p) { return { id: String(p.id), label: p.name || '—' } }) } })
      }
      if (src === 'job_departments') {
        return supabase.from('employees').select('id, full_name, employee_code').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (e) { return { id: String(e.id), label: e.full_name + ' (' + e.employee_code + ')' } } ) } })
      }
      if (src === 'categories') {
        return supabase.from('categories').select('id, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (c) { return { id: String(c.id), label: c.name } }) } })
      }
      if (src === 'venues') {
        return supabase.from('venues').select('id, code, name').in('id', ids)
          .then(function (r) { return { src: src, rows: (r.data || []).map(function (v) { return { id: String(v.id), label: v.code + ' — ' + v.name } }) } })
      }
      return Promise.resolve({ src: src, rows: [] })
    })).then(function (results) {
      var next = {}
      results.forEach(function (res) { res.rows.forEach(function (row) { next[res.src + ':' + row.id] = row.label }) })
      setExpLookupLabels(function (prev) { return Object.assign({}, prev, next) })
    }).catch(function () {})
  }

  async function loadRecentTxns(wallet) {
    if (!wallet) return
    var { data } = await supabase.from('wallet_transactions')
      .select('*')
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false })
      .limit(5)
    var txns = data || []
    var tRefIds = txns.filter(function (t) { return t.reference_type === 'transfer' && t.reference_id }).map(function (t) { return t.reference_id })
    if (tRefIds.length > 0) {
      var { data: tData } = await supabase.from('wallet_transfers').select('*').in('id', tRefIds)
      var tMap = {}
      var cpIds = {}
      ;(tData || []).forEach(function (tr) {
        tMap[tr.id] = tr
        if (tr.from_user_id) cpIds[tr.from_user_id] = true
        if (tr.to_user_id) cpIds[tr.to_user_id] = true
      })
      setTransferParties(function (prev) { return Object.assign({}, prev, tMap) })
      var cpArr = Object.keys(cpIds)
      if (cpArr.length > 0) {
        var { data: pData } = await supabase.from('profiles').select('id, name').in('id', cpArr)
        var pMap = {}
        ;(pData || []).forEach(function (p) { pMap[p.id] = p })
        setWalletProfiles(function (prev) { return Object.assign({}, prev, pMap) })
      }
    }
    var expRefIds = txns.filter(function (tt) {
      return (tt.reference_type === 'expense' || tt.reference_type === 'expense_refund') && tt.reference_id
    }).map(function (tt) { return tt.reference_id })
    if (expRefIds.length > 0) {
      var expIdsNum = expRefIds.map(function (x) { return Number(x) }).filter(function (n) { return !isNaN(n) })
      var { data: eData } = await supabase.from('expenses')
        .select('id, description, amount_paise, expense_date, event_id, vendor_name, metadata, checked_by, checked_at, deleted_at, expense_types(name, icon), expense_sub_types(name, extra_fields), expense_allocations(department, amount_paise, expense_types(name), expense_sub_types(name))')
        .in('id', expIdsNum)
      var eMap = {}
      var evIds = {}
      ;(eData || []).forEach(function (e) {
        eMap[e.id] = e
        if (e.event_id) evIds[e.event_id] = true
      })
      var evArr = Object.keys(evIds)
      if (evArr.length > 0) {
        var { data: evData } = await supabase.from('event_ledger').select('id, event_name').in('id', evArr)
        var evNameMap = {}
        ;(evData || []).forEach(function (ev) { evNameMap[ev.id] = ev.event_name })
        Object.keys(eMap).forEach(function (eid) {
          var ex = eMap[eid]
          if (ex.event_id && evNameMap[ex.event_id]) ex._event_name = evNameMap[ex.event_id]
        })
      }
      setExpenseRefs(function (prev) { return Object.assign({}, prev, eMap) })
      resolveExpenseLookups(eMap)
    }
    // EPC back-links: any wallet_txn whose id matches extra_plate_collections.wallet_tx_id OR .cancel_wallet_tx_id
    var txnIds = txns.map(function (tt) { return tt.id })
    if (txnIds.length > 0) {
      var { data: epcFwd } = await supabase.from('extra_plate_collections')
        .select('id, event_id, extras_charged, plates_returned, total_paise, discount_paise, payment_mode, status, collected_by, wallet_tx_id, cancel_wallet_tx_id, cancelled_reason')
        .in('wallet_tx_id', txnIds)
      var { data: epcRev } = await supabase.from('extra_plate_collections')
        .select('id, event_id, extras_charged, plates_returned, total_paise, discount_paise, payment_mode, status, collected_by, wallet_tx_id, cancel_wallet_tx_id, cancelled_reason')
        .in('cancel_wallet_tx_id', txnIds)
      var eMapEpc = {}
      ;(epcFwd || []).forEach(function (r) { if (r.wallet_tx_id) eMapEpc[r.wallet_tx_id] = { epc: r, isCancel: false } })
      ;(epcRev || []).forEach(function (r) { if (r.cancel_wallet_tx_id) eMapEpc[r.cancel_wallet_tx_id] = { epc: r, isCancel: true } })
      setEpcRefs(function (prev) { return Object.assign({}, prev, eMapEpc) })
    }
    setWalletTxns(txns)
  }

  function handleBack() {
    if (walletView === 'transactions' && (isAdmin || isAuditor)) {
      // Admin viewing own wallet: back to dashboard. Otherwise back to wallets list.
      if (selectedWallet && selectedWallet.user_id === profile.id) {
        setWalletView('dashboard')
        setTxnFrom('')
        setTxnTo('')
        loadRecentTxns(selectedWallet)
      } else {
        setWalletView('wallets')
        setSelectedWallet(null)
        setWalletTxns([])
        setTxnFrom('')
        setTxnTo('')
      }
    } else if (walletView === 'transactions' && !isAdmin && !isAuditor) {
      setWalletView('dashboard')
      setTxnFrom('')
      setTxnTo('')
      loadRecentTxns(selectedWallet)
    } else if (walletView === 'dashboard' && (isAdmin || isAuditor)) {
      setWalletView('wallets')
      setSelectedWallet(null)
      setWalletTxns([])
    } else {
      onClose()
    }
  }

  async function loadAllWallets() {
    var [wRes, pRes, pendRes] = await Promise.all([
      supabase.from('wallets').select('id, user_id, balance_paise, updated_at'),
      supabase.from('profiles').select('id, name, email, role').eq('active', true).order('name'),
      supabase.from('wallet_transactions').select('wallet_id').eq('status', 'pending'),
    ])
    var pMap = {}
    ;(pRes.data || []).forEach(function (p) { pMap[p.id] = p })
    setWalletProfiles(pMap)
    var pendingMap = {}
    ;(pendRes.data || []).forEach(function (t) { pendingMap[t.wallet_id] = (pendingMap[t.wallet_id] || 0) + 1 })
    var wMap = {}
    ;(wRes.data || []).forEach(function (w) { wMap[w.user_id] = w })
    var combined = (pRes.data || []).map(function (p) {
      var w = wMap[p.id]
      var wid = w?.id || 'no_wallet_' + p.id
      return { id: wid, user_id: p.id, balance_paise: w?.balance_paise || 0, updated_at: w?.updated_at || null, _hasWallet: !!w, _pendingCount: pendingMap[wid] || 0 }
    })
    setAllWallets(combined)
  }

  // Opening someone's wallet used to be eight database round trips in a row
  // — transactions, then transfers, then expenses, then the events those
  // expenses belong to, then ledger entries, then two plate-collection
  // lookups, then profiles — and the screen only changed after the last one
  // came back. So a click did nothing at all for a second or three.
  //
  // Now the view switches first and the data fills in behind it, and the
  // seven follow-up queries run in two parallel waves instead of a queue.
  // Only the transactions themselves have to arrive before anything else can
  // be asked for; the rest are independent of each other.
  async function openWalletTxns(wallet, from, to, refType) {
    if (wallet) setSelectedWallet(wallet)
    var wid = (wallet || selectedWallet)?.id
    if (!wid) return

    var ticket = ++txnReqRef.current
    function current() { return txnReqRef.current === ticket }
    // A new person, or a new filter, is a new list — page five of the last
    // one means nothing here.
    setTxnPage(0)

    if (wallet) {
      // Clear first: the transactions view is already mounted for the previous
      // person, and showing their rows under this person's name for a second
      // would be worse than showing nothing.
      setWalletTxns([])
      setTransferParties({})
      setExpenseRefs({})
      setPaymentRefs({})
      setEpcRefs({})
      // Register the mobile back-gesture's undo for this navigation — mirrors handleBack's
      // transactions→(dashboard|wallets) logic, but computed off the fresh `wallet` param
      // rather than component state (which hasn't committed the new view yet at this point).
      var isOwnWalletNav = wallet.user_id === profile.id
      var walletForUndo = wallet
      pushBack(function () {
        if (isOwnWalletNav) {
          setWalletView('dashboard')
          setTxnFrom('')
          setTxnTo('')
          loadRecentTxns(walletForUndo)
        } else {
          setWalletView('wallets')
          setSelectedWallet(null)
          setWalletTxns([])
          setTxnFrom('')
          setTxnTo('')
        }
      })
      setWalletView('transactions')
    }
    setTxnsLoading(true)

    try {
      var query = supabase.from('wallet_transactions')
        .select('id, type, amount_paise, balance_after_paise, description, reference_type, reference_id, performed_by, created_at, issued_image_path, received_image_path, received_at, wallet_id, status, receipt_no, payment_mode, cancel_wallet_tx_id, cancelled_at, cancelled_by, cancelled_reason, checked_by, checked_at')
        .eq('wallet_id', wid)
        .order('created_at', { ascending: false })
        .limit(500)
      var f = from != null ? from : txnFrom
      var t = to != null ? to : txnTo
      var rt = refType != null ? refType : txnRefType
      if (f) query = query.gte('created_at', f + 'T00:00:00')
      if (t) query = query.lte('created_at', t + 'T23:59:59')
      if (rt) query = query.eq('reference_type', rt)
      var { data } = await query
      if (!current()) return
      var txns = data || []
      var cpIds = {}
      txns.forEach(function (t) { if (t.checked_by) cpIds[t.checked_by] = true })

      var tRefIds = txns.filter(function (t) { return t.reference_type === 'transfer' && t.reference_id }).map(function (t) { return t.reference_id })
      var expRefIds = txns.filter(function (tt) {
        return (tt.reference_type === 'expense' || tt.reference_type === 'expense_refund') && tt.reference_id
      }).map(function (tt) { return tt.reference_id })
      var expIdsNum = expRefIds.map(function (x) { return Number(x) }).filter(function (n) { return !isNaN(n) })
      var payRefIds = txns.filter(function (tt) {
        return PAYMENT_REF_TYPES.indexOf(tt.reference_type) !== -1 && tt.reference_id
      }).map(function (tt) { return tt.reference_id })
      var txnIds = txns.map(function (tt) { return tt.id })

      var EPC_COLS = 'id, event_id, extras_charged, plates_returned, total_paise, discount_paise, payment_mode, status, collected_by, wallet_tx_id, cancel_wallet_tx_id, cancelled_reason'
      var none = Promise.resolve({ data: [] })

      // Wave one. Nothing here needs anything from anything else here.
      var wave = await Promise.all([
        tRefIds.length > 0
          ? supabase.from('wallet_transfers').select('*').in('id', tRefIds)
          : none,
        expIdsNum.length > 0
          ? supabase.from('expenses')
              .select('id, description, amount_paise, expense_date, event_id, vendor_name, metadata, status, checked_by, checked_at, deleted_at, receipt_path, receipt_paths, expense_types(name, icon), expense_sub_types(name, extra_fields), expense_allocations(department, amount_paise, expense_types(name), expense_sub_types(name))')
              .in('id', expIdsNum)
          : none,
        // Matched on ref_id, not id — see openPaymentDetail for why.
        payRefIds.length > 0
          ? supabase.from('ledger_entries').select('id, ref_id, metadata').in('ref_id', payRefIds)
          : none,
        // EPC back-links: any wallet_txn whose id matches extra_plate_collections.wallet_tx_id OR .cancel_wallet_tx_id
        txnIds.length > 0
          ? supabase.from('extra_plate_collections').select(EPC_COLS).in('wallet_tx_id', txnIds)
          : none,
        txnIds.length > 0
          ? supabase.from('extra_plate_collections').select(EPC_COLS).in('cancel_wallet_tx_id', txnIds)
          : none,
      ])
      if (!current()) return

      var tData = wave[0].data
      var eData = wave[1].data
      var leData = wave[2].data
      var epcFwd = wave[3].data
      var epcRev = wave[4].data

      var tMap = {}
      ;(tData || []).forEach(function (tr) {
        tMap[tr.id] = tr
        if (tr.from_user_id) cpIds[tr.from_user_id] = true
        if (tr.to_user_id) cpIds[tr.to_user_id] = true
      })
      setTransferParties(tMap)

      // Enrich expense + refund refs with type / sub-type / dept / event for finance context.
      var eMap = {}
      var evIds = {}
      ;(eData || []).forEach(function (e) {
        eMap[e.id] = e
        if (e.event_id) evIds[e.event_id] = true
        if (e.checked_by) cpIds[e.checked_by] = true
      })
      setExpenseRefs(eMap)
      if (eData && eData.length > 0) resolveExpenseLookups(eMap)

      var leMap = {}
      ;(leData || []).forEach(function (le) { leMap[le.ref_id] = le })
      setPaymentRefs(leMap)

      var eMapEpc = {}
      ;(epcFwd || []).forEach(function (r) { if (r.wallet_tx_id) eMapEpc[r.wallet_tx_id] = { epc: r, isCancel: false } })
      ;(epcRev || []).forEach(function (r) { if (r.cancel_wallet_tx_id) eMapEpc[r.cancel_wallet_tx_id] = { epc: r, isCancel: true } })
      setEpcRefs(eMapEpc)

      // The rows go up with wave one, not before it. The deleted-expense
      // filter reads expenseRefs, so posting them a round trip earlier would
      // show every deleted row and then take it away again as the refs
      // landed — rows disappearing under the reader is worse than one more
      // moment of "Loading".
      setWalletTxns(txns)

      // Wave two. The event names need the expenses; the counterparty names
      // need every checked_by and both sides of every transfer, so both of
      // these had to wait for wave one — but not for each other.
      var evArr = Object.keys(evIds)
      // Ensure counterparty profile names load (needed on non-admin own-wallet view).
      var missing = Object.keys(cpIds).filter(function (id) { return !walletProfiles[id] })
      if (evArr.length > 0 || missing.length > 0) {
        var wave2 = await Promise.all([
          evArr.length > 0 ? supabase.from('event_ledger').select('id, event_name').in('id', evArr) : none,
          missing.length > 0 ? supabase.from('profiles').select('id, name').in('id', missing) : none,
        ])
        if (!current()) return

        var evNameMap = {}
        ;(wave2[0].data || []).forEach(function (ev) { evNameMap[ev.id] = ev.event_name })
        if (Object.keys(evNameMap).length > 0) {
          setExpenseRefs(function (prev) {
            var next = {}
            Object.keys(prev).forEach(function (eid) {
              var ex = prev[eid]
              next[eid] = (ex.event_id && evNameMap[ex.event_id])
                ? Object.assign({}, ex, { _event_name: evNameMap[ex.event_id] })
                : ex
            })
            return next
          })
        }

        var pMap = {}
        ;(wave2[1].data || []).forEach(function (p) { pMap[p.id] = p })
        if (Object.keys(pMap).length > 0) {
          setWalletProfiles(function (prev) { return Object.assign({}, prev, pMap) })
        }
      }
    } finally {
      if (current()) setTxnsLoading(false)
    }
  }

  async function issuePoints() {
    if (issueSaving || !issueModal || !issueAmount || Number(issueAmount) <= 0) return
    // Image mandatory on credit (issue). Debit unchanged.
    if (issueType !== 'debit' && !issueImage) {
      alert('Receipt image is required when issuing points.')
      return
    }
    setIssueSaving(true)
    var amountRupees = Math.round(Number(issueAmount) * 100)
    var rpcName = issueType === 'debit' ? 'deduct_money' : 'issue_money'
    var defaultDesc = issueType === 'debit' ? 'Points deducted by admin' : 'Points issued by admin'
    var imagePath = null
    if (issueImage) {
      var iF = await prepUpload(issueImage, 100)
      var ext = iF.name.split('.').pop()
      var path = 'wallet/issued/' + issueModal.user_id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, iF, { upsert: true })
      if (upErr) { alert('Image upload failed: ' + upErr.message); setIssueSaving(false); return }
      imagePath = path
    }
    var { error } = await supabase.rpc(rpcName, {
      p_user_id: issueModal.user_id,
      p_amount_paise: amountRupees,
      p_description: issueDesc.trim() || defaultDesc,
    })
    if (error) { alert((issueType === 'debit' ? 'Deduct' : 'Issue') + ' failed: ' + error.message); setIssueSaving(false); return }
    if (imagePath) {
      var { data: latestTxn } = await supabase.from('wallet_transactions')
        .select('id')
        .eq('wallet_id', issueModal.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (latestTxn) {
        await supabase.from('wallet_transactions').update({ issued_image_path: imagePath }).eq('id', latestTxn.id)
      }
    }
    var logAction = issueType === 'debit' ? 'WALLET_DEDUCT' : 'WALLET_ISSUE'
    try { await logActivity(logAction, (walletProfiles[issueModal.user_id]?.name || '—') + ' | ' + formatPoints(amountRupees) + ' | ' + (issueDesc.trim() || '—')) } catch (_) {}
    setIssueModal(null)
    setIssueAmount('')
    setIssueDesc('')
    setIssueImage(null)
    setIssueSaving(false)
    loadAllWallets()
    refreshBalance()
    refreshView()
  }

  async function confirmReceive() {
    if (receiveSaving || !receiveModal) return
    setReceiveSaving(true)
    var imagePath = null
    if (receiveImage) {
      var rF = await prepUpload(receiveImage, 100)
      var ext = rF.name.split('.').pop()
      var path = 'wallet/received/' + profile.id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, rF, { upsert: true })
      if (upErr) { alert('Image upload failed: ' + upErr.message); setReceiveSaving(false); return }
      imagePath = path
    }
    var { error } = await supabase.rpc('confirm_wallet_receive', {
      p_txn_id: receiveModal.id,
      p_received_image: imagePath,
    })
    if (error) { alert('Confirm failed: ' + error.message); setReceiveSaving(false); return }
    try { await logActivity('WALLET_RECEIVE_CONFIRM', formatPoints(Math.abs(receiveModal.amount_paise)) + ' | Txn #' + receiveModal.id) } catch (_) {}
    setReceiveModal(null)
    setReceiveImage(null)
    setReceiveSaving(false)
    refreshBalance()
    loadTransfers()
    refreshView()
  }

  async function loadTransfers() {
    var wid = myWallet?.id
    var [incRes, outRes, issRes] = await Promise.all([
      supabase.from('wallet_transfers').select('id, from_user_id, amount_paise, description, sender_image_path, status, created_at').eq('to_user_id', profile.id).eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('wallet_transfers').select('id, to_user_id, amount_paise, description, sender_image_path, status, created_at').eq('from_user_id', profile.id).eq('status', 'pending').order('created_at', { ascending: false }),
      wid
        ? supabase.from('wallet_transactions').select('id, type, amount_paise, description, performed_by, created_at, issued_image_path, wallet_id, status, reference_type').eq('wallet_id', wid).eq('status', 'pending').eq('type', 'credit').is('reference_type', null).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ])
    var inc = incRes.data || []
    var out = outRes.data || []
    var uids = []
    inc.forEach(function (t) { if (uids.indexOf(t.from_user_id) === -1) uids.push(t.from_user_id) })
    out.forEach(function (t) { if (uids.indexOf(t.to_user_id) === -1) uids.push(t.to_user_id) })
    if (uids.length > 0) {
      var { data: names } = await supabase.rpc('get_profile_names', { p_ids: uids })
      var nMap = {}
      ;(names || []).forEach(function (n) { nMap[n.id] = n.name })
      inc = inc.map(function (t) { return Object.assign({}, t, { _fromName: nMap[t.from_user_id] || '—' }) })
      out = out.map(function (t) { return Object.assign({}, t, { _toName: nMap[t.to_user_id] || '—' }) })
    }
    setPendingIncoming(inc)
    setPendingOutgoing(out)
    setPendingIssues(issRes.data || [])
  }

  async function openTransferModal() {
    setTransferModal(true)
    setTransferTo('')
    setTransferToBalance(null)
    setTransferAmount('')
    setTransferDate(toYMD(new Date()))
    setTransferDesc('')
    setTransferImage(null)
    transferRec.cancel()
    if (transferUsers.length === 0) {
      var { data } = await supabase.rpc('get_transfer_users')
      setTransferUsers(data || [])
    }
  }

  useEffect(function () {
    if (!transferTo) { setTransferToBalance(null); return }
    var cancelled = false
    setTransferToBalance(undefined)  // loading
    supabase.from('wallets').select('balance_paise').eq('user_id', transferTo).maybeSingle().then(function (res) {
      if (!cancelled) setTransferToBalance(res.data?.balance_paise || 0)
    })
    return function () { cancelled = true }
  }, [transferTo])

  async function initiateTransfer() {
    if (transferSaving || !transferTo || !transferAmount || Number(transferAmount) <= 0 || !transferDate) return
    setTransferSaving(true)
    var amountRupees = Math.round(Number(transferAmount) * 100)
    var imagePath = null
    if (transferImage) {
      var tF = await prepUpload(transferImage, 100)
      var ext = tF.name.split('.').pop()
      var path = 'wallet/transfer/' + profile.id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, tF, { upsert: true })
      if (upErr) { alert('Image upload failed: ' + upErr.message); setTransferSaving(false); return }
      imagePath = path
    } else if (transferRec.blob) {
      var path2 = 'wallet/transfer/' + profile.id + '_' + Date.now() + '_voice.webm'
      var { error: upErr2 } = await supabase.storage.from('receipts').upload(path2, transferRec.blob, { contentType: 'audio/webm', upsert: true })
      if (upErr2) { alert('Voice note upload failed: ' + upErr2.message); setTransferSaving(false); return }
      imagePath = path2
    }
    var toName = (transferUsers.find(function (u) { return u.id === transferTo }) || {}).name || '—'
    var { data: tid, error } = await supabase.rpc('initiate_transfer', {
      p_to_user_id: transferTo,
      p_amount_paise: amountRupees,
      p_description: (transferDesc.trim() || 'Cash transfer') + ' → ' + toName,
      p_sender_image: imagePath,
      p_transfer_date: transferDate || null,
    })
    if (error) { alert('Transfer failed: ' + error.message); setTransferSaving(false); return }
    try { await logActivity('WALLET_TRANSFER', toName + ' | ' + formatPoints(amountRupees)) } catch (_) {}
    setTransferModal(false)
    setTransferSaving(false)
    transferRec.cancel()
    refreshBalance()
    loadTransfers()
    refreshView()
  }

  async function confirmTransferReceive() {
    if (transferConfirmSaving || !transferConfirmModal) return
    setTransferConfirmSaving(true)
    var imagePath = null
    if (transferConfirmImage) {
      var tcF = await prepUpload(transferConfirmImage, 100)
      var ext = tcF.name.split('.').pop()
      var path = 'wallet/transfer/' + profile.id + '_recv_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(path, tcF, { upsert: true })
      if (upErr) { alert('Image upload failed: ' + upErr.message); setTransferConfirmSaving(false); return }
      imagePath = path
    } else if (transferConfirmRec.blob) {
      var path2c = 'wallet/transfer/' + profile.id + '_recv_' + Date.now() + '_voice.webm'
      var { error: upErr2c } = await supabase.storage.from('receipts').upload(path2c, transferConfirmRec.blob, { contentType: 'audio/webm', upsert: true })
      if (upErr2c) { alert('Voice note upload failed: ' + upErr2c.message); setTransferConfirmSaving(false); return }
      imagePath = path2c
    }
    var { error } = await supabase.rpc('confirm_transfer', {
      p_transfer_id: transferConfirmModal.id,
      p_receiver_image: imagePath,
    })
    if (error) { alert('Confirm failed: ' + error.message); setTransferConfirmSaving(false); return }
    try { await logActivity('WALLET_TRANSFER_CONFIRM', formatPoints(transferConfirmModal.amount_paise) + ' from ' + (transferConfirmModal._fromName || '—')) } catch (_) {}
    setTransferConfirmModal(null)
    setTransferConfirmImage(null)
    transferConfirmRec.cancel()
    setTransferConfirmSaving(false)
    refreshBalance()
    loadTransfers()
    refreshView()
  }

  async function cancelTransfer(t) {
    if (!confirm('Cancel this transfer? ' + formatPoints(t.amount_paise) + ' will be refunded.')) return
    var { error } = await supabase.rpc('cancel_transfer', { p_transfer_id: t.id })
    if (error) { alert('Cancel failed: ' + error.message); return }
    try { await logActivity('WALLET_TRANSFER_CANCEL', formatPoints(t.amount_paise)) } catch (_) {}
    refreshBalance()
    loadTransfers()
  }

  async function toggleWalletCheck(t) {
    if (checkingTxnId) return
    setCheckingTxnId(t.id)
    var { data, error } = await supabase.rpc('fn_toggle_wallet_check', { p_transaction_id: t.id })
    setCheckingTxnId(null)
    if (error) { alert('Could not update: ' + error.message); return }
    var nowChecked = !!data
    setWalletTxns(function (prev) { return prev.map(function (x) {
      if (x.id !== t.id) return x
      return Object.assign({}, x, {
        checked_by: nowChecked ? profile.id : null,
        checked_at: nowChecked ? new Date().toISOString() : null,
      })
    }) })
    if (nowChecked && profile && profile.id) {
      setWalletProfiles(function (prev) {
        if (prev[profile.id]) return prev
        var next = Object.assign({}, prev); next[profile.id] = { id: profile.id, name: profile.name }; return next
      })
    }
  }

  // Expense/refund rows check the underlying expenses row itself, not this
  // wallet_transactions row — an expense is shown from several other
  // screens too (Expenses list, Ledgers, the detail modal), all reading the
  // same expenses.id, so this has to change what they all see.
  async function toggleExpenseCheck(expId) {
    if (checkingExpId) return
    setCheckingExpId(expId)
    var { data, error } = await supabase.rpc('fn_toggle_expense_check', { p_expense_id: expId })
    setCheckingExpId(null)
    if (error) { alert('Could not update: ' + error.message); return }
    var nowChecked = !!data
    setExpenseRefs(function (prev) {
      if (!prev[expId]) return prev
      var next = Object.assign({}, prev)
      next[expId] = Object.assign({}, next[expId], {
        checked_by: nowChecked ? profile.id : null,
        checked_at: nowChecked ? new Date().toISOString() : null,
      })
      return next
    })
    if (nowChecked && profile && profile.id) {
      setWalletProfiles(function (prev) {
        if (prev[profile.id]) return prev
        var next = Object.assign({}, prev); next[profile.id] = { id: profile.id, name: profile.name }; return next
      })
    }
  }

  async function openCollectModal() {
    setCollectModal(true)
    setCollectDate('')
    setCollectEvents([])
    setCollectEventId('')
    setCollectMode('')
    setCollectBalance(null)
    setCollectAmount('')
    setCollectDesc('')
    setCollectImage(null)
  }

  async function loadFunctionsForDate(dateStr) {
    setCollectDate(dateStr)
    setCollectEventId('')
    setCollectBalance(null)
    if (!dateStr) { setCollectEvents([]); return }
    setCollectFunctionsLoading(true)
    var { data } = await supabase.from('events')
      .select('id, event_name, function_date, venue_name, client_name, session, contact_person, contact_number, secondary_contact, created_user_name, department, contract_no, is_tentative')
      .eq('function_date', dateStr)
      .is('merged_into_id', null)
      .order('event_name')
    setCollectEvents(data || [])
    setCollectFunctionsLoading(false)
    if (data && data.length === 1) { selectCollectFunction(String(data[0].id)) }
  }

  async function selectCollectFunction(fid) {
    setCollectEventId(fid)
    setCollectBalance(null)
    if (!fid) return
    setCollectBalanceLoading(true)
    var { data, error } = await supabase.rpc('fn_event_balance', { p_event_id: Number(fid) })
    if (!error && data && data.length > 0) { setCollectBalance(data[0]) }
    setCollectBalanceLoading(false)
  }

  function openTentativeModal() {
    setTentativeGuestName('')
    setTentativeVenue('')
    setTentativePax('')
    setTentativeFunctionType('')
    setTentativeModal(true)
    if (eventTypeOptions.length === 0) {
      supabase.from('quote_config').select('key, value').eq('key', 'event_types').maybeSingle()
        .then(function (res) { setEventTypeOptions((res.data && res.data.value) || []) })
    }
  }

  async function submitTentativeEvent() {
    if (tentativeSaving || !collectDate || !tentativeGuestName.trim() || !tentativeVenue || !tentativeFunctionType) return
    setTentativeSaving(true)
    var { data: newId, error } = await supabase.rpc('fn_create_tentative_event', {
      p_client_name: tentativeGuestName.trim(),
      p_venue_id: Number(tentativeVenue),
      p_function_date: collectDate,
      p_pax: tentativePax ? Number(tentativePax) : null,
      p_function_type: tentativeFunctionType,
    })
    if (error) { alert('Could not create event: ' + error.message); setTentativeSaving(false); return }
    setTentativeSaving(false)
    setTentativeModal(false)
    await loadFunctionsForDate(collectDate)
    if (newId != null) selectCollectFunction(String(newId))
  }

  async function printReceipt(txn) {
    if (!txn) return
    var contractNo = null
    var clientName = ''
    var eventDate = ''
    var dealBy = ''
    if (txn.reference_id) {
      var { data: ev } = await supabase.from('events')
        .select('contract_no, client_name, function_date, created_user_name')
        .eq('id', Number(txn.reference_id)).maybeSingle()
      if (ev) {
        contractNo = ev.contract_no || null
        clientName = ev.client_name || ''
        eventDate = ev.function_date || ''
        dealBy = ev.created_user_name || ''
      }
    }
    var collectorId = txn.performed_by
    var receivedByName = walletProfiles[collectorId]?.name || ''
    var signatureUrl = null
    if (collectorId) {
      var { data: pr } = await supabase.from('profiles').select('name, signature_path').eq('id', collectorId).maybeSingle()
      if (pr) {
        if (!receivedByName) receivedByName = pr.name || ''
        if (pr.signature_path) {
          var { data: signed } = await supabase.storage.from('images').createSignedUrl(pr.signature_path, 300)
          signatureUrl = signed?.signedUrl || null
        }
      }
    }
    try {
      await generateCollectionReceiptPdf({
        receiptNo: txn.receipt_no,
        paymentMode: txn.payment_mode,
        amountRupees: txn.amount_paise,
        description: txn.description,
        createdAt: txn.created_at,
        contractNo: contractNo,
        clientName: clientName,
        eventDate: eventDate,
        dealBy: dealBy,
        receivedByName: receivedByName,
        signatureUrl: signatureUrl,
      })
    } catch (e) { alert('Receipt generation failed: ' + e.message) }
  }

  function openCancel(txn, kind) {
    setCancelTarget({ txn: txn, kind: kind })
    setCancelReason('')
  }

  async function confirmCancel() {
    if (cancelSaving || !cancelTarget) return
    var reason = cancelReason.trim()
    if (reason.length < 3) { alert('Reason required (min 3 chars)'); return }
    setCancelSaving(true)
    var t = cancelTarget.txn
    var kind = cancelTarget.kind
    var rpc, params, actName, lbl
    if (kind === 'epc') {
      var epcRow = (epcRefs[t.id] || {}).epc
      if (!epcRow) { alert('EPC row not found'); setCancelSaving(false); return }
      rpc = 'fn_extra_plate_cancel'
      params = { p_collection_id: epcRow.id, p_reason: reason }
      actName = 'EXTRA_PLATE_CANCEL_FROM_WALLET'
      lbl = epcRow.extras_charged + ' extras · ' + formatPoints(t.amount_paise)
    } else {
      rpc = 'fn_wallet_collect_cancel'
      params = { p_txn_id: t.id, p_reason: reason }
      actName = 'WALLET_COLLECTION_CANCEL'
      lbl = (t.receipt_no ? '#' + t.receipt_no + ' · ' : '') + formatPoints(t.amount_paise)
    }
    var { error } = await supabase.rpc(rpc, params)
    if (error) { alert('Cancel failed: ' + error.message); setCancelSaving(false); return }
    try { await logActivity(actName, lbl + ' | ' + reason) } catch (_) {}
    setCancelTarget(null)
    setCancelReason('')
    setCancelSaving(false)
    refreshBalance()
    if (walletView === 'transactions') { openWalletTxns(null) }
    else if (walletView === 'dashboard') { loadRecentTxns(selectedWallet) }
  }

  function renderCancelModal() {
    if (!cancelTarget) return null
    var t = cancelTarget.txn
    var kind = cancelTarget.kind
    var isEpc = kind === 'epc'
    var epcRow = isEpc ? (epcRefs[t.id] || {}).epc : null
    return createPortal((
      <div className="fixed inset-0 z-[9998] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={function () { if (!cancelSaving) { setCancelTarget(null); setCancelReason('') } }}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          onClick={function (ev) { ev.stopPropagation() }}>
          <h3 className="text-base font-bold text-gray-900">
            Cancel {isEpc ? 'Extra Plate Collection' : 'Event Collection'}
          </h3>
          <div className="text-sm text-gray-600">
            {isEpc && epcRow
              ? epcRow.extras_charged + ' extras · ' + formatPoints(t.amount_paise) + (t.payment_mode ? ' · ' + t.payment_mode.toUpperCase() : '')
              : (t.receipt_no ? '#' + t.receipt_no + ' · ' : '') + formatPoints(t.amount_paise) + (t.payment_mode ? ' · ' + t.payment_mode.toUpperCase() : '')}
            {t.description ? ' — ' + t.description : ''}
          </div>
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            Wallet will be debited {formatPoints(t.amount_paise)} and the event ledger reversed. This cannot be undone.
          </div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason</label>
          <VoiceInput type="text" value={cancelReason} onChange={function (e) { setCancelReason(e.target.value) }}
            placeholder="Why is this being cancelled?"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={function () { setCancelTarget(null); setCancelReason('') }} disabled={cancelSaving}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl font-semibold">Keep</button>
            <button type="button" onClick={confirmCancel} disabled={cancelSaving || !cancelReason.trim()}
              className="flex-1 py-3 text-sm text-white bg-red-600 rounded-xl disabled:opacity-40 font-semibold">
              {cancelSaving ? 'Cancelling...' : 'Confirm Cancel'}
            </button>
          </div>
        </div>
      </div>
    ), document.body)
  }

  // ── Detail overlays: expense (ExpenseDetail reused) + collection (self-contained modal) ──
  var [expenseDetailTarget, setExpenseDetailTarget] = useState(null)  // full expense row for ExpenseDetail
  var [expenseDetailLoading, setExpenseDetailLoading] = useState(false)
  var [detailTarget, setDetailTarget] = useState(null)  // { txn, kind, event, collectorName, imgUrl, loading }
  var [payDetailTarget, setPayDetailTarget] = useState(null)  // { txn, entry, partyName, loading }

  // Opens on what is already here, then fills in the rest.
  //
  // The ledger row this was clicked from was drawn from expenseRefs, which
  // already holds the description, the amount, the date, the status, the type
  // and the allocations — most of what the panel opens with. Waiting on a
  // round trip to show any of it meant a second of "Loading expense…" for
  // facts that were on the screen a moment ago.
  //
  // The fetch still runs, for the things the ledger had no reason to load:
  // the receipts, the tax split, who reviewed it and when. When it lands it
  // replaces the seed. The id does not change, so the panel is not remounted
  // and nothing it has already drawn flickers.
  async function openExpenseDetail(expenseId) {
    if (!expenseId) return
    var seed = expenseRefs[expenseId] || expenseRefs[Number(expenseId)]
    setExpenseDetailLoading(!seed)
    setExpenseDetailTarget(seed ? Object.assign({}, seed) : { _placeholder: true, id: expenseId })
    var { data: row, error } = await supabase.from('expenses')
      .select('id, user_id, batch_id, expense_type_id, expense_sub_type_id, amount_paise, tax_paise, description, status, expense_date, receipt_path, receipt_paths, created_at, rejection_reason, flag_reason, penalty_paise, penalized_at, penalized_by, reviewed_at, reviewed_by, acknowledged_at, acknowledged_by, deduction_type, vendor_name, travel_from, travel_to, travel_mode, metadata, event_id, deleted_at, expense_types(name, extra_fields), expense_sub_types(name, extra_fields), events(event_name, venue_name, function_date, pax), expense_allocations(department, department_id, venue_id, amount_paise)')
      .eq('id', Number(expenseId)).maybeSingle()
    setExpenseDetailLoading(false)
    if (error || !row) {
      // With a seed on screen there is something to read and something to
      // close; taking it away to announce a failed refresh would be worse
      // than the failure.
      if (!seed) { alert('Expense not found: ' + (error?.message || 'missing')); setExpenseDetailTarget(null) }
      return
    }
    setExpenseDetailTarget(row)
  }

  function closeExpenseDetail(refresh) {
    setExpenseDetailTarget(null)
    if (refresh) {
      refreshBalance()
      if (walletView === 'transactions') { openWalletTxns(null) }
      else if (walletView === 'dashboard') { loadRecentTxns(selectedWallet) }
    }
  }

  function renderExpenseDetailModal() {
    if (!expenseDetailTarget) return null
    return createPortal((
      <div className="fixed inset-0 z-[9998] bg-black/70 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
        onClick={function () { closeExpenseDetail(false) }}>
        {/* Wide enough for the detail to use its own two-column layout.

            ExpenseDetail is a @container and splits into two columns at 48rem.
            At max-w-2xl the container was about 630px, so it never did — every
            panel stacked, the panel ran twice the height it needed, and a modal
            that fits on a screen had a scrollbar down the side of it.

            The height cap stays as a floor, not as the plan: an expense with a
            dozen allocations can outgrow any screen, and without it the bottom
            of the panel would be somewhere below the desk. */}
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-5xl p-4 sm:p-5 min-h-screen sm:min-h-0 sm:max-h-[92vh] overflow-y-auto"
          onClick={function (ev) { ev.stopPropagation() }}>
          {expenseDetailLoading || expenseDetailTarget._placeholder ? (
            <div className="py-16 text-center text-sm text-gray-500">Loading expense…</div>
          ) : (
            <ExpenseDetail
              key={expenseDetailTarget.id}
              exp={expenseDetailTarget}
              profile={profile}
              isAdmin={isAdmin}
              isDeptApprover={false}
              onBack={function () { closeExpenseDetail(false) }}
              backLabel="Back to wallet"
              onUpdated={function () { closeExpenseDetail(true) }}
              onEdit={function () { var id = expenseDetailTarget.id; closeExpenseDetail(false); onNavigateToExpenses && onNavigateToExpenses(id, 'edit') }}
              onRaiseGV={function () { var id = expenseDetailTarget.id; closeExpenseDetail(false); onNavigateToExpenses && onNavigateToExpenses(id, 'gv') }}
            />
          )}
        </div>
      </div>
    ), document.body)
  }

  async function openCollectionDetail(txn, kind) {
    setDetailTarget({ txn: txn, kind: kind, loading: true })
    var evData = null
    if (kind === 'collection' && txn.reference_id) {
      var { data: ev } = await supabase.from('events')
        .select('id, contract_no, event_name, client_name, function_date, created_user_name, venue_name')
        .eq('id', Number(txn.reference_id)).maybeSingle()
      evData = ev || null
    } else if (kind === 'epc') {
      var epcRow = (epcRefs[txn.id] || {}).epc
      if (epcRow && epcRow.event_id) {
        var { data: ev2 } = await supabase.from('events')
          .select('id, contract_no, event_name, client_name, function_date, created_user_name, venue_name')
          .eq('id', epcRow.event_id).maybeSingle()
        evData = ev2 || null
      }
    }
    var collectorName = walletProfiles[txn.performed_by]?.name || ''
    if (!collectorName && txn.performed_by) {
      var { data: pr } = await supabase.from('profiles').select('name').eq('id', txn.performed_by).maybeSingle()
      if (pr) collectorName = pr.name || ''
    }
    var imgUrl = txn.received_image_path
      ? supabase.storage.from('receipts').getPublicUrl(txn.received_image_path).data?.publicUrl
      : null
    setDetailTarget({ txn: txn, kind: kind, loading: false, event: evData, collectorName: collectorName, imgUrl: imgUrl })
  }

  function renderCollectionDetailModal() {
    if (!detailTarget) return null
    var t = detailTarget.txn
    var kind = detailTarget.kind
    var isEpc = kind === 'epc'
    var ev = detailTarget.event || null
    var epcRow = isEpc ? (epcRefs[t.id] || {}).epc : null
    var isCancelled = t.status === 'cancelled' || (isEpc && epcRow && epcRow.status === 'cancelled')
    var canCancel = !isCancelled && (
      (kind === 'collection' && (isAdmin || t.performed_by === profile.id)) ||
      (isEpc && epcRow && (isAdmin || epcRow.collected_by === profile.id))
    )
    return createPortal((
      <div className="fixed inset-0 z-[9998] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={function () { setDetailTarget(null) }}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          onClick={function (ev2) { ev2.stopPropagation() }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {isEpc ? '🍽 Extra Plate Collection' : '🎯 Event Collection'}
              </h3>
              {ev && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {ev.event_name || '—'}{ev.client_name ? ' · ' + ev.client_name : ''}
                </p>
              )}
            </div>
            <button type="button" onClick={function () { setDetailTarget(null) }}
              className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">✕</button>
          </div>
          {isCancelled && (
            <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              <span className="font-bold uppercase text-[10px] tracking-wider">Cancelled</span>
              {(t.cancelled_reason || (epcRow && epcRow.cancelled_reason)) && (
                <div className="mt-0.5">Reason: {t.cancelled_reason || epcRow.cancelled_reason}</div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <p className="text-[10px] uppercase text-gray-500">Amount</p>
              <p className="font-bold text-gray-900 text-base">{formatPoints(t.amount_paise)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">Payment</p>
              <p className="font-medium text-gray-800">{t.payment_mode ? t.payment_mode.toUpperCase() : '—'}</p>
            </div>
            {t.receipt_no && (
              <div>
                <p className="text-[10px] uppercase text-gray-500">Receipt No</p>
                <p className="font-medium text-gray-800">#{t.receipt_no}</p>
              </div>
            )}
            {isEpc && epcRow && (
              <>
                <div>
                  <p className="text-[10px] uppercase text-gray-500">Plates Charged</p>
                  <p className="font-medium text-gray-800">{epcRow.extras_charged}</p>
                </div>
                {epcRow.plates_returned > 0 && (
                  <div>
                    <p className="text-[10px] uppercase text-gray-500">Returned</p>
                    <p className="font-medium text-gray-800">{epcRow.plates_returned}</p>
                  </div>
                )}
                {epcRow.discount_paise > 0 && (
                  <div>
                    <p className="text-[10px] uppercase text-gray-500">Discount</p>
                    <p className="font-medium text-gray-800">{formatPoints(epcRow.discount_paise)}</p>
                  </div>
                )}
              </>
            )}
            {ev && ev.function_date && (
              <div>
                <p className="text-[10px] uppercase text-gray-500">Event Date</p>
                <p className="font-medium text-gray-800">{formatDate(ev.function_date)}</p>
              </div>
            )}
            {ev && ev.contract_no && (
              <div>
                <p className="text-[10px] uppercase text-gray-500">Contract</p>
                <p className="font-medium text-gray-800">{ev.contract_no}</p>
              </div>
            )}
            {ev && ev.venue_name && (
              <div>
                <p className="text-[10px] uppercase text-gray-500">Venue</p>
                <p className="font-medium text-gray-800">{ev.venue_name}</p>
              </div>
            )}
            {ev && ev.created_user_name && (
              <div>
                <p className="text-[10px] uppercase text-gray-500">Deal By</p>
                <p className="font-medium text-gray-800">{ev.created_user_name}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] uppercase text-gray-500">Collected By</p>
              <p className="font-medium text-gray-800">{detailTarget.collectorName || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">When</p>
              <p className="font-medium text-gray-800">{formatDate(t.created_at)}</p>
            </div>
          </div>
          {t.description && (
            <div>
              <p className="text-[10px] uppercase text-gray-500 mb-0.5">Description</p>
              <p className="text-sm text-gray-800">{t.description}</p>
            </div>
          )}
          {detailTarget.imgUrl && (
            <div>
              <p className="text-[10px] uppercase text-gray-500 mb-1">Receipt Image</p>
              <img src={detailTarget.imgUrl} alt="receipt"
                onClick={function () { setEnlargedWalletImg(detailTarget.imgUrl) }}
                className="w-full max-h-64 object-contain rounded border border-gray-200 cursor-zoom-in bg-gray-50" />
            </div>
          )}
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            {kind === 'collection' && t.receipt_no && (
              <button type="button" onClick={function () { printReceipt(t) }}
                className="flex-1 py-2 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100">
                🖨 Reprint
              </button>
            )}
            {canCancel && (
              <button type="button" onClick={function () { setDetailTarget(null); openCancel(t, kind) }}
                className="flex-1 py-2 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100">
                🚫 Cancel
              </button>
            )}
            <button type="button" onClick={function () { setDetailTarget(null) }}
              className="flex-1 py-2 text-xs font-bold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
              Close
            </button>
          </div>
        </div>
      </div>
    ), document.body)
  }

  async function openPaymentDetail(t) {
    setPayDetailTarget({ txn: t, entry: null, partyName: '', loading: true })
    if (!t.reference_id) { setPayDetailTarget({ txn: t, entry: null, partyName: '', loading: false }); return }
    // wallet_transactions.reference_id for a payment row is the shared UUID
    // (v_ref_id in pay_vendor / the salary-payment equivalent) — that value
    // lives on ledger_entries.ref_id, not its own bigint id column.
    var { data: entry } = await supabase.from('ledger_entries')
      .select('id, ledger_type, party_id, entry_date, created_at, description, debit_paise, ref_type, metadata')
      .eq('ref_id', t.reference_id).maybeSingle()
    if (!entry) { setPayDetailTarget({ txn: t, entry: null, partyName: '', loading: false }); return }
    var partyName = ''
    if (entry.ledger_type === 'vendor') {
      var { data: v } = await supabase.from('vendors').select('name').eq('id', entry.party_id).maybeSingle()
      partyName = (v && v.name) || ''
    } else {
      var { data: p } = await supabase.from('profiles').select('name').eq('id', entry.party_id).maybeSingle()
      partyName = (p && p.name) || ''
    }
    setPayDetailTarget({ txn: t, entry: entry, partyName: partyName, loading: false })
  }

  function renderPaymentDetailModal() {
    if (!payDetailTarget) return null
    var t = payDetailTarget.txn
    var entry = payDetailTarget.entry
    var meta = (entry && entry.metadata) || {}
    return createPortal((
      <div className="fixed inset-0 z-[9998] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={function () { setPayDetailTarget(null) }}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          onClick={function (ev) { ev.stopPropagation() }}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-bold text-gray-900">{REF_TYPE_LABELS[t.reference_type] || t.reference_type}</h3>
            <button type="button" onClick={function () { setPayDetailTarget(null) }}
              className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">✕</button>
          </div>
          {payDetailTarget.loading ? (
            <p className="text-sm text-gray-400 text-center py-6">Loading...</p>
          ) : (
            <>
              <p className="text-2xl font-bold text-red-700">−{formatPoints(t.amount_paise)}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <p className="text-[10px] uppercase text-gray-500">{entry && entry.ledger_type === 'vendor' ? 'Vendor' : 'Employee'}</p>
                  <p className="font-medium text-gray-800">{payDetailTarget.partyName || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-gray-500">Date</p>
                  <p className="font-medium text-gray-800">{formatDate((entry && entry.entry_date) || t.created_at)}</p>
                </div>
                {meta.mode && (
                  <div>
                    <p className="text-[10px] uppercase text-gray-500">Mode</p>
                    <p className="font-medium text-gray-800">{meta.mode === 'cash' ? '💵 Cash' : '🏦 Bank'}</p>
                  </div>
                )}
                {meta.salary_month && (
                  <div>
                    <p className="text-[10px] uppercase text-gray-500">Salary Month</p>
                    <p className="font-medium text-gray-800">{meta.salary_month}</p>
                  </div>
                )}
              </div>
              {(t.description || (entry && entry.description)) && (
                <div>
                  <p className="text-[10px] uppercase text-gray-500 mb-0.5">Description</p>
                  <p className="text-sm text-gray-800">{t.description || entry.description}</p>
                </div>
              )}
              {meta.reason && (
                <div>
                  <p className="text-[10px] uppercase text-gray-500 mb-0.5">Reason</p>
                  <p className="text-sm text-gray-800">{meta.reason}</p>
                </div>
              )}
              {(meta.payment_images || meta.deduction_image) && (
                <div>
                  <p className="text-[10px] uppercase text-gray-500 mb-1">Proof</p>
                  <PaymentProofThumbs meta={meta} />
                </div>
              )}
              <p className="text-[10px] text-gray-400 pt-1">Logged {formatDate(t.created_at)}</p>
              <button type="button" onClick={function () { setPayDetailTarget(null) }}
                className="w-full py-2 text-xs font-bold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                Close
              </button>
            </>
          )}
        </div>
      </div>
    ), document.body)
  }

  async function submitCollection() {
    if (collectSaving) return
    if (!collectEventId) { alert('Select a function'); return }
    if (!collectMode) { alert('Select Cash or Bank'); return }
    if (!collectAmount || Number(collectAmount) <= 0) { alert('Enter amount'); return }
    if (collectMode === 'bank' && !collectImage) { alert('Receipt photo is required for bank collections'); return }
    setCollectSaving(true)
    var amountRupees = Math.round(Number(collectAmount) * 100)
    var imagePath = null
    if (collectImage) {
      // Upload receipt first — DB write is source of truth
      var cF = await prepUpload(collectImage, 100)
      var ext = cF.name.split('.').pop()
      imagePath = 'wallet/collection/' + profile.id + '_' + Date.now() + '.' + ext
      var { error: upErr } = await supabase.storage.from('receipts').upload(imagePath, cF, { upsert: true })
      if (upErr) { alert('Receipt upload failed: ' + upErr.message); setCollectSaving(false); return }
    }
    var evtName = (collectEvents.find(function (e) { return String(e.id) === collectEventId }) || {}).event_name || ''
    var desc = (collectDesc.trim() || 'Collection') + ' — ' + evtName
    var { data, error } = await supabase.rpc('fn_wallet_collect', {
      p_event_id: Number(collectEventId),
      p_payment_mode: collectMode,
      p_amount_paise: amountRupees,
      p_description: desc,
      p_receipt_path: imagePath
    })
    if (error) { alert('Collection failed: ' + error.message); setCollectSaving(false); return }
    if (data && data.over_agreed) {
      alert('Warning: this collection exceeds the agreed ' + collectMode + ' amount for the event. Recorded anyway.')
    }
    try { await logActivity('WALLET_COLLECTION', evtName + ' | ' + collectMode + ' | ' + formatPoints(amountRupees)) } catch (_) {}

    // Auto-open PDF receipt in new tab
    try {
      await printReceipt({
        receipt_no: data ? data.receipt_no : null,
        payment_mode: collectMode,
        amount_paise: amountRupees,
        description: desc,
        created_at: new Date().toISOString(),
        reference_id: collectEventId,
      })
    } catch (_) {}

    setCollectModal(false)
    setCollectSaving(false)
    refreshBalance()
    openWalletTxns(null)
  }

  async function runBulkIssue() {
    var userIds = Object.keys(bulkSelected).filter(function (k) { return bulkSelected[k] })
    if (bulkSaving || !userIds.length || !bulkAmount || Number(bulkAmount) <= 0) return
    setBulkSaving(true)
    var amountRupees = Math.round(Number(bulkAmount) * 100)
    var desc = bulkDesc.trim() || 'Bulk points issued by admin'
    var succeeded = 0
    var failed = 0
    var CHUNK = 10
    for (var c = 0; c < userIds.length; c += CHUNK) {
      var chunk = userIds.slice(c, c + CHUNK)
      var results = await Promise.allSettled(chunk.map(function (uid) {
        return supabase.rpc('issue_money', { p_user_id: uid, p_amount_paise: amountRupees, p_description: desc })
      }))
      results.forEach(function (res) {
        if (res.status === 'fulfilled' && !res.value.error) succeeded++
        else failed++
      })
    }
    try { await logActivity('WALLET_BULK_ISSUE', succeeded + ' users | ' + formatPoints(amountRupees) + ' each | ' + desc) } catch (_) {}
    alert('Done: ' + succeeded + ' issued' + (failed > 0 ? ', ' + failed + ' failed' : ''))
    setBulkSaving(false)
    setBulkMode(false)
    setBulkSelected({})
    setBulkAmount('')
    setBulkDesc('')
    loadAllWallets()
  }

  function exportWalletCSV() {
    if (!walletTxns.length || !selectedWallet) return
    var userName = walletProfiles[selectedWallet.user_id]?.name || 'user'
    var headers = ['Date', 'Type', 'Amount (pts)', 'Balance After (pts)', 'Description', 'Performed By']
    var rows = walletTxns.map(function (t) {
      return [
        t.created_at ? t.created_at.split('T')[0] : '',
        t.type || '',
        t.amount_paise ? (t.amount_paise / 100) : 0,
        t.balance_after_paise ? (t.balance_after_paise / 100) : 0,
        (t.description || '').replace(/,/g, ';'),
        walletProfiles[t.performed_by]?.name || '—',
      ].join(',')
    })
    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'wallet_' + userName + '_' + new Date().toISOString().split('T')[0] + '.csv'; a.click()
  }

  async function exportWalletPDF() {
    if (!walletTxns.length || !selectedWallet || pdfBusy) return
    setPdfBusy(true)
    try {
      var jsPDFmod = await import('jspdf')
      var jsPDF = jsPDFmod.default || jsPDFmod.jsPDF
      var autoTableMod = await import('jspdf-autotable')
      var autoTable = autoTableMod.default || autoTableMod

      var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      var fontOk = await registerPdfFont(doc)
      var FONT = fontOk ? 'NotoSans' : 'helvetica'
      var pageW = doc.internal.pageSize.getWidth()
      var pageH = doc.internal.pageSize.getHeight()

      // Chronological (oldest → newest) for bank-statement feel
      var chrono = walletTxns.slice().sort(function (a, b) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })

      var totalCr = 0, totalDb = 0
      chrono.forEach(function (t) {
        if (t.type === 'credit') totalCr += (t.amount_paise || 0)
        else totalDb += (t.amount_paise || 0)
      })
      var oldest = chrono[0]
      var newest = chrono[chrono.length - 1]
      var opening = oldest ? ((oldest.balance_after_paise || 0) - (oldest.type === 'credit' ? (oldest.amount_paise || 0) : -(oldest.amount_paise || 0))) : 0
      var closing = newest ? (newest.balance_after_paise || 0) : 0

      var userName = walletProfiles[selectedWallet.user_id]?.name || 'User'
      var userEmail = walletProfiles[selectedWallet.user_id]?.email || selectedWallet.email || ''
      var mm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      function fmtD(iso) {
        if (!iso) return '—'
        var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
        return String(d.getDate()).padStart(2, '0') + '-' + mm[d.getMonth()] + '-' + d.getFullYear()
      }
      function fmtN(paise) {
        return ((paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      }
      // Structured Particulars lines for the hand-drawn column: a bold header (the
      // linked expense's type > sub-type when there is one, else the transaction's
      // own ref kind), the description, then whatever context that reference type
      // offers — sub-type fields, a per-allocation breakdown with right-pinned
      // amounts, event name, counterparty, payment mode, etc.
      function particularsLinesFor(t) {
        var refLabel = REF_TYPE_LABELS[t.reference_type] || (t.reference_type || '')
        var refNo = t.reference_id ? String(t.reference_id).slice(0, 10) : ''
        var e = (t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id
          ? expenseRefs[t.reference_id] : null
        var tn = (e && e.expense_types?.name) || ''
        var stn = (e && e.expense_sub_types?.name) || ''

        var lines = [{ kind: 'header', text: tn ? (tn + (stn ? ' > ' + stn : '')) : (refLabel + (refNo ? ' #' + refNo : '')) }]
        lines.push({ kind: 'desc', text: t.description || '—' })

        if (e) {
          // Sub-type custom fields (vendor, employee, casual type, slip no, etc.), resolving
          // lookup fields to their display names — mirrors the on-screen transaction list.
          var subFields = (e.expense_sub_types && e.expense_sub_types.extra_fields) || []
          var meta = e.metadata || {}
          var fieldBits = []
          subFields.forEach(function (f) {
            var val = meta[f.key]
            if (val == null || val === '') return
            var display = val
            if (f.type === 'lookup' && f.source) display = expLookupLabels[f.source + ':' + String(val)] || val
            fieldBits.push((f.label || f.key) + ': ' + display)
          })
          if (e.vendor_name && !fieldBits.some(function (b) { return b.slice(b.indexOf(': ') + 2) === e.vendor_name })) {
            fieldBits.unshift('Vendor: ' + e.vendor_name)
          }
          if (fieldBits.length > 0) lines.push({ kind: 'chip', text: fieldBits.join('   ·   ') })

          var allocs = e.expense_allocations || []
          if (allocs.length > 1) {
            allocs.forEach(function (a) {
              var atn = a.expense_types?.name || ''
              var astn = a.expense_sub_types?.name || ''
              var differs = atn && (atn !== tn || astn !== stn)
              var typeLabel = differs ? (' [' + atn + (astn ? ' > ' + astn : '') + ']') : ''
              lines.push({ kind: 'alloc', text: (a.department || 'Unassigned') + typeLabel, amount: fmtN(a.amount_paise) })
            })
          } else if (allocs.length === 1 && allocs[0].department) {
            lines.push({ kind: 'chip', text: allocs[0].department })
          }
          if (e._event_name) lines.push({ kind: 'chip', text: 'Event: ' + e._event_name })
          if (e.expense_date) lines.push({ kind: 'chip', text: 'Expense date: ' + fmtD(e.expense_date) })
        } else if (t.reference_type === 'transfer' && t.reference_id) {
          var tr = transferParties[t.reference_id]
          if (tr) {
            var cpId = t.type === 'debit' ? tr.to_user_id : tr.from_user_id
            var cpName = walletProfiles[cpId]?.name
            if (cpName) lines.push({ kind: 'chip', text: (t.type === 'debit' ? '→ ' : '← ') + cpName })
          }
        } else if (t.reference_type === 'collection') {
          var bits = []
          if (t.payment_mode) bits.push(t.payment_mode)
          if (t.receipt_no) bits.push('Receipt #' + t.receipt_no)
          if (bits.length) lines.push({ kind: 'chip', text: bits.join('   ·   ') })
        } else if (t.reference_type === 'issued') {
          lines.push({ kind: 'chip', text: 'Issued by admin' })
        } else if (t.reference_type === 'deducted') {
          lines.push({ kind: 'chip', text: 'Deducted by admin' })
        } else if (t.reference_type === 'opening') {
          lines.push({ kind: 'chip', text: 'Opening balance' })
        }
        return lines
      }

      var periodFrom = txnFrom || (oldest ? oldest.created_at.split('T')[0] : '')
      var periodTo = txnTo || (newest ? newest.created_at.split('T')[0] : '')

      // Header
      doc.setFont(FONT, 'bold'); doc.setFontSize(14)
      doc.text('WALLET STATEMENT', 10, 14)
      doc.setFont(FONT, 'normal'); doc.setFontSize(8); doc.setTextColor(120)
      doc.text('Generated ' + new Date().toLocaleString('en-IN'), pageW - 10, 14, { align: 'right' })
      doc.setTextColor(0)

      doc.setFontSize(9)
      var y = 22
      doc.setFont(FONT, 'bold'); doc.text('Account:', 10, y)
      doc.setFont(FONT, 'normal'); doc.text(userName + (userEmail ? '  (' + userEmail + ')' : ''), 28, y)
      y += 5
      doc.setFont(FONT, 'bold'); doc.text('Period:', 10, y)
      doc.setFont(FONT, 'normal'); doc.text(fmtD(periodFrom) + '  to  ' + fmtD(periodTo) + '     (' + chrono.length + ' transactions)', 28, y)
      y += 7

      // Summary strip
      autoTable(doc, {
        startY: y,
        head: [['Opening Balance', 'Total Credits', 'Total Debits', 'Closing Balance']],
        body: [[
          fmtN(opening),
          '+' + fmtN(totalCr),
          '-' + fmtN(totalDb),
          fmtN(closing),
        ]],
        styles: { font: FONT, fontSize: 9, halign: 'right', cellPadding: 2 },
        headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold', halign: 'right', fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 47.5 },
          1: { cellWidth: 47.5, textColor: [16, 128, 60] },
          2: { cellWidth: 47.5, textColor: [180, 30, 30] },
          3: { cellWidth: 47.5, fontStyle: 'bold' },
        },
        margin: { left: 10, right: 10 },
      })

      // Main ledger
      var dateMeta = []
      var particularsMeta = []
      var body = chrono.map(function (t) {
        var dt = t.created_at ? new Date(t.created_at) : null
        var dm = { top: dt ? fmtD(t.created_at.split('T')[0]) : '—', bottom: dt ? dt.toTimeString().slice(0, 5) : '' }
        dateMeta.push(dm)
        var pLines = particularsLinesFor(t)
        particularsMeta.push(pLines)
        var isCredit = t.type === 'credit'
        var amt = fmtN(t.amount_paise || 0)
        return [
          plainDateLines(dm, ''),
          plainParticularsLines(pLines).join('\n'),
          isCredit ? '' : amt,
          isCredit ? amt : '',
          fmtN(t.balance_after_paise || 0),
        ]
      })

      var statementHooks = makeStatementCellHooks(doc, FONT, {
        dateCol: 0, particularsCol: 1, dateMeta: dateMeta, particularsMeta: particularsMeta,
        topLabel: 'DATE', bottomLabel: 'TIME',
      })

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 6,
        // columnStyles' halign only ever reaches body cells (jspdf-autotable applies it
        // exclusively to sectionName === 'body'), so Debit/Credit/Balance need their own
        // per-cell halign here to land over the right-aligned figures below.
        head: [['Date', 'Particulars',
          { content: 'Debit', styles: { halign: 'right' } },
          { content: 'Credit', styles: { halign: 'right' } },
          { content: 'Balance', styles: { halign: 'right' } }]],
        body: body,
        styles: { font: FONT, fontSize: 8, cellPadding: 1.5, overflow: 'linebreak', valign: 'top' },
        headStyles: { font: FONT, fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 26, fontSize: 7 },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 22, halign: 'right', textColor: [180, 30, 30] },
          3: { cellWidth: 22, halign: 'right', textColor: [16, 128, 60] },
          4: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
        },
        margin: { left: 10, right: 10 },
        didParseCell: statementHooks.didParseCell,
        willDrawCell: statementHooks.willDrawCell,
        didDrawCell: statementHooks.didDrawCell,
        didDrawPage: function () {
          doc.setFontSize(7); doc.setTextColor(120)
          doc.text('Page ' + doc.internal.getCurrentPageInfo().pageNumber, pageW - 10, pageH - 6, { align: 'right' })
          doc.text('Ambria Ops · Wallet statement for ' + userName, 10, pageH - 6)
          doc.setTextColor(0)
        },
      })

      await openOrSharePdf(doc, 'wallet_' + userName.replace(/[^a-z0-9]+/gi, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pdf')
      try { await logActivity('WALLET_PDF_EXPORT', userName + ' | ' + chrono.length + ' txns') } catch (_) {}
    } catch (err) {
      alert('PDF export failed: ' + (err.message || err))
    } finally {
      setPdfBusy(false)
    }
  }

  // ═══════════════════════════════════════════════
  // MODAL HELPERS — Shared across dashboard / wallets / transactions views
  // ═══════════════════════════════════════════════
  function renderIssueModal() {
    if (!issueModal) return null
    return (
      <BottomSheet open={true} onClose={function () { setIssueModal(null); setIssueImage(null) }} title={issueType === 'debit' ? 'Deduct Points' : 'Issue Points'}>
        <div className="space-y-4">
          {/* What this does, before anything that depends on it. */}
          <div className="flex items-center bg-slate-100 rounded-xl p-1">
            {[['credit', '+ Credit', 'text-emerald-700'], ['debit', '− Debit', 'text-red-700']].map(function (opt) {
              var on = issueType === opt[0]
              return (
                <button key={opt[0]} type="button" onClick={function () { setIssueType(opt[0]) }}
                  aria-pressed={on}
                  className={"flex-1 h-9 text-[13px] font-bold rounded-lg transition-colors " +
                    (on ? "bg-white shadow-sm " + opt[2] : "text-slate-500 hover:text-slate-800")}>
                  {opt[1]}
                </button>
              )
            })}
          </div>

          {(function () {
            var who = walletProfiles[issueModal.user_id] || {}
            var bal = issueModal.balance_paise || 0
            return (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className={"shrink-0 w-11 h-11 rounded-full inline-flex items-center justify-center text-[16px] font-bold " + avatarTint(who.name)}>
                  {(who.name || '?').charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold text-slate-900 truncate">{who.name || '—'}</span>
                  <span className="block text-[12px] text-slate-500">Current balance</span>
                </span>
                <span className={"shrink-0 px-3 py-1.5 rounded-full text-[13px] font-bold tabular-nums " +
                  (bal < 0 ? "bg-red-100 text-red-700" : bal === 0 ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-700")}
                  data-notranslate>{formatPoints(bal)}</span>
              </div>
            )
          })()}

          <div>
            <label htmlFor="issue-amount" className="flex items-center gap-2 text-[13px] font-bold text-slate-800 mb-1.5">
              <Icon name="rupee" size={15} className="shrink-0 text-slate-400" />
              Amount (Points)
              <span className="text-red-500">*</span>
            </label>
            <input id="issue-amount" type="number" min="1" step="any" inputMode="decimal" value={issueAmount}
              onChange={function (e) { setIssueAmount(e.target.value) }}
              placeholder="0"
              className="w-full h-[52px] px-3.5 bg-white border border-slate-200 rounded-xl text-[20px] font-bold text-slate-900 tabular-nums placeholder:font-normal placeholder:text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
              style={{ fontSize: '20px' }} />
          </div>

          <div>
            <label className="flex items-center gap-2 text-[13px] font-bold text-slate-800 mb-1.5">
              <Icon name="fileText" size={15} className="shrink-0 text-slate-400" />
              Description
            </label>
            <VoiceInput type="text" value={issueDesc} onChange={function (e) { setIssueDesc(e.target.value) }}
              placeholder="e.g. Weekly allowance, Reimbursement..."
              maxLength="300"
              className="w-full px-3.5 py-3 bg-white border border-slate-200 rounded-xl text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
              style={{ fontSize: '16px' }} />
          </div>

          <div>
            <label className="flex items-center gap-2 text-[13px] font-bold text-slate-800 mb-1.5">
              <Icon name="camera" size={15} className="shrink-0 text-slate-400" />
              Cash Photo
            </label>
            {issueImage ? (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                <Icon name="checkCircle" size={16} className="shrink-0 text-emerald-600" />
                <span className="flex-1 min-w-0 text-[13px] font-medium text-emerald-800 truncate">{issueImage.name}</span>
                <button type="button" onClick={function () { setIssueImage(null) }}
                  aria-label="Remove photo"
                  className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-red-600 hover:bg-red-100 transition-colors">
                  <Icon name="close" size={14} />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-1 w-full py-5 rounded-xl border-2 border-dashed border-slate-300 bg-white text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors">
                <span className="text-indigo-500"><Icon name="camera" size={20} /></span>
                <span className="text-[13px] font-semibold text-indigo-600">Tap to attach photo</span>
                <span className="text-[11px] text-slate-400">Proof of the cash handed over</span>
                <input type="file" accept="image/*" capture="environment" className="sr-only"
                  onChange={function (e) { if (e.target.files?.[0]) setIssueImage(e.target.files[0]); e.target.value = '' }} />
              </label>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={function () { setIssueModal(null); setIssueImage(null) }}
              className="flex-1 h-12 rounded-xl text-[14px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 active:scale-[0.98] transition-all">
              Cancel
            </button>
            {(function () {
              // Disabled until there is an amount, and it says so by being flat
              // grey rather than a washed-out version of the live button — a pale
              // purple button reads as "loading", not as "not yet".
              var ready = !issueSaving && issueAmount && Number(issueAmount) > 0
              var debit = issueType === 'debit'
              return (
                <button type="button" onClick={issuePoints} disabled={!ready}
                  className={"flex-1 h-12 inline-flex items-center justify-center gap-1.5 rounded-xl text-[14px] font-bold text-white transition-all " +
                    (!ready ? "bg-slate-300 cursor-not-allowed"
                      : debit
                        ? "bg-gradient-to-b from-red-500 to-red-600 shadow-[0_2px_8px_rgba(220,38,38,0.30)] hover:from-red-600 hover:to-red-700 active:scale-[0.98]"
                        : "bg-gradient-to-b from-indigo-500 to-indigo-600 shadow-[0_2px_8px_rgba(79,70,229,0.30)] hover:from-indigo-600 hover:to-indigo-700 active:scale-[0.98]")}>
                  {issueSaving
                    ? (debit ? 'Deducting…' : 'Issuing…')
                    : (
                      <>
                        {debit ? 'Deduct' : 'Issue'}
                        {ready && <span className="tabular-nums" data-notranslate>{Number(issueAmount).toLocaleString('en-IN') + ' pts'}</span>}
                      </>
                    )}
                </button>
              )
            })()}
          </div>
        </div>
      </BottomSheet>
    )
  }

  function renderReceiveModal() {
    if (!receiveModal) return null
    return (
      <BottomSheet open={true} onClose={function () { setReceiveModal(null); setReceiveImage(null) }} title="Confirm Cash Received">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Amount: <span className="font-bold text-green-700">{formatPoints(Math.abs(receiveModal.amount_paise))}</span></p>
          <p className="text-xs text-gray-400">{receiveModal.description || '—'}</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">📷 Receipt Photo</label>
            {receiveImage ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {receiveImage.name}</span>
                <button onClick={function () { setReceiveImage(null) }}
                  className="text-xs text-red-500 font-bold hover:text-red-700">✕</button>
              </div>
            ) : (
              <label className="block w-full py-3 text-center text-sm text-amber-700 border-2 border-dashed border-amber-300 rounded-lg cursor-pointer hover:bg-amber-50 transition-colors font-medium">
                📷 Take photo of cash received
                <input type="file" accept="image/*" capture="environment" className="sr-only"
                  onChange={function (e) { if (e.target.files?.[0]) setReceiveImage(e.target.files[0]); e.target.value = '' }} />
              </label>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={function () { setReceiveModal(null); setReceiveImage(null) }}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
            <button onClick={confirmReceive} disabled={receiveSaving}
              className="flex-1 py-3 text-sm text-white bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors font-semibold">
              {receiveSaving ? 'Confirming...' : '✓ Confirm Received'}
            </button>
          </div>
        </div>
      </BottomSheet>
    )
  }

  function renderCollectModal() {
    if (!collectModal) return null
    var pendCashP = collectBalance ? Number(collectBalance.pending_cash_paise || 0) : 0
    var pendBankP = collectBalance ? Number(collectBalance.pending_bank_paise || 0) : 0
    var pendTaxP = collectBalance ? Number(collectBalance.pending_tax_paise || 0) : 0
    var agrCashP = collectBalance ? Number(collectBalance.agreed_cash_paise || 0) : 0
    var agrBankP = collectBalance ? Number(collectBalance.agreed_bank_paise || 0) : 0
    var colCashP = collectBalance ? Number(collectBalance.collected_cash_paise || 0) : 0
    var colBankP = collectBalance ? Number(collectBalance.collected_bank_paise || 0) : 0
    var taxP = collectBalance ? Number(collectBalance.tax_amount_paise || 0) : 0
    var canSubmit = collectEventId && collectMode && collectAmount && Number(collectAmount) > 0 && (collectMode === 'cash' || collectImage) && !collectSaving
    return (
      <BottomSheet open={true} onClose={function () { setCollectModal(false) }} title="Collect Payment">
        <div className="space-y-4">
          <EventDatePicker label="1. Event Date" value={collectDate} collapsible
            onChange={function (dateStr) { loadFunctionsForDate(dateStr) }} />

          {collectDate && (
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] mb-2">2. Select Function</label>
              {collectFunctionsLoading && <p className="text-xs text-gray-400">Loading...</p>}
              {!collectFunctionsLoading && collectEvents.length === 0 && (
                <p className="text-xs text-gray-400 mb-2">No functions on this date</p>
              )}
              {!collectFunctionsLoading && canCreateTentativeEvent && (
                <button type="button" onClick={openTentativeModal}
                  className="w-full mb-2 py-2 text-xs font-semibold text-indigo-600 border border-dashed border-indigo-300 rounded-lg hover:bg-indigo-50 transition-colors">
                  + Booking not in the list? Create tentative event
                </button>
              )}
              {collectEvents.length > 0 && (
                <div className="space-y-1.5">
                  {collectEvents.map(function (ev) {
                    var selected = String(ev.id) === collectEventId
                    return (
                      <div key={ev.id} role="button" tabIndex={0}
                        onClick={function () { selectCollectFunction(String(ev.id)) }}
                        onKeyDown={function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCollectFunction(String(ev.id)) } }}
                        className={"w-full text-left px-3 py-2.5 rounded-xl border transition-colors cursor-pointer " +
                          (selected ? "border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-slate-300 bg-white")}>
                        <div className={"text-[13px] font-bold " + (selected ? "text-indigo-900" : "text-slate-900")}>
                          {ev.event_name + (ev.client_name ? ' — ' + ev.client_name : '')}
                        </div>
                        <div className={"text-[12px] " + (selected ? "text-indigo-700" : "text-slate-500")}>
                          {(ev.venue_name || '') + (ev.session ? ' · ' + ev.session : '')}
                        </div>
                        {(ev.department || ev.contract_no) && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <DeptChip name={ev.department} />
                            {ev.contract_no && (
                              <span className="text-[10px] font-mono text-gray-500">#{ev.contract_no}</span>
                            )}
                          </div>
                        )}
                        {ev.created_user_name && (
                          <div className={"text-[11px] mt-0.5 " + (selected ? "text-blue-600" : "text-gray-400")}>
                            Contract by {ev.created_user_name}
                          </div>
                        )}
                        {(ev.contact_number || ev.secondary_contact) && (
                          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
                            {ev.contact_person && <span className="text-gray-500">{ev.contact_person}:</span>}
                            {ev.contact_number && (
                              <a href={"tel:" + String(ev.contact_number).replace(/[^0-9+]/g, '')}
                                onClick={function (e) { e.stopPropagation() }}
                                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium">
                                <Icon name="phone" size={13} className="shrink-0" />
                                {ev.contact_number}
                              </a>
                            )}
                            {ev.secondary_contact && (
                              <a href={"tel:" + String(ev.secondary_contact).replace(/[^0-9+]/g, '')}
                                onClick={function (e) { e.stopPropagation() }}
                                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800">
                                <Icon name="phone" size={13} className="shrink-0" />
                                {ev.secondary_contact}
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {collectEventId && (
            <div className="bg-gray-50 rounded-lg px-3 py-2.5">
              {collectBalanceLoading ? (
                <p className="text-xs text-gray-400">Loading balance...</p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em]">Pending Balance</div>
                    <button type="button" onClick={function () { setShowActualCash(!showActualCash) }}
                      className="shrink-0 px-2 py-1 rounded-lg text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors">
                      {showActualCash ? 'Actual ×10' : 'LMS scale'}
                    </button>
                  </div>
                  {/* Nil is slate, owed is red, settled is emerald. Three states,
                      three answers — a dash in green used to mean both "nothing
                      to collect" and "nothing here at all". */}
                  <div className="flex flex-wrap gap-x-6 gap-y-3">
                    <div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Icon name="banknote" size={13} className="shrink-0 text-slate-400" />
                        Cash{showActualCash && agrCashP > 0 ? ' (actual)' : ''}
                      </div>
                      <div className={"mt-0.5 text-[15px] font-bold tabular-nums whitespace-nowrap " +
                        (pendCashP > 0 ? "text-red-600" : (agrCashP > 0 || colCashP > 0) ? "text-emerald-600" : "text-slate-400")}
                        data-notranslate>
                        {agrCashP > 0 ? formatPoints(pendCashP * (showActualCash ? 10 : 1)) : (colCashP > 0 ? formatPoints(colCashP * (showActualCash ? 10 : 1)) + ' collected' : '—')}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Icon name="bank" size={13} className="shrink-0 text-slate-400" />
                        Bank
                      </div>
                      <div className={"mt-0.5 text-[15px] font-bold tabular-nums whitespace-nowrap " +
                        (pendBankP > 0 ? "text-red-600" : (agrBankP > 0 || colBankP > 0) ? "text-emerald-600" : "text-slate-400")}
                        data-notranslate>
                        {agrBankP > 0 ? formatPoints(pendBankP) : (colBankP > 0 ? formatPoints(colBankP) + ' collected' : '—')}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Icon name="receipt" size={13} className="shrink-0 text-slate-400" />
                        Tax
                      </div>
                      <div className={"mt-0.5 text-[15px] font-bold tabular-nums whitespace-nowrap " +
                        (pendTaxP > 0 ? "text-red-600" : taxP > 0 ? "text-emerald-600" : "text-slate-400")}
                        data-notranslate>
                        {taxP > 0 ? formatPoints(pendTaxP) : '—'}
                      </div>
                    </div>
                  </div>
                  {agrCashP === 0 && agrBankP === 0 && taxP === 0 && (
                    <div className="text-xs text-gray-400 mt-1.5">No agreed split set from LMS</div>
                  )}
                </>
              )}
            </div>
          )}

          {collectEventId && (
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] mb-2">3. Payment Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={function () { setCollectMode('cash') }}
                  aria-pressed={collectMode === 'cash'}
                  className={"h-12 inline-flex items-center justify-center gap-2 rounded-xl border text-[14px] font-bold transition-colors " +
                    (collectMode === 'cash' ? "border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
                  <Icon name="banknote" size={16} />
                  Cash
                </button>
                <button type="button" onClick={function () { setCollectMode('bank') }}
                  aria-pressed={collectMode === 'bank'}
                  className={"h-12 inline-flex items-center justify-center gap-2 rounded-xl border text-[14px] font-bold transition-colors " +
                    (collectMode === 'bank' ? "border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
                  <Icon name="bank" size={16} />
                  Bank
                </button>
              </div>
            </div>
          )}

          {collectEventId && (
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] mb-2">4. Amount Received</label>
              <input type="number" min="1" step="any" inputMode="decimal" value={collectAmount}
                onChange={function (e) { setCollectAmount(e.target.value) }}
                placeholder="0" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{ fontSize: '16px' }} />
            </div>
          )}

          {collectEventId && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">5. Description</label>
              <VoiceInput type="text" value={collectDesc} onChange={function (e) { setCollectDesc(e.target.value) }}
                placeholder="e.g. Advance payment, Final settlement..."
                maxLength="300" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}

          {collectEventId && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">6. Receipt Photo {collectMode === 'bank' && <span className="text-red-500">*</span>}{collectMode === 'cash' && <span className="text-gray-400 normal-case">(optional)</span>}</label>
              {collectImage ? (
                <div className="flex items-center gap-2 px-3 py-2.5 border border-green-300 bg-green-50 rounded-lg">
                  <Icon name="checkCircle" size={16} className="shrink-0 text-emerald-600" />
                  <span className="flex-1 min-w-0 text-[13px] font-medium text-emerald-800 truncate">{collectImage.name}</span>
                  <button type="button" onClick={function () { setCollectImage(null) }} aria-label="Remove photo"
                    className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-red-600 hover:bg-red-100 transition-colors">
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <label className="h-12 inline-flex items-center justify-center gap-2 text-[13px] font-bold text-slate-700 border border-slate-200 bg-white rounded-xl cursor-pointer hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                    <Icon name="camera" size={16} />
                    Camera
                    <input type="file" accept="image/*" capture="environment" className="sr-only"
                      onChange={function (e) { if (e.target.files?.[0]) setCollectImage(e.target.files[0]); e.target.value = '' }} />
                  </label>
                  <label className="h-12 inline-flex items-center justify-center gap-2 text-[13px] font-bold text-slate-700 border border-slate-200 bg-white rounded-xl cursor-pointer hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                    <Icon name="gallery" size={16} />
                    Gallery
                    <input type="file" accept="image/*" className="sr-only"
                      onChange={function (e) { if (e.target.files?.[0]) setCollectImage(e.target.files[0]); e.target.value = '' }} />
                  </label>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={function () { setCollectModal(false) }}
              className="flex-1 h-12 rounded-xl text-[14px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 active:scale-[0.98] transition-all">
              Cancel
            </button>
            <button type="button" onClick={submitCollection} disabled={!canSubmit}
              className={"flex-1 h-12 inline-flex items-center justify-center gap-1.5 rounded-xl text-[14px] font-bold text-white transition-all " +
                (canSubmit
                  ? "bg-gradient-to-b from-indigo-500 to-indigo-600 shadow-[0_2px_8px_rgba(79,70,229,0.30)] hover:from-indigo-600 hover:to-indigo-700 active:scale-[0.98]"
                  : "bg-slate-300 cursor-not-allowed")}>
              {collectSaving
                ? 'Saving…'
                : (
                  <>
                    Collect
                    {collectAmount && Number(collectAmount) > 0 && (
                      <span className="tabular-nums" data-notranslate>{Number(collectAmount).toLocaleString('en-IN') + ' pts'}</span>
                    )}
                  </>
                )}
            </button>
          </div>
        </div>
      </BottomSheet>
    )
  }

  function renderTentativeModal() {
    if (!tentativeModal) return null
    var canSubmitTentative = !tentativeSaving && tentativeGuestName.trim() && tentativeVenue && tentativeFunctionType
    return (
      <BottomSheet open={true} onClose={function () { setTentativeModal(false) }} title="Create Tentative Event">
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            For a booking that hasn't been contracted in LMS yet. It'll get its own ledger right away —
            once the real LMS event syncs in, an admin can merge this into it.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Guest Name</label>
            <input type="text" value={tentativeGuestName}
              onChange={function (e) { setTentativeGuestName(e.target.value) }}
              placeholder="e.g. Himanshu Vats"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Venue</label>
            <select value={tentativeVenue} onChange={function (e) { setTentativeVenue(e.target.value) }}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ fontSize: '16px' }}>
              <option value="">Select venue...</option>
              {activeVenues.map(function (v) { return <option key={v.id} value={v.id}>{(v.code ? v.code + ' — ' : '') + v.name}</option> })}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pax</label>
              <input type="number" min="0" inputMode="numeric" value={tentativePax}
                onChange={function (e) { setTentativePax(e.target.value) }}
                placeholder="0"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ fontSize: '16px' }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Function Type</label>
              <select value={tentativeFunctionType} onChange={function (e) { setTentativeFunctionType(e.target.value) }}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ fontSize: '16px' }}>
                <option value="">Select...</option>
                {eventTypeOptions.map(function (t, i) { return <option key={t.label + i} value={t.label}>{(t.icon ? t.icon + ' ' : '') + t.label}</option> })}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-400">Function date: {formatDate(collectDate)}</p>
          <div className="flex gap-3 pt-2">
            <button onClick={function () { setTentativeModal(false) }}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
            <button onClick={submitTentativeEvent} disabled={!canSubmitTentative}
              className="flex-1 py-3 text-sm text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors font-semibold">
              {tentativeSaving ? 'Creating...' : 'Create Event'}
            </button>
          </div>
        </div>
      </BottomSheet>
    )
  }

  function renderTransferModal() {
    if (!transferModal) return null
    function closeTransfer() { setTransferModal(false); transferRec.cancel() }
    return (
      <BottomSheet open={true} onClose={closeTransfer} title="Transfer Cash">
        <div className="space-y-4">
          <div>
            <label className="flex items-center gap-2 text-[13px] font-bold text-slate-800 mb-1.5">
              <Icon name="user" size={15} className="shrink-0 text-slate-400" />
              Send to
              <span className="text-red-500">*</span>
            </label>
            <SearchDropdown
              items={transferUsers.map(function (u) { return { label: u.name, value: u.id } })}
              value={transferTo}
              onChange={function (val) { setTransferTo(val) }}
              placeholder="Search user..." />
            {transferTo && (
              <p className="mt-1.5 text-[12px] text-slate-500">
                Balance:{' '}
                {transferToBalance === undefined ? (
                  '…'
                ) : (
                  <span className={"font-bold tabular-nums " + (transferToBalance < 0 ? "text-red-600" : "text-slate-700")} data-notranslate>
                    {formatPoints(transferToBalance)}
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Bounded to today − 3 days, same as expense date: a transfer is
              cash that already changed hands, and this records when. */}
          {(function () {
            var today = toYMD(new Date())
            var minDate = toYMD(new Date(Date.now() - 3 * 86400000))
            return (
              <div>
                <label htmlFor="transfer-date" className="flex items-center gap-2 text-[13px] font-bold text-slate-800 mb-1.5">
                  <Icon name="calendar" size={15} className="shrink-0 text-slate-400" />
                  Transfer Date
                  <span className="text-red-500">*</span>
                </label>
                <input id="transfer-date" type="date" value={transferDate} min={minDate} max={today}
                  onChange={function (e) {
                    var v = e.target.value
                    if (v && v < minDate) { setTransferDate(minDate); return }
                    if (v && v > today) { setTransferDate(today); return }
                    setTransferDate(v)
                  }}
                  className="w-full px-3.5 py-3 bg-white border border-slate-200 rounded-xl text-[14px] text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
                  style={{ fontSize: '16px' }} />
                <p className="text-[10px] text-slate-500 mt-1">Today or up to 3 days back.</p>
              </div>
            )
          })()}

          <div>
            <label htmlFor="transfer-amount" className="flex items-center gap-2 text-[13px] font-bold text-slate-800 mb-1.5">
              <Icon name="rupee" size={15} className="shrink-0 text-slate-400" />
              Amount (Points)
              <span className="text-red-500">*</span>
            </label>
            <input id="transfer-amount" type="number" min="1" step="any" inputMode="decimal" value={transferAmount}
              onChange={function (e) { setTransferAmount(e.target.value) }}
              placeholder="0"
              className="w-full h-[52px] px-3.5 bg-white border border-slate-200 rounded-xl text-[20px] font-bold text-slate-900 tabular-nums placeholder:font-normal placeholder:text-slate-300 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
              style={{ fontSize: '20px' }} />
            {transferAmount && Number(transferAmount) > 0 && Math.round(Number(transferAmount) * 100) > walletBalance && (
              <div className="mt-2 flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                <Icon name="alert" size={15} className="shrink-0 mt-px text-amber-600" />
                <p className="text-[12px] text-amber-800 leading-snug">
                  This takes your wallet negative. You have
                  <span className="font-bold tabular-nums" data-notranslate>{' ' + formatPoints(walletBalance)}</span>.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 text-[13px] font-bold text-slate-800 mb-1.5">
              <Icon name="fileText" size={15} className="shrink-0 text-slate-400" />
              Description
            </label>
            <VoiceInput type="text" value={transferDesc} onChange={function (e) { setTransferDesc(e.target.value) }}
              placeholder="e.g. Repayment, Lunch money..." maxLength="300"
              className="w-full px-3.5 py-3 bg-white border border-slate-200 rounded-xl text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
              style={{ fontSize: '16px' }} />
          </div>

          <div>
            <label className="flex items-center gap-2 text-[13px] font-bold text-slate-800 mb-1.5">
              <Icon name="camera" size={15} className="shrink-0 text-slate-400" />
              Cash proof
            </label>
            {transferImage ? (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                <Icon name="checkCircle" size={16} className="shrink-0 text-emerald-600" />
                <span className="flex-1 min-w-0 text-[13px] font-medium text-emerald-800 truncate">{transferImage.name}</span>
                <button type="button" onClick={function () { setTransferImage(null) }} aria-label="Remove photo"
                  className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-red-600 hover:bg-red-100 transition-colors">
                  <Icon name="close" size={14} />
                </button>
              </div>
            ) : transferRec.url ? (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-slate-200">
                <audio src={transferRec.url} controls className="flex-1 min-w-0 h-8" />
                <button type="button" onClick={transferRec.remove} aria-label="Remove voice note"
                  className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-lg text-red-600 hover:bg-red-100 transition-colors">
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ) : transferRec.recording ? (
              <button type="button" onClick={transferRec.stop}
                className="w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl bg-red-500 text-[13px] font-bold text-white hover:bg-red-600 transition-colors">
                <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                Recording… tap to stop
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="h-12 inline-flex items-center justify-center gap-2 text-[13px] font-bold text-slate-700 border border-slate-200 bg-white rounded-xl cursor-pointer hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                  <Icon name="camera" size={16} />
                  Photo
                  <input type="file" accept="image/*" capture="environment" className="sr-only"
                    onChange={function (e) { if (e.target.files?.[0]) setTransferImage(e.target.files[0]); e.target.value = '' }} />
                </label>
                <button type="button" onClick={transferRec.start}
                  className="h-12 inline-flex items-center justify-center gap-2 text-[13px] font-bold text-slate-700 border border-slate-200 bg-white rounded-xl hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                  <Icon name="mic" size={16} />
                  Voice note
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={closeTransfer}
              className="flex-1 h-12 rounded-xl text-[14px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 active:scale-[0.98] transition-all">
              Cancel
            </button>
            {(function () {
              var ready = !transferSaving && transferTo && transferAmount && Number(transferAmount) > 0 && transferDate
              return (
                <button type="button" onClick={initiateTransfer} disabled={!ready}
                  className={"flex-1 h-12 inline-flex items-center justify-center gap-1.5 rounded-xl text-[14px] font-bold text-white transition-all " +
                    (ready
                      ? "bg-gradient-to-b from-indigo-500 to-indigo-600 shadow-[0_2px_8px_rgba(79,70,229,0.30)] hover:from-indigo-600 hover:to-indigo-700 active:scale-[0.98]"
                      : "bg-slate-300 cursor-not-allowed")}>
                  {transferSaving
                    ? 'Sending…'
                    : (
                      <>
                        Send
                        {transferAmount && Number(transferAmount) > 0 && (
                          <span className="tabular-nums" data-notranslate>{Number(transferAmount).toLocaleString('en-IN') + ' pts'}</span>
                        )}
                      </>
                    )}
                </button>
              )
            })()}
          </div>
        </div>
      </BottomSheet>
    )
  }

  function renderTransferConfirmModal() {
    if (!transferConfirmModal) return null
    function closeConfirm() { setTransferConfirmModal(null); setTransferConfirmImage(null); transferConfirmRec.cancel() }
    return (
      <BottomSheet open={true} onClose={closeConfirm} title="Confirm Transfer Received">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">From: <span className="font-bold text-gray-900">{transferConfirmModal._fromName}</span></p>
          <p className="text-sm text-gray-500">Amount: <span className="font-bold text-green-700">{formatPoints(transferConfirmModal.amount_paise)}</span></p>
          <p className="text-xs text-gray-400">{transferConfirmModal.description || '—'}</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Proof of receipt</label>
            {transferConfirmImage ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-600 font-medium truncate flex-1">✓ {transferConfirmImage.name}</span>
                <button onClick={function () { setTransferConfirmImage(null) }} className="text-xs text-red-500 font-bold hover:text-red-700">✕</button>
              </div>
            ) : transferConfirmRec.url ? (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 border border-blue-200">
                <audio src={transferConfirmRec.url} controls className="flex-1 h-8" />
                <button onClick={transferConfirmRec.remove} className="text-xs text-red-500 font-bold hover:text-red-700 flex-shrink-0">✕</button>
              </div>
            ) : transferConfirmRec.recording ? (
              <button type="button" onClick={transferConfirmRec.stop}
                className="w-full py-3 rounded-lg bg-red-500 text-white text-sm font-medium animate-pulse flex items-center justify-center gap-2">
                <span className="w-2.5 h-2.5 bg-white rounded-full" />Recording... Tap to stop
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="py-3 text-center text-sm text-amber-700 border-2 border-dashed border-amber-300 rounded-lg cursor-pointer hover:bg-amber-50 transition-colors font-medium">
                  📷 Photo
                  <input type="file" accept="image/*" capture="environment" className="sr-only"
                    onChange={function (e) { if (e.target.files?.[0]) setTransferConfirmImage(e.target.files[0]); e.target.value = '' }} />
                </label>
                <button type="button" onClick={transferConfirmRec.start}
                  className="py-3 text-center text-sm text-amber-700 border-2 border-dashed border-amber-300 rounded-lg hover:bg-amber-50 transition-colors font-medium">
                  🎤 Voice note
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={closeConfirm}
              className="flex-1 py-3 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors font-semibold">Cancel</button>
            <button onClick={confirmTransferReceive} disabled={transferConfirmSaving}
              className="flex-1 py-3 text-sm text-white bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors font-semibold">
              {transferConfirmSaving ? 'Confirming...' : '✓ Confirm Received'}
            </button>
          </div>
        </div>
      </BottomSheet>
    )
  }

  function renderEnlargedImg() {
    if (!enlargedWalletImg) return null
    return createPortal((
      <div className="fixed inset-0 bg-black/80 z-[9998] flex items-center justify-center p-4" onClick={function () { setEnlargedWalletImg(null) }}>
        <img src={enlargedWalletImg} alt="" className="max-w-full max-h-[80vh] rounded-lg" />
      </div>
    ), document.body)
  }

  // ═══════════════════════════════════════════════
  // WALLET DASHBOARD — Own wallet landing (mobile-first)
  // ═══════════════════════════════════════════════
  if (walletView === 'dashboard' && selectedWallet) {
    var bal = walletBalance != null ? walletBalance : (selectedWallet.balance_paise || 0)
    var balColor = bal < 0 ? 'text-red-700' : bal === 0 ? 'text-gray-500' : 'text-green-800'
    var balBg = bal < 0 ? 'bg-red-50 border-red-200' : bal === 0 ? 'bg-gray-50 border-gray-200' : 'bg-green-50 border-green-200'
    var lastTxn = walletTxns[0]
    var lastActivity = lastTxn ? formatDate(lastTxn.created_at) : 'none yet'
    var previewTxns = mergeExpenseWalletRows(walletTxns)
      .sort(function (a, b) { return new Date(b._sortAt || b.created_at) - new Date(a._sortAt || a.created_at) })
    var receiveCount = pendingIncoming.length + pendingIssues.length
    // Pending confirmations take priority over the Issue shortcut — otherwise an admin/
    // auditor's own incoming transfers never surface on their dashboard at all.
    var showIssueTile = (isAdmin || isAuditor) && receiveCount === 0
    return (
      <div className="@container">
      <div className="space-y-4 max-w-2xl mx-auto @3xl:max-w-none">
        <WalletBackdrop inAdmin={inAdmin} />
        <div className="space-y-2">
          {inAdmin && (
            <button type="button" onClick={handleBack}
              className="inline-flex items-center gap-1.5 h-8 -ml-1 px-2 rounded-lg text-[13px] font-bold text-indigo-600 hover:bg-indigo-50 transition-colors">
              <Icon name="arrowLeft" size={15} />
              Back
            </button>
          )}
          <div className="flex items-center gap-3">
            <span className={"shrink-0 w-11 h-11 rounded-full inline-flex items-center justify-center text-[16px] font-bold " + avatarTint(profile.name)}>
              {(profile.name || '?').charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-[19px] font-bold text-slate-900 leading-snug truncate">{profile.name || '—'}</h2>
              <p className="text-[12px] text-slate-500">Your wallet</p>
            </div>
          </div>
        </div>

        {/* items-stretch, not items-start: the right column held one short card
            and then stopped, leaving the page with a column of nothing beside a
            column of content. Stretched, the two sides are one block. */}
        <div className="space-y-4 @3xl:grid @3xl:grid-cols-12 @3xl:gap-5 @3xl:space-y-0 @3xl:items-stretch">
          <div className="@3xl:col-span-5">

        {/* The heading moves out of the card so that this column and the one
            beside it start their cards on the same line. Recent Transactions
            has always had its heading outside, and that one label was the whole
            reason the two columns began at different heights. */}
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] mb-2">Balance</p>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5">
          <p className={"font-display text-[34px] font-extrabold tabular-nums leading-none " + balColor}
            data-notranslate>{formatPoints(bal)}</p>
          <p className="mt-2.5 text-[12px] text-slate-500">Last activity — {lastActivity}</p>
        </div>

        {/* Two up on a phone, four across once the page splits into columns.
            At that point this column is about 600px and the tiles were sitting
            two to a row at 300px each — a 40px glyph and one word in the middle
            of a card wide enough for a sentence. */}
        <div className="mt-4 grid grid-cols-2 @3xl:grid-cols-4 gap-3">
          <button type="button" onClick={openCollectModal} className="relative py-4 bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-2">
            <span className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 inline-flex items-center justify-center">
              <Icon name="download" size={18} />
            </span>
            <span className="text-[13px] font-bold text-slate-800">Collect</span>
          </button>
          <button type="button" onClick={openTransferModal} className="relative py-4 bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-2">
            <span className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 inline-flex items-center justify-center">
              <Icon name="transfer" size={18} />
            </span>
            <span className="text-[13px] font-bold text-slate-800">Transfer</span>
          </button>
          <button type="button" onClick={function () { setWalletView('transactions'); openWalletTxns(selectedWallet) }} className="relative py-4 bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-2">
            <span className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 inline-flex items-center justify-center">
              <Icon name="clock" size={18} />
            </span>
            <span className="text-[13px] font-bold text-slate-800">History</span>
          </button>
          {showIssueTile ? (
            <button type="button" onClick={function () { setIssueModal(selectedWallet); setIssueAmount(''); setIssueDesc(''); setIssueType('credit') }} className="relative py-4 bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-2">
      <span className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 inline-flex items-center justify-center">
        <Icon name="plus" size={18} />
      </span>
      <span className="text-[13px] font-bold text-slate-800">Issue</span>
            </button>
          ) : receiveCount > 0 ? (
            <button type="button" onClick={function () { setWalletView('transactions'); openWalletTxns(selectedWallet) }} className="relative py-4 bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 active:scale-[0.98] transition-all flex flex-col items-center justify-center gap-2">
              <span className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 inline-flex items-center justify-center">
                <Icon name="inbox" size={18} />
              </span>
              <span className="text-[13px] font-bold text-slate-800">Receive</span>
              <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full inline-flex items-center justify-center tabular-nums">{receiveCount}</span>
            </button>
          ) : (
            /* An empty slot, not a button that does nothing. Dashed and quiet,
               so the grid keeps its shape without offering a fourth action. */
            <div className="py-4 border border-dashed border-slate-200 rounded-2xl flex items-center justify-center">
              <span className="text-[12px] text-slate-400">No pending</span>
            </div>
          )}
        </div>
          </div>

          <div className="@3xl:col-span-7 @3xl:flex @3xl:flex-col">
        {/* Recent transactions */}
        <div className="@3xl:flex-1 @3xl:flex @3xl:flex-col @3xl:min-h-0">
          {/* The heading carries the way to the rest of them. It listed five and
             said nothing about there being more, so History was the only route
             and it was two tiles away. */}
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em]">Recent Transactions</p>
            {previewTxns.length > 5 && (
              <button type="button" onClick={function () { setWalletView('transactions'); openWalletTxns(selectedWallet) }}
                className="text-[12px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
                View all
              </button>
            )}
          </div>
          {previewTxns.length === 0 ? (
            /* Says what would be here and how it gets here, rather than only
               that there is nothing. */
            <div className="py-8 px-4 text-center bg-white border border-slate-200 rounded-2xl @3xl:flex-1 @3xl:flex @3xl:flex-col @3xl:items-center @3xl:justify-center">
              <span className="inline-flex w-11 h-11 rounded-full bg-slate-100 text-slate-400 items-center justify-center">
                <Icon name="receipt" size={19} />
              </span>
              <p className="mt-2.5 text-[13px] font-bold text-slate-700">No transactions yet</p>
              <p className="mt-1 text-[12px] text-slate-500 leading-snug">Collecting cash or receiving a transfer will show up here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {previewTxns.slice(0, 5).map(function (t) {
                var isCredit = t.type === 'credit'
                var isExpKind = t.reference_type === 'expense' || t.reference_type === 'expense_refund'
                var xp = isExpKind && t.reference_id ? expenseRefs[t.reference_id] : null
                var tr = t.reference_type === 'transfer' && t.reference_id ? transferParties[t.reference_id] : null
                var epcHit = epcRefs[t.id] || null
                var isEpc = !!epcHit && !epcHit.isCancel
                var isEpcCancel = !!epcHit && epcHit.isCancel
                var isCancelled = t.status === 'cancelled'
                var cpName = null
                if (tr) {
                  var cpId = t.type === 'debit' ? tr.to_user_id : tr.from_user_id
                  cpName = walletProfiles[cpId]?.name
                }
                var enrichLine = null
                if (isExpKind) {
                  var typeName = xp?.expense_types?.name || ''
                  var subTypeName = xp?.expense_sub_types?.name || ''
                  var alloc = (xp?.expense_allocations && xp.expense_allocations[0]) || null
                  var dept = alloc?.department || ''
                  var parts = []
                  if (typeName) parts.push((xp.expense_types?.icon ? xp.expense_types.icon + ' ' : '') + typeName + (subTypeName ? ' › ' + subTypeName : ''))
                  if (dept) parts.push(dept)
                  if (t.reference_type === 'expense_refund' && xp?.amount_paise) parts.push('orig ' + formatPoints(xp.amount_paise))
                  if (parts.length > 0) enrichLine = <p className="text-[11px] text-indigo-600 truncate">{parts.join(' · ')}</p>
                  else enrichLine = <p className="text-[11px] text-gray-400 italic truncate">No type / dept set</p>
                } else if (t.reference_type === 'collection') {
                  enrichLine = <p className="text-[11px] text-emerald-600 truncate">🎉 Event Collection{t.payment_mode ? ' · ' + t.payment_mode : ''}</p>
                } else if (t.reference_type === 'collection_cancel') {
                  enrichLine = <p className="text-[11px] text-rose-600 truncate">🔁 Cancellation reversal</p>
                } else if (isEpc) {
                  enrichLine = <p className="text-[11px] text-emerald-600 truncate">🍽 Extra Plates · {epcHit.epc.extras_charged}{epcHit.epc.payment_mode ? ' · ' + epcHit.epc.payment_mode : ''}</p>
                } else if (isEpcCancel) {
                  enrichLine = <p className="text-[11px] text-rose-600 truncate">🔁 Extra Plate cancel</p>
                } else if (tr && cpName) {
                  enrichLine = <p className="text-[11px] text-blue-600 truncate">{t.type === 'debit' ? '→ ' : '← '}{cpName}</p>
                } else if (t.reference_type === 'issued') {
                  enrichLine = <p className="text-[11px] text-purple-600 truncate">Issued by admin</p>
                } else if (t.reference_type === 'deducted') {
                  enrichLine = <p className="text-[11px] text-orange-600 truncate">Deducted by admin</p>
                } else if (t.reference_type === 'opening') {
                  enrichLine = <p className="text-[11px] text-gray-500 truncate">Opening balance</p>
                }
                var epcCancellable = isEpc && epcHit.epc.status !== 'cancelled' && (isAdmin || epcHit.epc.collected_by === profile.id)
                var collCancellable = t.reference_type === 'collection' && !isCancelled && (isAdmin || t.performed_by === profile.id)
                var isExpRow = (t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id
                var isPayRow = PAYMENT_REF_TYPES.indexOf(t.reference_type) !== -1
                var rowIsClickable = isExpRow || t.reference_type === 'collection' || isEpc || isPayRow
                function handleRowClick() {
                  if (!rowIsClickable) return
                  if (isExpRow) {
                    if (onOpenExpense) onOpenExpense(t.reference_id)
                    else openExpenseDetail(t.reference_id)
                  } else if (t.reference_type === 'collection') {
                    openCollectionDetail(t, 'collection')
                  } else if (isEpc) {
                    openCollectionDetail(t, 'epc')
                  } else if (isPayRow) {
                    openPaymentDetail(t)
                  }
                }
                return (
                  <div key={t.id}
                    onClick={handleRowClick}
                    className={"flex items-center gap-3 p-3 bg-white border rounded-xl " + (isCancelled ? "border-gray-200 opacity-50" : "border-gray-200") + (rowIsClickable ? " cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors" : "")}>
                    <div className={"w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 " + (isCredit ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600")}>
                      <span className="text-sm font-bold">{isCredit ? '+' : '−'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {t.reference_type && (
                          <span className={CHIP + (REF_TYPE_TONES[t.reference_type] || CHIP_NEUTRAL) + " flex-shrink-0"}>
                            {REF_TYPE_LABELS[t.reference_type] || t.reference_type}
                          </span>
                        )}
                        <p className={"text-sm font-bold text-gray-800 truncate " + (isCancelled ? "line-through" : "")}>{t.description || (isCredit ? 'Credit' : 'Debit')}</p>
                        {t.status === 'pending' && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded flex-shrink-0">Pending</span>}
                        {isCancelled && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded flex-shrink-0">Cancelled</span>}
                      </div>
                      {enrichLine}
                      {isCancelled && t.cancelled_reason && (
                        <p className="text-[10px] text-rose-600 italic truncate">Reason: {t.cancelled_reason}</p>
                      )}
                      <p className="text-[11px] text-slate-500">
                        {tr && tr.transfer_date && tr.transfer_date !== String(t.created_at).slice(0, 10)
                          ? formatDate(tr.transfer_date)
                          : formatDate(t.created_at)}
                      </p>
                      <div className="flex gap-1 flex-wrap mt-1" onClick={function (ev) { ev.stopPropagation() }}>
                        {t.reference_type === 'collection' && t.receipt_no && (
                          <button onClick={function (ev) { ev.stopPropagation(); printReceipt(t) }}
                            className="px-2 py-1 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors">
                            🖨 #{t.receipt_no}
                          </button>
                        )}
                        {collCancellable && (
                          <button onClick={function (ev) { ev.stopPropagation(); openCancel(t, 'collection') }}
                            className="px-2 py-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors">
                            🚫 Cancel
                          </button>
                        )}
                        {epcCancellable && (
                          <button onClick={function (ev) { ev.stopPropagation(); openCancel(t, 'epc') }}
                            className="px-2 py-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors">
                            🚫 Cancel
                          </button>
                        )}
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-right">
                      <span className={"block text-sm font-bold " + (isCredit ? "text-green-600" : "text-red-600")}>
                        {isCredit ? '+' : '−'}{formatPoints(t.amount_paise)}
                      </span>
                      {/* The verdict goes with the figure rather than the
                          description, here as everywhere else. */}
                      {(function () {
                        if (isCancelled) return null
                        var chk = isExpRow ? xp : t
                        if (!chk) return null
                        if (!canMarkChecked && !chk.checked_by) return null
                        return (
                          <span className="mt-1 flex justify-end" onClick={function (ev) { ev.stopPropagation() }}>
                            <CheckedStamp
                              variant="stamp"
                              checked={!!chk.checked_by}
                              checkerName={chk.checked_by && walletProfiles[chk.checked_by] ? walletProfiles[chk.checked_by].name : null}
                              checkedAt={chk.checked_at}
                              canToggle={canMarkChecked}
                              canUncheck={chk.checked_by === profile.id || isAdmin || isAuditor}
                              busy={isExpRow ? checkingExpId === t.reference_id : checkingTxnId === t.id}
                              onToggle={function () { if (isExpRow) toggleExpenseCheck(t.reference_id); else toggleWalletCheck(t) }}
                            />
                          </span>
                        )
                      })()}
                    </span>
                  </div>
                )
              })}
              {walletTxns.length >= 5 && (
                <button onClick={function () { setWalletView('transactions'); openWalletTxns(selectedWallet) }}
                  className="w-full py-2 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
                  View all →
                </button>
              )}
            </div>
          )}
        </div>
          </div>
        </div>

        {renderCollectModal()}
        {renderTentativeModal()}
        {renderTransferModal()}
        {renderIssueModal()}
        {renderReceiveModal()}
        {renderTransferConfirmModal()}
        {renderCancelModal()}
        {renderCollectionDetailModal()}
        {renderPaymentDetailModal()}
        {renderExpenseDetailModal()}
        {renderEnlargedImg()}
      </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════
  // WALLET ADMIN — All balances
  // ═══════════════════════════════════════════════
  if (walletView === 'wallets') {
    var wSearchLower = walletSearch.toLowerCase()
    var uniqueRoles = {}
    ;(allWallets || []).forEach(function (w) {
      var p = walletProfiles[w.user_id]
      if (p && p.role) uniqueRoles[p.role] = true
    })
    var roleOptions = Object.keys(uniqueRoles).sort()

    var filteredWallets = allWallets.filter(function (w) {
      var p = walletProfiles[w.user_id]
      if (walletSearch) {
        var matches = (p?.name || '').toLowerCase().indexOf(wSearchLower) !== -1 ||
          (p?.email || '').toLowerCase().indexOf(wSearchLower) !== -1 ||
          (p?.role || '').toLowerCase().indexOf(wSearchLower) !== -1
        if (!matches) return false
      }
      if (walletRoleFilter && (p?.role || '') !== walletRoleFilter) return false
      var bal = w.balance_paise || 0
      if (walletBalanceState === 'positive' && bal <= 0) return false
      if (walletBalanceState === 'zero' && bal !== 0) return false
      if (walletBalanceState === 'negative' && bal >= 0) return false
      if (walletPendingOnly && !(w._pendingCount > 0)) return false
      return true
    })

    if (walletSort === 'balance_desc') {
      filteredWallets = filteredWallets.slice().sort(function (a, b) { return (b.balance_paise || 0) - (a.balance_paise || 0) })
    } else if (walletSort === 'balance_asc') {
      filteredWallets = filteredWallets.slice().sort(function (a, b) { return (a.balance_paise || 0) - (b.balance_paise || 0) })
    } else if (walletSort === 'pending') {
      filteredWallets = filteredWallets.slice().sort(function (a, b) { return (b._pendingCount || 0) - (a._pendingCount || 0) })
    } else if (walletSort === 'activity') {
      filteredWallets = filteredWallets.slice().sort(function (a, b) {
        var ta = a.updated_at ? new Date(a.updated_at).getTime() : 0
        var tb = b.updated_at ? new Date(b.updated_at).getTime() : 0
        return tb - ta
      })
    }

    var wTotalPages = Math.max(1, Math.ceil(filteredWallets.length / walletPageSize))
    var wPageNow = Math.min(walletPage, wTotalPages - 1)
    var pagedWallets = filteredWallets.slice(wPageNow * walletPageSize, (wPageNow + 1) * walletPageSize)
    var wFirstShown = filteredWallets.length === 0 ? 0 : wPageNow * walletPageSize + 1
    var wLastShown = Math.min((wPageNow + 1) * walletPageSize, filteredWallets.length)

    var wPageButtons = []
    for (var wpb = 0; wpb < wTotalPages; wpb++) {
      if (wpb === 0 || wpb === wTotalPages - 1 || (wpb >= wPageNow - 1 && wpb <= wPageNow + 1)) wPageButtons.push(wpb)
      else if (wPageButtons[wPageButtons.length - 1] !== '…') wPageButtons.push('…')
    }

    function goWalletPage(n) {
      setWalletPage(n)
      scrollToTopOf(walletListRef.current)
    }

    // Names are scanned, not looked up by page number, so the search above is
    // still the real way to find somebody. This is here so ninety cards are
    // not all built at once, and so the foot of the list says where you are.
    function renderWalletPager() {
      if (filteredWallets.length === 0) return null
      return (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-white border border-slate-200 rounded-2xl">
          <p className="text-[12px] font-semibold text-slate-500" data-notranslate>
            Showing {wFirstShown}–{wLastShown} of {filteredWallets.length}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {wTotalPages > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" disabled={wPageNow === 0} onClick={function () { goWalletPage(wPageNow - 1) }}
                  aria-label="Previous page"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <Icon name="chevronRight" size={14} className="rotate-180" />
                </button>
                {wPageButtons.map(function (b, i) {
                  if (b === '…') return <span key={'wg' + i} className="px-1 text-[12px] font-bold text-slate-300">…</span>
                  return (
                    <button key={b} type="button" onClick={function () { goWalletPage(b) }}
                      className={'min-w-8 h-8 px-2 rounded-lg text-[12px] font-bold tabular-nums transition-colors ' +
                        (b === wPageNow ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100')}
                      data-notranslate>{b + 1}</button>
                  )
                })}
                <button type="button" disabled={wPageNow >= wTotalPages - 1} onClick={function () { goWalletPage(wPageNow + 1) }}
                  aria-label="Next page"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <Icon name="chevronRight" size={14} />
                </button>
              </div>
            )}
            <select value={walletPageSize}
              onChange={function (e) { setWalletPageSize(Number(e.target.value)); setWalletPage(0); scrollToTopOf(walletListRef.current) }}
              aria-label="Wallets per page"
              style={{ fontSize: '13px' }}
              className="h-8 px-2 rounded-lg border border-slate-300 bg-white text-[12px] font-bold text-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20">
              {WALLET_PAGE_SIZES.map(function (n) { return <option key={n} value={n}>{n} / page</option> })}
            </select>
          </div>
        </div>
      )
    }

    // The five controls over this list. They are the same controls in both
    // layouts — a phone stacks them down the page, a desktop lays them along
    // one toolbar — so they are written once and arranged twice.
    function renderWalletSearch() {
      return (
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <Icon name="search" size={19} />
          </span>
          <input type="text" value={walletSearch}
            onChange={function (e) { setWalletSearch(e.target.value) }}
            placeholder="Search name, email, role..."
            className="w-full h-[52px] pl-12 pr-4 bg-white border border-slate-200 rounded-2xl text-[14px] text-slate-900 placeholder:text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-shadow"
            style={{ fontSize: '16px' }} />
        </div>
      )
    }

    function renderRoleSelect() {
      return (
        <div className="relative shrink-0">
          <select value={walletRoleFilter} onChange={function (e) { setWalletRoleFilter(e.target.value) }}
            aria-label="Filter by role"
            className="appearance-none w-[9.5rem] h-[52px] pl-4 pr-9 bg-white border border-slate-200 rounded-2xl text-[14px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus:outline-none focus:border-indigo-400"
            style={{ fontSize: '16px' }}>
            <option value="">All Roles</option>
            {roleOptions.map(function (r) { return <option key={r} value={r}>{r}</option> })}
          </select>
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <Icon name="chevronDown" size={16} />
          </span>
        </div>
      )
    }

    // Four words. On a phone they divide the row between them; on a desktop
    // that row is 1500px wide and each word was sitting alone in the middle of
    // 340px of nothing, so there they take the width they need.
    function renderBalanceTabs() {
      return (
        <div className={"flex items-center h-[52px] bg-indigo-50/70 rounded-2xl p-1 " + (inAdmin ? "shrink-0" : "flex-1 min-w-0")}>
          {[['all', 'All'], ['positive', '+ve'], ['zero', 'Zero'], ['negative', '−ve']].map(function (opt) {
            var active = walletBalanceState === opt[0]
            return (
              <button key={opt[0]} type="button" onClick={function () { setWalletBalanceState(opt[0]) }}
                aria-pressed={active}
                /* An inactive segment shows what it would become: the same
                   white pill, at less than full strength. Darkening the text
                   alone left the four of them looking like labels rather than
                   like something you press. The active one does not answer the
                   pointer, because pressing it again does nothing. */
                className={(inAdmin ? "px-5 " : "flex-1 min-w-0 px-1 ") + "h-full text-[13px] font-bold rounded-xl transition-all duration-150 " +
                  (active
                    ? "bg-white text-indigo-700 shadow-[0_1px_3px_rgba(15,23,42,0.10)]"
                    : "text-slate-500 hover:text-slate-900 hover:bg-white/70 hover:shadow-[0_1px_3px_rgba(15,23,42,0.06)]")}>
                {opt[1]}
              </button>
            )
          })}
        </div>
      )
    }

    function renderPendingToggle() {
      return (
        <label className="inline-flex items-center gap-2.5 shrink-0 text-[14px] font-medium text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={walletPendingOnly}
            onChange={function (e) { setWalletPendingOnly(e.target.checked) }}
            className="w-5 h-5 rounded-md border-slate-300 accent-indigo-600" />
          Pending only
        </label>
      )
    }

    function renderWalletSort() {
      return (
        <span className="inline-flex items-center gap-1.5 text-[14px] text-slate-500 shrink-0">
          Sort by:
          <span className="relative inline-flex items-center gap-1 font-bold text-slate-900">
            <span data-notranslate>{SORT_LABELS[walletSort] || SORT_LABELS.name}</span>
            <Icon name="chevronDown" size={15} className="text-slate-400" />
            {/* The real control, invisible and exactly over the text it
                describes — so the tap target is the whole thing and the
                native picker still opens. */}
            <select value={walletSort} onChange={function (e) { setWalletSort(e.target.value) }}
              aria-label="Sort by"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              style={{ fontSize: '16px' }}>
              <option value="name">Name</option>
              <option value="balance_desc">Balance high → low</option>
              <option value="balance_asc">Balance low → high</option>
              <option value="pending">Most pending</option>
              <option value="activity">Recent activity</option>
            </select>
          </span>
        </span>
      )
    }

    // The wallet chip and Bulk Issue. On a desktop they belong beside the page
    // title, where the actions for a page live; on a phone they are a row of
    // their own because the title has no spare width.
    function renderWalletActions() {
      return (
        <div className="flex items-center gap-2">
          {myWallet && (
            <button type="button" onClick={function () {
              setWalletProfiles(function (prev) { var n = Object.assign({}, prev); n[profile.id] = profile; return n })
              var w = Object.assign({}, myWallet, { balance_paise: walletBalance })
              setSelectedWallet(w)
              setWalletView('dashboard')
              loadRecentTxns(w)
              loadTransfers()
            }}
              aria-label={'My wallet, ' + formatPoints(walletBalance)}
              className={"inline-flex items-center gap-1.5 h-9 pl-3 pr-2.5 rounded-full border text-[13px] font-bold tabular-nums active:scale-95 transition-all " +
                (walletBalance < 0
                  ? "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
                  : "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100")}>
              <Icon name="wallet" size={15} />
              <span data-notranslate>{formatPoints(walletBalance)}</span>
              {pendingIncoming.length > 0 && (
                <span className="min-w-[17px] h-[17px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold inline-flex items-center justify-center">
                  {pendingIncoming.length}
                </span>
              )}
              <Icon name="chevronRight" size={14} className="opacity-60" />
            </button>
          )}
          {!bulkMode && (
            <button type="button" onClick={function () { setBulkMode(true); setBulkSelected({}) }}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 text-[13px] font-bold hover:bg-indigo-100 active:scale-95 transition-all">
              <Icon name="users" size={15} />
              Bulk Issue
            </button>
          )}
        </div>
      )
    }

    return (
      <div className="space-y-4">

        {/* The artwork is the whole screen behind the list, not a strip behind
            the title: the illustration sits at the top of a 977x1609 image and
            the leaves run down both sides, so cropping it to a 280px band threw
            away everything but the empty middle.

            fixed, so it stays put while ninety rows scroll over it. -z-10 works
            because the phone shell root is relative + isolate — without that
            stacking context it would fall behind the body and vanish.

            bg-top keeps the wallet anchored: cover on a portrait image in a
            narrower portrait viewport crops the sides, and centring it would
            push the illustration off the top on a short screen. */}
        <WalletBackdrop inAdmin={inAdmin} />

        <div className="relative -mx-4 px-4 pt-3 pb-5">

          {/* On a desktop the page actions belong beside the title, which is
              where the actions for a page live. A phone gives them a row of
              their own because the title has no spare width. */}
          <div className={inAdmin ? "relative flex items-start justify-between gap-4" : "relative"}>
            <div className="min-w-0">
              <h1 className="font-display text-[30px] font-extrabold text-slate-900 leading-none tracking-[-0.03em]">Wallet</h1>
              <p className="mt-2 text-[14px] font-medium text-slate-500">Manage and track wallet balances</p>
            </div>
            {inAdmin && <div className="shrink-0">{renderWalletActions()}</div>}
          </div>

          {inAdmin ? (
            /* A wide page can answer more than two questions, and the two it
               was answering had a third of the row each and nothing in the
               middle. Deficit and pending are the two that decide whether
               anybody has to do something today. */
            (function () {
              var total = filteredWallets.reduce(function (s, w) { return s + (w.balance_paise || 0) }, 0)
              return (
                <div className="relative mt-5 grid grid-cols-2 gap-3">
                  <StatTile icon="users" tone="bg-indigo-50 text-indigo-600" label="Wallets"
                    value={String(filteredWallets.length)} valueClass="text-slate-900" />
                  <StatTile icon="banknote" tone={total < 0 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}
                    label="Total Points" value={formatPoints(total)}
                    valueClass={total < 0 ? "text-red-700" : "text-slate-900"} />
                </div>
              )
            })()
          ) : (
            <>
            {/* Two figures about the list as a whole, split down the middle. */}
            <div className="relative mt-5 bg-white/85 backdrop-blur-sm border border-white/70 rounded-2xl shadow-[0_2px_10px_rgba(15,23,42,0.06)] px-4 py-3.5 flex items-center">
              <button type="button" onClick={function () { setWalletRoleFilter(''); setWalletBalanceState('all'); setWalletPendingOnly(false) }}
                className="flex-1 min-w-0 flex items-center gap-3 text-left">
                <span className="shrink-0 w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-600 inline-flex items-center justify-center">
                  <Icon name="wallet" size={19} />
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-[17px] font-bold text-slate-900 leading-snug">All Wallets</span>
                  <span className="block text-[13px] font-medium text-slate-500 tabular-nums" data-notranslate>
                    {filteredWallets.length} wallets
                  </span>
                </span>
              </button>

              <span aria-hidden="true" className="shrink-0 w-px h-10 bg-slate-200 mx-2" />

              {(function () {
                // The sum of what is on screen, not of every wallet in the table:
                // filter to one role and this has to follow, or it is answering a
                // question nobody asked.
                var total = filteredWallets.reduce(function (s, w) { return s + (w.balance_paise || 0) }, 0)
                return (
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <span className={"shrink-0 w-10 h-10 rounded-2xl inline-flex items-center justify-center " +
                      (total < 0 ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600")}>
                      <Icon name="banknote" size={19} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-slate-500 leading-snug">Total Points</span>
                      <span className={"block font-display text-[16px] font-bold tabular-nums leading-snug whitespace-nowrap " +
                        (total < 0 ? "text-red-700" : "text-slate-900")} data-notranslate>{formatPoints(total)}</span>
                    </span>
                  </div>
                )
              })()}
            </div>
            </>
          )}
        </div>

        {inAdmin ? (
          /* One toolbar. Stacked, these five took four rows and most of a
             screen before a single wallet appeared. */
          <div className="bg-white/75 border border-slate-200 rounded-2xl px-4 py-3.5 flex flex-wrap items-center gap-3">
            {renderWalletSearch()}
            {renderRoleSelect()}
            {renderBalanceTabs()}
            <span aria-hidden="true" className="hidden xl:block w-px h-8 bg-slate-200" />
            {renderPendingToggle()}
            {renderWalletSort()}
          </div>
        ) : (
          <>
            {renderWalletActions()}
            {renderWalletSearch()}
            <div className="flex items-center gap-2.5">
              {renderRoleSelect()}
              {renderBalanceTabs()}
            </div>
            <div className="flex items-center justify-between gap-3">
              {renderPendingToggle()}
              {renderWalletSort()}
            </div>
          </>
        )}

        {/* One column unless we are actually on the dashboard. md: measures the
            viewport and the phone shell is a 540px column inside it, so a bare
            md:grid-cols-2 gave the phone two 160px cards. */}
        {/* What the filters came back with, above the thing they filtered. One
            figure, for the filter that is actually on: which tab you picked is
            already shown by the tab, and printing the other three beside it was
            answering questions nobody had asked yet. */}
        <p className="text-[12px] text-slate-500">
          Showing
          <span className="mx-1 font-bold text-slate-900 tabular-nums" data-notranslate>{filteredWallets.length}</span>
          wallets
        </p>

        <div ref={walletListRef} className={"scroll-mt-24 space-y-2" + (inAdmin ? " md:space-y-0 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-2.5" : "")}>
          {pagedWallets.map(function (w) {
            var p = walletProfiles[w.user_id] || {}
            return (
              /* The whole row opens the wallet, so the whole row answers the
                 pointer: it lifts a pixel, its edge takes the accent, and the
                 translucent card goes solid white, which on the ruled ground is
                 what reads as coming forward. transform-gpu keeps the lift on
                 the compositor — ninety of these animating their own layout
                 would not be free. */
              <div key={w.id} className={"group relative border rounded-2xl px-3.5 py-2.5 flex items-center gap-3 transform-gpu transition-all duration-150 shadow-[0_1px_2px_rgba(15,23,42,0.04)] border-slate-200 hover:border-indigo-300 hover:bg-white hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(79,70,229,0.10)] " +
                (inAdmin ? "bg-white/75" : "bg-white")}>
                {bulkMode && (
                  <input type="checkbox" checked={!!bulkSelected[w.user_id]}
                    onChange={function () { setBulkSelected(function (prev) { var n = Object.assign({}, prev); n[w.user_id] = !n[w.user_id]; return n }) }}
                    className="w-5 h-5 shrink-0 rounded border-slate-300 accent-indigo-600" />
                )}
                {/* No initial here. On a list you scan by name it was a 52px disc
                    repeating the first letter of the word beside it — and it took
                    the width that forced the balance and the action onto separate
                    lines. */}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={function () { if (!bulkMode) openWalletTxns(w) }}>
                  <span className="min-w-0 block">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[15px] font-bold text-slate-900 truncate transition-colors group-hover:text-indigo-700">{p.name || '—'}</span>
                      {w._pendingCount > 0 && (
                        <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums"
                          title={w._pendingCount + ' pending'}>{w._pendingCount}</span>
                      )}
                    </span>
                    <span className="block text-[13px] text-slate-500 truncate">{p.role || '—'}</span>
                  </span>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  <span className={"px-3 py-1.5 rounded-full text-[13px] font-bold tabular-nums " +
                    ((w.balance_paise || 0) < 0 ? "bg-red-100 text-red-700"
                      : (w.balance_paise || 0) === 0 ? "bg-slate-100 text-slate-500"
                      : "bg-emerald-100 text-emerald-700")}
                    data-notranslate>{formatPoints(w.balance_paise)}</span>
                  <button onClick={function () { setIssueModal(w); setIssueAmount(''); setIssueDesc(''); setIssueType('credit') }}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-[13px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 active:scale-[0.97] transition-all">
                    <Icon name="plus" size={14} strokeWidth={2.6} />
                    Issue
                  </button>
                </div>

              </div>
            )
          })}
        </div>
        {renderWalletPager()}
        {bulkMode && (
          <div className="sticky bottom-0 bg-white border-t border-gray-200 rounded-xl p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-gray-900">
                {Object.values(bulkSelected).filter(Boolean).length} selected
              </p>
              <div className="flex gap-2">
                <button onClick={function () { var all = {}; filteredWallets.forEach(function (w) { all[w.user_id] = true }); setBulkSelected(all) }}
                  className="text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg transition-colors">Select All</button>
                <button onClick={function () { setBulkSelected({}) }}
                  className="text-[10px] font-bold text-gray-500 hover:bg-gray-100 px-2.5 py-1.5 rounded-lg transition-colors">Clear</button>
              </div>
            </div>
            <div className="flex gap-2">
              <input type="number" min="1" step="any" inputMode="decimal" value={bulkAmount}
                onChange={function (e) { setBulkAmount(e.target.value) }}
                placeholder="Amount (pts)" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ fontSize: '16px' }} />
              <VoiceInput type="text" value={bulkDesc} onChange={function (e) { setBulkDesc(e.target.value) }}
                placeholder="Description" maxLength="300" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="flex gap-2">
              <button onClick={function () { setBulkMode(false); setBulkSelected({}); setBulkAmount(''); setBulkDesc('') }}
                className="flex-1 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium">Cancel</button>
              <button onClick={runBulkIssue}
                disabled={bulkSaving || !bulkAmount || Number(bulkAmount) <= 0 || Object.values(bulkSelected).filter(Boolean).length === 0}
                className="flex-1 py-2.5 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
                {bulkSaving ? 'Issuing...' : 'Issue to ' + Object.values(bulkSelected).filter(Boolean).length + ' users'}
              </button>
            </div>
          </div>
        )}
        {renderIssueModal()}
      </div>
    )
  }

  // ═══════════════════════════════════════════════
  // WALLET TRANSACTIONS — Per-user drill-down
  // ═══════════════════════════════════════════════
  if (walletView === 'transactions' && selectedWallet) {
    var txnUser = walletProfiles[selectedWallet.user_id] || {}
    // One row, drawn the same whichever layout asks for it. It was written
    // inline in the list; the desktop layout needs the same row inside a
    // different card, and 240 lines is not something to keep two copies of.
    function renderTxnRow(t) {
    var isCredit = t.type === 'credit'
    var issuedPath = t.issued_image_path || null
    var receivedPath = t.received_image_path || null
    var transferRow = t.reference_type === 'transfer' && t.reference_id ? transferParties[t.reference_id] : null
    if (transferRow) {
      var transferSenderPath = transferRow.sender_image_path
      var transferReceiverPath = transferRow.receiver_image_path || transferRow.received_image_path
      if (transferSenderPath) issuedPath = transferSenderPath
      if (transferReceiverPath) receivedPath = transferReceiverPath
    }
    var issuedUrl = getReceiptUrl(issuedPath)
    var receivedUrl = getReceiptUrl(receivedPath)
    var issuedIsVoice = isVoiceNotePath(issuedPath)
    var receivedIsVoice = isVoiceNotePath(receivedPath)
    var isOwnWallet = selectedWallet && selectedWallet.user_id === profile.id
    var canConfirm = isCredit && t.status === 'pending' && isOwnWallet
    var epcHit = epcRefs[t.id] || null
    var isEpc = !!epcHit && !epcHit.isCancel
    var isEpcCancel = !!epcHit && epcHit.isCancel
    var isCancelled = t.status === 'cancelled'
    var epcCancellable = isEpc && epcHit.epc.status !== 'cancelled' && (isAdmin || epcHit.epc.collected_by === profile.id)
    var collCancellable = t.reference_type === 'collection' && !isCancelled && (isAdmin || t.performed_by === profile.id)
    var isExpRow = (t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id
    var isPayRow = PAYMENT_REF_TYPES.indexOf(t.reference_type) !== -1
    var rowIsClickable = isExpRow || t.reference_type === 'collection' || isEpc || isPayRow
    function handleRowClick() {
      if (!rowIsClickable) return
      if (isExpRow) {
        if (onOpenExpense) onOpenExpense(t.reference_id)
        else openExpenseDetail(t.reference_id)
      } else if (t.reference_type === 'collection') {
        openCollectionDetail(t, 'collection')
      } else if (isEpc) {
        openCollectionDetail(t, 'epc')
      } else if (isPayRow) {
        openPaymentDetail(t)
      }
    }
    var rowBorderClass = isCancelled
      ? "border-gray-200 opacity-50"
      : (t.status === 'pending' ? "border-amber-300 bg-amber-50/30" : "border-gray-200")
    return (
      <div key={t.id}
        onClick={handleRowClick}
        className={"bg-white border rounded-xl px-3.5 py-3 " + rowBorderClass + (rowIsClickable ? " cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors" : "")}>
        {/* justify-between was never doing the split — the left column is
            flex-1 and already pushes the figures right — so the row can simply
            gain a third child at the front. */}
        <div className="flex items-start gap-3">
          {inAdmin && REF_TYPE_MARKS[t.reference_type] && (
            /* The tile is what you scan down a long ledger; the chip beside the
               title is what you read once you have stopped. On a phone there is
               no room to say it twice. */
            <span aria-hidden="true"
              className={"shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center " + REF_TYPE_MARKS[t.reference_type].tone}>
              <Icon name={REF_TYPE_MARKS[t.reference_type].icon} size={18} />
            </span>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {t.reference_type && (
                <span className={CHIP + (REF_TYPE_TONES[t.reference_type] || CHIP_NEUTRAL)}>
                  {REF_TYPE_LABELS[t.reference_type] || t.reference_type}
                </span>
              )}
              {isEpc && (
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                  Extra Plates
                </span>
              )}
              {isEpcCancel && (
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">
                  EP Cancel
                </span>
              )}
              <p className={"text-[14px] font-bold text-slate-900 leading-snug " + (isCancelled ? "line-through" : "")}>
                {t.description || '—'}
                {t.reference_type === 'transfer' && t.reference_id && transferParties[t.reference_id] && (function () {
                  var tr = transferParties[t.reference_id]
                  var cpId = t.type === 'debit' ? tr.to_user_id : tr.from_user_id
                  var cpName = walletProfiles[cpId]?.name
                  if (!cpName) return null
                  return ' ' + (t.type === 'debit' ? '→' : '←') + ' ' + cpName
                })()}
                {isEpc && ' · ' + epcHit.epc.extras_charged + ' extras'}
              </p>
              {t.reference_type === 'collection' && t.payment_mode && (
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                  {t.payment_mode}
                </span>
              )}
              {t.status === 'pending' && (
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Pending</span>
              )}
              {isCancelled && (
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded">Cancelled</span>
              )}
              {(t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id && expenseRefs[t.reference_id] && expenseRefs[t.reference_id].status && (
                <span className={"text-[10px] font-bold uppercase px-1.5 py-0.5 rounded " + (EXP_STATUS_COLORS[expenseRefs[t.reference_id].status] || 'bg-gray-100 text-gray-600')}>
                  {EXP_STATUS_LABELS[expenseRefs[t.reference_id].status] || expenseRefs[t.reference_id].status}
                </span>
              )}
            </div>
            {isCancelled && t.cancelled_reason && (
              <p className="text-[10px] text-rose-600 italic mt-0.5">Reason: {t.cancelled_reason}</p>
            )}
            {/* Enrichment: expense/refund → type › sub-type · event · vendor · extra fields · (refund amount + date) · per-allocation breakdown */}
            {(t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id && expenseRefs[t.reference_id] && (function () {
              var e = expenseRefs[t.reference_id]
              var typeName = e.expense_types?.name || ''
              var subTypeName = e.expense_sub_types?.name || ''
              var allocs = e.expense_allocations || []
              var parts = []
              var pairs = []
              var subFields = (e.expense_sub_types && e.expense_sub_types.extra_fields) || []
              var meta = e.metadata || {}
              var extraFieldValues = []
              subFields.forEach(function (f) {
                var val = meta[f.key]
                if (val == null || val === '') return
                var display = val
                if (f.type === 'lookup' && f.source) display = expLookupLabels[f.source + ':' + String(val)] || val
                pairs.push({ label: f.label || f.key, value: String(display) })
                extraFieldValues.push(String(display))
              })
              // The plain vendor_name column is a fallback shown to the same
              // value a sub-type "vendor" lookup field already surfaces — skip
              // it here when that's the case so the vendor name isn't repeated.
              if (e.vendor_name && extraFieldValues.indexOf(e.vendor_name) === -1) pairs.unshift({ label: 'Vendor', value: e.vendor_name })
              if (t.reference_type === 'expense_refund' && e.amount_paise) parts.push('orig ' + formatPoints(e.amount_paise) + ' on ' + formatDate(e.expense_date))
              var sourceReceipts = Array.isArray(e.receipt_paths) && e.receipt_paths.length > 0
                ? e.receipt_paths
                : (e.receipt_path ? [e.receipt_path] : [])
              return (
                <>
                  {/* One rhythm down the row. Five lines at four pixels apart,
                      every one of them grey and roughly the same size, is why
                      this read as a block rather than as facts — nothing told
                      the eye where one thing ended and the next began. */}
                  {(typeName || e._event_name) && (
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {typeName && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                          {typeName + (subTypeName ? ' › ' + subTypeName : '')}
                        </span>
                      )}
                      {e._event_name && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                          <Icon name="calendar" size={11} />
                          {e._event_name}
                        </span>
                      )}
                    </p>
                  )}
                  {/* Each field as its own unit, not one sentence with middots
                      in it. Strung together, "Expense Details: Odc hk expense ·
                      Vendor Name: Venue rental" is a line you have to read
                      through to find the break in; stacked label over value,
                      with real space between the pairs, the breaks are where
                      the eye already is. */}
                  {pairs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pairs.map(function (pr, pi) {
                        return (
                          <span key={pi} className="inline-flex min-w-0 items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                            <Icon name={glyphForLabel(pr.label)} size={15} className="shrink-0 text-slate-400" />
                            <span className="inline-flex min-w-0 flex-col gap-1">
                              <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400 leading-none">{pr.label}</span>
                              <span className="text-[12.5px] font-semibold text-slate-800 leading-none truncate">{pr.value}</span>
                            </span>
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {parts.length > 0 && <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">{parts.join(' · ')}</p>}
                  {sourceReceipts.length > 0 && (
                    <div onClick={function (ev) { ev.stopPropagation() }}>
                      <LedgerSourceMedia paths={sourceReceipts} />
                    </div>
                  )}
                  {allocs.length > 0 && !expandAllTxns && (
                    <button type="button" onClick={function (ev) { toggleTxnExpanded(t.id, ev) }}
                      // 12.5px against the 12px allocation rows it opens: the
                      // control that reveals a section should not be smaller
                      // than the section. At 10.5 it was the smallest thing on
                      // the card and read as a footnote.
                      className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-800">
                      <Icon name={expandedTxnIds[t.id] ? 'chevronDown' : 'chevronRight'} size={13} />
                      {expandedTxnIds[t.id] ? 'Hide allocation details' : 'Allocation details'}
                    </button>
                  )}
                  {/* Under a rule, and indented off it. The breakdown and the
                      footer below it were two grey lines of much the same size,
                      each led by a small grey glyph, so neither said what kind
                      of thing it was — one is a division of the amount, the
                      other is when it happened and who did it. The rule makes
                      the breakdown read as belonging to the expense above it
                      rather than as one more line in a grey stack. */}
                  {allocs.length > 0 && (expandAllTxns || !!expandedTxnIds[t.id]) && (
                    <div className="mt-2 pl-3 border-l-2 border-indigo-100 space-y-1">
                      {allocs.map(function (a, ai) {
                        var allocType = a.expense_types?.name || ''
                        var allocSubType = a.expense_sub_types?.name || ''
                        return (
                          /* One chain of narrowing — department, type,
                             sub-type — so it reads with chevrons throughout
                             rather than a middot for the first step and a
                             chevron for the second. The figure is the point of
                             the line, so it is the part that is not grey. */
                          /* The figures share a column. Trailing the label with
                             a dash put each one wherever its own label happened
                             to end, so four allocations made four different
                             margins and the amounts could not be compared down
                             the list — which is the only reason to print them
                             one under another. The label takes the room that is
                             left, the figure is pinned right, and tabular-nums
                             lines the digits up inside it. */
                          <p key={ai} className="flex items-center gap-3 text-[12px] leading-relaxed">
                            {/* The label sizes to its own text rather than
                                taking the whole row, so there is something left
                                for the leader to fill. It still shrinks and
                                truncates when the text is longer than the room.
                                The tag glyph went with the rule that replaced
                                it: a small grey icon at the head of a grey line
                                is exactly what the footer below already does. */}
                            <span className="min-w-0 truncate text-slate-500">
                              <span className="font-semibold text-slate-700">{a.department || 'Unassigned'}</span>
                              {allocType ? ' › ' + allocType + (allocSubType ? ' › ' + allocSubType : '') : ''}
                            </span>
                            {/* The leader, drawn rather than bordered. A dotted
                                border only grows by growing its width, so a
                                bigger dot is also a thicker rule and the browser
                                decides the spacing; a repeated radial gradient
                                sets the dot and the gap independently. */}
                            <span aria-hidden="true" className="flex-1 min-w-[1.5rem] self-center h-[2px]"
                              style={{
                                backgroundImage: 'radial-gradient(circle, rgb(203 213 225) 1px, transparent 1.1px)',
                                backgroundSize: '7px 2px',
                                backgroundRepeat: 'repeat-x',
                                backgroundPosition: 'center',
                              }} />
                            <span className="shrink-0 font-bold text-slate-800 tabular-nums" data-notranslate>{formatPoints(a.amount_paise)}</span>
                          </p>
                        )
                      })}
                    </div>
                  )}
                </>
              )
            })()}
            {(function () {
              var d = new Date(t.created_at)
              var time = isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
              var ref = t.reference_type
                ? (REF_TYPE_LABELS[t.reference_type] || t.reference_type) + (t.reference_id ? ' #' + String(t.reference_id).slice(0, 8) : '')
                : ''
              var who = t.performed_by && walletProfiles[t.performed_by] ? walletProfiles[t.performed_by].name : ''
              // Date and time are one fact, so they are one item rather than two
              // separated as though they were unrelated.
              var when = formatDate(t.created_at) + (time ? ', ' + time : '')
              // A backdated transfer carries its own date, distinct from when it
              // was logged — same split as an expense's expense_date vs created_at.
              var backdated = transferRow && transferRow.transfer_date && transferRow.transfer_date !== String(t.created_at).slice(0, 10)
              var facts = [
                backdated ? { icon: 'calendar', text: 'For ' + formatDate(transferRow.transfer_date) } : null,
                { icon: backdated ? 'clock' : 'calendar', text: (backdated ? 'Logged ' : '') + when },
                ref ? { icon: 'receipt', text: ref } : null,
                who ? { icon: 'user', text: who, lead: 'by ' } : null,
              ].filter(Boolean)
              // A rule above, not just a wider gap: everything before this says
              // what the row is, and this says when it happened and who did it.
              // A gap alone left it looking like one more line of the same grey
              // material as the breakdown above — it is a footer, so it sits
              // below something. A glyph apiece and a rule between the three,
              // because three kinds of fact in one grey string separated by
              // middots is what made this row hard to read in the first place.
              return (
                <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-y-1 text-[12px] font-semibold text-slate-500 leading-relaxed">
                  {facts.map(function (f, fi) {
                    return (
                      <span key={fi} className="inline-flex items-center whitespace-nowrap">
                        {fi > 0 && <span aria-hidden="true" className="mx-3 w-px h-3.5 bg-slate-200" />}
                        <Icon name={f.icon} size={13} className="shrink-0 mr-1.5 text-slate-400" />
                        {/* One span, not a bare "by " beside another element.
                            A text run on its own is an anonymous flex item, and
                            a flex item has its leading and trailing whitespace
                            trimmed — which is where the space in "by " went. */}
                        <span>
                          {f.lead}
                          {f.lead
                            ? <span className="font-bold text-slate-700">{f.text}</span>
                            : f.text}
                        </span>
                      </span>
                    )
                  })}
                </div>
              )
            })()}
            {t.received_at && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                <Icon name="checkCircle" size={12} className="shrink-0" />
                Confirmed {formatDate(t.received_at)}
              </p>
            )}
            {/* wrap, because two players side by side on a phone each
                end up too narrow for the browser to draw a timeline
                in; stacked they each get the row. */}
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {issuedUrl && (
                <ProofThumb url={issuedUrl} label="Sent" tone="bg-blue-600"
                  onOpen={function () { setEnlargedWalletImg(issuedUrl) }} />
              )}
              {receivedUrl && (
                <ProofThumb url={receivedUrl} label="Rcvd" tone="bg-emerald-600"
                  onOpen={function () { setEnlargedWalletImg(receivedUrl) }} />
              )}
            </div>
            {isPayRow && t.reference_id && paymentRefs[t.reference_id] && (
              <div onClick={function (ev) { ev.stopPropagation() }}>
                <PaymentProofThumbs meta={paymentRefs[t.reference_id].metadata} />
              </div>
            )}
          </div>
          <div className="text-right flex-shrink-0 ml-2">
            <p className={"text-[15px] font-bold tabular-nums " + (isCredit ? "text-emerald-600" : "text-red-600")} data-notranslate>
              {isCredit ? '+' : '−'}{formatPoints(Math.abs(t.amount_paise))}
            </p>
            {/* A running balance is a figure someone reads, not a caption.
                At slate-400 it sat around 3:1 on the card and read as
                disabled beside the bold amount above it. */}
            <p className="text-[11.5px] text-slate-500 tabular-nums" data-notranslate>
              Balance: <span className="font-semibold text-slate-700">{formatPoints(t.balance_after_paise)}</span>
            </p>
            {/* The finance check belongs under the figure it is a check on.
                Up in the title row it sat among the status chips, where
                "Mark checked" read as one more label describing the row rather
                than the one control on it that does something. */}
            {(function () {
              if (isCancelled) return null
              var chk = isExpRow ? (t.reference_id && expenseRefs[t.reference_id]) : t
              if (!chk) return null
              // Nothing is drawn for someone who cannot mark a row and is
              // looking at one nobody has marked — CheckedStamp returns null
              // there, and an empty wrapper would still spend its margin.
              if (!canMarkChecked && !chk.checked_by) return null
              return (
              /* The artwork, not the chip: a chip beside an amount reads as
                 one more label, and this is a verdict on the figure above it.
                 Unchecked it stays the small dashed prompt either way — a
                 160px empty circle asking to be pressed would be a lot of
                 furniture for an action most rows never take. */
              <div className="mt-2 flex justify-end" onClick={function (ev) { ev.stopPropagation() }}>
                {isExpRow ? (
                  <CheckedStamp
                    variant="stamp"
                    checked={!!expenseRefs[t.reference_id].checked_by}
                    checkerName={expenseRefs[t.reference_id].checked_by && walletProfiles[expenseRefs[t.reference_id].checked_by] ? walletProfiles[expenseRefs[t.reference_id].checked_by].name : null}
                    checkedAt={expenseRefs[t.reference_id].checked_at}
                    canToggle={canMarkChecked}
                    canUncheck={expenseRefs[t.reference_id].checked_by === profile.id || isAdmin || isAuditor}
                    busy={checkingExpId === t.reference_id}
                    onToggle={function (ev) { ev.stopPropagation(); toggleExpenseCheck(t.reference_id) }}
                  />
                ) : (
                  <CheckedStamp
                    variant="stamp"
                    checked={!!t.checked_by}
                    checkerName={t.checked_by && walletProfiles[t.checked_by] ? walletProfiles[t.checked_by].name : null}
                    checkedAt={t.checked_at}
                    canToggle={canMarkChecked}
                    canUncheck={t.checked_by === profile.id || isAdmin || isAuditor}
                    busy={checkingTxnId === t.id}
                    onToggle={function (ev) { ev.stopPropagation(); toggleWalletCheck(t) }}
                  />
                )}
              </div>
              )
            })()}
            {canConfirm && (
              <button onClick={function (ev) { ev.stopPropagation(); setReceiveModal(t); setReceiveImage(null) }}
                className="mt-1.5 px-2 py-1 text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded hover:bg-amber-200 transition-colors">
                📷 Confirm Received
              </button>
            )}
            {t.reference_type === 'collection' && t.receipt_no && (
              <button onClick={function (ev) { ev.stopPropagation(); printReceipt(t) }}
                className="mt-1.5 ml-1 px-2 py-1 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors">
                🖨 #{t.receipt_no}
              </button>
            )}
            {(collCancellable || epcCancellable) && (
              <button onClick={function (ev) { ev.stopPropagation(); openCancel(t, collCancellable ? 'collection' : 'epc') }}
                className="mt-1.5 ml-1 px-2 py-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors">
                🚫 Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    )
    }

    // Four readings of one period. Both layouts print them, so they are worked
    // out once rather than inside whichever happens to be rendering.
    var stats = (function () {
      var chrono = walletTxns.slice().sort(function (a, b) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })
      var cr = 0, db = 0
      chrono.forEach(function (t) {
        if (t.type === 'credit') cr += (t.amount_paise || 0)
        else db += (t.amount_paise || 0)
      })
      var oldest = chrono[0]
      var newest = chrono[chrono.length - 1]
      return {
        credits: cr,
        debits: db,
        opening: oldest ? ((oldest.balance_after_paise || 0) - (oldest.type === 'credit' ? (oldest.amount_paise || 0) : -(oldest.amount_paise || 0))) : 0,
        closing: newest ? (newest.balance_after_paise || 0) : 0,
      }
    })()

    var sortedTxns = (function () {
      // The debit already happened, so a deleted expense's transaction stays
      // in the ledger for audit rather than being removed — just hidden from
      // the everyday view unless asked for.
      var visible = walletTxns.filter(function (t) {
        if (showDeletedTxns) return true
        var isExpRow = (t.reference_type === 'expense' || t.reference_type === 'expense_refund') && t.reference_id
        var xp = isExpRow ? expenseRefs[t.reference_id] : null
        return !(xp && xp.deleted_at)
      })
      var rows = mergeExpenseWalletRows(visible)
      if (txnSort === 'oldest') {
        return rows.sort(function (a, b) { return new Date(a._sortAt || a.created_at) - new Date(b._sortAt || b.created_at) })
      }
      if (txnSort === 'amount') {
        return rows.sort(function (a, b) { return (b.amount_paise || 0) - (a.amount_paise || 0) })
      }
      return rows.sort(function (a, b) { return new Date(b._sortAt || b.created_at) - new Date(a._sortAt || a.created_at) })
    })()

    var txnTotalPages = Math.max(1, Math.ceil(sortedTxns.length / txnPageSize))
    // Clamp rather than reset: a filter that shortens the list should leave
    // you near where you were, not at the top of page one.
    var txnPageNow = Math.min(txnPage, txnTotalPages - 1)
    var pagedTxns = sortedTxns.slice(txnPageNow * txnPageSize, (txnPageNow + 1) * txnPageSize)
    var txnFirstShown = sortedTxns.length === 0 ? 0 : txnPageNow * txnPageSize + 1
    var txnLastShown = Math.min((txnPageNow + 1) * txnPageSize, sortedTxns.length)

    // 1 … 4 5 6 … 20, never twenty buttons.
    var txnPageButtons = []
    for (var tpb = 0; tpb < txnTotalPages; tpb++) {
      if (tpb === 0 || tpb === txnTotalPages - 1 || (tpb >= txnPageNow - 1 && tpb <= txnPageNow + 1)) txnPageButtons.push(tpb)
      else if (txnPageButtons[txnPageButtons.length - 1] !== '…') txnPageButtons.push('…')
    }

    // Pressing Next at the foot of twenty-five rows otherwise leaves you at
    // the foot of the next twenty-five, reading upwards from the end of
    // something you never saw the start of.
    function goTxnPage(n) {
      setTxnPage(n)
      scrollToTopOf(txnListRef.current)
    }

    function renderTxnPager() {
      if (sortedTxns.length === 0) return null
      return (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-200">
          <p className="text-[12px] font-semibold text-slate-500" data-notranslate>
            Showing {txnFirstShown}–{txnLastShown} of {sortedTxns.length}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {txnTotalPages > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" disabled={txnPageNow === 0} onClick={function () { goTxnPage(txnPageNow - 1) }}
                  aria-label="Previous page"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <Icon name="chevronRight" size={14} className="rotate-180" />
                </button>
                {txnPageButtons.map(function (b, i) {
                  if (b === '…') return <span key={'g' + i} className="px-1 text-[12px] font-bold text-slate-300">…</span>
                  return (
                    <button key={b} type="button" onClick={function () { goTxnPage(b) }}
                      className={'min-w-8 h-8 px-2 rounded-lg text-[12px] font-bold tabular-nums transition-colors ' +
                        (b === txnPageNow ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100')}
                      data-notranslate>{b + 1}</button>
                  )
                })}
                <button type="button" disabled={txnPageNow >= txnTotalPages - 1} onClick={function () { goTxnPage(txnPageNow + 1) }}
                  aria-label="Next page"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
                  <Icon name="chevronRight" size={14} />
                </button>
              </div>
            )}
            <select value={txnPageSize}
              onChange={function (e) { setTxnPageSize(Number(e.target.value)); setTxnPage(0); scrollToTopOf(txnListRef.current) }}
              aria-label="Rows per page"
              style={{ fontSize: '13px' }}
              className="h-8 px-2 rounded-lg border border-slate-300 bg-white text-[12px] font-bold text-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20">
              {TXN_PAGE_SIZES.map(function (n) { return <option key={n} value={n}>{n} / page</option> })}
            </select>
          </div>
        </div>
      )
    }

    function resetTxnFilters() {
      setTxnFrom(''); setTxnTo(''); setTxnRefType('')
      openWalletTxns(null, '', '', '')
    }

    // ── The desktop ledger ──────────────────────────────────────────────
    // Four bands down the page, each one a card: who this is, what the period
    // came to, what is being asked of it, and the answer. On a phone the same
    // material is a single column of sections, because a card inside a 540px
    // column is a box around the whole screen.
    function renderTxnsDesktop() {
      var bal = selectedWallet.balance_paise || 0
      return (
        <div className="space-y-4">
          <WalletBackdrop inAdmin={inAdmin} />

          <button type="button" onClick={goBack}
            className="inline-flex items-center gap-1.5 h-8 -ml-1 px-2 rounded-lg text-[13px] font-bold text-indigo-600 hover:bg-indigo-50 transition-colors">
            <Icon name="arrowLeft" size={15} />
            {(isAdmin || isAuditor) ? 'Back to Wallets' : 'Back'}
          </button>

          {/* Who. The balance sits on the same line as the name rather than
              under it: it is the headline fact about this person, not a
              footnote to their email address. */}
          <div className="flex items-center gap-4 bg-white border border-slate-200 rounded-2xl px-5 py-4">
            <span className={"shrink-0 w-12 h-12 rounded-full inline-flex items-center justify-center text-[17px] font-bold " + avatarTint(txnUser.name)}>
              {(txnUser.name || '?').charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="font-display text-[18px] font-bold text-slate-900 leading-tight truncate">{txnUser.name || '—'}</h2>
                <span className={"inline-flex px-2.5 py-1 rounded-full text-[13px] font-bold tabular-nums " +
                  (bal < 0 ? "bg-red-100 text-red-700" : bal === 0 ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700")}
                  data-notranslate>{formatPoints(bal)}</span>
              </div>
              <p className="mt-0.5 text-[12px] text-slate-500 truncate">{txnUser.email || '—'}</p>
            </div>
            {/* Both of these do the same harmless thing, so they look the same.
                Green and red on a pair of downloads read as a verdict on the
                file — one safe, one dangerous — when the only thing that
                differs is the format, which the word already says. */}
            {walletTxns.length > 0 && (
              <div className="shrink-0 flex items-center gap-2">
                <button type="button" onClick={exportWalletCSV}
                  className="inline-flex items-center gap-2 h-10 px-3.5 rounded-xl text-[13px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] disabled:opacity-60 transition-all">
                  <Icon name="download" size={15} className="text-slate-400" />
                  Download CSV
                </button>
                <button type="button" onClick={exportWalletPDF} disabled={pdfBusy}
                  className="inline-flex items-center gap-2 h-10 px-3.5 rounded-xl text-[13px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] disabled:opacity-60 transition-all">
                  <Icon name={pdfBusy ? 'refresh' : 'fileText'} size={15} className="text-slate-400" />
                  {pdfBusy ? 'Generating…' : 'Download PDF'}
                </button>
              </div>
            )}
          </div>

          {/* What it came to. */}
          {walletTxns.length > 0 && (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <StatTile icon="wallet" tone="bg-indigo-50 text-indigo-600" label="Opening Balance"
                value={formatPoints(stats.opening)}
                valueClass={stats.opening < 0 ? 'text-red-600' : 'text-slate-900'} />
              <StatTile icon="chevronUp" tone="bg-emerald-50 text-emerald-600" label="Total Credits"
                value={'+' + formatPoints(stats.credits)} valueClass="text-emerald-600" />
              <StatTile icon="chevronDown" tone="bg-red-50 text-red-600" label="Total Debits"
                value={'-' + formatPoints(stats.debits)} valueClass="text-red-600" />
              <StatTile icon="box" tone="bg-violet-50 text-violet-600" label="Closing Balance"
                value={formatPoints(stats.closing)}
                valueClass={stats.closing < 0 ? 'text-red-600' : 'text-slate-900'} />
            </div>
          )}

          {/* What is being asked of it. Apply re-runs the read; the controls
              already apply themselves the moment they change, so it is there
              for the case where nothing changed and you want it again. Reset
              is the only one that does something no control can. */}
          <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[300px] flex-[2]">
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">Time Period</label>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="shrink-0 w-10 h-11 inline-flex items-center justify-center rounded-xl bg-slate-50 border border-slate-200 text-slate-400">
                    <Icon name="calendar" size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <EventDatePicker value={txnFrom} placeholder="From date" collapsible includePast plain
                      onChange={function (v) { setTxnFrom(v); openWalletTxns(null, v, null) }} />
                  </div>
                  <span aria-hidden="true" className="shrink-0 text-slate-300"><Icon name="arrowRight" size={15} /></span>
                  <div className="flex-1 min-w-0">
                    <EventDatePicker value={txnTo} placeholder="To date" collapsible includePast plain
                      onChange={function (v) { setTxnTo(v); openWalletTxns(null, null, v) }} />
                  </div>
                </div>
              </div>

              <div className="min-w-[200px] flex-1">
                <label htmlFor="txn-type" className="block text-[11px] font-semibold text-slate-500 mb-1.5">Type</label>
                <div className="relative">
                  <select id="txn-type" value={txnRefType}
                    onChange={function (e) { setTxnRefType(e.target.value); openWalletTxns(null, null, null, e.target.value) }}
                    className="appearance-none w-full h-11 pl-3.5 pr-9 bg-white border border-slate-200 rounded-xl text-[13px] text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow">
                    <option value="">All Types</option>
                    <option value="expense">Expenses</option>
                    <option value="expense_refund">Refunds</option>
                    <option value="collection">Collections</option>
                    <option value="transfer">Transfers</option>
                    <option value="issued">Issued (admin)</option>
                    <option value="deducted">Deducted (admin)</option>
                    <option value="opening">Opening</option>
                  </select>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <Icon name="chevronDown" size={15} />
                  </span>
                </div>
              </div>

              {/* No Apply. Every control here reads the moment it changes, so a
                  button promising to apply them was describing work that was
                  already done. Reset stays because clearing all three at once
                  is the one thing none of them can do on its own. */}
              {(txnFrom || txnTo || txnRefType) && (
                <button type="button" onClick={resetTxnFilters}
                  className="shrink-0 h-11 px-4 inline-flex items-center gap-1.5 rounded-xl text-[13px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                  <Icon name="close" size={14} />
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* The answer. */}
          <div className="bg-white border border-slate-200 rounded-2xl">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <h3 className="font-display text-[15px] font-bold text-slate-900">
                  Transactions <span data-notranslate>({sortedTxns.length})</span>
                </h3>
                <p className="mt-0.5 text-[12px] text-slate-500">Showing all wallet transactions for the selected period</p>
              </div>
              {walletTxns.length > 1 && (
                /* The real control, invisible and exactly over the text it
                   describes, so the whole thing is the tap target and the
                   native picker still opens — the same trick the wallet
                   list's sort uses. */
                <span className="relative shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 text-[13px] text-slate-500">
                  Sort by:
                  <span className="font-bold text-slate-900" data-notranslate>{TXN_SORTS[txnSort]}</span>
                  <Icon name="chevronDown" size={14} className="text-slate-400" />
                  <select value={txnSort} onChange={function (e) { setTxnSort(e.target.value); setTxnPage(0) }}
                    aria-label="Sort transactions"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                    <option value="latest">Latest</option>
                    <option value="oldest">Oldest</option>
                    <option value="amount">Highest amount</option>
                  </select>
                </span>
              )}
            </div>
            {walletTxns.length > 0 && (
              <div className="flex flex-wrap items-center gap-4 px-5 py-2.5 border-b border-slate-100">
                <label className="flex items-center gap-2 text-[12.5px] text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={showDeletedTxns}
                    onChange={function (e) { setShowDeletedTxns(e.target.checked); setTxnPage(0) }}
                    className="w-4 h-4 accent-indigo-600" />
                  Show deleted expenses
                </label>
                <label className="flex items-center gap-2 text-[12.5px] text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={expandAllTxns}
                    onChange={function (e) { setExpandAllTxns(e.target.checked) }}
                    className="w-4 h-4 accent-indigo-600" />
                  Expand all allocation details
                </label>
              </div>
            )}
            {sortedTxns.length === 0 ? (
              <p className="px-5 py-14 text-center text-[13px] font-medium text-slate-400">
                {/* The view opens on the click now, so it can be here before the
                    rows are. Saying nothing would read as an empty wallet. */}
                {txnsLoading ? 'Loading transactions…'
                  : walletTxns.length === 0 ? 'No transactions yet'
                  : 'No transactions match — try "Show deleted expenses"'}
              </p>
            ) : (
              <>
                {/* scroll-mt clears the sticky header the rows slide under, so
                    Next lands on the first row rather than just above it. */}
                <div ref={txnListRef} className="p-3 space-y-2 scroll-mt-24">{pagedTxns.map(renderTxnRow)}</div>
                {renderTxnPager()}
              </>
            )}
          </div>

          {/* The same eleven the phone branch mounts. Two were missing here and
              one was a name I had invented, which is why the page came up
              blank: an undefined call in the render path takes the whole tree
              with it, and a build does not see it because it is only a
              reference until something runs. */}
          {renderIssueModal()}
          {renderReceiveModal()}
          {renderCollectModal()}
          {renderTentativeModal()}
          {renderTransferModal()}
          {renderTransferConfirmModal()}
          {renderCancelModal()}
          {renderCollectionDetailModal()}
          {renderPaymentDetailModal()}
          {renderExpenseDetailModal()}
          {renderEnlargedImg()}
        </div>
      )
    }

    if (inAdmin) return renderTxnsDesktop()

    return (
      <div className="space-y-4">
        <WalletBackdrop inAdmin={inAdmin} />
        <div className="space-y-3">
          {/* Only where nothing else offers a way back. This calls backNav's
             goBack — the very same handler the phone shell's ← pops — so on a
             phone it was the same button twice, one under the other. The admin
             shell has a breadcrumb and no arrow, so there it is the only route
             out and has to stay. */}
          {inAdmin && (
            <button type="button" onClick={goBack}
              className="inline-flex items-center gap-1.5 h-8 -ml-1 px-2 rounded-lg text-[13px] font-bold text-indigo-600 hover:bg-indigo-50 transition-colors">
              <Icon name="arrowLeft" size={15} />
              {(isAdmin || isAuditor) ? 'Back to Wallets' : 'Back'}
            </button>
          )}

          <div className="flex items-start gap-3">
            <span className={"shrink-0 w-12 h-12 rounded-full inline-flex items-center justify-center text-[17px] font-bold " + avatarTint(txnUser.name)}>
              {(txnUser.name || '?').charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[19px] font-bold text-slate-900 leading-snug truncate">{txnUser.name || '—'}</h2>
              <p className="text-[12px] text-slate-500 truncate">{txnUser.email || '—'}</p>
              <span className={"inline-flex mt-1.5 px-2.5 py-1 rounded-full text-[13px] font-bold tabular-nums " +
                ((selectedWallet.balance_paise || 0) < 0 ? "bg-red-100 text-red-700"
                  : (selectedWallet.balance_paise || 0) === 0 ? "bg-slate-100 text-slate-500"
                  : "bg-emerald-100 text-emerald-700")}
                data-notranslate>{formatPoints(selectedWallet.balance_paise)}</span>
            </div>

            {walletTxns.length > 0 && (
              <div className="shrink-0 flex gap-2">
                <button type="button" onClick={exportWalletCSV} title="Export CSV"
                  className="inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl text-[12px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] disabled:opacity-60 transition-all">
                  <Icon name="download" size={15} className="text-slate-400" />
                  <span className="hidden sm:inline">CSV</span>
                </button>
                <button type="button" onClick={exportWalletPDF} disabled={pdfBusy} title="Export PDF"
                  className="inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl text-[12px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] disabled:opacity-60 transition-all">
                  <Icon name={pdfBusy ? 'refresh' : 'fileText'} size={14} className="text-slate-400" />
                  <span className="hidden sm:inline">{pdfBusy ? 'Generating…' : 'PDF'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* One pill for the pair, not two: two bordered date fields side by
            side do not fit a narrow phone, and stacking them spent two rows
            on one question. Sharing a border pays for the second field. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.08em] mb-1">Time Period</label>
            {/* The app's own calendar, the same one the expense filters use.
                A native date input was the wrong tool twice over: it would not
                shrink to half a phone row without drawing an empty box, and it
                took a date the moment its picker opened, because React's
                onChange is the input event and that runs while the picker is
                still up. This one fires on a tap and on nothing else. */}
            <div className="flex items-stretch bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex-1 min-w-0">
                <EventDatePicker value={txnFrom} placeholder="From" collapsible includePast plain
                  triggerStyle={DATE_TRIGGER}
                  onChange={function (v) { setTxnFrom(v); openWalletTxns(null, v, null) }} />
              </div>
              {/* A rule, not a dash: the two halves read as one field
                  otherwise, and a dash on the baseline was easy to miss. */}
              <span aria-hidden="true" className="shrink-0 self-stretch my-2 w-px bg-slate-200" />
              <div className="flex-1 min-w-0">
                <EventDatePicker value={txnTo} placeholder="To" collapsible includePast plain
                  triggerStyle={DATE_TRIGGER}
                  onChange={function (v) { setTxnTo(v); openWalletTxns(null, null, v) }} />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.08em] mb-1">Type</label>
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <select value={txnRefType} onChange={function (e) { setTxnRefType(e.target.value); openWalletTxns(null, null, null, e.target.value) }}
                  className="appearance-none w-full h-11 pl-3 pr-9 bg-white border border-slate-200 rounded-xl text-[13px] text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-shadow"
                  style={{ fontSize: '16px' }}>
                  <option value="">All Types</option>
                  <option value="expense">Expenses</option>
                  <option value="expense_refund">Refunds</option>
                  <option value="collection">Collections</option>
                  <option value="transfer">Transfers</option>
                  <option value="issued">Issued (admin)</option>
                  <option value="deducted">Deducted (admin)</option>
                  <option value="opening">Opening</option>
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <Icon name="chevronDown" size={15} />
                </span>
              </div>
              {(txnFrom || txnTo) && (
                <button type="button" onClick={function () { setTxnFrom(''); setTxnTo(''); openWalletTxns(null, '', '') }}
                  className="shrink-0 h-11 px-3 rounded-xl text-[12px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
        {walletTxns.length > 0 && (function () {
          var totalCr = stats.credits, totalDb = stats.debits
          var opening = stats.opening, closing = stats.closing
          return (
            /* Four readings of the same period, so they get one shape and one
               type size. Closing stays dark because it is the answer the other
               three are working towards, not a fourth number of equal weight. */
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {/* One card, four times. The tint used to fill the whole chip, so
                  four cards shouted four different colours at a glance and the
                  figures — the only part that differs — had to compete with
                  their own backgrounds. The colour now sits on the number and
                  nowhere else; the labels are identical because they are the
                  same kind of thing. */}
              <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em]">Opening</p>
                <p className={"mt-0.5 text-[13px] font-bold tabular-nums " + (opening < 0 ? "text-red-600" : "text-slate-900")}
                  data-notranslate>{formatPoints(opening)}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em]">Total Credits</p>
                <p className="mt-0.5 text-[13px] font-bold tabular-nums text-emerald-600" data-notranslate>+{formatPoints(totalCr)}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em]">Total Debits</p>
                <p className="mt-0.5 text-[13px] font-bold tabular-nums text-red-600" data-notranslate>-{formatPoints(totalDb)}</p>
              </div>
              {/* Closing is the answer the other three work towards, so it gets a
                  firmer edge — not a filled panel, which made it read as a
                  different kind of thing entirely. */}
              <div className="bg-white border-2 border-slate-300 rounded-xl px-3 py-2">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em]">Closing</p>
                <p className={"mt-0.5 text-[13px] font-bold tabular-nums " + (closing < 0 ? "text-red-600" : "text-slate-900")}
                  data-notranslate>{formatPoints(closing)}</p>
              </div>
            </div>
          )
        })()}
        {selectedWallet && selectedWallet.user_id === profile.id && pendingIncoming.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Incoming Transfers</p>
            {pendingIncoming.map(function (t) {
              var imgUrl = getReceiptUrl(t.sender_image_path)
              var isVoice = isVoiceNotePath(t.sender_image_path)
              return (
                <div key={t.id} className="bg-amber-50/50 border border-amber-300 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{t._fromName} sent you {formatPoints(t.amount_paise)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{t.description || '—'} · {formatDate(t.created_at)}</p>
                      {imgUrl && (
                        <span className="block mt-1.5">
                          <ProofThumb url={imgUrl} label="Sent" tone="bg-blue-600"
                            onOpen={function () { setEnlargedWalletImg(imgUrl) }} />
                        </span>
                      )}
                    </div>
                    <button onClick={function () { setTransferConfirmModal(t); setTransferConfirmImage(null); transferConfirmRec.cancel() }}
                      className="px-3 py-1.5 text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200 transition-colors flex-shrink-0 ml-2">
                      📷 Confirm
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {selectedWallet && selectedWallet.user_id === profile.id && pendingOutgoing.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Outgoing Transfers (Pending)</p>
            {pendingOutgoing.map(function (t) {
              return (
                <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold text-slate-900 leading-snug">Sent {formatPoints(t.amount_paise)} to {t._toName}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{t.description || '—'} · {formatDate(t.created_at)}</p>
                    </div>
                    <button onClick={function () { cancelTransfer(t) }}
                      className="px-3 py-1.5 text-[10px] font-bold text-red-500 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors flex-shrink-0 ml-2">
                      Cancel
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {walletTxns.length === 0 && pendingIncoming.length === 0 && pendingOutgoing.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
            <p className="text-gray-400 text-sm">No transactions yet</p>
          </div>
        )}
        {walletTxns.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
            <label className="flex items-center gap-2 text-[12.5px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={showDeletedTxns}
                onChange={function (e) { setShowDeletedTxns(e.target.checked); setTxnPage(0) }}
                className="w-4 h-4 accent-indigo-600" />
              Show deleted expenses
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={expandAllTxns}
                onChange={function (e) { setExpandAllTxns(e.target.checked) }}
                className="w-4 h-4 accent-indigo-600" />
              Expand all allocation details
            </label>
          </div>
        )}
        {txnsLoading && walletTxns.length === 0 ? (
          <p className="text-center text-[13px] font-medium text-slate-400 py-8">Loading transactions…</p>
        ) : sortedTxns.length === 0 && walletTxns.length > 0 ? (
          <p className="text-center text-[13px] font-medium text-slate-400 py-8">No transactions match — try "Show deleted expenses"</p>
        ) : (
          <>
            <div ref={txnListRef} className="space-y-2 scroll-mt-20">
              {pagedTxns.map(renderTxnRow)}
            </div>
            {renderTxnPager()}
          </>
        )}
        {renderIssueModal()}
        {renderReceiveModal()}
        {renderCollectModal()}
        {renderTentativeModal()}
        {renderTransferModal()}
        {renderTransferConfirmModal()}
        {renderCancelModal()}
        {renderCollectionDetailModal()}
        {renderPaymentDetailModal()}
        {renderExpenseDetailModal()}
        {renderEnlargedImg()}
      </div>
    )
  }

  return null
}

export default WalletManager
