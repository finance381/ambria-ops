import pcBg from '../../assets/pc-bg.png'

// The artwork behind a page.
//
// Imported rather than referenced from public/: vite.config.js sets
// base: "/ambria-ops/", so a hand-written "/pc-bg.png" would 404 in production.
// The import also gets it a content hash, so a new backdrop is never served
// from a stale cache.
//
// Fixed, so it stays put while the page scrolls over it. It was absolute until
// the shell took it over, and absolute meant it covered the whole document and
// travelled with the content — on a long expense list the artwork scrolled off
// the top and the page ran out of ground.
//
// It expects its parent to be `relative isolate`:
//
//   - isolate, because -z-10 without a stacking context falls behind the opaque
//     body background and disappears.
//   - and NOT overflow-hidden on the parent: sticky children (the shell header,
//     the expense form's submit bar, the Items/Split tabs) get pinned to a box
//     that scrolls away. The img clips itself to its own inset-0 box instead.
//
// One caveat that cost an afternoon in the admin shell: a stacking context
// paints as a single unit, above every sibling that precedes it. So this has
// to live in a parent that comes BEFORE the chrome it must sit behind — at the
// shell root, not inside the page area — or it hides the header rather than
// sitting under it.
//
// `veil` overrides the scrim. How much the artwork can show through depends
// on how wide the page is: behind one 540px column of cards on a phone the
// diagonals frame the content, but across a 1500px admin content area the
// same diagonals cut straight through tables and card borders.
function PageBackdrop({ veil }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <img src={pcBg} alt="" className="w-full h-full object-cover object-center" />
      {/* A white scrim: the artwork is busiest at the corners and the cards
          need a calm ground to sit on, or every border competes with a
          diagonal behind it. */}
      <div className={'absolute inset-0 ' + (veil || 'bg-white/55')} />
    </div>
  )
}

export default PageBackdrop
