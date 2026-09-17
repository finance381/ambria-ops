// The ground behind a page.
//
// Drawn rather than photographed. It was a WebP of hard diagonals, and a
// picture gives you no say in any of this: how many lines cross the screen is
// whatever `cover` decides, and on a phone that was a dozen of them, each as
// crisp as the card borders in front. Blurring and enlarging it got the edge
// off but never changed what it was — a pattern competing with the content.
//
// Four wide, soft washes of colour instead. They read as depth rather than as
// marks, which is the job: give the frosted cards something to sit on that is
// not flat, and stay quiet enough that nobody looks at it twice. It is also a
// few hundred bytes of CSS, so there is nothing to load and nothing to arrive
// late.
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
//     that scrolls away. It clips itself to its own inset-0 box instead.
//
// One caveat that cost an afternoon in the admin shell: a stacking context
// paints as a single unit, above every sibling that precedes it. So this has
// to live in a parent that comes BEFORE the chrome it must sit behind — at the
// shell root, not inside the page area — or it hides the header rather than
// sitting under it.
//
// The washes are placed off the corners and sized past them, so what shows is
// the middle of each one. Nothing here has a hard edge anywhere near the
// screen, which is why a change of viewport height — the address bar sliding
// away mid-scroll — moves them a little instead of resizing something sharp.
var WASHES = [
  'radial-gradient(75% 55% at 8% -5%,  rgba(99,102,241,0.30), transparent 72%)',
  'radial-gradient(65% 50% at 102% 12%, rgba(56,189,248,0.26), transparent 72%)',
  'radial-gradient(80% 60% at 88% 104%, rgba(139,92,246,0.26), transparent 72%)',
  'radial-gradient(70% 55% at -8% 88%,  rgba(45,212,191,0.20), transparent 72%)',
].join(', ')

// A hairline grid, corner to corner. It is the one mark on this ground that is
// actually drawn, and it is what stops the washes reading as an empty gradient:
// rules this faint are below anything you would call a pattern, but they give
// the eye a scale, and colour with a scale behind it reads as a surface.
//
// No mask. Fading it out left the grid showing in whichever corner the washes
// happened to be palest, which reads as a smudge rather than as a ruled ground
// — if it is structure it has to hold everywhere, and if it cannot hold
// everywhere it should not be there at all.
//
// 5%, not 3.5%: it sits above the scrim, and what it has to survive is not the
// white but the saturated middle of a wash, where a 3.5% line disappears. Still
// a twentieth of black, which is a line you find when you look for it and not
// before.
var GRID = {
  backgroundImage: [
    'linear-gradient(rgba(15,23,42,0.05) 1px, transparent 1px)',
    'linear-gradient(90deg, rgba(15,23,42,0.05) 1px, transparent 1px)',
  ].join(', '),
  backgroundSize: '44px 44px',
}

// `veil` overrides the scrim. How much the ground can show through depends on
// how wide the page is: behind one 540px column of cards on a phone it frames
// the content, but across a 1500px admin content area the same colour spreads
// under tables and card borders.
function PageBackdrop({ veil }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ backgroundColor: '#eef1f7' }}>
      <div className="absolute inset-0" style={{ backgroundImage: WASHES }} />
      {/* A white scrim, graded rather than flat: heaviest at the top, where the
          header and the first row of cards are, and lifting towards the bottom,
          where there is usually nothing to read and the colour can be itself. A
          single flat value had to be calm enough for the busiest part of the
          page, which left the rest of it duller than it needed to be. */}
      <div className={'absolute inset-0 ' + (veil || 'bg-gradient-to-b from-white/72 via-white/60 to-white/45')} />
      <div className="absolute inset-0" style={GRID} />
    </div>
  )
}

export default PageBackdrop
