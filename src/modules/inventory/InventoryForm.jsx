import { useState, useEffect, useRef } from 'react'
import { supabase, getImageUrl } from '../../lib/supabase'
import { prepUpload } from '../../lib/uploadHelper'
import SearchDropdown from '../../components/ui/SearchDropdown'
import Icon from '../../components/ui/Icon'
import AllocationRows from '../../components/ui/AllocationRows'
import ImageCrop from '../../components/ImageCrop'
import CameraCapture from '../../components/ui/CameraCapture'
import { translateToHindi } from '../../lib/translate'
import { titleCase, formatPaise } from '../../lib/format'
import { useLang } from '../../lib/i18n'
import { logActivity } from '../../lib/logger'
import { filterUserCategories } from '../../lib/categories'
import { hasPerm } from '../../lib/permissions'
import { useReferenceData } from '../../lib/referenceData.jsx'
import { reconcileStockBatches, stockValuePaise, placeRates } from '../../lib/stockBatches'

var UNITS = [
  'Inches','Pieces', 'Nos', 'Sets', 'Pairs', 'Dozens',
  'Kg', 'Grams', 'Tons', 'Quintals',
  'Liters', 'ML',
  'Meters', 'CM', 'Feet', 'Yards',
  'Sq.Ft', 'Sq.Mt', 'Cu.Ft', 'Cu.Mt',
  'Rolls', 'Bundles', 'Bunches', 'Packets', 'Bags', 'Cartons', 'Boxes',
  'Bottles', 'Cans', 'Drums', 'Sheets', 'Plates', 'Coils',
  'Trips', 'Hours', 'Days', 'Loads',
]

// Pieces for the admin layout (variant="admin" — the Edit popup on the
// admin Inventory page). Everywhere else — the phone app, Purchase, the
// reviews — keeps the original single-column form below.
function FormSection({ icon, title, hint, right, children }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
      <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-slate-100">
        <span className="shrink-0 w-8 h-8 rounded-lg bg-[#EDEFF5] text-[#3B4668] inline-flex items-center justify-center"><Icon name={icon} size={15} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.07em] text-slate-900">{title}</h3>
          {hint && <p className="text-[12px] text-slate-500">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}
var F_LBL = "block text-[13px] font-semibold text-slate-700 mb-1.5"
var F_INP = "w-full h-11 px-3 bg-white border border-slate-300 rounded-xl text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#A9B1CB] focus:ring-4 focus:ring-[#3B4668]/10"
// A row of options as one segmented control: the picked one lifts white out
// of the grey track.
function Segmented({ options, value, onChange }) {
  return (
    <div className={"grid gap-1 p-1 bg-slate-100 rounded-xl " + (options.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {options.map(function (o) {
        var on = value === o.value
        return (
          <button key={o.value} type="button" onClick={function () { onChange(o.value) }} aria-pressed={on}
            className={"h-9 inline-flex items-center justify-center gap-1.5 rounded-lg text-[13.5px] font-semibold transition-colors " +
              (on ? (o.on || "bg-white text-slate-900") + " shadow-[0_2px_6px_-2px_rgba(15,23,42,0.35)]" : "text-slate-500 hover:text-slate-800 hover:bg-white/60")}>
            {o.icon && <Icon name={o.icon} size={14} />}{o.label}
          </button>
        )
      })}
    </div>
  )
}

function InventoryForm({ item, prefill, profile, onClose, onSaved, variant }) {
  var { t } = useLang()
  var seed = item || prefill || null
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [existingItems, setExistingItems] = useState([])
  var [departments, setDepartments] = useState([])
  var [categoryId, setCategoryId] = useState(seed?.category_id ? String(seed.category_id) : '')
  var [subCategoryId, setSubCategoryId] = useState(seed?.sub_category_id ? String(seed.sub_category_id) : '')
  var [name, setName] = useState(seed?.name || '')
  var [description, setDescription] = useState(seed?.description || '')
  var [nameHindi, setNameHindi] = useState(seed?.name_hindi || '')
  var [hiEdited, setHiEdited] = useState(false)
  var nameManual = useRef(!!(seed?.name && String(seed.name).trim()))
  var [qty, setQty] = useState(seed?.qty ?? '')
  var [unit, setUnit] = useState(seed?.unit || 'Pieces')
  var [minOrderQty, setMinOrderQty] = useState(seed?.min_order_qty ?? seed?.season_reorder_qty ?? '')
  var [reorderQty, setReorderQty] = useState(seed?.reorder_qty ?? seed?.off_season_reorder_qty ?? '')
  var [ratePaise, setRatePaise] = useState(seed?.rate_paise ? (seed.rate_paise / 100) : '')
  var [isAsset, setIsAsset] = useState(seed?.is_asset ?? 'unknown')
  var venues = useReferenceData().venues.filter(function (v) { return v.active })
  var [subVenues, setSubVenues] = useState([])
  var [subDepartments, setSubDepartments] = useState([])
  var [allocations, setAllocations] = useState([{ department: '', sub_department_id: '', venue_id: '', sub_venue_id: '', qty: '' }])
  var [showAllocations, setShowAllocations] = useState(false)
  var [type, setType] = useState(seed?.type || 'Indoor')
  var [imageFile, setImageFile] = useState(null)
  var [imagePreview, setImagePreview] = useState(seed?.image_path ? getImageUrl(seed.image_path) : '')
  var [cropSrc, setCropSrc] = useState(null)
  var [cameraOpen, setCameraOpen] = useState(false)
  var [listeningField, setListeningField] = useState(null)
  var recognitionRef = useRef(null)
  var [saving, setSaving] = useState(false)
  var [errors, setErrors] = useState({})
  var itemSearchTimer = useRef(null)
  // validate()'s dimension-based name-generation sets this synchronously so
  // handleSubmit can use it right away — setName() alone isn't enough since
  // that state update isn't visible until the next render, and handleSubmit
  // keeps running (and used to read the still-empty `name` state) in the
  // meantime.
  var resolvedNameRef = useRef('')
  var [dimensionValues, setDimensionValues] = useState(seed?.dimensions || [])
  var [categoryDimFields, setCategoryDimFields] = useState([])
  var [cateringStoreSubDeptId, setCateringStoreSubDeptId] = useState(null)
  var [packSizeQty, setPackSizeQty] = useState(seed?.pack_size_qty ?? '')
  var [packSizeUnit, setPackSizeUnit] = useState(seed?.pack_size_unit || 'Grams')
  var [packSizeBrand, setPackSizeBrand] = useState(seed?.brand || '')
  var [brandList, setBrandList] = useState([])
  var isEdit = !!item
  // Admin Edit: stock arriving now, kept as a batch of its own (stock_batches).
  // On save its qty goes on top of what is on hand and its venue split into
  // the allocations.
  var [showAddStock, setShowAddStock] = useState(false)
  // The item's stock batches (oldest first, with their venue splits), so
  // what is shown as its worth uses each batch's own rate.
  var [itemBatches, setItemBatches] = useState([])
  // Rates typed in for the item's batches (batch id → rupees as typed),
  // written to the batches on save. A batch saved before rates were kept
  // shows ₹0 until it is given one here.
  var [batchRateEdits, setBatchRateEdits] = useState({})
  var effBatches = itemBatches.map(function (b) {
    if (!Object.prototype.hasOwnProperty.call(batchRateEdits, b.id)) return b
    var v = batchRateEdits[b.id]
    return Object.assign({}, b, { rate_paise: v === '' || v == null ? null : Math.round(Number(v) * 100) })
  })
  var [newStockQty, setNewStockQty] = useState('')
  var [newStockRate, setNewStockRate] = useState('')
  var [newStockAllocs, setNewStockAllocs] = useState([{ venue_id: '', sub_venue_id: '', qty: '' }])

  function deriveSource(itm, cats, csSubDeptId) {
    if (itm?._source) return itm._source
    if (csSubDeptId && itm?.category_id) {
      var cat = cats.find(function (c) { return c.id === itm.category_id })
      if (cat?.sub_department_id === csSubDeptId) return 'catering_store'
    }
    return 'inventory'
  }

  useEffect(function () {
    loadLookups().then(function (lookups) {
      if (isEdit && item?.id) {
        var source = deriveSource(item, lookups.cats, lookups.csId)
        var allocTbl = source === 'catering_store' ? 'cs_venue_allocations' : 'venue_allocations'
        supabase.from('stock_batches')
          .select('id, qty, rate_paise, is_opening, created_at, stock_batch_allocations(venue_id, sub_venue_id, qty)')
          .eq('item_id', item.id).eq('item_source', source)
          .order('created_at', { ascending: true })
          .then(function (res) { setItemBatches(res.data || []) })
        supabase.from(allocTbl).select('venue_id, sub_venue_id, sub_department_id, qty').eq('item_id', item.id)
          .then(function (res) {
            var data = res.data || []
            if (data.length > 0) {
              setAllocations(data.map(function (va) {
                return { department: item.department || '', sub_department_id: va.sub_department_id ? String(va.sub_department_id) : '', venue_id: String(va.venue_id), sub_venue_id: va.sub_venue_id ? String(va.sub_venue_id) : '', qty: String(va.qty) }
              }))
            }
          })
      }
    })
  }, [])
  useEffect(function () {
    if (categoryId) {
      supabase.from('sub_categories').select('*').eq('category_id', Number(categoryId)).order('name')
        .then(function ({ data }) {
          var subs = data || []
          var isAdmin = hasPerm(profile?.permsNew, 'inventory.items')
          var userSubIds = profile?.sub_category_ids || []
          if (!isAdmin && userSubIds.length > 0) {
            subs = subs.filter(function (s) { return userSubIds.includes(s.id) })
          }
          setSubCategories(subs)
        })
    } else { setSubCategories([]); setSubCategoryId('') }
  }, [categoryId])
  useEffect(function () {
    if (!cateringStoreSubDeptId || !categoryId || !name.trim()) { setBrandList([]); return }
    var cat = categories.find(function (c) { return String(c.id) === categoryId })
    if (!cat || cat.sub_department_id !== cateringStoreSubDeptId) { setBrandList([]); return }
    supabase.from('catering_store_items')
      .select('brand')
      .eq('category_id', Number(categoryId))
      .ilike('name', name.trim())
      .eq('status', 'approved')
      .not('brand', 'is', null)
      .order('brand')
      .then(function (res) {
        var brands = [...new Set((res.data || []).map(function (r) { return r.brand }).filter(Boolean))].sort()
        setBrandList(brands)
      })
  }, [categoryId, cateringStoreSubDeptId, name])
  function searchItems(term) {
    if (itemSearchTimer.current) clearTimeout(itemSearchTimer.current)
    if (!term || term.length < 2) { setExistingItems([]); return }
    itemSearchTimer.current = setTimeout(function () {
      var searchTerm = term.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
      // Scope by sub-department of selected category (broaden beyond selected cat to sibling cats)
      var scopeCatIds = null
      if (categoryId) {
        var selCat = categories.find(function (c) { return String(c.id) === categoryId })
        if (selCat && selCat.sub_department_id) {
          scopeCatIds = categories.filter(function (c) { return c.sub_department_id === selCat.sub_department_id }).map(function (c) { return c.id })
        }
      }
      var invQ = supabase.from('inventory_items').select('id, name, name_hindi, unit, type, description, min_order_qty, reorder_qty, rate_paise, is_asset, department, dimensions, image_path, category_id, sub_category_id, status').ilike('name', '%' + searchTerm + '%').in('status', ['approved', 'pending', 'pending_dept'])
      var csQ = supabase.from('catering_store_items').select('id, name, name_hindi, unit, type, description, season_reorder_qty, off_season_reorder_qty, rate_paise, is_asset, department, brand, pack_size_qty, pack_size_unit, image_path, category_id, sub_category_id, status').ilike('name', '%' + searchTerm + '%').in('status', ['approved', 'pending', 'pending_dept'])
      if (scopeCatIds && scopeCatIds.length > 0) {
        invQ = invQ.in('category_id', scopeCatIds)
        csQ = csQ.in('category_id', scopeCatIds)
      }
      Promise.all([invQ.order('name').limit(20), csQ.order('name').limit(20)]).then(function (results) {
        var inv = (results[0].data || []).map(function (i) { return Object.assign({}, i, { _source: 'inventory' }) })
        var cs = (results[1].data || []).map(function (i) { return Object.assign({}, i, { _source: 'catering_store' }) })
        setExistingItems(inv.concat(cs))
      })
    }, 300)
  }
  useEffect(function () {
    if (categoryId) {
      if (categories.length === 0) return // categories still loading — don't wipe dimensions yet
      var cat = categories.find(function (c) { return String(c.id) === categoryId })
      var fields = cat?.dimension_fields || []
      setCategoryDimFields(fields)
      if (fields.length > 0) {
        setDimensionValues(function (prev) {
          var source = prev.length > 0 ? prev : (seed?.dimensions || [])
          return fields.map(function (f) {
            var fType = f.type || 'number'
            var existing = source.find(function (d) { return d.name === f.name })
            if (existing) {
              var merged = Object.assign({}, existing, { type: fType, options: f.options })
              // Migrate legacy: select/text values were stored in qty instead of value
              if ((fType === 'select' || fType === 'text') && !merged.value) {
                var effQ = merged.qty && merged.qty !== 'Pieces' ? merged.qty : ''
                var effU = merged.unit && merged.unit !== 'Pieces' ? merged.unit : ''
                merged.value = (effQ + (effU ? ' ' + effU : '')).trim()
              }
              return merged
            }
            if (fType === 'text') return { name: f.name, type: 'text', value: '' }
            if (fType === 'select') return { name: f.name, type: 'select', value: '', options: f.options || [] }
            return { name: f.name, type: 'number', qty: '', unit: 'Pieces' }
          })
        })
      } else { setDimensionValues([]) }
    } else { setCategoryDimFields([]); setDimensionValues([]) }
  }, [categoryId, categories])

  useEffect(function () {
    if (nameManual.current) return
    var genFields = categoryDimFields.filter(function (f) { return f.nameGen })
    if (genFields.length === 0) return
    var parts = []
    genFields.forEach(function (f) {
      var dim = dimensionValues.find(function (d) { return d.name === f.name })
      if (!dim) return
      var dimType = f.type || 'number'
      var val = ''
      if (dimType === 'number') { val = (dim.qty ? dim.qty + ' ' + (dim.unit || '') : '').trim() }
      else { val = (dim.value || '').trim() }
      if (val) parts.push(val)
    })
    if (parts.length > 0) { setName(parts.join(' ')); setHiEdited(false) }
  }, [subCategoryId, dimensionValues, categoryDimFields])

  async function loadLookups() {
    var [catRes, deptRes, subVenueRes, subDeptRes] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('departments').select('*').eq('active', true).eq('hide_from_lists', false).order('name'),
      supabase.from('sub_venues').select('id, name, venue_id').eq('active', true).order('name'),
      supabase.from('sub_departments').select('id, name, department_id, active').order('name')
    ])
    var allSubDepts = subDeptRes.data || []
    var cateringStoreId = (allSubDepts.find(function (s) { return s.name === 'Catering Store' }) || {}).id || null

   var allCats = filterUserCategories(catRes.data || [], profile)
    setCategories(allCats)
    setDepartments(deptRes.data || [])
    setSubVenues(subVenueRes.data || [])
    setSubDepartments(allSubDepts)
    setCateringStoreSubDeptId(cateringStoreId)
    return { cats: allCats, csId: cateringStoreId }
  }

  function updateAllocation(index, field, value) {
    setAllocations(function (prev) { return prev.map(function (row, i) { if (i !== index) return row; var updated = { ...row, [field]: value }; if (field === 'venue_id') updated.sub_venue_id = ''; if (field === 'department') updated.sub_department_id = ''; return updated }) })
  }
  useEffect(function () {
    if (showAllocations) return
    if (allocations.some(function (a) { return a.department || a.venue_id || a.qty })) setShowAllocations(true)
  }, [allocations])
  function addAllocationRow() {
    setAllocations(function (prev) { return prev.concat([{ department: '', sub_department_id: '', venue_id: '', sub_venue_id: '', qty: '' }]) })
  }
  function removeAllocationRow(index) { setAllocations(function (prev) { if (prev.length <= 1) return prev; return prev.filter(function (_, i) { return i !== index }) }) }
  function duplicateAllocationRow(index) {
    setAllocations(function (prev) {
      var src = prev[index]
      if (!src) return prev
      var dup = Object.assign({}, src, { qty: '' })
      return prev.concat([dup])
    })
  }

  function handleImageChange(e) {
    var file = e.target.files?.[0]; if (!file) return
    if (file.size > 20 * 1024 * 1024) { setErrors(function (prev) { return { ...prev, img: 'Too large (max 20MB)' } }); e.target.value = ''; return }
    setErrors(function (prev) { var n = { ...prev }; delete n.img; return n })
    var reader = new FileReader(); reader.onload = function (ev) { setCropSrc(ev.target.result) }; reader.readAsDataURL(file); e.target.value = ''
  }
  async function handleCropped(dataUrl) {
    var res = await fetch(dataUrl)
    var blob = await res.blob()
    var origFile = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
    var compressed = await prepUpload(origFile, 100)
    setImageFile(compressed)
    setImagePreview(URL.createObjectURL(compressed))
    setCropSrc(null)
  }
  function handleUseFull(dataUrl) { handleCropped(dataUrl) }
  function handleCropCancel() { setCropSrc(null) }
  function removeImage() { setImageFile(null); setImagePreview('') }

  function handleItemNameSelect(val) {
    setName(val); nameManual.current = !!val; if (!val) return
    var match = existingItems.find(function (i) { return i.name === val && i.status === 'approved' })
      || existingItems.find(function (i) { return i.name === val })
    var loadedHindi = false
    if (match) {
      // Fill category + sub-category from matched item
      if (match.category_id) setCategoryId(String(match.category_id))
      if (match.sub_category_id) setSubCategoryId(String(match.sub_category_id))

      // Metadata fields
      if (match.name_hindi) { setNameHindi(match.name_hindi); setHiEdited(true); loadedHindi = true }
      if (match.unit) setUnit(match.unit)
      if (match.type) setType(match.type)
      if (match.description) setDescription(match.description)
      if (match.is_asset && match.is_asset !== 'unknown') setIsAsset(match.is_asset)

      // Catering store fields
      if (match.brand) setPackSizeBrand(match.brand)
      if (match.pack_size_qty) setPackSizeQty(String(match.pack_size_qty))
      if (match.pack_size_unit) setPackSizeUnit(match.pack_size_unit)

      // Dimensions
      if (match.dimensions && Array.isArray(match.dimensions) && match.dimensions.length > 0) {
        setDimensionValues(match.dimensions)
      }

      // Image
      if (match.image_path) {
        setImagePreview(getImageUrl(match.image_path))
        setImageFile(null)
      }

      // Skip: qty, rate_paise, min_order_qty, reorder_qty, allocations
    }
    if (!hiEdited && !loadedHindi) {
      translateToHindi(val, function (translated) { if (translated) setNameHindi(translated) })
    }
  }

  function handleBrandSelect(brand) {
    var current = (packSizeBrand || '').toLowerCase()
    var isDeselect = brand.toLowerCase() === current
    if (isDeselect) { setPackSizeBrand(''); return }
    setPackSizeBrand(brand)

    // Find matching item: same name + same category + this brand
    var nameLower = (name || '').trim().toLowerCase()
    var match = existingItems.find(function (i) {
      return (i.name || '').toLowerCase() === nameLower && (i.brand || '').toLowerCase() === brand.toLowerCase()
    })
    if (!match) return

    // Populate all fields from matching item
    if (match.name_hindi) { setNameHindi(match.name_hindi); setHiEdited(true) }
    if (match.unit) setUnit(match.unit)
    if (match.type) setType(match.type)
    if (match.description) setDescription(match.description)
    var isApprovedMatch = match.status === 'approved'
    if (isApprovedMatch && match.rate_paise) setRatePaise(match.rate_paise / 100)
    if (match.is_asset && match.is_asset !== 'unknown') setIsAsset(match.is_asset)
    if (match.pack_size_qty) setPackSizeQty(String(match.pack_size_qty))
    if (match.pack_size_unit) setPackSizeUnit(match.pack_size_unit)
    if (isApprovedMatch && match.season_reorder_qty != null) setMinOrderQty(match.season_reorder_qty)
    if (isApprovedMatch && match.off_season_reorder_qty != null) setReorderQty(match.off_season_reorder_qty)

    // Load allocations — pre-fill venues, leave qty empty for user to enter
    if (match.id) {
      supabase.from('cs_venue_allocations').select('venue_id, sub_venue_id, sub_department_id, qty').eq('item_id', match.id)
        .then(function (res) {
          var data = res.data
          if (data && data.length > 0) {
            setAllocations(data.map(function (va) {
              return { department: match.department || allocations[0]?.department || '', sub_department_id: va.sub_department_id ? String(va.sub_department_id) : '', venue_id: String(va.venue_id), sub_venue_id: va.sub_venue_id ? String(va.sub_venue_id) : '', qty: '' }
            }))
          }
        })
    }
  }

  function startSpeech(fieldId) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) { alert('Speech not supported'); return }
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; setListeningField(null); return }
    var recognition = new SR(); recognition.lang = fieldId === 'nameHindi' ? 'hi-IN' : 'en-IN'; recognition.interimResults = false
    recognition.onresult = function (ev) { var transcript = ev.results[0][0].transcript; if (fieldId === 'description') { setDescription(function (prev) { return prev ? prev + ' ' + transcript : transcript }) } else if (fieldId === 'nameHindi') { setNameHindi(function (prev) { return prev ? prev + ' ' + transcript : transcript }) }; setListeningField(null); recognitionRef.current = null }
    recognition.onend = function () { setListeningField(null); recognitionRef.current = null }; recognition.onerror = function () { setListeningField(null); recognitionRef.current = null }
    recognitionRef.current = recognition; setListeningField(fieldId); recognition.start()
  }

  async function uploadImage(itemId, prefix) {
    if (!imageFile) return null
    var ext = imageFile.name.split('.').pop() || 'jpg'; var path = (prefix || 'inventory') + '/' + itemId + '_' + Date.now() + '.' + ext
    var { error } = await supabase.storage.from('images').upload(path, imageFile, { upsert: true })
    if (error) { setErrors(function (prev) { return { ...prev, img: 'Upload failed: ' + error.message } }); return null }
    return path
  }

  function validate() {
    var errs = {}
    if (!categoryId) errs.cat = 'Category is required'
    var hasNameGen = categoryDimFields.some(function (f) { return f.nameGen })
    var effectiveName = name.trim()
    if (!effectiveName && hasNameGen) {
      var parts = []
      categoryDimFields.filter(function (f) { return f.nameGen }).forEach(function (f) {
        var dim = dimensionValues.find(function (d) { return d.name === f.name })
        if (!dim) return
        var dimType = f.type || 'number'
        var val = ''
        if (dimType === 'number') { val = (dim.qty ? dim.qty + ' ' + (dim.unit || '') : '').trim() }
        else { val = (dim.value || '').trim() }
        if (val) parts.push(val)
      })
      if (parts.length > 0) {
        effectiveName = parts.join(' ')
        setName(effectiveName)
      }
    }
    if (!effectiveName) errs.item = 'Item name is required'
    // Optional in the admin Edit form (an empty quantity saves as 0).
    if (variant !== 'admin' && !qty && qty !== 0) errs.qty = 'Quantity is required'
    if (variant === 'admin') {
      var placedBase = allocations.reduce(function (sum, a) { return sum + (a.venue_id ? (Number(a.qty) || 0) : 0) }, 0)
      if (allocations.some(function (a) { return Number(a.qty) > 0 && !a.venue_id })) errs.alloc = 'Pick a venue for every row that has a quantity'
      else if (Math.round(placedBase * 1000) > Math.round((Number(qty) || 0) * 1000)) errs.alloc = 'Allocated ' + (Math.round(placedBase * 1000) / 1000) + ' is more than the quantity ' + (Number(qty) || 0)
    }
    if (isEdit) {
      var addQ = Number(newStockQty) || 0
      var nsAllocated = newStockAllocs.reduce(function (sum, a) { return sum + (Number(a.qty) || 0) }, 0)
      if (addQ < 0) errs.newStock = 'New quantity cannot be negative'
      else if (addQ === 0 && nsAllocated > 0) errs.newStock = 'Enter the new quantity first'
      else if (newStockAllocs.some(function (a) { return Number(a.qty) > 0 && !a.venue_id })) errs.newStock = 'Pick a venue for every row that has a quantity'
      else if (addQ > 0 && Math.round(nsAllocated * 1000) > Math.round(addQ * 1000)) errs.newStock = 'Allocated ' + (Math.round(nsAllocated * 1000) / 1000) + ' is more than the new quantity ' + addQ
    }
    resolvedNameRef.current = effectiveName
    setErrors(errs); return Object.keys(errs).length === 0
  }

  function resetForm() {
    setCategoryId(''); setSubCategoryId(''); setName(''); setDescription(''); setNameHindi(''); setQty(''); setUnit('Pieces'); nameManual.current = false
    setMinOrderQty(''); setReorderQty(''); setRatePaise(''); setIsAsset('unknown'); setType('Indoor')
    setImageFile(null); setImagePreview(''); setErrors({}); setAllocations([{ department: '', sub_department_id: '', venue_id: '', sub_venue_id: '', qty: '' }])
    setCropSrc(null); setHiEdited(false); setDimensionValues([]); setCategoryDimFields([])
    setPackSizeQty(''); setPackSizeUnit('Grams'); setPackSizeBrand(''); setBrandList([])
  }

  async function handleSubmit(e) {
    e.preventDefault(); if (saving) return; if (!validate()) return; setSaving(true)
    var effectiveName = resolvedNameRef.current || name.trim()
    var hindiName = nameHindi.trim()
    if (effectiveName && !hindiName) {
      hindiName = await new Promise(function (resolve) {
        var done = false
        translateToHindi(effectiveName, function (translated) {
          if (!done) { done = true; resolve(translated || '') }
        })
        setTimeout(function () { if (!done) { done = true; resolve('') } }, 3000)
      })
      if (hindiName) setNameHindi(hindiName)
    }
    var isCatStore = showPackSize
    var tableName = isCatStore ? 'catering_store_items' : 'inventory_items'
    var allocTable = isCatStore ? 'cs_venue_allocations' : 'venue_allocations'
    var itemRatePaise = ratePaise ? Math.round(Number(ratePaise) * 100) : null
    // New stock from the admin Edit form: added on top of what is on hand,
    // and its venue split added into the allocations saved below. Without a
    // rate of its own it takes the item's rate.
    var addQty = isEdit ? Math.round((Number(newStockQty) || 0) * 1000) / 1000 : 0
    var addAllocs = addQty > 0 ? newStockAllocs.filter(function (a) { return a.venue_id && Number(a.qty) > 0 }) : []
    // With batches, the item's own rate follows the newest stock: new stock
    // added now, else the latest batch. It is also what new stock without a
    // rate of its own is priced at.
    var latestBatchRate = effBatches.length > 0 ? effBatches[effBatches.length - 1].rate_paise : null
    // Batch rates typed in the form, in paise, for reconcile to write.
    var rateOverrides = {}
    Object.keys(batchRateEdits).forEach(function (id) {
      var v = batchRateEdits[id]
      rateOverrides[id] = v === '' || v == null ? null : Math.round(Number(v) * 100)
    })
    var addRatePaise = newStockRate ? Math.round(Number(newStockRate) * 100) : (latestBatchRate || itemRatePaise)
    var savedRatePaise = itemBatches.length > 0 ? ((addQty > 0 && addRatePaise) ? addRatePaise : (latestBatchRate || itemRatePaise)) : itemRatePaise
    var totalQty = Math.round(((Number(qty) || 0) + addQty) * 1000) / 1000
    var allocsForSave = allocations.map(function (a) { return Object.assign({}, a) })
    addAllocs.forEach(function (na) {
      var row = allocsForSave.find(function (a) { return String(a.venue_id) === String(na.venue_id) && String(a.sub_venue_id || '') === String(na.sub_venue_id || '') && !a.sub_department_id })
      if (row) row.qty = String(Math.round(((Number(row.qty) || 0) + Number(na.qty)) * 1000) / 1000)
      else allocsForSave.push({ department: '', sub_department_id: '', venue_id: String(na.venue_id), sub_venue_id: na.sub_venue_id ? String(na.sub_venue_id) : '', qty: String(na.qty) })
    })
    // Records a batch of stock arriving — qty, unit rate, when, who — and how
    // it was split across venues. Never blocks the save: a failed write, or
    // the tables not existing yet (migration 00059), is ignored.
    async function saveStockBatch(itemId, bQty, bRatePaise, bAllocs, isOpening) {
      var q = Math.round((Number(bQty) || 0) * 1000) / 1000
      if (!itemId || q <= 0) return
      try {
        var res = await supabase.from('stock_batches').insert({
          item_id: itemId,
          item_source: isCatStore ? 'catering_store' : 'inventory',
          qty: q,
          rate_paise: bRatePaise || null,
          is_opening: !!isOpening,
          added_by: profile?.id || null,
        }).select('id').single()
        if (res.error || !res.data) return
        var rows = (bAllocs || []).filter(function (a) { return a.venue_id && Number(a.qty) > 0 }).map(function (a) {
          return { batch_id: res.data.id, venue_id: Number(a.venue_id), sub_venue_id: a.sub_venue_id ? Number(a.sub_venue_id) : null, qty: Math.round(Number(a.qty) * 1000) / 1000 }
        })
        if (rows.length > 0) await supabase.from('stock_batch_allocations').insert(rows)
      } catch (_) {}
    }
    var cleanDims = dimensionValues.length > 0 ? dimensionValues.map(function (d) {
      var dt = d.type || 'number'
      if (dt === 'select' || dt === 'text') {
        var v = (d.value || '').toString().trim()
        if (!v || v.toLowerCase() === 'pieces') return null
        return { name: d.name, type: dt, value: v }
      }
      var q = (d.qty == null ? '' : String(d.qty)).trim()
      if (!q) return null
      var u = (d.unit || '').toString().trim()
      if (u.toLowerCase() === 'pieces') u = ''
      return { name: d.name, type: 'number', qty: q, unit: u }
    }).filter(function (x) { return x !== null }) : []
    if (cleanDims.length === 0) cleanDims = null
    var payload
    if (isCatStore) {
      payload = { name: effectiveName, category_id: Number(categoryId), sub_category_id: subCategoryId ? Number(subCategoryId) : null, type: type, qty: totalQty, unit: unit, description: description.trim() || null, name_hindi: hindiName || null, brand: packSizeBrand.trim() || null, pack_size_qty: packSizeQty ? Number(packSizeQty) : null, pack_size_unit: packSizeUnit, season_reorder_qty: minOrderQty ? Number(minOrderQty) : null, off_season_reorder_qty: reorderQty ? Number(reorderQty) : null, rate_paise: savedRatePaise, is_asset: isAsset, department: allocations[0]?.department || null, dimensions: cleanDims }
    } else {
      payload = { name: effectiveName, category_id: Number(categoryId), sub_category_id: subCategoryId ? Number(subCategoryId) : null, type: type, qty: totalQty, unit: unit, description: description.trim() || null, name_hindi: hindiName || null, min_order_qty: minOrderQty ? Number(minOrderQty) : null, reorder_qty: reorderQty ? Number(reorderQty) : null, rate_paise: savedRatePaise, is_asset: isAsset, department: allocations[0]?.department || null, dimensions: cleanDims }
    }
    if (!isEdit && profile?.id) { payload.submitted_by = profile.id }
    if (!isEdit) {
      var isAdminRole = hasPerm(profile?.permsNew, 'review.pending.approve')
      if (isCatStore) {
        // item_receipt keeps the two-stage flow: dept clears it, then admin
        // gives final approval — unchanged by the inventory single-stage change.
        if (prefill || isAdminRole) {
          payload.status = 'approved'
        } else {
          var catIdNum = Number(categoryId)
          var { data: hasDeptApprover } = await supabase.rpc('has_category_dept_approver', {
            p_category_id: catIdNum,
            p_exclude_id: profile.id,
          })
          var selfIsDeptApprover = hasPerm(profile?.permsNew, 'review.dept.approve') && (profile?.category_ids || []).includes(Number(categoryId))
          if (selfIsDeptApprover) {
            payload.status = 'pending'
            payload.dept_approved_by = profile.id
            payload.dept_approved_at = new Date().toISOString()
          } else if (hasDeptApprover) {
            payload.status = 'pending_dept'
          } else {
            payload.status = 'pending'
          }
        }
      } else {
        // inventory: single stage — the category dept head's approval is
        // final. A category with no dept head has no fallback approver, so
        // it auto-approves (see fn_is_inventory_dept_head / has_category_dept_approver).
        var isDeptHeadHere = profile?.role === 'dept. head'
          && hasPerm(profile?.permsNew, 'review.dept.approve')
          && (profile?.category_ids || []).includes(Number(categoryId))
        if (prefill || isAdminRole) {
          payload.status = 'approved'
        } else if (isDeptHeadHere) {
          payload.status = 'approved'
          payload.dept_approved_by = profile.id
          payload.dept_approved_at = new Date().toISOString()
          payload.reviewed_by = profile.id
          payload.reviewed_at = new Date().toISOString()
        } else {
          var catIdNum2 = Number(categoryId)
          var { data: hasDeptApprover2 } = await supabase.rpc('has_category_dept_approver', {
            p_category_id: catIdNum2,
            p_exclude_id: profile.id,
          })
          payload.status = hasDeptApprover2 ? 'pending_dept' : 'approved'
        }
      }
    }
    try {
      var imgPrefix = isCatStore ? 'catering-store' : 'inventory'
      if (isEdit) {
        // Check if name/key changed and would now match another approved item
        var mergeTarget = null
        if (item.status === 'approved') {
          var mergeQuery = supabase.from(tableName).select('id, qty, image_path').eq('name', payload.name).eq('category_id', payload.category_id).eq('status', 'approved').neq('id', item.id)
          if (payload.sub_category_id) { mergeQuery = mergeQuery.eq('sub_category_id', payload.sub_category_id) } else { mergeQuery = mergeQuery.is('sub_category_id', null) }
          if (isCatStore) {
            if (payload.brand) { mergeQuery = mergeQuery.eq('brand', payload.brand) } else { mergeQuery = mergeQuery.is('brand', null) }
            if (payload.pack_size_qty) { mergeQuery = mergeQuery.eq('pack_size_qty', payload.pack_size_qty) } else { mergeQuery = mergeQuery.is('pack_size_qty', null) }
            if (payload.pack_size_unit) { mergeQuery = mergeQuery.eq('pack_size_unit', payload.pack_size_unit) } else { mergeQuery = mergeQuery.is('pack_size_unit', null) }
          }
          var { data: mergeDup } = await mergeQuery.limit(1).maybeSingle()
          if (mergeDup) mergeTarget = mergeDup
        }

        if (mergeTarget) {
          // Bump the target's own qty by the edited item's qty BEFORE touching
          // allocations — this never happened before, so the allocation-vs-qty
          // trigger rejected the merge every time the target's existing qty
          // couldn't cover the incoming allocations, even though the merge
          // itself was legitimate. Mirrors the equivalent NEW-ITEM merge path
          // below (existing.qty + qty).
          var mergedQty = Math.round(((mergeTarget.qty || 0) + totalQty) * 1000) / 1000
          var { error: qtyBumpErr } = await supabase.from(tableName).update({ qty: mergedQty }).eq('id', mergeTarget.id)
          if (qtyBumpErr) throw new Error('Merge qty update failed: ' + qtyBumpErr.message)
          mergeTarget.qty = mergedQty

          // Gather all allocations to merge: form entries + any DB entries not in form
          var { data: dbAllocs } = await supabase.from(allocTable).select('*').eq('item_id', item.id)
          var { data: targetAllocs } = await supabase.from(allocTable).select('*').eq('item_id', mergeTarget.id)
          var formRows = allocsForSave.filter(function (a) { return a.venue_id && Number(a.qty) > 0 })
          // Build combined allocation list: start with form entries
          var allAllocsToMerge = formRows.map(function (a) { return { venue_id: Number(a.venue_id), sub_venue_id: a.sub_venue_id ? Number(a.sub_venue_id) : null, sub_department_id: a.sub_department_id ? Number(a.sub_department_id) : null, qty: Number(a.qty) } })
          // Add any DB allocations not covered by form (in case form didn't load them)
          ;(dbAllocs || []).forEach(function (da) {
            var inForm = allAllocsToMerge.some(function (fa) { return fa.venue_id === da.venue_id && (fa.sub_venue_id || null) === (da.sub_venue_id || null) && (fa.sub_department_id || null) === (da.sub_department_id || null) })
            if (!inForm) allAllocsToMerge.push({ venue_id: da.venue_id, sub_venue_id: da.sub_venue_id || null, sub_department_id: da.sub_department_id || null, qty: da.qty })
          })
          // Merge each into target
          for (var ai = 0; ai < allAllocsToMerge.length; ai++) {
            var nr = allAllocsToMerge[ai]
            if (!nr.qty || nr.qty <= 0) continue
            var match = (targetAllocs || []).find(function (ta) { return ta.venue_id === nr.venue_id && (ta.sub_venue_id || null) === (nr.sub_venue_id || null) && (ta.sub_department_id || null) === (nr.sub_department_id || null) })
            if (match) {
              var { error: updErr } = await supabase.from(allocTable).update({ qty: Math.round((match.qty + nr.qty) * 1000) / 1000 }).eq('id', match.id)
              if (updErr) throw new Error('Merge allocation update failed: ' + updErr.message)
            } else {
              var { error: insErr } = await supabase.from(allocTable).insert({ item_id: mergeTarget.id, venue_id: nr.venue_id, sub_venue_id: nr.sub_venue_id, sub_department_id: nr.sub_department_id, qty: nr.qty })
              if (insErr) throw new Error('Merge allocation insert failed: ' + insErr.message)
            }
          }
          // Keep image: if edited item has image and target doesn't, move it
          if (item.image_path && !mergeTarget.image_path) {
            await supabase.from(tableName).update({ image_path: item.image_path }).eq('id', mergeTarget.id)
          }
          if (imageFile) { var path = await uploadImage(mergeTarget.id, imgPrefix); if (path) await supabase.from(tableName).update({ image_path: path }).eq('id', mergeTarget.id) }
          // Delete the edited item + its old allocations
          await supabase.from(allocTable).delete().eq('item_id', item.id)
          await supabase.from(tableName).delete().eq('id', item.id)
          // Its stock arrives on the target as a batch, then any new stock.
          try { await supabase.from('stock_batches').delete().eq('item_id', item.id).eq('item_source', isCatStore ? 'catering_store' : 'inventory') } catch (_) {}
          await saveStockBatch(mergeTarget.id, Number(qty) || 0, itemRatePaise, allocations, false)
          await saveStockBatch(mergeTarget.id, addQty, addRatePaise, addAllocs, false)
          try { await logActivity('ITEM_EDIT_MERGE', payload.name + ' → merged into existing (qty +' + (Number(qty) || 0) + ')') } catch (_) {}
        } else {
          // No merge needed — standard update (qty first so allocation trigger passes)
          var { error: updateError } = await supabase.from(tableName).update(payload).eq('id', item.id)
          if (updateError) throw updateError
          await supabase.from(allocTable).delete().eq('item_id', item.id)
          var venueRows = allocsForSave.filter(function (a) { return a.venue_id && Number(a.qty) > 0 }).map(function (a) { return { item_id: item.id, venue_id: Number(a.venue_id), sub_venue_id: a.sub_venue_id ? Number(a.sub_venue_id) : null, sub_department_id: a.sub_department_id ? Number(a.sub_department_id) : null, qty: Number(a.qty) } })
          if (venueRows.length > 0) { var { error: vaErr } = await supabase.from(allocTable).insert(venueRows); if (vaErr) throw new Error('Allocation save failed: ' + vaErr.message) }
          await saveStockBatch(item.id, addQty, addRatePaise, addAllocs, false)
          await reconcileStockBatches(supabase, { itemId: item.id, itemSource: isCatStore ? 'catering_store' : 'inventory', finalQty: totalQty, finalAllocs: venueRows, ratePaise: itemRatePaise, userId: profile?.id, rateOverrides: rateOverrides })
          if (imageFile) { var path = await uploadImage(item.id, imgPrefix); if (path) await supabase.from(tableName).update({ image_path: path }).eq('id', item.id) }
        }
      }
      else {
        // NEW ITEM path
        var isAdminSubmit = payload.status === 'approved'
        var existing = null
        var targetItem = null

        // Only admin/auditor merges directly into existing approved items
        // Everyone else always creates a new pending row for review
        if (isAdminSubmit) {
          var matchQuery = supabase.from(tableName).select('id, qty, image_path').eq('name', payload.name).eq('category_id', payload.category_id).eq('status', 'approved')
          if (payload.sub_category_id) { matchQuery = matchQuery.eq('sub_category_id', payload.sub_category_id) } else { matchQuery = matchQuery.is('sub_category_id', null) }
          if (isCatStore) {
            if (payload.brand) { matchQuery = matchQuery.eq('brand', payload.brand) } else { matchQuery = matchQuery.is('brand', null) }
            if (payload.pack_size_qty) { matchQuery = matchQuery.eq('pack_size_qty', payload.pack_size_qty) } else { matchQuery = matchQuery.is('pack_size_qty', null) }
            if (payload.pack_size_unit) { matchQuery = matchQuery.eq('pack_size_unit', payload.pack_size_unit) } else { matchQuery = matchQuery.is('pack_size_unit', null) }
          }
          var { data: existingMatch } = await matchQuery.limit(1).maybeSingle()
          existing = existingMatch
        }

        if (existing) {
          // Admin merge: add qty + merge allocations into existing approved item
          var newQty = Math.round(((existing.qty || 0) + (Number(qty) || 0)) * 1000) / 1000
          var { error: updateErr } = await supabase.from(tableName).update({ qty: newQty }).eq('id', existing.id)
          if (updateErr) throw updateErr
          targetItem = { id: existing.id }
          if (imageFile) { var imgPath = await uploadImage(existing.id, imgPrefix); if (imgPath) await supabase.from(tableName).update({ image_path: imgPath }).eq('id', existing.id) }

          // Merge allocations
          var { data: oldAllocs, error: allocErr } = await supabase.from(allocTable).select('id, venue_id, sub_venue_id, sub_department_id, qty').eq('item_id', existing.id)
          if (allocErr) throw new Error('Failed to fetch allocations: ' + allocErr.message)
          var newVenueRows = allocations.filter(function (a) { return a.venue_id && Number(a.qty) > 0 })
          for (var ai = 0; ai < newVenueRows.length; ai++) {
            var nr = newVenueRows[ai]
            var nrVenueId = Number(nr.venue_id)
            var nrSubVenueId = nr.sub_venue_id ? Number(nr.sub_venue_id) : null
            var nrSubDeptId = nr.sub_department_id ? Number(nr.sub_department_id) : null
            var nrQty = Number(nr.qty)
            if (!nrQty || nrQty <= 0) continue
            var match = (oldAllocs || []).find(function (oa) { return oa.venue_id === nrVenueId && (oa.sub_venue_id || null) === nrSubVenueId && (oa.sub_department_id || null) === nrSubDeptId })
            if (match) {
              var { error: updErr } = await supabase.from(allocTable).update({ qty: Math.round((match.qty + nrQty) * 1000) / 1000 }).eq('id', match.id)
              if (updErr) throw new Error('Allocation update failed: ' + updErr.message)
            } else {
              var { error: insErr } = await supabase.from(allocTable).insert({ item_id: existing.id, venue_id: nrVenueId, sub_venue_id: nrSubVenueId, sub_department_id: nrSubDeptId, qty: nrQty })
              if (insErr) throw new Error('Allocation insert failed: ' + insErr.message)
            }
          }
          await saveStockBatch(existing.id, Number(qty) || 0, itemRatePaise, newVenueRows, false)
        } else {
          // Fresh insert — pending or approved depending on role
          var { data: newItem, error: insertError } = await supabase.from(tableName).insert(payload).select().single()
          if (insertError) throw insertError
          targetItem = newItem
          if (imageFile && newItem) { var imgPath = await uploadImage(newItem.id, imgPrefix); if (imgPath) await supabase.from(tableName).update({ image_path: imgPath }).eq('id', newItem.id) }

          // Insert allocations for the new row
          if (targetItem) {
            var venueRows = allocations.filter(function (a) { return a.venue_id && Number(a.qty) > 0 }).map(function (a) { return { item_id: targetItem.id, venue_id: Number(a.venue_id), sub_venue_id: a.sub_venue_id ? Number(a.sub_venue_id) : null, sub_department_id: a.sub_department_id ? Number(a.sub_department_id) : null, qty: Number(a.qty) } })
            if (venueRows.length > 0) { var { error: allocInsErr } = await supabase.from(allocTable).insert(venueRows); if (allocInsErr) throw new Error('Allocation save failed: ' + allocInsErr.message) }
            await saveStockBatch(targetItem.id, Number(qty) || 0, itemRatePaise, venueRows, true)
          }
        }
      }
      var logAction = isEdit ? 'ITEM_UPDATE' : 'ITEM_SUBMIT'
      var logDetail = effectiveName + ' | Cat: ' + (categories.find(function (c) { return String(c.id) === categoryId })?.name || '—') + ' | Qty: ' + (Number(qty) || 0)
      try { await logActivity(logAction, logDetail) } catch (_) {}
      onSaved(targetItem, tableName)
    } catch (err) { setErrors(function (prev) { return { ...prev, submit: err.message || 'Failed to save' } }) }
    setSaving(false)
  }

  // Rate × Quantity, in paise, the moment both are filled in.
  // What the quantity is worth: batch by batch at each batch's rate when the
  // item has batches, otherwise quantity × the rate field.
  var itemRateP = Number(ratePaise) > 0 ? Math.round(Number(ratePaise) * 100) : 0
  var rateTotalPaise = (function () {
    if (!(Number(qty) > 0)) return null
    var v = effBatches.length > 0 ? stockValuePaise(effBatches, Number(qty), itemRateP) : Math.round(Number(qty) * itemRateP)
    return v > 0 ? v : null
  })()
  // A venue's share priced at the rate of the batches it came from (the
  // item's rate where no batch has stock there yet).
  var rateAtPlace = placeRates(effBatches, itemRateP)
  // Which batches each venue's stock came from, at what rate.
  var partsAtPlace = {}
  effBatches.forEach(function (b, bi) {
    ;(b.stock_batch_allocations || []).forEach(function (x) {
      var q = Number(x.qty) || 0
      if (!x.venue_id || q <= 0) return
      var k = x.venue_id + '|' + (x.sub_venue_id || '')
      if (!partsAtPlace[k]) partsAtPlace[k] = []
      partsAtPlace[k].push({ n: bi + 1, q: q, rate: b.rate_paise || itemRateP })
    })
  })
  var latestRatePaise = effBatches.length > 0 ? (effBatches[effBatches.length - 1].rate_paise || itemRateP) : itemRateP
  function placeRateOf(row) {
    var k = (row.venue_id || '') + '|' + (row.sub_venue_id || '')
    return rateAtPlace[k] != null ? rateAtPlace[k] : itemRateP
  }
  // A place's value written out batch by batch: "₹36.00 + ₹40.00", or in
  // full "6 × ₹6.00 + 20 × ₹2.00".
  function placeParts(row) { return partsAtPlace[(row.venue_id || '') + '|' + (row.sub_venue_id || '')] || [] }
  function placeCalc(row) {
    return placeParts(row).map(function (pt) { return formatPaise(Math.round(pt.q * pt.rate)) }).join(' + ')
  }
  function placeCalcFull(row) {
    return placeParts(row).map(function (pt) { return pt.q + ' × ' + formatPaise(pt.rate) }).join(' + ')
  }
  function placeRateVaries(row) {
    var parts = partsAtPlace[(row.venue_id || '') + '|' + (row.sub_venue_id || '')] || []
    return parts.map(function (pt) { return pt.rate }).filter(function (r, i, arr) { return arr.indexOf(r) === i }).length > 1
  }
  function placeValuePaise(row) {
    var k = (row.venue_id || '') + '|' + (row.sub_venue_id || '')
    var rate = rateAtPlace[k] != null ? rateAtPlace[k] : itemRateP
    return Math.round((Number(row.qty) || 0) * rate)
  }
  // How much of the quantity is placed at a venue, said in the Allocations
  // header — 58 in stock with one row of 8 read as a mismatch when the
  // other 50 simply are not assigned anywhere.
  var allocPlaced = Math.round(allocations.reduce(function (sum, a) { return sum + (a.venue_id ? (Number(a.qty) || 0) : 0) }, 0) * 1000) / 1000
  var allocRest = Math.round(((Number(qty) || 0) - allocPlaced) * 1000) / 1000
  var allocHint = 'Where the stock is kept · ' + allocPlaced + ' of ' + (Number(qty) || 0) + ' ' + unit + ' placed'
    + (allocRest > 0 ? ', ' + allocRest + ' not assigned to a venue' : allocRest < 0 ? ', ' + (-allocRest) + ' more than in stock' : '')

  var catItems = categories.map(function (c) { return { label: c.name, value: String(c.id), pending: c.status === 'pending' } })
  var subCatItems = subCategories.map(function (s) { return { label: s.name, value: String(s.id), pending: s.status === 'pending' } })
  var itemNameItems = [...new Set(existingItems.map(function (i) { return i.name }))].map(function (n) { return { label: titleCase(n), value: n } })
  

  var showPackSize = (function () {
    if (!cateringStoreSubDeptId || !categoryId) return false
    var cat = categories.find(function (c) { return String(c.id) === categoryId })
    return cat?.sub_department_id === cateringStoreSubDeptId
  })()

  if (cropSrc) {
    return (
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{t('Crop Image')}</h3>
        <ImageCrop imageSrc={cropSrc} onCrop={handleCropped} onUseFull={handleUseFull} onCancel={handleCropCancel} />
      </div>
    )
  }

  // The admin Edit popup: photo beside what the item is, then stock and
  // pricing, allocations and dimensions, each in a card of its own, two
  // columns where the popup is wide enough (a container query on the form).
  if (variant === 'admin') {
    return (
      <form onSubmit={handleSubmit} className="@container space-y-4">
        {/* ═══ THE ITEM: photo beside what it is ═══ */}
        <FormSection icon="box" title={t('Item Details')}>
          <div className="grid gap-5 @2xl:grid-cols-[210px_minmax(0,1fr)]">
            {/* Photo */}
            <div>
              <label className={F_LBL}>{t('Photo')}</label>
              {!imagePreview ? (
                <div className="h-52 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-3 text-center">
                  <span className="w-11 h-11 rounded-xl bg-white border border-slate-200 text-slate-400 inline-flex items-center justify-center"><Icon name="camera" size={20} /></span>
                  <div className="flex gap-2">
                    <button type="button" onClick={function () { setCameraOpen(true) }}
                      className="inline-flex items-center gap-1.5 h-9 px-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
                      <Icon name="camera" size={14} />{t('Camera')}
                    </button>
                    <label className="inline-flex items-center gap-1.5 h-9 px-3 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                      <Icon name="gallery" size={14} />{t('Gallery')}<input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                    </label>
                  </div>
                  <p className="text-[11.5px] text-slate-500">{t('Photo Hint')}</p>
                </div>
              ) : (
                <div>
                  <div className="h-52 flex items-center justify-center p-2 rounded-xl border border-slate-200 bg-slate-50">
                    <img src={imagePreview} alt="Preview" className="max-w-full max-h-full rounded-lg object-contain shadow-[0_6px_16px_-8px_rgba(15,23,42,0.4)]" />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="inline-flex items-center justify-center gap-1.5 h-9 text-[13px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                      <Icon name="refresh" size={13} />Replace<input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                    </label>
                    <button type="button" onClick={removeImage}
                      className="inline-flex items-center justify-center gap-1.5 h-9 text-[13px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded-lg hover:bg-red-100 transition-colors">
                      <Icon name="trash" size={13} />Remove
                    </button>
                  </div>
                </div>
              )}
              {errors.img && <p className="text-xs text-red-500 mt-1">{errors.img}</p>}
            </div>

            {/* What it is */}
            <div className="min-w-0 space-y-3.5">
              <div>
                <label className={F_LBL}>{t('Type')}</label>
                <Segmented value={type} onChange={setType} options={[
                  { value: 'Indoor', label: 'Indoor', icon: 'home', on: 'bg-[#3B4668] text-white' },
                  { value: 'Outdoor', label: 'Outdoor', icon: 'leaf', on: 'bg-emerald-600 text-white' },
                  { value: 'Premium', label: 'Premium', icon: 'star', on: 'bg-amber-500 text-white' },
                ]} />
              </div>
              <SearchDropdown label={t('Existing Item Name')} required items={itemNameItems} value={name} onChange={handleItemNameSelect} allowAdd onAdd={function (val) { setName(val); nameManual.current = true }} placeholder={t('Search Existing Item Name...')} error={errors.item} onInputChange={searchItems} />
              <div className="grid gap-3.5 @2xl:grid-cols-2">
                <SearchDropdown label={t('Category')} required items={catItems} value={categoryId} onChange={setCategoryId} placeholder={t('Search Category...')} error={errors.cat} />
                <SearchDropdown label={t('Sub-Category')} items={subCatItems} value={subCategoryId} onChange={setSubCategoryId} placeholder={t('Search Sub-Category...')} />
              </div>
              <div>
                <label className={F_LBL}>{t('Item Name (Hindi)')}</label>
                <div className="flex gap-2">
                  <input type="text" value={nameHindi} onChange={function (e) { setNameHindi(e.target.value); setHiEdited(true) }} maxLength="200" placeholder="हिंदी नाम" className={F_INP + " flex-1 min-w-0"} />
                  <button type="button" onClick={function () { startSpeech('nameHindi') }} aria-label="Speak" title="Speak"
                    className={"shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-xl border transition-colors " + (listeningField === 'nameHindi' ? "bg-red-500 border-red-500 text-white animate-pulse" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50")}><Icon name="mic" size={16} /></button>
                </div>
              </div>
            </div>
          </div>

          {showPackSize && (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
              <h4 className="text-[12px] font-bold text-amber-800 uppercase tracking-[0.07em]">Pack Size</h4>
              <div>
                <label className={F_LBL}>Brand Name</label>
                {brandList.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {brandList.map(function (b) {
                      var isActive = (packSizeBrand || '').toLowerCase() === b.toLowerCase()
                      return (
                        <button key={b} type="button"
                          onClick={function () { handleBrandSelect(b) }}
                          className={"h-8 px-3 text-[12.5px] font-semibold rounded-lg border transition-colors " +
                            (isActive ? "border-amber-600 bg-amber-600 text-white" : "border-amber-200 text-amber-800 bg-white hover:bg-amber-50")}>
                          {b}
                        </button>
                      )
                    })}
                  </div>
                )}
                <input type="text" value={packSizeBrand}
                  onChange={function (e) { setPackSizeBrand(e.target.value) }}
                  maxLength="100" placeholder={brandList.length > 0 ? "Or type new brand..." : "e.g. MDH, Haldiram"}
                  className={F_INP} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={F_LBL}>Quantity</label>
                  <input type="number" min="0" step="any" inputMode="decimal" value={packSizeQty}
                    onChange={function (e) { setPackSizeQty(e.target.value) }}
                    placeholder="e.g. 500" className={F_INP} />
                </div>
                <div>
                  <label className={F_LBL}>Unit</label>
                  <select value={packSizeUnit} onChange={function (e) { setPackSizeUnit(e.target.value) }} className={F_INP}>
                    {UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4">
            <label className={F_LBL}>{t('Description')}</label>
            <div className="flex gap-2">
              <textarea value={description} onChange={function (e) { setDescription(e.target.value) }} rows="2" maxLength="1000" placeholder={t('Optional notes...')}
                className="flex-1 min-w-0 px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-900/10 resize-none" />
              <button type="button" onClick={function () { startSpeech('description') }} aria-label="Speak" title="Speak"
                className={"shrink-0 self-start w-11 h-11 inline-flex items-center justify-center rounded-xl border transition-colors " + (listeningField === 'description' ? "bg-red-500 border-red-500 text-white animate-pulse" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50")}><Icon name="mic" size={16} /></button>
            </div>
          </div>
        </FormSection>

        {/* ═══ PROPERTIES — label over field, two to a row ═══ */}
        {categoryDimFields.length > 0 && (
          <FormSection icon="list" title="Properties">
            <div className="grid gap-3.5 @2xl:grid-cols-2">
            {dimensionValues.map(function (dim, index) {
              var dimType = dim.type || 'number'
              function setDim(patch) { setDimensionValues(function (prev) { return prev.map(function (d, i) { if (i !== index) return d; return Object.assign({}, d, patch) }) }) }
              if (dimType === 'text') {
                return (
                  <div key={dim.name}>
                    <label className={F_LBL}>{dim.name}</label>
                    <input type="text" value={dim.value || ''} onChange={function (e) { setDim({ value: e.target.value }) }} placeholder={'Enter ' + dim.name + '...'} maxLength="500" className={F_INP} />
                  </div>
                )
              }
              if (dimType === 'select') {
                var dimOptItems = (dim.options || []).map(function (opt) { return { label: opt, value: opt } })
                return (
                  <div key={dim.name}>
                    <label className={F_LBL}>{dim.name}</label>
                    <SearchDropdown items={dimOptItems} value={dim.value || ''}
                      onChange={function (val) { setDim({ value: val }) }}
                      placeholder={'Search ' + dim.name + '...'} />
                  </div>
                )
              }
              return (
                <div key={dim.name}>
                  <label className={F_LBL}>{dim.name}</label>
                  <div className="flex gap-2">
                    <input type="number" min="0" step="any" inputMode="decimal" value={dim.qty} onChange={function (e) { setDim({ qty: e.target.value }) }} placeholder="0" aria-label={dim.name + ' quantity'} className={F_INP + " flex-1 min-w-0"} />
                    <select value={dim.unit} onChange={function (e) { setDim({ unit: e.target.value }) }} aria-label={dim.name + ' unit'} className={F_INP + " !w-32 shrink-0"}>
                      {UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
                    </select>
                  </div>
                </div>
              )
            })}
            </div>
          </FormSection>
        )}

        {/* ═══ STOCK & PRICING ═══ */}
        <FormSection icon="rupee" title="Stock & pricing">
          <div className={"grid grid-cols-2 gap-3 " + (itemBatches.length > 0 ? "@2xl:grid-cols-3" : "@2xl:grid-cols-4")}>
            <div>
              <label className={F_LBL}>{t('Quantity')}</label>
              {/* Editable for corrections. A change typed here is not a batch
                  — new stock arriving goes through Add new stock below, which
                  keeps its rate and venue split; the breakdown notes any gap. */}
              <input type="number" min="0" max="999999" step="any" inputMode="numeric" value={qty} onChange={function (e) { setQty(e.target.value) }} placeholder="0"
                className={F_INP + (errors.qty ? " border-red-300" : "")} />
              {errors.qty && <p className="text-xs text-red-500 mt-1">{errors.qty}</p>}
            </div>
            <div>
              <label className={F_LBL}>{t('Unit')}</label>
              <select value={unit} onChange={function (e) { setUnit(e.target.value) }} className={F_INP}>
                {UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
              </select>
            </div>
            {/* With batches the rate is theirs, not one number — each batch's
                rate is shown in the allocation list below — so the field only
                appears for an item with no batches yet. The rate of new stock
                is entered in Add new stock. */}
            {itemBatches.length === 0 && (
              <div>
                <label className={F_LBL}>{t('Rate') + ' (₹)'}</label>
                <input type="number" min="0" step="any" inputMode="decimal" value={ratePaise} onChange={function (e) { setRatePaise(e.target.value) }} placeholder="—" className={F_INP} />
              </div>
            )}
            <div>
              <label className={F_LBL}>Total (₹)</label>
              <div className={F_INP + " flex items-center bg-slate-50 font-semibold tabular-nums " + (rateTotalPaise != null ? "text-slate-900" : "text-slate-400")}>
                {rateTotalPaise != null ? formatPaise(rateTotalPaise) : '—'}
              </div>
            </div>
          </div>
          {/* Batch rates: each batch's unit rate, editable — a batch saved
              before rates were kept has none (₹0) until it is given one. */}
          {itemBatches.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.07em] text-slate-500">Batch rates</p>
              <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                {effBatches.map(function (b, bi) {
                  var bq = Number(b.qty) || 0
                  var missing = !b.rate_paise
                  var typed = Object.prototype.hasOwnProperty.call(batchRateEdits, b.id) ? batchRateEdits[b.id] : (itemBatches[bi].rate_paise ? String(itemBatches[bi].rate_paise / 100) : '')
                  return (
                    <div key={b.id} className={"flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5 " + (missing ? "bg-amber-50/60" : "")}>
                      <span className="flex-1 min-w-[160px]">
                        <span className="block text-[13px] font-semibold text-slate-800">Batch {bi + 1} · {b.is_opening ? 'Opening stock' : 'New stock'}</span>
                        <span className="block text-[11.5px] text-slate-500 tabular-nums">{bq} {unit} · {new Date(b.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      </span>
                      <label className="flex items-center gap-1.5">
                        <span className="text-[12px] font-semibold text-slate-500">Rate ₹</span>
                        <input type="number" min="0" step="any" inputMode="decimal" value={typed} placeholder="0"
                          onChange={function (e) { var v = e.target.value; setBatchRateEdits(function (prev) { var n = Object.assign({}, prev); n[b.id] = v; return n }) }}
                          className={"w-24 h-9 px-2.5 bg-white border rounded-lg text-[14px] font-semibold text-slate-900 tabular-nums focus:outline-none focus:ring-4 focus:ring-[#3B4668]/10 " + (missing ? "border-amber-300" : "border-slate-300 focus:border-[#A9B1CB]")} />
                      </label>
                      <span className={"w-[104px] text-right text-[14px] font-bold tabular-nums " + (missing ? "text-amber-700" : "text-slate-900")}>
                        {missing ? 'Rate missing' : formatPaise(Math.round(bq * b.rate_paise))}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {/* Where the quantity above is kept: the item's venue allocations,
              filled in from what is saved, edited the same way as a new stock
              split — venue, sub-venue, qty and its value at the item's rate. */}
          {(function () {
            var onHandQ = Number(qty) || 0
            var placedQ = Math.round(allocations.reduce(function (sum, a) { return sum + (a.venue_id ? (Number(a.qty) || 0) : 0) }, 0) * 1000) / 1000
            var restQ = Math.round((onHandQ - placedQ) * 1000) / 1000
            function removeAt(i) {
              if (allocations.length <= 1) setAllocations([{ department: '', sub_department_id: '', venue_id: '', sub_venue_id: '', qty: '' }])
              else removeAllocationRow(i)
            }
            // Shown once there is a quantity to place: open rows like the Add
            // new stock split for first-time stock (no batches yet), the
            // numbered list with each place's batches for stock that has them.
            if (onHandQ <= 0 && !errors.alloc) return null
            // First-time stock (no batches yet): the same open rows as the Add
            // new stock split — venue, sub-venue, qty and total — rather than
            // a folded list that opens on an empty "Incomplete" line.
            if (itemBatches.length === 0) {
              return (
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-[12px] font-bold uppercase tracking-[0.07em] text-slate-500">Allocate to venues</p>
                    <span className={"text-[12.5px] font-semibold tabular-nums " + (restQ < 0 ? "text-red-600" : restQ === 0 ? "text-emerald-700" : "text-slate-500")}>
                      {placedQ} of {onHandQ} allocated{restQ > 0 ? ' · ' + restQ + ' left' : restQ < 0 ? ' · ' + (-restQ) + ' too many' : ''}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {allocations.map(function (r, i) {
                      var svs = r.venue_id ? subVenues.filter(function (sv) { return String(sv.venue_id) === String(r.venue_id) }) : []
                      return (
                        <div key={i} className="grid gap-2.5 items-end rounded-xl border border-slate-200 bg-slate-50/70 p-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_130px_44px]">
                          <div className={svs.length > 0 ? "" : "@2xl:col-span-2"}>
                            <SearchDropdown label="Venue" items={venues.map(function (v) { return { label: v.code + ' — ' + v.name, value: String(v.id) } })} value={r.venue_id} onChange={function (val) { updateAllocation(i, 'venue_id', val) }} placeholder="Select venue..." />
                          </div>
                          {svs.length > 0 && <SearchDropdown label="Sub-venue" items={svs.map(function (sv) { return { label: sv.name, value: String(sv.id) } })} value={r.sub_venue_id} onChange={function (val) { updateAllocation(i, 'sub_venue_id', val) }} placeholder="Select sub-venue..." />}
                          <div>
                            <label className={F_LBL}>Qty</label>
                            <input type="number" min="0" step="any" inputMode="decimal" value={r.qty} onChange={function (e) { updateAllocation(i, 'qty', e.target.value) }} placeholder="0" className={F_INP} />
                          </div>
                          <div>
                            <label className={F_LBL}>Total</label>
                            <div className={F_INP + " flex items-center bg-white font-semibold tabular-nums " + (placeValuePaise(r) > 0 ? "text-slate-900" : "text-slate-400")}>
                              {placeValuePaise(r) > 0 ? formatPaise(placeValuePaise(r)) : '—'}
                            </div>
                          </div>
                          <button type="button" onClick={function () { removeAt(i) }} aria-label="Remove row" title="Remove"
                            className="h-11 w-11 inline-flex items-center justify-center rounded-xl text-red-500 hover:bg-red-50 transition-colors">
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <button type="button" onClick={addAllocationRow}
                    className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold text-[#333D5E] bg-[#EDEFF5] hover:bg-[#E3E6F0] transition-colors">
                    <Icon name="plus" size={14} />Add venue
                  </button>
                  {errors.alloc && <p className="mt-2 text-xs font-medium text-red-600">{errors.alloc}</p>}
                </div>
              )
            }
            return (
              <div className="mt-5 pt-4 border-t border-slate-100">
                {/* The list view: one numbered line per place with its qty and
                    value; the line being edited opens in place. */}
                <AllocationRows
                  allocations={allocations}
                  accent="gray"
                  bare
                  startCollapsed
                  title="Allocations"
                  heading={
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-bold uppercase tracking-[0.07em] text-slate-600">Allocate to venues</span>
                      <span className={"inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[12px] font-semibold tabular-nums " +
                        (restQ < 0 ? "bg-red-50 text-red-700 ring-1 ring-red-200" : restQ === 0 ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-1 ring-amber-200")}>
                        {restQ === 0 && <Icon name="check" size={12} />}
                        {placedQ} of {onHandQ} allocated{restQ > 0 ? ' \u00b7 ' + restQ + ' left' : restQ < 0 ? ' \u00b7 ' + (-restQ) + ' too many' : ''}
                      </span>
                    </div>
                  }
                  onAdd={addAllocationRow}
                  onRemove={removeAt}
                  onDuplicate={duplicateAllocationRow}
                  isComplete={function (a) { return !!a.venue_id && !!a.qty && Number(a.qty) > 0 }}
                  renderChip={function (a) {
                    var v = a.venue_id ? venues.find(function (x) { return String(x.id) === String(a.venue_id) }) : null
                    var sv = a.sub_venue_id && v ? subVenues.find(function (x) { return String(x.id) === String(a.sub_venue_id) }) : null
                    var rq = Number(a.qty) || 0
                    return {
                      left: (
                        <span className="flex flex-col min-w-0 gap-1">
                          <span className="flex items-center gap-2 min-w-0">
                            {v && <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#EDEFF5] text-[10px] font-bold text-[#333D5E] shrink-0">{v.code}</span>}
                            {sv
                              ? <span className="font-medium text-slate-800 truncate">{sv.name}</span>
                              : v && <span className="text-slate-500 truncate">{v.name}</span>}
                          </span>
                          {/* The batches this place holds, each at its rate. */}
                          {(partsAtPlace[(a.venue_id || '') + '|' + (a.sub_venue_id || '')] || []).length > 0 && (
                            <span className="flex flex-wrap gap-1">
                              {partsAtPlace[(a.venue_id || '') + '|' + (a.sub_venue_id || '')].map(function (pt, pi) {
                                // The newest batch is marked, once there is more than one.
                                var isNewest = itemBatches.length > 1 && pt.n === itemBatches.length
                                return (
                                  <span key={pi} className={"inline-flex items-center h-5 px-1.5 rounded text-[11px] tabular-nums " + (isNewest ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-600")}>
                                    {isNewest && <span className="mr-1 px-1 rounded-sm bg-emerald-600 text-white text-[9.5px] font-extrabold uppercase tracking-[0.06em] leading-[14px]">New</span>}
                                    <b className="font-semibold text-slate-700 mr-1">Batch {pt.n}</b>{pt.q} × {formatPaise(pt.rate)} = <b className="font-semibold text-slate-800 ml-1">{formatPaise(Math.round(pt.q * pt.rate))}</b>
                                  </span>
                                )
                              })}
                            </span>
                          )}
                        </span>
                      ),
                      right: (
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-slate-100 text-[13px] font-bold text-slate-900 tabular-nums">{rq} <span className="text-[11px] font-semibold text-slate-500">{unit}</span></span>
                          <span className="hidden sm:inline text-[12px] font-semibold text-slate-500 tabular-nums">{placeRateVaries(a) ? placeCalc(a) : '× ' + formatPaise(Math.round(placeRateOf(a)))}</span>
                          <span className="inline-block w-[96px] text-right text-[13.5px] font-bold text-slate-900 tabular-nums">{placeValuePaise(a) > 0 ? formatPaise(placeValuePaise(a)) : '\u2014'}</span>
                        </span>
                      ),
                    }
                  }}
                  renderExpanded={function (r, i) {
                    var svs = r.venue_id ? subVenues.filter(function (sv) { return String(sv.venue_id) === String(r.venue_id) }) : []
                    var rq = Number(r.qty) || 0
                    return (
                      <div className="grid gap-2.5 items-end @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_130px]">
                        {/* With no sub-venues to pick, the venue takes both
                            columns rather than leaving a gap before the qty. */}
                        <div className={svs.length > 0 ? "" : "@2xl:col-span-2"}>
                          <SearchDropdown label="Venue" required items={venues.map(function (v) { return { label: v.code + ' — ' + v.name, value: String(v.id) } })} value={r.venue_id} onChange={function (val) { updateAllocation(i, 'venue_id', val) }} placeholder="Select venue..." />
                        </div>
                        {svs.length > 0 && <SearchDropdown label="Sub-venue" items={svs.map(function (sv) { return { label: sv.name, value: String(sv.id) } })} value={r.sub_venue_id} onChange={function (val) { updateAllocation(i, 'sub_venue_id', val) }} placeholder="Select sub-venue..." />}
                        <div>
                          <label className={F_LBL}>Qty</label>
                          <input type="number" min="0" step="any" inputMode="decimal" value={r.qty} onChange={function (e) { updateAllocation(i, 'qty', e.target.value) }} placeholder="0" className={F_INP} />
                        </div>
                        <div>
                          <label className={F_LBL}>Total</label>
                          <div className={F_INP + " flex items-center bg-white font-semibold tabular-nums " + (placeValuePaise(r) > 0 ? "text-slate-900" : "text-slate-400")}>
                            {placeValuePaise(r) > 0 ? formatPaise(placeValuePaise(r)) : '—'}
                          </div>
                          {placeRateOf(r) > 0 && <p className="mt-1 text-[11.5px] text-slate-500 tabular-nums">{placeRateVaries(r) ? placeCalcFull(r) : 'at ' + formatPaise(Math.round(placeRateOf(r))) + ' each'}</p>}
                        </div>
                      </div>
                    )
                  }}
                />
                {errors.alloc && <p className="mt-2 text-xs font-medium text-red-600">{errors.alloc}</p>}
              </div>
            )
          })()}
          {/* Add new stock: a button under the quantity; it opens the new
              qty, its unit rate and total, and its split across venues. */}
        {isEdit && !showAddStock && (
          <button type="button" onClick={function () { setShowAddStock(true) }}
            className="mt-4 inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-[13.5px] font-semibold text-white bg-[#3B4668] shadow-[0_4px_12px_-4px_rgba(59,70,104,0.55)] hover:bg-[#2F3854] transition-colors">
            <Icon name="plus" size={15} />Add new stock
          </button>
        )}
        {isEdit && showAddStock && (function () {
          var onHand = Number(qty) || 0
          var addQ = Number(newStockQty) || 0
          var rateN = Number(newStockRate) || (latestRatePaise ? latestRatePaise / 100 : 0)
          var allocated = Math.round(newStockAllocs.reduce(function (sum, a) { return sum + (Number(a.qty) || 0) }, 0) * 1000) / 1000
          var remaining = Math.round((addQ - allocated) * 1000) / 1000
          function setRow(i, patch) {
            setNewStockAllocs(function (prev) {
              return prev.map(function (r, j) {
                if (j !== i) return r
                var u = Object.assign({}, r, patch)
                if (patch.venue_id !== undefined) u.sub_venue_id = ''
                return u
              })
            })
          }
          function cancelAdd() {
            setNewStockQty(''); setNewStockRate(''); setNewStockAllocs([{ venue_id: '', sub_venue_id: '', qty: '' }])
            setErrors(function (prev) { var n = Object.assign({}, prev); delete n.newStock; return n })
            setShowAddStock(false)
          }
          function removeRow(i) {
            setNewStockAllocs(function (prev) {
              if (prev.length <= 1) return [{ venue_id: '', sub_venue_id: '', qty: '' }]
              return prev.filter(function (_, j) { return j !== i })
            })
          }
          return (
            <div className="mt-4 rounded-xl border border-[#D8DCE8] bg-[#F6F7FB] p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold uppercase tracking-[0.07em] text-slate-900">Add new stock</p>
                  <p className="text-[12px] text-slate-500">{'Now ' + onHand + ' ' + unit + (addQ > 0 ? ' \u00b7 after save ' + (Math.round((onHand + addQ) * 1000) / 1000) + ' ' + unit : '')}</p>
                </div>
                <button type="button" onClick={cancelAdd}
                  className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[12.5px] font-semibold text-slate-600 hover:bg-white hover:text-slate-900 transition-colors">
                  <Icon name="close" size={13} />Cancel
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3">
                <div>
                  <label className={F_LBL}>New quantity</label>
                  <input type="number" min="0" step="any" inputMode="decimal" value={newStockQty} onChange={function (e) { setNewStockQty(e.target.value) }} placeholder="0" className={F_INP} />
                </div>
                <div>
                  <label className={F_LBL}>Unit rate (₹)</label>
                  <input type="number" min="0" step="any" inputMode="decimal" value={newStockRate} onChange={function (e) { setNewStockRate(e.target.value) }} placeholder={latestRatePaise ? String(latestRatePaise / 100) : '—'} className={F_INP} />
                </div>
                <div className="col-span-2 @2xl:col-span-1">
                  <label className={F_LBL}>Total (₹)</label>
                  <div className={F_INP + " flex items-center bg-slate-50 font-semibold tabular-nums " + (addQ > 0 && rateN > 0 ? "text-slate-900" : "text-slate-400")}>
                    {addQ > 0 && rateN > 0 ? formatPaise(Math.round(addQ * rateN * 100)) : '—'}
                  </div>
                </div>
              </div>

              {addQ > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-[12px] font-bold uppercase tracking-[0.07em] text-slate-500">Allocate to venues</p>
                    <span className={"text-[12.5px] font-semibold tabular-nums " + (remaining < 0 ? "text-red-600" : remaining === 0 ? "text-emerald-700" : "text-slate-500")}>
                      {allocated} of {addQ} allocated{remaining > 0 ? ' \u00b7 ' + remaining + ' left' : remaining < 0 ? ' \u00b7 ' + (-remaining) + ' too many' : ''}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {newStockAllocs.map(function (r, i) {
                      var svs = r.venue_id ? subVenues.filter(function (sv) { return String(sv.venue_id) === String(r.venue_id) }) : []
                      var rq = Number(r.qty) || 0
                      return (
                        <div key={i} className="grid gap-2.5 items-end rounded-xl border border-slate-200 bg-white p-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_130px_44px]">
                          <SearchDropdown label="Venue" items={venues.map(function (v) { return { label: v.code + ' \u2014 ' + v.name, value: String(v.id) } })} value={r.venue_id} onChange={function (val) { setRow(i, { venue_id: val }) }} placeholder="Select venue..." />
                          {svs.length > 0
                            ? <SearchDropdown label="Sub-venue" items={svs.map(function (sv) { return { label: sv.name, value: String(sv.id) } })} value={r.sub_venue_id} onChange={function (val) { setRow(i, { sub_venue_id: val }) }} placeholder="Select sub-venue..." />
                            : <div className="hidden @2xl:block" />}
                          <div>
                            <label className={F_LBL}>Qty</label>
                            <input type="number" min="0" step="any" inputMode="decimal" value={r.qty} onChange={function (e) { setRow(i, { qty: e.target.value }) }} placeholder="0" className={F_INP} />
                          </div>
                          <div>
                            <label className={F_LBL}>Total</label>
                            <div className={F_INP + " flex items-center bg-slate-50 font-semibold tabular-nums " + (rq > 0 && rateN > 0 ? "text-slate-900" : "text-slate-400")}>
                              {rq > 0 && rateN > 0 ? formatPaise(Math.round(rq * rateN * 100)) : '—'}
                            </div>
                          </div>
                          <button type="button" onClick={function () { removeRow(i) }} aria-label="Remove row" title="Remove"
                            className="h-11 w-11 inline-flex items-center justify-center rounded-xl text-red-500 hover:bg-red-50 transition-colors">
                            <Icon name="trash" size={15} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <button type="button" onClick={function () { setNewStockAllocs(function (prev) { return prev.concat([{ venue_id: '', sub_venue_id: '', qty: '' }]) }) }}
                    className="mt-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold text-[#333D5E] bg-[#EDEFF5] hover:bg-[#E3E6F0] transition-colors">
                    <Icon name="plus" size={14} />Add venue
                  </button>
                </div>
              )}
              {errors.newStock && <p className="mt-2 text-xs font-medium text-red-600">{errors.newStock}</p>}
            </div>
          )
        })()}
        </FormSection>


        {/* ═══ ADDITIONAL DETAILS — the least-checked settings, at the
            very bottom of the form rather than crowding Stock & pricing */}
        <FormSection icon="settings" title="Additional Details">
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3">
            <div>
              <label className={F_LBL + " truncate"}>{showPackSize ? 'Season Reorder Qty' : t('Min Order Qty')}</label>
              <input type="number" min="0" step="any" inputMode="numeric" value={minOrderQty} onChange={function (e) { setMinOrderQty(e.target.value) }} placeholder="—" className={F_INP} />
            </div>
            <div>
              <label className={F_LBL + " truncate"}>{showPackSize ? 'Off Season Reorder Qty' : t('Reorder Qty')}</label>
              <input type="number" min="0" step="any" inputMode="numeric" value={reorderQty} onChange={function (e) { setReorderQty(e.target.value) }} placeholder="—" className={F_INP} />
            </div>
            <div className="col-span-2 @2xl:col-span-1">
              <label className={F_LBL}>{t('Is Asset?')}</label>
              <Segmented value={isAsset} onChange={setIsAsset} options={[
                { value: 'yes', label: t('Yes'), on: 'bg-emerald-600 text-white' },
                { value: 'no', label: t('No'), on: 'bg-red-500 text-white' },
                { value: 'unknown', label: t('Dont Know'), on: 'bg-slate-600 text-white' },
              ]} />
            </div>
          </div>
        </FormSection>

        {/* ═══ SUBMIT AREA ═══ */}
        {errors.submit && (
          <div className="flex items-start gap-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
            <Icon name="alert" size={16} className="shrink-0 mt-0.5" />{errors.submit}
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-end pt-4 border-t border-slate-200">
          {!isEdit && <button type="button" onClick={resetForm} className="mr-auto inline-flex items-center gap-1.5 h-11 px-4 text-sm font-semibold text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"><Icon name="undo" size={14} />{t('Reset')}</button>}
          <button type="button" onClick={onClose} className="h-11 px-5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors">{t('Cancel')}</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 h-11 px-6 text-sm font-semibold text-white bg-[#3B4668] rounded-xl shadow-[0_4px_12px_-4px_rgba(59,70,104,0.55)] hover:bg-[#2F3854] disabled:opacity-50 transition-colors"><Icon name="check" size={15} />{saving ? t('Saving...') : (isEdit ? t('Update Item') : t('Submit Item'))}</button>
        </div>

        {cameraOpen && (
          <CameraCapture
            onCapture={function (file) { setCameraOpen(false); handleImageChange({ target: { files: [file], value: '' } }) }}
            onClose={function () { setCameraOpen(false) }}
          />
        )}
      </form>
    )
  }

  // The phone app, and every other place this form opens (Purchase
  // receiving, Item Receipts, Reviews): one column, built from the same
  // pieces as the admin layout above — icon buttons instead of emoji, filled
  // segmented controls, a photo you can Replace or Remove once it is taken.
  return (
    <form onSubmit={handleSubmit} className="space-y-3.5">
      <FormSection icon="camera" title={t('Photo')}>
        {!imagePreview ? (
          <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 py-7 px-4 text-center">
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white border border-slate-200 text-slate-400 mb-3"><Icon name="camera" size={22} /></span>
            <div className="flex gap-2 justify-center mb-2.5">
              <button type="button" onClick={function () { setCameraOpen(true) }}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 text-[13.5px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors">
                <Icon name="camera" size={15} />{t('Camera')}
              </button>
              <label className="inline-flex items-center gap-1.5 h-10 px-3.5 text-[13.5px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                <Icon name="gallery" size={15} />{t('Gallery')}<input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              </label>
            </div>
            <p className="text-[12px] text-slate-500">{t('Photo Hint')}</p>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-center p-2 rounded-xl border border-slate-200 bg-slate-50" style={{ height: 200 }}>
              <img src={imagePreview} alt="Preview" className="max-w-full max-h-full rounded-lg object-contain shadow-[0_6px_16px_-8px_rgba(15,23,42,0.4)]" />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <label className="inline-flex items-center justify-center gap-1.5 h-10 text-[13.5px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                <Icon name="refresh" size={14} />{t('Replace') || 'Replace'}<input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              </label>
              <button type="button" onClick={removeImage}
                className="inline-flex items-center justify-center gap-1.5 h-10 text-[13.5px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl hover:bg-red-100 transition-colors">
                <Icon name="trash" size={14} />{t('Remove') || 'Remove'}
              </button>
            </div>
          </div>
        )}
        {errors.img && <p className="text-xs text-red-500 mt-1.5">{errors.img}</p>}
      </FormSection>

      <FormSection icon="box" title={t('Item Details')}>
        <div className="space-y-3.5">
          <div>
            <label className={F_LBL}>{t('Type')}</label>
            <Segmented value={type} onChange={setType} options={[
              { value: 'Indoor', label: 'Indoor', icon: 'home', on: 'bg-[#3B4668] text-white' },
              { value: 'Outdoor', label: 'Outdoor', icon: 'leaf', on: 'bg-emerald-600 text-white' },
              { value: 'Premium', label: 'Premium', icon: 'star', on: 'bg-amber-500 text-white' },
            ]} />
          </div>
          <SearchDropdown label={t('Existing Item Name')} required items={itemNameItems} value={name} onChange={handleItemNameSelect} allowAdd onAdd={function (val) { setName(val); nameManual.current = true }} placeholder={t('Search Existing Item Name...')} error={errors.item} onInputChange={searchItems} />
          <SearchDropdown label={t('Category')} required items={catItems} value={categoryId} onChange={setCategoryId} placeholder={t('Search Category...')} error={errors.cat} />
          <SearchDropdown label={t('Sub-Category')} items={subCatItems} value={subCategoryId} onChange={setSubCategoryId} placeholder={t('Search Sub-Category...')} />

          {showPackSize && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 space-y-3">
              <h4 className="text-[12px] font-bold text-amber-800 uppercase tracking-[0.07em]">Pack Size</h4>
              <div>
                <label className={F_LBL}>Brand Name</label>
                {brandList.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {brandList.map(function (b) {
                      var isActive = (packSizeBrand || '').toLowerCase() === b.toLowerCase()
                      return (
                        <button key={b} type="button"
                          onClick={function () { handleBrandSelect(b) }}
                          className={"h-8 px-3 text-[12.5px] font-semibold rounded-lg border transition-colors " +
                            (isActive ? "border-amber-600 bg-amber-600 text-white" : "border-amber-200 text-amber-800 bg-white hover:bg-amber-50")}>
                          {b}
                        </button>
                      )
                    })}
                  </div>
                )}
                <input type="text" value={packSizeBrand}
                  onChange={function (e) { setPackSizeBrand(e.target.value) }}
                  maxLength="100" placeholder={brandList.length > 0 ? "Or type new brand..." : "e.g. MDH, Haldiram"}
                  style={{ fontSize: '16px' }} className={F_INP} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={F_LBL}>Quantity</label>
                  <input type="number" min="0" step="any" inputMode="decimal" value={packSizeQty}
                    onChange={function (e) { setPackSizeQty(e.target.value) }}
                    placeholder="e.g. 500" style={{ fontSize: '16px' }} className={F_INP} />
                </div>
                <div>
                  <label className={F_LBL}>Unit</label>
                  <select value={packSizeUnit} onChange={function (e) { setPackSizeUnit(e.target.value) }} className={F_INP}>
                    {UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className={F_LBL}>{t('Description')}</label>
            <div className="flex gap-2">
              <textarea value={description} onChange={function (e) { setDescription(e.target.value) }} rows="2" maxLength="1000" placeholder={t('Optional notes...')}
                style={{ fontSize: '16px' }} className="flex-1 min-w-0 px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#A9B1CB] focus:ring-4 focus:ring-[#3B4668]/10 resize-none" />
              <button type="button" onClick={function () { startSpeech('description') }} aria-label="Speak" title="Speak"
                className={"shrink-0 self-start w-11 h-11 inline-flex items-center justify-center rounded-xl border transition-colors " + (listeningField === 'description' ? "bg-red-500 border-red-500 text-white animate-pulse" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50")}><Icon name="mic" size={16} /></button>
            </div>
          </div>
          <div>
            <label className={F_LBL}>{t('Item Name (Hindi)')}</label>
            <div className="flex gap-2">
              <input type="text" value={nameHindi} onChange={function (e) { setNameHindi(e.target.value); setHiEdited(true) }} maxLength="200" placeholder="हिंदी नाम" style={{ fontSize: '16px' }} className={F_INP + " flex-1 min-w-0"} />
              <button type="button" onClick={function () { startSpeech('nameHindi') }} aria-label="Speak" title="Speak"
                className={"shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-xl border transition-colors " + (listeningField === 'nameHindi' ? "bg-red-500 border-red-500 text-white animate-pulse" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50")}><Icon name="mic" size={16} /></button>
            </div>
          </div>
        </div>
      </FormSection>

      {categoryDimFields.length > 0 && (
        <FormSection icon="list" title="Properties">
          <div className="space-y-3.5">
          {dimensionValues.map(function (dim, index) {
            var dimType = dim.type || 'number'
            function setDim(patch) { setDimensionValues(function (prev) { return prev.map(function (d, i) { if (i !== index) return d; return Object.assign({}, d, patch) }) }) }
            if (dimType === 'text') {
              return (
                <div key={dim.name}>
                  <label className={F_LBL}>{dim.name}</label>
                  <input type="text" value={dim.value || ''} onChange={function (e) { setDim({ value: e.target.value }) }} placeholder={'Enter ' + dim.name + '...'} maxLength="500" style={{ fontSize: '16px' }} className={F_INP} />
                </div>
              )
            }
            if (dimType === 'select') {
              var dimOptItems = (dim.options || []).map(function (opt) { return { label: opt, value: opt } })
              return (
                <div key={dim.name}>
                  <label className={F_LBL}>{dim.name}</label>
                  <SearchDropdown items={dimOptItems} value={dim.value || ''}
                    onChange={function (val) { setDim({ value: val }) }}
                    placeholder={'Search ' + dim.name + '...'} />
                </div>
              )
            }
            return (
              <div key={dim.name}>
                <label className={F_LBL}>{dim.name}</label>
                <div className="flex gap-2">
                  <input type="number" min="0" step="any" inputMode="decimal" value={dim.qty} onChange={function (e) { setDim({ qty: e.target.value }) }} placeholder="0" aria-label={dim.name + ' quantity'} style={{ fontSize: '16px' }} className={F_INP + " flex-1 min-w-0"} />
                  <select value={dim.unit} onChange={function (e) { setDim({ unit: e.target.value }) }} aria-label={dim.name + ' unit'} className={F_INP + " !w-28 shrink-0"}>
                    {UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
                  </select>
                </div>
              </div>
            )
          })}
          </div>
        </FormSection>
      )}

      <FormSection icon="rupee" title="Stock & pricing">
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={F_LBL}>{t('Quantity')}<span className="text-red-500 ml-0.5">*</span></label>
              <input type="number" min="0" max="999999" step="any" inputMode="numeric" value={qty} onChange={function (e) { setQty(e.target.value) }} placeholder="0"
                style={{ fontSize: '16px' }} className={F_INP + (errors.qty ? " border-red-300" : "")} />
              {errors.qty && <p className="text-xs text-red-500 mt-1">{errors.qty}</p>}
            </div>
            <div>
              <label className={F_LBL}>{t('Unit')}</label>
              <select value={unit} onChange={function (e) { setUnit(e.target.value) }} className={F_INP}>
                {UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={F_LBL}>{t('Rate') + ' (₹)'}</label>
              <input type="number" min="0" step="any" inputMode="decimal" value={ratePaise} onChange={function (e) { setRatePaise(e.target.value) }} placeholder="—" style={{ fontSize: '16px' }} className={F_INP} />
            </div>
            <div>
              <label className={F_LBL}>Total (₹)</label>
              <div className={F_INP + " flex items-center bg-slate-50 font-semibold tabular-nums " + (rateTotalPaise != null ? "text-slate-900" : "text-slate-400")}>
                {rateTotalPaise != null ? formatPaise(rateTotalPaise) : '—'}
              </div>
            </div>
          </div>
        </div>
      </FormSection>

      <FormSection icon="mapPin" title={t('Allocations') || 'Allocations'} hint={allocHint}
        right={
          <button type="button" role="switch" aria-checked={showAllocations} aria-label="Show allocations"
            onClick={function () { setShowAllocations(function (v) { return !v }) }}
            className={"relative shrink-0 w-11 h-6 rounded-full transition-colors " + (showAllocations ? "bg-[#3B4668]" : "bg-slate-300")}>
            <span className={"absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-[translate] duration-200 " + (showAllocations ? "translate-x-5" : "translate-x-0")} />
          </button>
        }>
        {showAllocations && <div className="space-y-2">
        {errors.dept && <p className="text-xs text-red-500">{errors.dept}</p>}
        <AllocationRows
          allocations={allocations}
          accent="gray"
          bare
          title={t('Allocations') || 'Allocations'}
          onAdd={addAllocationRow}
          onRemove={removeAllocationRow}
          onDuplicate={duplicateAllocationRow}
          isComplete={function (a) { return !!a.venue_id && !!a.qty && Number(a.qty) > 0 }}
          renderChip={function (a) {
            var v = a.venue_id ? venues.find(function (x) { return String(x.id) === String(a.venue_id) }) : null
            var sv = a.sub_venue_id && v ? subVenues.find(function (x) { return String(x.id) === String(a.sub_venue_id) }) : null
            return {
              left: (
                <>
                  {v && <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#EDEFF5] text-[10px] font-bold text-[#333D5E] shrink-0">{v.code}</span>}
                  {sv
                    ? <span className="font-medium text-slate-800 truncate">{sv.name}</span>
                    : v && <span className="text-slate-500 truncate">{v.name}</span>}
                </>
              ),
              right: (Number(a.qty) || 0).toString(),
            }
          }}
          renderExpanded={function (row, index) {
            var filteredSubVenues = row.venue_id ? subVenues.filter(function (sv) { return String(sv.venue_id) === row.venue_id }) : []
            return (
              <div className="space-y-2.5">
                <SearchDropdown label={t('Venue') || 'Venue'} required items={venues.map(function (v) { return { label: v.code + ' — ' + v.name, value: String(v.id) } })} value={row.venue_id} onChange={function (val) { updateAllocation(index, 'venue_id', val) }} placeholder="Select venue..." />
                {row.venue_id && filteredSubVenues.length > 0 && (
                  <SearchDropdown label="Sub-venue" items={filteredSubVenues.map(function (sv) { return { label: sv.name, value: String(sv.id) } })} value={row.sub_venue_id} onChange={function (val) { updateAllocation(index, 'sub_venue_id', val) }} placeholder="Select sub-venue..." />
                )}
                <div>
                  <label className={F_LBL}>{t('Quantity')}</label>
                  <input type="number" min="0" step="any" inputMode="numeric" value={row.qty} onChange={function (e) { updateAllocation(index, 'qty', e.target.value) }} placeholder="0" style={{ fontSize: '16px' }} className={F_INP} />
                </div>
              </div>
            )
          }}
        />
        </div>}
      </FormSection>

      {/* The least-checked settings, at the very bottom of the form rather
          than crowding Stock & pricing. */}
      <FormSection icon="settings" title="Additional Details">
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={F_LBL + " truncate"}>{showPackSize ? 'Season Reorder Qty' : t('Min Order Qty')}</label>
              <input type="number" min="0" step="any" inputMode="numeric" value={minOrderQty} onChange={function (e) { setMinOrderQty(e.target.value) }} placeholder="—" style={{ fontSize: '16px' }} className={F_INP} />
            </div>
            <div>
              <label className={F_LBL + " truncate"}>{showPackSize ? 'Off Season Reorder Qty' : t('Reorder Qty')}</label>
              <input type="number" min="0" step="any" inputMode="numeric" value={reorderQty} onChange={function (e) { setReorderQty(e.target.value) }} placeholder="—" style={{ fontSize: '16px' }} className={F_INP} />
            </div>
          </div>
          <div>
            <label className={F_LBL}>{t('Is Asset?')}</label>
            <Segmented value={isAsset} onChange={setIsAsset} options={[
              { value: 'yes', label: t('Yes'), on: 'bg-emerald-600 text-white' },
              { value: 'no', label: t('No'), on: 'bg-red-500 text-white' },
              { value: 'unknown', label: t('Dont Know'), on: 'bg-slate-600 text-white' },
            ]} />
          </div>
        </div>
      </FormSection>

      {errors.submit && (
        <div className="flex items-start gap-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
          <Icon name="alert" size={16} className="shrink-0 mt-0.5" />{errors.submit}
        </div>
      )}
      <div className="flex flex-wrap gap-2 justify-end pt-1">
        {!isEdit && <button type="button" onClick={resetForm} className="mr-auto inline-flex items-center gap-1.5 h-11 px-4 text-sm font-semibold text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"><Icon name="undo" size={14} />{t('Reset')}</button>}
        <button type="button" onClick={onClose} className="h-11 px-5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors">{t('Cancel')}</button>
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 h-11 px-6 text-sm font-semibold text-white bg-[#3B4668] rounded-xl shadow-[0_4px_12px_-4px_rgba(59,70,104,0.55)] hover:bg-[#2F3854] disabled:opacity-50 transition-colors"><Icon name="check" size={15} />{saving ? t('Saving...') : (isEdit ? t('Update Item') : t('Submit Item'))}</button>
      </div>

      {cameraOpen && (
        <CameraCapture
          onCapture={function (file) { setCameraOpen(false); handleImageChange({ target: { files: [file], value: '' } }) }}
          onClose={function () { setCameraOpen(false) }}
        />
      )}
    </form>
  )
}

export default InventoryForm
