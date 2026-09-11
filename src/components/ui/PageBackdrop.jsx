import pcBg from '../../assets/pc-bg.png'

// The artwork behind a page.
//
// Imported rather than referenced from public/: vite.config.js sets
// base: "/ambria-ops/", so a hand-written "/pc-bg.png" would 404 in production.
// The import also gets it a content hash, so a new backdrop is never served
// from a stale cache.
//
// Absolute, and it expects its parent to be `relative isolate` and to already
// be at least a screen tall:
//
//   - absolute, because a `fixed` copy inside an isolated parent paints as one
//     unit ON TOP of every sibling before it. In the admin shell that hid the
//     section heading and the tab row, which read as a large empty gap.
//   - isolate, because -z-10 without a stacking context falls behind the opaque
//     body background and disappears.
//   - and NOT overflow-hidden on the parent: sticky children (the expense
//     form's submit bar, the Items/Split tabs) get pinned to a box that scrolls
//     away. The img clips itself to its own inset-0 box instead.
//
// `veil` overrides the scrim. How much the artwork can show through depends
// on how wide the page is: behind one 540px column of cards on a phone the
// diagonals frame the content, but across a 1500px admin content area the
// same diagonals cut straight through tables and card borders.
function PageBackdrop({ veil }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <img src={pcBg} alt="" className="w-full h-full object-cover object-center" />
      {/* A white scrim: the artwork is busiest at the corners and the cards
          need a calm ground to sit on, or every border competes with a
          diagonal behind it. */}
      <div className={'absolute inset-0 ' + (veil || 'bg-white/55')} />
    </div>
  )
}

export default PageBackdrop
