// What to draw where an item's photograph should be.
//
// Most items in the masters have no image_path, and a grey box repeated down a
// list tells you nothing and looks like a loading failure. The item already
// says what it is — "Full Cream Milk Amul 1 Liters", filed under Dairy — so the
// tile is built from that: a glyph for the kind of thing, and a ground colour
// that is the same every time for the same name, so a row you have scrolled
// past once is recognisable when you come back to it.
//
// This is a stand-in, not a substitute. A real photograph is uploaded against
// the item in Inventory → Items, and the moment one exists this is not used.

// Longest, most specific words first: "soft drinks" must beat "drinks", and
// "dry fruits" must not be read as fruit.
var RULES = [
  { icon: 'box',      words: ['dry fruit', 'dryfruit'] },
  { icon: 'sparkle',  words: ['cleaning', 'housekeep', 'detergent', 'sanitiz', 'sanitis', 'soap', 'phenyl', 'tissue'] },
  { icon: 'wrench',   words: ['hardware', 'tool', 'electric', 'plumb', 'spare', 'machine', 'equipment'] },
  { icon: 'cup',      words: ['beverage', 'drink', 'juice', 'cola', 'soda', 'water', 'tea', 'coffee', 'shake'] },
  { icon: 'droplet',  words: ['dairy', 'milk', 'curd', 'dahi', 'ghee', 'butter', 'cream', 'paneer', 'oil'] },
  { icon: 'leaf',     words: ['fruit', 'vegetable', 'veggie', 'sabzi', 'salad', 'herb', 'green'] },
  { icon: 'utensils', words: ['non-veg', 'non veg', 'meat', 'chicken', 'mutton', 'fish', 'egg', 'crockery', 'cutlery', 'kitchen', 'bakery', 'dessert'] },
  { icon: 'box',      words: ['grocery', 'masala', 'spice', 'pasta', 'rice', 'flour', 'sugar', 'pulse', 'grain'] },
]

// Soft grounds, dark glyphs: the tile sits beside a name and must not outshout
// it the way a saturated square would.
var TINTS = [
  'bg-amber-50 text-amber-600 border-amber-100',
  'bg-emerald-50 text-emerald-600 border-emerald-100',
  'bg-sky-50 text-sky-600 border-sky-100',
  'bg-violet-50 text-violet-600 border-violet-100',
  'bg-rose-50 text-rose-600 border-rose-100',
  'bg-teal-50 text-teal-600 border-teal-100',
]

export function itemIcon(name, cat, subcat) {
  // Category and sub-category are what someone filed the thing under, so they
  // decide before the name does — a name can say "Chocolate" about a cleaning
  // product, but nobody files it under Dairy.
  var hay = [subcat, cat, name].map(function (v) { return String(v || '').toLowerCase() })
  for (var h = 0; h < hay.length; h++) {
    if (!hay[h]) continue
    for (var r = 0; r < RULES.length; r++) {
      var words = RULES[r].words
      for (var w = 0; w < words.length; w++) {
        if (hay[h].indexOf(words[w]) !== -1) return RULES[r].icon
      }
    }
  }
  return 'box'
}

// Hashed rather than assigned: the list is filtered and re-sorted constantly,
// and an index would hand the same item a different colour every time
// something above it moved.
export function itemTint(name) {
  var s = String(name || '')
  var h = 0
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]
}

export default itemIcon
