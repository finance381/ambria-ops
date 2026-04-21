import { useState, useEffect, useRef } from 'react'
import { supabase, getImageUrl } from '../../lib/supabase'
import SearchDropdown from '../../components/ui/SearchDropdown'
import ImageCrop from '../../components/ImageCrop'
import { translateToHindi } from '../../lib/translate'
import { titleCase } from '../../lib/format'
import { useLang } from '../../lib/i18n'
import { logActivity } from '../../lib/logger'

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

function InventoryForm({ item, profile, onClose, onSaved }) {
  var { t } = useLang()
  var [categories, setCategories] = useState([])
  var [subCategories, setSubCategories] = useState([])
  var [existingItems, setExistingItems] = useState([])
  var [departments, setDepartments] = useState([])
  var [categoryId, setCategoryId] = useState(item?.category_id ? String(item.category_id) : '')
  var [subCategoryId, setSubCategoryId] = useState(item?.sub_category_id ? String(item.sub_category_id) : '')
  var [name, setName] = useState(item?.name || '')
  var [description, setDescription] = useState(item?.description || '')
  var [nameHindi, setNameHindi] = useState(item?.name_hindi || '')
  var [hiEdited, setHiEdited] = useState(false)
  var [qty, setQty] = useState(item?.qty ?? '')
  var [unit, setUnit] = useState(item?.unit || 'Pieces')
  var [minOrderQty, setMinOrderQty] = useState(item?.min_order_qty ?? item?.season_reorder_qty ?? '')
  var [reorderQty, setReorderQty] = useState(item?.reorder_qty ?? item?.off_season_reorder_qty ?? '')
  var [ratePaise, setRatePaise] = useState(item?.rate_paise ? (item.rate_paise / 100) : '')
  var [isAsset, setIsAsset] = useState(item?.is_asset ?? 'unknown')
  var [venues, setVenues] = useState([])
  var [subVenues, setSubVenues] = useState([])
  var [allocations, setAllocations] = useState([{ department: '', venue_id: '', sub_venue_id: '', qty: '' }])
  var [type, setType] = useState(item?.type || 'Indoor')
  var [imageFile, setImageFile] = useState(null)
  var [imagePreview, setImagePreview] = useState(item?.image_path ? getImageUrl(item.image_path) : '')
  var [cropSrc, setCropSrc] = useState(null)
  var [listeningField, setListeningField] = useState(null)
  var recognitionRef = useRef(null)
  var [saving, setSaving] = useState(false)
  var [errors, setErrors] = useState({})
  var [dimensionValues, setDimensionValues] = useState(item?.dimensions || [])
  var [categoryDimFields, setCategoryDimFields] = useState([])
  var [cateringStoreSubDeptId, setCateringStoreSubDeptId] = useState(null)
  var [packSizeQty, setPackSizeQty] = useState(item?.pack_size_qty ?? '')
  var [packSizeUnit, setPackSizeUnit] = useState(item?.pack_size_unit || 'Grams')
  var [packSizeBrand, setPackSizeBrand] = useState(item?.brand || '')
  var [brandList, setBrandList] = useState([])
  var isEdit = !!item

  function compressImage(dataUrl, maxBytes, callback) {
    var img = new Image()
    img.onload = function () {
      var canvas = document.createElement('canvas')
      var maxDim = 1200; var w = img.width; var h = img.height
      if (w > maxDim || h > maxDim) { if (w > h) { h = Math.round(h * maxDim / w); w = maxDim } else { w = Math.round(w * maxDim / h); h = maxDim } }
      canvas.width = w; canvas.height = h
      var ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h)
      var quality = 0.8; var result = canvas.toDataURL('image/jpeg', quality)
      while (result.length * 0.75 > maxBytes && quality > 0.1) { quality -= 0.1; result = canvas.toDataURL('image/jpeg', quality) }
      if (result.length * 0.75 > maxBytes) { w = Math.round(w * 0.7); h = Math.round(h * 0.7); canvas.width = w; canvas.height = h; ctx.drawImage(img, 0, 0, w, h); result = canvas.toDataURL('image/jpeg', 0.6) }
      callback(result)
    }; img.src = dataUrl
  }

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
        supabase.from(allocTbl).select('venue_id, sub_venue_id, qty').eq('item_id', item.id)
          .then(function (res) {
            var data = res.data || []
            if (data.length > 0) {
              setAllocations(data.map(function (va) {
                return { department: item.department || '', venue_id: String(va.venue_id), sub_venue_id: va.sub_venue_id ? String(va.sub_venue_id) : '', qty: String(va.qty) }
              }))
            }
          })
      }
    })
        .then(function (res) {
          var data = res.data || []
          if (data.length > 0) {
            setAllocations(data.map(function (va) {
              return { department: item.department || '', venue_id: String(va.venue_id), sub_venue_id: va.sub_venue_id ? String(va.sub_venue_id) : '', qty: String(va.qty) }
            }))
          }
        })
    }
  )
  useEffect(function () {
    if (categoryId) {
      supabase.from('sub_categories').select('*').eq('category_id', Number(categoryId)).order('name')
        .then(function ({ data }) {
          var subs = data || []
          var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
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
      .eq('status', 'approved')
      .not('brand', 'is', null)
      .order('brand')
      .then(function (res) {
        var brands = [...new Set((res.data || []).map(function (r) { return r.brand }).filter(Boolean))].sort()
        setBrandList(brands)
      })
  }, [categoryId, cateringStoreSubDeptId, name])
  useEffect(function () {
    if (categoryId) {
      var isCatStore = false
      if (cateringStoreSubDeptId) {
        var cat = categories.find(function (c) { return String(c.id) === categoryId })
        isCatStore = cat?.sub_department_id === cateringStoreSubDeptId
      }
      var query
      if (isCatStore) {
        query = supabase.from('catering_store_items').select('id, name, name_hindi, unit, type, description, season_reorder_qty, off_season_reorder_qty, rate_paise, is_asset, department, brand, pack_size_qty, pack_size_unit, status').eq('category_id', Number(categoryId)).in('status', ['approved', 'pending', 'pending_dept'])
      } else {
        query = supabase.from('inventory_items').select('id, name, name_hindi, unit, type, description, min_order_qty, reorder_qty, rate_paise, is_asset, department, dimensions, status').eq('category_id', Number(categoryId)).in('status', ['approved', 'pending', 'pending_dept'])
      }
      if (subCategoryId) query = query.eq('sub_category_id', Number(subCategoryId))
      query.order('name').then(function ({ data }) { setExistingItems(data || []) })
    } else { setExistingItems([]) }
  }, [categoryId, subCategoryId, cateringStoreSubDeptId])
  useEffect(function () {
    if (categoryId) {
      var cat = categories.find(function (c) { return String(c.id) === categoryId })
      var fields = cat?.dimension_fields || []
      setCategoryDimFields(fields)
      if (fields.length > 0 && dimensionValues.length === 0 && !isEdit) {
        setDimensionValues(fields.map(function (f) { return { name: f.name, qty: '', unit: 'Pieces' } }))
      }
    } else { setCategoryDimFields([]); setDimensionValues([]) }
  }, [categoryId])

  async function loadLookups() {
    var [catRes, deptRes, venueRes, subVenueRes, subDeptRes] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('departments').select('*').eq('active', true).order('name'),
      supabase.from('venues').select('*').eq('active', true).order('code'),
      supabase.from('sub_venues').select('id, name, venue_id').eq('active', true).order('name'),
      supabase.from('sub_departments').select('id, name').eq('name', 'Catering Store').limit(1)
    ])
    var cateringStoreId = (subDeptRes.data || [])[0]?.id || null

    var allCats = catRes.data || []
    var isAdmin = profile?.role === 'admin' || profile?.role === 'auditor'
    var userCatIds = profile?.category_ids || []
    
    // Admin sees all, others see only assigned categories
    if (!isAdmin && userCatIds.length > 0) {
      allCats = allCats.filter(function (c) { return userCatIds.includes(c.id) })
    }
    
    setCategories(allCats)
    setDepartments(deptRes.data || [])
    setVenues(venueRes.data || [])
    setSubVenues(subVenueRes.data || [])
    setCateringStoreSubDeptId(cateringStoreId)
    return { cats: allCats, csId: cateringStoreId }
  }

  function updateAllocation(index, field, value) {
    setAllocations(function (prev) { return prev.map(function (row, i) { if (i !== index) return row; var updated = { ...row, [field]: value }; if (field === 'venue_id') updated.sub_venue_id = ''; return updated }) })
  }
  function addAllocationRow() {
    setAllocations(function (prev) { return [...prev, { department: '', venue_id: '', sub_venue_id: '', qty: '' }] })
  }
  function removeAllocationRow(index) { setAllocations(function (prev) { if (prev.length <= 1) return prev; return prev.filter(function (_, i) { return i !== index }) }) }

  function handleImageChange(e) {
    var file = e.target.files?.[0]; if (!file) return
    if (file.size > 20 * 1024 * 1024) { setErrors(function (prev) { return { ...prev, img: 'Too large (max 20MB)' } }); e.target.value = ''; return }
    setErrors(function (prev) { var n = { ...prev }; delete n.img; return n })
    var reader = new FileReader(); reader.onload = function (ev) { setCropSrc(ev.target.result) }; reader.readAsDataURL(file); e.target.value = ''
  }
  function handleCropped(dataUrl) { compressImage(dataUrl, 100 * 1024, function (compressed) { setImagePreview(compressed); setCropSrc(null); fetch(compressed).then(function (res) { return res.blob() }).then(function (blob) { setImageFile(new File([blob], 'photo.jpg', { type: 'image/jpeg' })) }) }) }
  function handleUseFull(dataUrl) { handleCropped(dataUrl) }
  function handleCropCancel() { setCropSrc(null) }
  function removeImage() { setImageFile(null); setImagePreview('') }

  function handleItemNameSelect(val) {
    setName(val); if (!val) return
    // Prefer approved match; fall back to pending for name/metadata only
    var match = existingItems.find(function (i) { return i.name === val && i.status === 'approved' })
      || existingItems.find(function (i) { return i.name === val })
    var loadedHindi = false
    if (match) {
      var isApproved = match.status === 'approved'

      // Common fields — always populate for consistency
      if (match.name_hindi) { setNameHindi(match.name_hindi); setHiEdited(true); loadedHindi = true }
      if (match.unit) setUnit(match.unit)
      if (match.type) setType(match.type)
      if (match.description) setDescription(match.description)
      if (isApproved && match.rate_paise) setRatePaise(match.rate_paise / 100)
      if (match.is_asset && match.is_asset !== 'unknown') setIsAsset(match.is_asset)

      // Reorder fields — only from approved
      if (isApproved) {
        if (match.season_reorder_qty != null) { setMinOrderQty(match.season_reorder_qty) }
        else if (match.min_order_qty != null) { setMinOrderQty(match.min_order_qty) }
        if (match.off_season_reorder_qty != null) { setReorderQty(match.off_season_reorder_qty) }
        else if (match.reorder_qty != null) { setReorderQty(match.reorder_qty) }
      }

      // Catering store fields — brand/pack metadata always
      if (match.brand) setPackSizeBrand(match.brand)
      if (match.pack_size_qty) setPackSizeQty(String(match.pack_size_qty))
      if (match.pack_size_unit) setPackSizeUnit(match.pack_size_unit)

      // Dimensions — only from approved items
      if (isApproved && match.dimensions && Array.isArray(match.dimensions) && match.dimensions.length > 0) {
        setDimensionValues(match.dimensions)
      }

      // Load allocations — only from approved items
      if (isApproved && match.id) {
        var isCatStoreItem = match.brand !== undefined || match.pack_size_qty !== undefined
        var aTable = isCatStoreItem ? 'cs_venue_allocations' : 'venue_allocations'
        supabase.from(aTable).select('venue_id, sub_venue_id, qty').eq('item_id', match.id)
          .then(function (res) {
            var data = res.data
            if (data && data.length > 0) {
              setAllocations(data.map(function (va) {
                return { department: match.department || allocations[0]?.department || '', venue_id: String(va.venue_id), sub_venue_id: va.sub_venue_id ? String(va.sub_venue_id) : '', qty: '' }
              }))
            }
          })
      }
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
      supabase.from('cs_venue_allocations').select('venue_id, sub_venue_id, qty').eq('item_id', match.id)
        .then(function (res) {
          var data = res.data
          if (data && data.length > 0) {
            setAllocations(data.map(function (va) {
              return { department: match.department || allocations[0]?.department || '', venue_id: String(va.venue_id), sub_venue_id: va.sub_venue_id ? String(va.sub_venue_id) : '', qty: '' }
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
    var ext = imageFile.name.split('.').pop() || 'jpg'; var path = (prefix || 'inventory') + '/' + itemId + '.' + ext
    var { error } = await supabase.storage.from('images').upload(path, imageFile, { upsert: true })
    if (error) { setErrors(function (prev) { return { ...prev, img: 'Upload failed: ' + error.message } }); return null }
    return path
  }

  function validate() {
    var errs = {}
    if (!categoryId) errs.cat = t('categoryRequired') || 'Category is required'
    if (!name.trim()) errs.item = t('itemNameRequired') || 'Item name is required'
    if (!qty && qty !== 0) errs.qty = t('qtyRequired') || 'Quantity is required'
    var hasAlloc = allocations.some(function (a) { return a.department && a.qty })
    if (!hasAlloc) errs.dept = 'At least one allocation is required'
    setErrors(errs); return Object.keys(errs).length === 0
  }

  function resetForm() {
    setCategoryId(''); setSubCategoryId(''); setName(''); setDescription(''); setNameHindi(''); setQty(''); setUnit('Pieces')
    setMinOrderQty(''); setReorderQty(''); setRatePaise(''); setIsAsset('unknown'); setType('Indoor')
    setImageFile(null); setImagePreview(''); setErrors({}); setAllocations([{ department: '', venue_id: '', sub_venue_id: '', qty: '' }])
    setCropSrc(null); setHiEdited(false); setDimensionValues([]); setCategoryDimFields([])
    setPackSizeQty(''); setPackSizeUnit('Grams'); setPackSizeBrand(''); setBrandList([])
  }

  async function handleSubmit(e) {
    e.preventDefault(); if (saving) return; if (!validate()) return; setSaving(true)
    var hindiName = nameHindi.trim()
    if (name.trim() && !hindiName) {
      hindiName = await new Promise(function (resolve) {
        var done = false
        translateToHindi(name.trim(), function (translated) {
          if (!done) { done = true; resolve(translated || '') }
        })
        setTimeout(function () { if (!done) { done = true; resolve('') } }, 3000)
      })
      if (hindiName) setNameHindi(hindiName)
    }
    var isCatStore = showPackSize
    var tableName = isCatStore ? 'catering_store_items' : 'inventory_items'
    var allocTable = isCatStore ? 'cs_venue_allocations' : 'venue_allocations'
    var payload
    if (isCatStore) {
      payload = { name: name.trim(), category_id: Number(categoryId), sub_category_id: subCategoryId ? Number(subCategoryId) : null, type: type, qty: Number(qty) || 0, unit: unit, description: description.trim() || null, name_hindi: hindiName || null, brand: packSizeBrand.trim() || null, pack_size_qty: packSizeQty ? Number(packSizeQty) : null, pack_size_unit: packSizeUnit, season_reorder_qty: minOrderQty ? Number(minOrderQty) : null, off_season_reorder_qty: reorderQty ? Number(reorderQty) : null, rate_paise: ratePaise ? Math.round(Number(ratePaise) * 100) : null, is_asset: isAsset, department: allocations[0]?.department || null }
    } else {
      payload = { name: name.trim(), category_id: Number(categoryId), sub_category_id: subCategoryId ? Number(subCategoryId) : null, type: type, qty: Number(qty) || 0, unit: unit, description: description.trim() || null, name_hindi: hindiName || null, min_order_qty: minOrderQty ? Number(minOrderQty) : null, reorder_qty: reorderQty ? Number(reorderQty) : null, rate_paise: ratePaise ? Math.round(Number(ratePaise) * 100) : null, is_asset: isAsset, department: allocations[0]?.department || null, dimensions: dimensionValues.length > 0 ? dimensionValues : null }
    }
    if (!isEdit && profile?.id) { payload.submitted_by = profile.id }
    if (!isEdit) {
      var isAdminRole = profile?.role === 'admin' || profile?.role === 'auditor'
      if (isAdminRole) {
        payload.status = 'approved'
      } else {
        // Check if a dept approver exists for this category (other than the submitter)
        var { data: allDeptApprovers } = await supabase
          .from('profiles')
          .select('id, category_ids')
          .contains('permissions', ['dept_approve'])
          .eq('active', true)
          .neq('id', profile.id)
        var catIdNum = Number(categoryId)
        var deptApprovers = (allDeptApprovers || []).filter(function (p) {
          return (p.category_ids || []).includes(catIdNum)
        })
        var hasDeptApprover = deptApprovers && deptApprovers.length > 0
        // If submitter IS a dept approver for this category, skip dept tier
        var selfIsDeptApprover = (profile?.permissions || []).includes('dept_approve') && (profile?.category_ids || []).includes(Number(categoryId))
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
          // Gather all allocations to merge: form entries + any DB entries not in form
          var { data: dbAllocs } = await supabase.from(allocTable).select('*').eq('item_id', item.id)
          var { data: targetAllocs } = await supabase.from(allocTable).select('*').eq('item_id', mergeTarget.id)
          var formRows = allocations.filter(function (a) { return a.venue_id && Number(a.qty) > 0 })
          // Build combined allocation list: start with form entries
          var allAllocsToMerge = formRows.map(function (a) { return { venue_id: Number(a.venue_id), sub_venue_id: a.sub_venue_id ? Number(a.sub_venue_id) : null, qty: Number(a.qty) } })
          // Add any DB allocations not covered by form (in case form didn't load them)
          ;(dbAllocs || []).forEach(function (da) {
            var inForm = allAllocsToMerge.some(function (fa) { return fa.venue_id === da.venue_id && (fa.sub_venue_id || null) === (da.sub_venue_id || null) })
            if (!inForm) allAllocsToMerge.push({ venue_id: da.venue_id, sub_venue_id: da.sub_venue_id || null, qty: da.qty })
          })
          // Merge each into target
          for (var ai = 0; ai < allAllocsToMerge.length; ai++) {
            var nr = allAllocsToMerge[ai]
            if (!nr.qty || nr.qty <= 0) continue
            var match = (targetAllocs || []).find(function (ta) { return ta.venue_id === nr.venue_id && (ta.sub_venue_id || null) === (nr.sub_venue_id || null) })
            if (match) {
              var { error: updErr } = await supabase.from(allocTable).update({ qty: match.qty + nr.qty }).eq('id', match.id)
              if (updErr) throw new Error('Merge allocation update failed: ' + updErr.message)
            } else {
              var { error: insErr } = await supabase.from(allocTable).insert({ item_id: mergeTarget.id, venue_id: nr.venue_id, sub_venue_id: nr.sub_venue_id, qty: nr.qty })
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
          logActivity('ITEM_EDIT_MERGE', payload.name + ' → merged into existing (qty +' + (Number(qty) || 0) + ')')
        } else {
          // No merge needed — standard update
          await supabase.from(allocTable).delete().eq('item_id', item.id)
          var venueRows = allocations.filter(function (a) { return a.venue_id && Number(a.qty) > 0 }).map(function (a) { return { item_id: item.id, venue_id: Number(a.venue_id), sub_venue_id: a.sub_venue_id ? Number(a.sub_venue_id) : null, qty: Number(a.qty) } })
          if (venueRows.length > 0) { var { error: vaErr } = await supabase.from(allocTable).insert(venueRows); if (vaErr) throw new Error('Allocation save failed: ' + vaErr.message) }
          var { error: updateError } = await supabase.from(tableName).update(payload).eq('id', item.id)
          if (updateError) throw updateError
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
          var newQty = (existing.qty || 0) + (Number(qty) || 0)
          var { error: updateErr } = await supabase.from(tableName).update({ qty: newQty }).eq('id', existing.id)
          if (updateErr) throw updateErr
          targetItem = { id: existing.id }
          if (imageFile) { var imgPath = await uploadImage(existing.id, imgPrefix); if (imgPath) await supabase.from(tableName).update({ image_path: imgPath }).eq('id', existing.id) }

          // Merge allocations
          var { data: oldAllocs, error: allocErr } = await supabase.from(allocTable).select('id, venue_id, sub_venue_id, qty').eq('item_id', existing.id)
          if (allocErr) throw new Error('Failed to fetch allocations: ' + allocErr.message)
          var newVenueRows = allocations.filter(function (a) { return a.venue_id && Number(a.qty) > 0 })
          for (var ai = 0; ai < newVenueRows.length; ai++) {
            var nr = newVenueRows[ai]
            var nrVenueId = Number(nr.venue_id)
            var nrSubVenueId = nr.sub_venue_id ? Number(nr.sub_venue_id) : null
            var nrQty = Number(nr.qty)
            if (!nrQty || nrQty <= 0) continue
            var match = (oldAllocs || []).find(function (oa) { return oa.venue_id === nrVenueId && (oa.sub_venue_id || null) === nrSubVenueId })
            if (match) {
              var { error: updErr } = await supabase.from(allocTable).update({ qty: match.qty + nrQty }).eq('id', match.id)
              if (updErr) throw new Error('Allocation update failed: ' + updErr.message)
            } else {
              var { error: insErr } = await supabase.from(allocTable).insert({ item_id: existing.id, venue_id: nrVenueId, sub_venue_id: nrSubVenueId, qty: nrQty })
              if (insErr) throw new Error('Allocation insert failed: ' + insErr.message)
            }
          }
        } else {
          // Fresh insert — pending or approved depending on role
          var { data: newItem, error: insertError } = await supabase.from(tableName).insert(payload).select().single()
          if (insertError) throw insertError
          targetItem = newItem
          if (imageFile && newItem) { var imgPath = await uploadImage(newItem.id, imgPrefix); if (imgPath) await supabase.from(tableName).update({ image_path: imgPath }).eq('id', newItem.id) }

          // Insert allocations for the new row
          if (targetItem) {
            var venueRows = allocations.filter(function (a) { return a.venue_id && Number(a.qty) > 0 }).map(function (a) { return { item_id: targetItem.id, venue_id: Number(a.venue_id), sub_venue_id: a.sub_venue_id ? Number(a.sub_venue_id) : null, qty: Number(a.qty) } })
            if (venueRows.length > 0) { var { error: allocInsErr } = await supabase.from(allocTable).insert(venueRows); if (allocInsErr) throw new Error('Allocation save failed: ' + allocInsErr.message) }
          }
        }
      }
      var logAction = isEdit ? 'ITEM_UPDATE' : 'ITEM_SUBMIT'
      var logDetail = name.trim() + ' | Cat: ' + (categories.find(function (c) { return String(c.id) === categoryId })?.name || '—') + ' | Qty: ' + (Number(qty) || 0)
      logActivity(logAction, logDetail)
      onSaved()
    } catch (err) { setErrors(function (prev) { return { ...prev, submit: err.message || 'Failed to save' } }) }
    setSaving(false)
  }

  var catItems = categories.map(function (c) { return { label: c.name, value: String(c.id), pending: c.status === 'pending' } })
  var subCatItems = subCategories.map(function (s) { return { label: s.name, value: String(s.id), pending: s.status === 'pending' } })
  var itemNameItems = [...new Set(existingItems.map(function (i) { return i.name }))].map(function (n) { return { label: titleCase(n), value: n } })
  var deptItems = departments.map(function (d) { return { label: d.name, value: d.name } })
  

  var showPackSize = (function () {
    if (!cateringStoreSubDeptId || !categoryId) return false
    var cat = categories.find(function (c) { return String(c.id) === categoryId })
    return cat?.sub_department_id === cateringStoreSubDeptId
  })()

  if (cropSrc) {
    return (
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{t('cropImage')}</h3>
        <ImageCrop imageSrc={cropSrc} onCrop={handleCropped} onUseFull={handleUseFull} onCancel={handleCropCancel} />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* ═══ PHOTO CARD ═══ */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{t('photo')}</h3>
        {!imagePreview ? (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <div className="text-3xl mb-2">📷</div>
            <div className="flex gap-2 justify-center mb-2">
              <label className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer transition-colors font-medium">
                {"📸 " + t('camera')}<input type="file" accept="image/*" capture="environment" onChange={handleImageChange} className="hidden" />
              </label>
              <label className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer transition-colors font-medium">
                {"🖼️ " + t('gallery')}<input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              </label>
            </div>
            <p className="text-xs text-gray-400">{t('photoHint')}</p>
          </div>
        ) : (
          <div className="relative inline-block">
            <img src={imagePreview} alt="Preview" className="max-h-48 rounded-lg border border-gray-200" />
            <button type="button" onClick={removeImage} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-sm leading-none hover:bg-red-600 transition-colors">×</button>
          </div>
        )}
        {errors.img && <p className="text-xs text-red-500 mt-1">{errors.img}</p>}
      </div>

      {/* ═══ ITEM DETAILS CARD ═══ */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">{t('itemDetails')}</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('type')}</label>
          <div className="flex gap-0 bg-white border border-gray-300 rounded-md overflow-hidden">
            <button type="button" onClick={function () { setType('Indoor') }} className={"flex-1 py-2 text-sm font-medium transition-colors " + (type === 'Indoor' ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-50")}>🏠 Indoor</button>
            <button type="button" onClick={function () { setType('Outdoor') }} className={"flex-1 py-2 text-sm font-medium transition-colors " + (type === 'Outdoor' ? "bg-green-600 text-white" : "text-gray-500 hover:bg-gray-50")}>🌳 Outdoor</button>
            <button type="button" onClick={function () { setType('Premium') }} className={"flex-1 py-2 text-sm font-medium transition-colors " + (type === 'Premium' ? "bg-purple-600 text-white" : "text-gray-500 hover:bg-gray-50")}>★ Premium</button>
          </div>
        </div>
        <SearchDropdown label={t('category')} required items={catItems} value={categoryId} onChange={setCategoryId} placeholder={t('searchCategory')} error={errors.cat} />
        <SearchDropdown label={t('subCategory')} items={subCatItems} value={subCategoryId} onChange={setSubCategoryId} placeholder={t('searchSubCategory')} />
        <SearchDropdown label={t('itemName')} required items={itemNameItems} value={name} onChange={handleItemNameSelect} allowAdd onAdd={function (val) { setName(val) }} placeholder={t('searchItemName')} error={errors.item} />
        {showPackSize && (
          <div className="bg-amber-50 rounded-lg border border-amber-200 p-3 space-y-2">
            <h4 className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Pack Size</h4>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand Name</label>
              {brandList.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {brandList.map(function (b) {
                    var isActive = (packSizeBrand || '').toLowerCase() === b.toLowerCase()
                    return (
                      <button key={b} type="button"
                        onClick={function () { handleBrandSelect(b) }}
                        className={"text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-colors " +
                          (isActive ? "border-amber-600 bg-amber-600 text-white" : "border-amber-200 text-amber-700 bg-white hover:bg-amber-50")}>
                        {b}
                      </button>
                    )
                  })}
                </div>
              )}
              <input type="text" value={packSizeBrand}
                onChange={function (e) { setPackSizeBrand(e.target.value) }}
                maxLength="100" placeholder={brandList.length > 0 ? "Or type new brand..." : "e.g. MDH, Haldiram"}
                className="w-full px-3 py-2 border border-amber-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                style={{ fontSize: '16px' }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                <input type="number" min="0" step="any" inputMode="decimal" value={packSizeQty}
                  onChange={function (e) { setPackSizeQty(e.target.value) }}
                  placeholder="e.g. 500"
                  className="w-full px-3 py-2 border border-amber-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                  style={{ fontSize: '16px' }} />
              </div>
              <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
              <select value={packSizeUnit} onChange={function (e) { setPackSizeUnit(e.target.value) }}
                className="w-full px-3 py-2 border border-amber-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white">
                {UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
              </select>
            </div>
            </div>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('description')}</label>
          <div className="flex gap-1">
            <textarea value={description} onChange={function (e) { setDescription(e.target.value) }} rows="2" maxLength="1000" placeholder={t('optionalNotes')} className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
            <button type="button" onClick={function () { startSpeech('description') }} className={"px-2.5 py-2 rounded-md text-sm transition-colors flex-shrink-0 self-start " + (listeningField === 'description' ? "bg-red-500 text-white animate-pulse" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>🎙️</button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('itemNameHindi')}</label>
          <div className="flex gap-1">
            <input type="text" value={nameHindi} onChange={function (e) { setNameHindi(e.target.value); setHiEdited(true) }} maxLength="200" placeholder="हिंदी नाम" className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button type="button" onClick={function () { startSpeech('nameHindi') }} className={"px-2.5 py-2 rounded-md text-sm transition-colors flex-shrink-0 " + (listeningField === 'nameHindi' ? "bg-red-500 text-white animate-pulse" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>🎙️</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('quantity')}<span className="text-red-500 ml-0.5">*</span></label>
            <input type="number" min="0" max="999999" step="any" inputMode="numeric" value={qty} onChange={function (e) { setQty(e.target.value) }} placeholder="0" className={"w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 " + (errors.qty ? "border-red-300" : "border-gray-300")} />
            {errors.qty && <p className="text-xs text-red-500 mt-1">{errors.qty}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('unit')}</label>
            <select value={unit} onChange={function (e) { setUnit(e.target.value) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
              {UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{showPackSize ? 'Season Reorder Qty' : t('minOrderQty')}</label><input type="number" min="0" step="any" inputMode="numeric" value={minOrderQty} onChange={function (e) { setMinOrderQty(e.target.value) }} placeholder="—" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{showPackSize ? 'Off Season Reorder Qty' : t('reorderQty')}</label><input type="number" min="0" step="any" inputMode="numeric" value={reorderQty} onChange={function (e) { setReorderQty(e.target.value) }} placeholder="—" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
          {(profile?.role === 'admin' || profile?.role === 'auditor') && (<div><label className="block text-sm font-medium text-gray-700 mb-1">{t('rate') + ' (₹)'}</label><input type="number" min="0" step="any" inputMode="decimal" value={ratePaise} onChange={function (e) { setRatePaise(e.target.value) }} placeholder="—" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>)}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('isAsset')}</label>
          <div className="flex gap-0 bg-white border border-gray-300 rounded-md overflow-hidden">
            {['yes', 'no', 'unknown'].map(function (val) {
              var labels = { yes: t('yes'), no: t('no'), unknown: t('dontKnow') }; var active = isAsset === val
              var colors = { yes: active ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-gray-50', no: active ? 'bg-red-600 text-white' : 'text-gray-500 hover:bg-gray-50', unknown: active ? 'bg-gray-600 text-white' : 'text-gray-500 hover:bg-gray-50' }
              return <button key={val} type="button" onClick={function () { setIsAsset(val) }} className={"flex-1 py-2 text-sm font-medium transition-colors " + colors[val]}>{labels[val]}</button>
            })}
          </div>
        </div>
      </div>

      {/* ═══ ALLOCATION CARD ═══ */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t('allocations') || 'Allocations'}</h3>
          <button type="button" onClick={addAllocationRow} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">+ Add Row</button>
        </div>
        {errors.dept && <p className="text-xs text-red-500">{errors.dept}</p>}
        {allocations.map(function (row, index) {
          return (
            <div key={index} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-gray-400">#{index + 1}</span>
                {allocations.length > 1 && <button type="button" onClick={function () { removeAllocationRow(index) }} className="text-xs text-red-400 hover:text-red-600 font-semibold">Remove</button>}
              </div>
              <SearchDropdown label={t('department')} required items={deptItems} value={row.department} onChange={function (val) { updateAllocation(index, 'department', val) }} placeholder={t('searchDepartment')} />
              <SearchDropdown label={t('venue') || 'Venue'} items={venues.map(function (v) { return { label: v.code + ' — ' + v.name, value: String(v.id) } })} value={row.venue_id} onChange={function (val) { updateAllocation(index, 'venue_id', val) }} placeholder="Select venue..." />
              {row.venue_id && (function () {
                var filtered = subVenues.filter(function (sv) { return String(sv.venue_id) === row.venue_id })
                if (filtered.length === 0) return null
                return <SearchDropdown label="Sub-venue" items={filtered.map(function (sv) { return { label: sv.name, value: String(sv.id) } })} value={row.sub_venue_id} onChange={function (val) { updateAllocation(index, 'sub_venue_id', val) }} placeholder="Select sub-venue..." />
              })()}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('quantity')}</label>
                <input type="number" min="0" step="any" inputMode="numeric" value={row.qty} onChange={function (e) { updateAllocation(index, 'qty', e.target.value) }} placeholder="0" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              
            </div>
          )
        })}
      </div>

      {/* ═══ DYNAMIC DIMENSIONS ═══ */}
      {categoryDimFields.length > 0 && (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Dimensions</h3>
          {dimensionValues.map(function (dim, index) {
            return (
              <div key={dim.name} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4"><label className="block text-sm font-medium text-gray-700 mb-1">{dim.name}</label></div>
                <div className="col-span-4">
                  <label className="block text-[11px] text-gray-400 mb-1">Quantity</label>
                  <input type="number" min="0" step="any" inputMode="decimal" value={dim.qty} onChange={function (e) { setDimensionValues(function (prev) { return prev.map(function (d, i) { if (i !== index) return d; return { ...d, qty: e.target.value } }) }) }} placeholder="0" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="col-span-4">
                  <label className="block text-[11px] text-gray-400 mb-1">Unit</label>
                  <select value={dim.unit} onChange={function (e) { setDimensionValues(function (prev) { return prev.map(function (d, i) { if (i !== index) return d; return { ...d, unit: e.target.value } }) }) }} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {UNITS.map(function (u) { return <option key={u} value={u}>{u}</option> })}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ SUBMIT AREA ═══ */}
      {errors.submit && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{errors.submit}</div>}
      <div className="flex gap-3 justify-end pt-1">
        {!isEdit && <button type="button" onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 transition-colors font-medium">{t('reset')}</button>}
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 transition-colors font-medium">{t('cancel')}</button>
        <button type="submit" disabled={saving} className="px-6 py-2 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">{saving ? t('saving') : (isEdit ? t('updateItem') : t('submitItem'))}</button>
      </div>
    </form>
  )
}

export default InventoryForm
