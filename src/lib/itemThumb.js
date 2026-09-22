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

export default itemIcon
