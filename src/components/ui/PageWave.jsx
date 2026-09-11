// The banded wash behind a page header.
//
// It was written for API Marketing and lived inside BroadcastHub. Finance now
// uses the same treatment, and a second copy of it is how two pages that are
// supposed to look identical drift apart, so it moved here and both import it.
//
// A radial gradient can only fade outward from a point — it cannot bend, so an
// earlier version was a soft blob where the design has a curve sweeping in from
// the corner. Curves need a path, so this is SVG.
//
// preserveAspectRatio="none" lets one drawing stretch to whatever width the
// content column happens to be, which is the point of drawing it rather than
// shipping a fixed-width image.
//
// Absolute, and it expects its parent to be `relative isolate`:
//
//   - absolute, because a `fixed` copy inside an isolated parent paints as one
//     unit ON TOP of every sibling before it — in the admin shell that hid the
//     section heading and the tab row, which read as a large empty gap.
//   - isolate, because -z-10 without a stacking context falls behind the
//     opaque body background and disappears.
//   - and NOT overflow-hidden on the parent: sticky children get pinned to a
//     box that scrolls away. This clips itself to its own box.

// A flat wash under the whole section, so it separates from the shell ground
// below it. The shaped part is the SVG on top of this.
var WASH = {
  backgroundImage: 'linear-gradient(180deg, rgba(245,243,255,0.85), rgba(245,243,255,0) 260px)',
}


// Shallow, and dissolving downward.
//
// The previous pair crested at half the band's height and ended on the curve
// itself, so a band tall enough to clear the top bar reached a third of the way
// down the page and stopped at a visible edge. These are shallower, and their
// fill fades out vertically — the band has no bottom to notice.
//
// Tileable: the bottom edge leaves the left at the height it arrives at the
// right, so two copies side by side meet with no seam. Without that the join
// shows as a step every cycle once it starts moving.
var WAVE_A = 'M0 0 H1200 V78 C1080 118 950 46 820 74 C690 102 560 140 430 104 C300 68 140 44 0 78 Z'
var WAVE_B = 'M0 0 H1200 V44 C1090 76 980 18 850 42 C710 68 590 96 440 66 C300 38 150 22 0 44 Z'

// The same two curves at 40% of their amplitude, for phone widths only.
//
// preserveAspectRatio="none" is what makes one drawing fit any column, and
// it is also why a phone needed its own: a 2400-unit tile squeezed into ~750
// CSS pixels is a horizontal squash of about 3.2×, against a vertical one of
// 0.8× — roughly 2.5× more compression across than down. Gentle curves come
// out of that as steep spikes. Flattening the source by the same factor puts
// the angles back where they were drawn.
//
// Endpoints are untouched, so these tile as seamlessly as the full-size pair.
var WAVE_A_SM = 'M0 0 H1200 V78 C1080 94 950 65 820 76 C690 88 560 103 430 88 C300 74 140 64 0 78 Z'
var WAVE_B_SM = 'M0 0 H1200 V44 C1090 57 980 34 850 43 C710 54 590 65 440 53 C300 42 150 35 0 44 Z'

// 200% wide, holding the tile twice. The animation slides it exactly one tile
// left and starts over on an identical frame — a continuous drift in one
// direction rather than a back-and-forth, and no jump at the restart.
var BAND = 'absolute inset-y-0 left-0 w-[200%] h-full'

function Band({ d, gradient, className }) {
  return (
    <svg className={BAND + ' ' + className} viewBox="0 0 2400 160" preserveAspectRatio="none" fill="none">
      {/* Two paths, not one 2400-wide path. The fade is vertical and an
          objectBoundingBox gradient maps to each element's own box, so two
          identical paths render identically while one wide path would stretch
          the gradient across both tiles and make the seam visible. */}
      <path d={d} fill={'url(#' + gradient + ')'} />
      <path d={d} fill={'url(#' + gradient + ')'} transform="translate(1200,0)" />
    </svg>
  )
}

function PageWave({ offset }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" style={WASH}>
      {/* A soft glow, drifting on its own timing. No edges anywhere in it, so
          it can be as large as it likes without ever reading as a shape that
          ends somewhere. */}
      <div className="absolute -top-40 right-[-8rem] w-[34rem] h-[34rem] rounded-full ambria-glow-drift"
        style={{ background: 'radial-gradient(circle, rgba(129,140,248,0.22) 0%, rgba(129,140,248,0) 70%)' }} />

      {/* `offset` is the chrome above the page header — 3.5rem of top bar in
          the admin shell, nothing in API Marketing. The band starts at the very
          top either way, so the colour runs behind that bar instead of leaving
          it as a white strip across a tinted page, and the offset only adds the
          height that bar takes up.

          No arithmetic to keep a crest in place any more: the fill dissolves
          before the band ends, so there is no boundary whose position matters. */}
      {/* ambria-wave-mask is the left-to-right falloff. It lives in CSS
          because it has to change at the sm breakpoint — see the rule for
          why — and an inline style cannot hold a media query. */}
      <div className="absolute inset-x-0 top-0 overflow-hidden ambria-wave-mask"
        style={{ height: offset ? 'calc(8rem + ' + offset + ')' : '8rem' }}>
        <svg width="0" height="0" className="absolute">
          <defs>
            {/* Vertical, so horizontal travel cannot make it pulse. */}
            <linearGradient id="pageWaveA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.34" />
              <stop offset="55%" stopColor="#a78bfa" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="pageWaveB" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0" />
            </linearGradient>
            {/* Denser, for the phone pair. Those waves are flattened to 40%
                of their amplitude, so they cover far less of the band than
                the full-size ones and read paler at the same opacity. */}
            <linearGradient id="pageWaveASm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.5" />
              <stop offset="55%" stopColor="#a78bfa" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="pageWaveBSm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0.44" />
              <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
        {/* the deeper band, then a shallower one in front so the edge is not a
            single hard sweep. Each is drawn twice — a flattened pair for phone
            widths and the full-amplitude pair from sm up — and swapped by
            display, so only one is ever painted. */}
        <Band d={WAVE_A_SM} gradient="pageWaveASm" className="ambria-wave-slow sm:hidden" />
        <Band d={WAVE_B_SM} gradient="pageWaveBSm" className="ambria-wave-fast sm:hidden" />
        <Band d={WAVE_A} gradient="pageWaveA" className="ambria-wave-slow hidden sm:block" />
        <Band d={WAVE_B} gradient="pageWaveB" className="ambria-wave-fast hidden sm:block" />
      </div>
    </div>
  )
}

export default PageWave
