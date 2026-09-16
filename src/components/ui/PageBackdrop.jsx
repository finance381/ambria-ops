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
      {/* Blurred and enlarged, because on a phone cover lands this almost
          exactly at its native size: the diagonals arrived hard-edged and
          crowded, every one of them a line as crisp as the card borders in
          front of it, and a dozen of them across the screen. At 1.35 the same
          shapes are half as many and twice as broad, which is a ground rather
          than a pattern, and the blur takes the edge off what is left.
          Enlarging is also what a blur needs anyway — a blurred element samples
          transparent pixels past its own edges and fades out around them, so it
          has to overfill for the faded ring to fall off-screen. */}
      <img src={pcBg} alt="" fetchpriority="high" decoding="async"
        className="w-full h-full object-cover object-center blur-[3px] scale-135" />
      {/* A white scrim: the artwork is busiest at the corners and the cards
          need a calm ground to sit on, or every border competes with a
          diagonal behind it.
          Graded rather than flat — heaviest at the top, where the header and
          the first row of cards are, and lifting towards the bottom, where
          there is usually nothing to read and the artwork can be itself. */}
      <div className={'absolute inset-0 ' + (veil || 'bg-gradient-to-b from-white/72 via-white/62 to-white/50')} />
    </div>
  )
}

export default PageBackdrop
