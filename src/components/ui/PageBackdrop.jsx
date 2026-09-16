import pcBg from '../../assets/pc-bg.webp'

// The artwork behind a page.
//
// Imported rather than referenced from public/: vite.config.js sets
// base: "/ambria-ops/", so a hand-written "/pc-bg.webp" would 404 in production.
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
// The flat colour below is the artwork averaged down to one pixel, so while the
// file is still in flight the ground composites to the same tone the artwork
// will — the page opens on its own colour rather than on white that later
// darkens. fetchpriority tells the browser this one is worth the queue, since
// by the time it is asked for, the lazy images further down the page have
// already been queued.
function PageBackdrop({ veil }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" style={{ backgroundColor: '#afc5db' }}>
      {/* Blurred, because on a phone cover lands this almost exactly at its
          native size and the diagonals came out hard-edged — every one of them
          a line as crisp as the card borders in front of it, which is not what
          a backdrop is for. scale-110 goes with the blur: a blurred element
          samples transparent pixels past its own edges and fades out around
          them, so it is overfilled and the faded ring pushed off-screen. */}
      <img src={pcBg} alt="" fetchpriority="high" decoding="async"
        className="w-full h-full object-cover object-center blur-[2px] scale-110" />
      {/* A white scrim: the artwork is busiest at the corners and the cards
          need a calm ground to sit on, or every border competes with a
          diagonal behind it. */}
      <div className={'absolute inset-0 ' + (veil || 'bg-white/62')} />
    </div>
  )
}

export default PageBackdrop
