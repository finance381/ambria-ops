// Supabase hands back at most 1000 rows per request, so a ledger past that
// silently came up short. makeQuery builds the same query fresh each time
// (a builder can only run once); pages of 1000 are read until one comes back
// short. Give the query a unique order (add 'id') so pages don't overlap.
export async function fetchAllRows(makeQuery, pageSize, maxRows) {
  var size = pageSize || 1000
  var cap = maxRows || 20000
  var all = []
  for (var from = 0; from < cap; from += size) {
    var res = await makeQuery().range(from, from + size - 1)
    if (res.error) return { data: all.length ? all : null, error: res.error }
    var rows = res.data || []
    all = all.concat(rows)
    if (rows.length < size) break
  }
  return { data: all, error: null }
}
