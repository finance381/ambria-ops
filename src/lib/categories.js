function filterUserCategories(categories, profile) {
  var ids = profile?.category_ids || []
  if (!ids.length || profile?.role === 'admin' || profile?.role === 'auditor') return categories
  return categories.filter(function (c) { return ids.indexOf(c.id) !== -1 })
}

export { filterUserCategories }