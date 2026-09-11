// The Ambria mark: a white A with a light swoosh through it, on an indigo
// glass tile.
//
// Drawn rather than imported. The brand art exists as a raster app icon, and a
// PNG at this size (32px in the sidebar) would either be a blurry downscale or
// a second asset to keep in step with the first. Two paths and a gradient cost
// nothing to download and stay sharp at any size — and the tile can then take
// the same size prop as the mark inside it.
//
// Not an Icon: everything in that set inherits `currentColor`, and this needs
// two colours at once.

var TILE = 'linear-gradient(150deg, #6366F1 0%, #4338CA 55%, #312E81 100%)'
// An inner highlight along the top edge and a hairline ring, which is what
// makes a small rounded square read as a raised object rather than a swatch.
var TILE_SHADOW = 'inset 0 1px 0 rgba(255,255,255,0.34), inset 0 0 0 1px rgba(129,140,248,0.5)'
// The sheen. It stops at 45% so it reads as light falling across the top-left
// corner, not as a second gradient fighting the first.
var SHEEN = 'linear-gradient(158deg, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0) 45%)'

function Logo({ size, className }) {
  var s = size || 32
  var glyph = Math.round(s * 0.68)
  return (
    <span
      aria-hidden="true"
      className={'relative shrink-0 inline-flex items-center justify-center overflow-hidden ' + (className || '')}
      // 28% rather than a fixed radius, so the corner curve stays in
      // proportion whatever size the tile is asked for.
      style={{ width: s, height: s, borderRadius: '28%', background: TILE, boxShadow: TILE_SHADOW }}
    >
      <span className="absolute inset-0" style={{ background: SHEEN }} />
      <svg viewBox="0 0 24 24" width={glyph} height={glyph} fill="none" className="relative">
        {/* The A has no crossbar — the swoosh is the crossbar, which is the
            whole idea of the mark. */}
        <path d="M6.3 19.3 L12 5.3 L17.7 19.3" stroke="#ffffff" strokeWidth="2.9"
          strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7.5 16.7 C 11.4 14.5 15.9 11.7 20.3 10.3" stroke="#a5b4fc" strokeWidth="2.3"
          strokeLinecap="round" />
      </svg>
    </span>
  )
}

export default Logo
