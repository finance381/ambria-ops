import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { StatusBadge, TypeBadge } from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'

function Boxes() {
  var [boxes, setBoxes] = useState([])
  var [items, setItems] = useState([])
  var [loading, setLoading] = useState(true)
  var [scanId, setScanId] = useState('')
  var [scanned, setScanned] = useState(null)
  var [selected, setSelected] = useState(null)

  useEffect(function () {
    loadData()
  }, [])

  async function loadData() {
    var [boxesRes, itemsRes] = await Promise.all([
      supabase.from('boxes').select('*').order('box_code'),
      supabase.from('inventory_items').select('id, name, type, box_id'),
    ])
    setBoxes(boxesRes.data || [])
    setItems(itemsRes.data || [])
    setLoading(false)
  }

  function getBoxContents(boxCode) {
    return items.filter(function (item) {
      return item.box_id === boxCode
    })
  }

  function handleScan(e) {
    e.preventDefault()
    var code = scanId.trim().toUpperCase()
    var found = boxes.find(function (b) { return b.box_code === code })
    if (found) {
      setScanned(found)
    } else {
      setScanned('not_found')
    }
  }

  function openDetail(box) {
    setSelected(box)
  }

  if (loading) {
    return <p className="text-gray-400 text-sm">Loading boxes...</p>
  }

  return (
    <div className="space-y-4">
      {/* Scan box */}
      <form onSubmit={handleScan} className="flex gap-2">
        <input
          type="text"
          placeholder="Scan / Enter Box ID (e.g. BOX-001)"
          value={scanId}
          onChange={function (e) { setScanId(e.target.value) }}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
        >
          🔍 Scan
        </button>
      </form>

      {/* Scan result */}
      {scanned === 'not_found' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-600">Box "{scanId.toUpperCase()}" not found</p>
        </div>
      )}
      {scanned && scanned !== 'not_found' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-green-800">{scanned.box_code}</h3>
            <StatusBadge status={scanned.status} />
          </div>
          {scanned.label && <p className="text-sm text-green-700">{scanned.label}</p>}
          <div className="mt-3">
            <p className="text-xs font-medium text-green-700 mb-1">Contents:</p>
            {getBoxContents(scanned.box_code).length === 0 && (
              <p className="text-xs text-green-600">No items assigned to this box</p>
            )}
            {getBoxContents(scanned.box_code).map(function (item) {
              return (
                <div key={item.id} className="flex items-center gap-2 text-sm text-green-800">
                  <span>{item.name}</span>
                  <TypeBadge type={item.type} />
                </div>
              )
            })}
          </div>
          <button
            onClick={function () { setScanned(null); setScanId('') }}
            className="mt-2 text-xs text-green-600 hover:text-green-800"
          >
            Clear
          </button>
        </div>
      )}

      {/* Box cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {boxes.map(function (box) {
          var contents = getBoxContents(box.box_code)
          return (
            <div
              key={box.id}
              onClick={function () { openDetail(box) }}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md cursor-pointer transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-800">{box.box_code}</h3>
                <StatusBadge status={box.status} />
              </div>
              {box.label && <p className="text-sm text-gray-600 mb-1">{box.label}</p>}
              {box.location && <p className="text-xs text-gray-400 mb-2">📍 {box.location}</p>}

              <div className="border-t border-gray-100 pt-2 mt-2">
                <p className="text-xs text-gray-500 mb-1">{contents.length} item{contents.length !== 1 ? 's' : ''}</p>
                <div className="flex flex-wrap gap-1">
                  {contents.map(function (item) {
                    return (
                      <span key={item.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {item.name}
                      </span>
                    )
                  })}
                  {contents.length === 0 && (
                    <span className="text-xs text-gray-400">Empty</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Detail Modal */}
      <Modal open={!!selected} onClose={function () { setSelected(null) }} title={selected ? selected.box_code : ''}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <StatusBadge status={selected.status} />
              {selected.location && <span className="text-sm text-gray-500">📍 {selected.location}</span>}
            </div>

            {selected.label && (
              <div>
                <p className="text-sm text-gray-500">Label</p>
                <p className="text-sm text-gray-800">{selected.label}</p>
              </div>
            )}

            {selected.notes && (
              <div>
                <p className="text-sm text-gray-500">Notes</p>
                <p className="text-sm text-gray-800">{selected.notes}</p>
              </div>
            )}

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Contents</p>
              {getBoxContents(selected.box_code).length === 0 && (
                <p className="text-sm text-gray-400">No items in this box</p>
              )}
              {getBoxContents(selected.box_code).map(function (item) {
                return (
                  <div key={item.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-800">{item.name}</span>
                    <TypeBadge type={item.type} />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default Boxes