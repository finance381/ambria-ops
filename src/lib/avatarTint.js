// A stable colour for a name, so the same person or vendor keeps the same
// initial-circle everywhere it appears. Hashed rather than assigned, because
// the lists this appears in are filtered and re-sorted constantly — an index
// would hand the same row a different colour every time something above it
// moved, which is exactly the sort of change the eye reads as "this is a
// different one".
//
// Lifted out of WalletManager, which is no longer the only screen with a
// column of names down the left.
var AVATAR_TINTS = [
  'bg-blue-100 text-blue-700',
  'bg-rose-100 text-rose-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
]

export function avatarTint(name) {
  var s = String(name || '')
  var h = 0
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}

export function avatarInitial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?'
}
