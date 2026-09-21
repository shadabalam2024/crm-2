import { useState, useEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import Navbar from '../../components/Navbar'
import Sidebar from '../../components/Sidebar'
import EmptyState from '../../components/EmptyState'
import { TableSkeleton } from '../../components/Skeleton'
import { supabase } from '../../lib/supabaseClient'
import { createScanTracker } from '../../utils/scanTracker'
import useGlobalScanRedirect from '../../hooks/useGlobalScanRedirect'

// products.is_custom is for one-off Billing items with no real stock - never
// candidates for a purchase order, so product search/lookup excludes them
// (mirrors the old ipc/invoice.js search-product handler).
const NOT_CUSTOM_FILTER = 'is_custom.is.null,is_custom.eq.false'

function Field({ label, className = '', children }) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

export default function PurchasePage() {
  const user = useSelector(state => state.auth.user)

  const [suppliers, setSuppliers] = useState([])
  const [purchases, setPurchases] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [items, setItems] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_person: '', phone: '', email: '', address: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [scanFlash, setScanFlash] = useState(null)
  const scanTrackerRef = useRef(createScanTracker())
  const [historySearch, setHistorySearch] = useState('')
  const [historySortBy, setHistorySortBy] = useState('newest')
  const [categories, setCategories] = useState([])
  const [showNewProductForm, setShowNewProductForm] = useState(false)
  const [newProductForm, setNewProductForm] = useState({
    name: '', sku: '', barcode: '', category_id: '', cost_price: '', selling_price: ''
  })
  const [duplicateBarcodeMatch, setDuplicateBarcodeMatch] = useState(null)
  const [newCategory, setNewCategory] = useState('')
  const [viewingPurchase, setViewingPurchase] = useState(null)
  const [loading, setLoading] = useState(true)
  const newProductBarcodeRef = useRef(null)
  const searchInputRef = useRef(null)

  const checkDuplicateBarcode = async (barcode) => {
    if (!barcode.trim()) {
      setDuplicateBarcodeMatch(null)
      return
    }
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('barcode', barcode.trim())
      .maybeSingle()
    setDuplicateBarcodeMatch(data || null)
  }

  useEffect(() => {
    if (showNewProductForm) {
      newProductBarcodeRef.current?.focus()
    }
  }, [showNewProductForm])

  const handleBarcodeFieldKeyDown = (e) => {
    // Scanners send Enter after typing the code - don't let that submit the whole form
    if (e.key === 'Enter') e.preventDefault()
  }

  const openPurchaseDetail = async (purchaseId) => {
    const { data: purchase, error: purchaseError } = await supabase
      .from('purchases')
      .select('*, suppliers(name)')
      .eq('id', purchaseId)
      .maybeSingle()

    if (purchaseError || !purchase) {
      setViewingPurchase(null)
      return
    }

    const { data: items } = await supabase
      .from('purchase_items')
      .select('*, products(name, sku)')
      .eq('purchase_id', purchaseId)

    setViewingPurchase({
      ...purchase,
      supplier_name: purchase.suppliers?.name || '',
      items: (items || []).map(item => ({
        ...item,
        product_name: item.products?.name || '',
        sku: item.products?.sku || ''
      }))
    })
  }

  useEffect(() => {
    loadSuppliers()
    loadPurchases()
    loadCategories()
  }, [])

  const handleAddCategory = async () => {
    if (!newCategory.trim()) return

    const trimmed = newCategory.trim()

    const { data: existing, error: existingError } = await supabase
      .from('categories')
      .select('*')
      .ilike('name', trimmed)
      .maybeSingle()

    if ((existing || existingError) && existing?.id) {
      setNewProductForm(f => ({ ...f, category_id: existing.id }))
      setNewCategory('')
      return
    }

    const { data, error } = await supabase
      .from('categories')
      .insert([{ name: trimmed }])
      .select()
      .single()

    if (error) {
      setError(error.message || 'Failed to add category')
      return
    }

    await loadCategories()
    setNewProductForm(f => ({ ...f, category_id: data.id }))
    setNewCategory('')
  }

  const loadCategories = async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('name', { ascending: true })

    setCategories(error ? [] : (data || []))
  }

  const loadSuppliers = async () => {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name', { ascending: true })

    setSuppliers(error ? [] : (data || []))
  }

  const loadPurchases = async () => {
    const { data, error } = await supabase
      .from('purchases')
      .select('*, suppliers(name)')
      .order('purchase_date', { ascending: false })
      .limit(50)

    if (error) {
      setPurchases([])
      setLoading(false)
      return
    }

    setPurchases((data || []).map(p => ({ ...p, supplier_name: p.suppliers?.name || '' })))
    setLoading(false)
  }

  const handleSearch = async (value) => {
    scanTrackerRef.current.onKeystroke()
    setSearchTerm(value)
    if (!value.trim()) {
      setSearchResults([])
      scanTrackerRef.current.reset()
      return
    }
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .or(`name.ilike.%${value}%,sku.ilike.%${value}%,barcode.ilike.%${value}%`)
      .or(NOT_CUSTOM_FILTER)
      .limit(10)

    setSearchResults(error ? [] : (data || []))
  }

  // Shared by the search field's own Enter handler AND by useGlobalScanRedirect (when
  // a scan lands in some other field entirely - e.g. a Supplier or New Product field -
  // because that's what had focus; the redirect hook strips it back out of that field
  // and routes it here instead).
  const processScannedCode = async (code, { scanLike = true } = {}) => {
    setSearchTerm(code)
    const { data: exact } = await supabase
      .from('products')
      .select('*')
      .eq('barcode', code)
      .maybeSingle()

    if (exact) {
      addItem(exact, true)
      return
    }

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .or(`name.ilike.%${code}%,sku.ilike.%${code}%,barcode.ilike.%${code}%`)
      .or(NOT_CUSTOM_FILTER)
      .limit(10)

    const results = error ? [] : (data || [])
    if (results.length === 0) {
      setError(`No product found for "${code}"`)
      setSearchResults([])
    } else if (scanLike && results.length === 1) {
      addItem(results[0], true)
    } else {
      setSearchResults(results)
    }
  }

  const handleBarcodeEnter = async (e) => {
    if (e.key !== 'Enter' || !searchTerm.trim()) return
    e.preventDefault()
    await processScannedCode(searchTerm.trim(), { scanLike: scanTrackerRef.current.isScanLike() })
    scanTrackerRef.current.reset()
  }

  useGlobalScanRedirect(searchInputRef, (code) => processScannedCode(code, { scanLike: true }))

  const flashScan = (name) => {
    setScanFlash(name)
    setTimeout(() => setScanFlash(current => current === name ? null : current), 1200)
  }

  const addItem = (product, viaScan = false) => {
    setError('')
    if (viaScan) flashScan(product.name)
    setItems(prev => {
      const existing = prev.find(i => i.product_id === product.id)
      if (existing) {
        return prev.map(i => i.product_id === product.id
          ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unit_cost }
          : i)
      }
      return [...prev, {
        product_id: product.id,
        name: product.name,
        unit_cost: product.cost_price,
        quantity: 1,
        subtotal: product.cost_price
      }]
    })
    setSearchTerm('')
    setSearchResults([])
  }

  const handleAddNewProduct = async (e) => {
    e.preventDefault()
    setError('')

    if (!newProductForm.name.trim() || !newProductForm.cost_price || !newProductForm.selling_price) {
      setError('Name, cost price, and selling price are required for a new product')
      return
    }
    if (duplicateBarcodeMatch) {
      setError(`Barcode already used by "${duplicateBarcodeMatch.name}"`)
      return
    }

    const { data: product, error: insertError } = await supabase
      .from('products')
      .insert([{
        name: newProductForm.name.trim(),
        sku: newProductForm.sku || null,
        barcode: newProductForm.barcode || null,
        category_id: newProductForm.category_id || null,
        cost_price: parseFloat(newProductForm.cost_price),
        selling_price: parseFloat(newProductForm.selling_price),
        current_stock: 0,
        min_stock_level: 5,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single()

    if (insertError) {
      setError(insertError.message || 'Failed to add product')
      return
    }

    addItem({ id: product.id, name: newProductForm.name.trim(), cost_price: parseFloat(newProductForm.cost_price) })
    setNewProductForm({ name: '', sku: '', barcode: '', category_id: '', cost_price: '', selling_price: '' })
    setDuplicateBarcodeMatch(null)
    setShowNewProductForm(false)
  }

  const updateItem = (productId, field, value) => {
    setItems(prev => prev.map(i => {
      if (i.product_id !== productId) return i
      const updated = { ...i, [field]: value }
      updated.subtotal = Number(updated.quantity || 0) * Number(updated.unit_cost || 0)
      return updated
    }))
  }

  const removeItem = (productId) => {
    setItems(prev => prev.filter(i => i.product_id !== productId))
  }

  const total = items.reduce((sum, i) => sum + i.subtotal, 0)

  const PURCHASE_SORT_OPTIONS = {
    'newest': { label: 'Newest First', sort: (a, b) => new Date(b.purchase_date) - new Date(a.purchase_date) || b.id - a.id },
    'oldest': { label: 'Oldest First', sort: (a, b) => new Date(a.purchase_date) - new Date(b.purchase_date) || a.id - b.id },
    'amount-desc': { label: 'Highest Amount', sort: (a, b) => b.total_amount - a.total_amount },
    'amount-asc': { label: 'Lowest Amount', sort: (a, b) => a.total_amount - b.total_amount },
    'pending-first': { label: 'Pending First', sort: (a, b) => (a.status === 'received') - (b.status === 'received') }
  }

  const filteredPurchases = purchases
    .filter(p =>
      !historySearch.trim() ||
      p.supplier_name.toLowerCase().includes(historySearch.trim().toLowerCase()) ||
      String(p.id).includes(historySearch.trim())
    )
    .sort(PURCHASE_SORT_OPTIONS[historySortBy].sort)

  const handleAddSupplier = async (e) => {
    e.preventDefault()

    const { data, error } = await supabase
      .from('suppliers')
      .insert([{ ...supplierForm, created_at: new Date().toISOString() }])
      .select()
      .single()

    if (error) {
      setError(error.message || 'Failed to add supplier')
      return
    }

    await loadSuppliers()
    setSupplierId(String(data.id))
    setSupplierForm({ name: '', contact_person: '', phone: '', email: '', address: '' })
    setShowSupplierForm(false)
  }

  const handleCreatePurchase = async () => {
    setError('')
    setMessage('')

    if (!supplierId) {
      setError('Select a supplier')
      return
    }
    if (items.length === 0) {
      setError('Add at least one item')
      return
    }

    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0)

    const { data: purchase, error: purchaseError } = await supabase
      .from('purchases')
      .insert([{
        supplier_id: supplierId,
        total_amount: totalAmount,
        purchase_date: new Date().toISOString(),
        user_id: user?.id || null,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single()

    if (purchaseError) {
      setError(purchaseError.message || 'Failed to create purchase order')
      return
    }

    const purchaseItems = items.map(item => ({
      purchase_id: purchase.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      subtotal: item.subtotal
    }))

    const { error: itemsError } = await supabase
      .from('purchase_items')
      .insert(purchaseItems)

    if (itemsError) {
      setError(itemsError.message || 'Purchase order created but items failed to save')
      return
    }

    setMessage(`Purchase order #${purchase.id} created`)
    setItems([])
    setSupplierId('')
    loadPurchases()
  }

  const handleReceive = async (purchaseId) => {
    const { error } = await supabase.rpc('receive_purchase', { p_purchase_id: purchaseId })
    if (error) {
      alert(error.message || 'Failed to receive purchase')
      return
    }
    loadPurchases()
  }

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1">
        <Navbar />
        <div className="p-4 sm:p-8">
          <h1 className="text-3xl font-bold mb-6">Purchase</h1>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2 bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-4">New Purchase Order</h2>

              <Field label="Supplier" className="mb-2">
                <div className="flex gap-2">
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="flex-1 px-4 py-2 border rounded"
                  >
                    <option value="">Select Supplier</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowSupplierForm(v => !v)}
                    className="px-4 py-2 border rounded hover:bg-gray-50"
                  >
                    + Supplier
                  </button>
                </div>
              </Field>

              {showSupplierForm && (
                <form onSubmit={handleAddSupplier} className="border rounded p-4 mb-4 bg-gray-50 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Supplier Name" className="sm:col-span-2">
                    <input required placeholder="Supplier Name" value={supplierForm.name}
                      onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                      className="w-full px-3 py-2 border rounded" />
                  </Field>
                  <Field label="Contact Person">
                    <input placeholder="Contact Person" value={supplierForm.contact_person}
                      onChange={(e) => setSupplierForm({ ...supplierForm, contact_person: e.target.value })}
                      className="w-full px-3 py-2 border rounded" />
                  </Field>
                  <Field label="Phone">
                    <input placeholder="Phone" value={supplierForm.phone}
                      onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                      className="w-full px-3 py-2 border rounded" />
                  </Field>
                  <Field label="Email">
                    <input placeholder="Email" value={supplierForm.email}
                      onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
                      className="w-full px-3 py-2 border rounded" />
                  </Field>
                  <Field label="Address">
                    <input placeholder="Address" value={supplierForm.address}
                      onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                      className="w-full px-3 py-2 border rounded" />
                  </Field>
                  <button type="submit" className="sm:col-span-2 bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
                    Save Supplier
                  </button>
                </form>
              )}

              <div className="flex flex-col sm:flex-row gap-2 mb-4 sm:items-end">
                <Field label="Add Product (scan barcode or search)" className="relative flex-1">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Scan barcode or search product to add..."
                    value={searchTerm}
                    onChange={(e) => handleSearch(e.target.value)}
                    onKeyDown={handleBarcodeEnter}
                    className="w-full px-4 py-2 border rounded"
                  />
                  {scanFlash && (
                    <div className="absolute z-20 -top-2 right-0 translate-y-[-100%] bg-green-600 text-white text-sm px-3 py-1 rounded shadow">
                      ✓ Added: {scanFlash}
                    </div>
                  )}
                  {searchResults.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border rounded mt-1 shadow-lg max-h-64 overflow-y-auto">
                      {searchResults.map(p => (
                        <button
                          key={p.id}
                          onClick={() => addItem(p)}
                          className="w-full text-left px-4 py-2 hover:bg-gray-100 flex justify-between"
                        >
                          <span>{p.name} <span className="text-gray-400 text-sm">({p.sku})</span></span>
                          <span className="text-gray-600">Cost ₹{p.cost_price}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchTerm.trim() && searchResults.length === 0 && (
                    <div className="absolute z-10 w-full bg-white border rounded mt-1 shadow-lg">
                      <EmptyState title="No products found" message="Try a different name, SKU, or barcode, or add it as a new product." />
                    </div>
                  )}
                </Field>
                <button
                  type="button"
                  onClick={() => setShowNewProductForm(v => !v)}
                  className="px-4 py-2 border rounded hover:bg-gray-50 whitespace-nowrap"
                >
                  + New Product
                </button>
              </div>

              {showNewProductForm && (
                <form onSubmit={handleAddNewProduct} className="border rounded p-4 mb-4 bg-gray-50 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Product Name" className="sm:col-span-2">
                    <input required placeholder="Product Name" value={newProductForm.name}
                      onChange={(e) => setNewProductForm({ ...newProductForm, name: e.target.value })}
                      className="w-full px-3 py-2 border rounded" />
                  </Field>
                  <Field label="SKU">
                    <input placeholder="SKU" value={newProductForm.sku}
                      onChange={(e) => setNewProductForm({ ...newProductForm, sku: e.target.value })}
                      className="w-full px-3 py-2 border rounded" />
                  </Field>
                  <Field label="Barcode (scan or type)">
                    <input
                      ref={newProductBarcodeRef}
                      placeholder="Scan barcode..." value={newProductForm.barcode}
                      onChange={(e) => { setNewProductForm({ ...newProductForm, barcode: e.target.value }); checkDuplicateBarcode(e.target.value) }}
                      onKeyDown={handleBarcodeFieldKeyDown}
                      className={`w-full px-3 py-2 border rounded ${duplicateBarcodeMatch ? 'border-red-500' : ''}`} />
                    {duplicateBarcodeMatch && (
                      <div className="text-xs mt-1">
                        <p className="text-red-600">Already used by "{duplicateBarcodeMatch.name}"</p>
                        <button
                          type="button"
                          onClick={() => {
                            addItem(duplicateBarcodeMatch)
                            setNewProductForm({ name: '', sku: '', barcode: '', category_id: '', cost_price: '', selling_price: '' })
                            setDuplicateBarcodeMatch(null)
                            setShowNewProductForm(false)
                          }}
                          className="text-blue-600 hover:underline"
                        >
                          Add "{duplicateBarcodeMatch.name}" to order instead
                        </button>
                      </div>
                    )}
                  </Field>
                  <Field label="Category" className="sm:col-span-2">
                    <select value={newProductForm.category_id}
                      onChange={(e) => setNewProductForm({ ...newProductForm, category_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded mb-2">
                      <option value="">No Category</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <label className="block text-xs text-gray-500 mb-1">New Category</label>
                    <div className="flex gap-2">
                      <input
                        type="text" placeholder="New category name"
                        value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
                        className="flex-1 px-3 py-2 border rounded text-sm"
                      />
                      <button type="button" onClick={handleAddCategory} className="px-3 py-2 border rounded text-sm hover:bg-gray-50">
                        Add
                      </button>
                    </div>
                  </Field>
                  <Field label="Cost Price">
                    <input required type="number" min="0" step="0.01" placeholder="Cost Price" value={newProductForm.cost_price}
                      onChange={(e) => setNewProductForm({ ...newProductForm, cost_price: e.target.value })}
                      className="w-full px-3 py-2 border rounded" />
                  </Field>
                  <Field label="Selling Price">
                    <input required type="number" min="0" step="0.01" placeholder="Selling Price" value={newProductForm.selling_price}
                      onChange={(e) => setNewProductForm({ ...newProductForm, selling_price: e.target.value })}
                      className="w-full px-3 py-2 border rounded" />
                  </Field>
                  <button
                    type="submit"
                    disabled={!!duplicateBarcodeMatch}
                    className="sm:col-span-2 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    Add & Include in Order
                  </button>
                </form>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2">Product</th>
                      <th className="py-2 text-center">Qty</th>
                      <th className="py-2 text-right">Unit Cost</th>
                      <th className="py-2 text-right">Subtotal</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.product_id} className="row-in border-b">
                        <td className="py-2">{item.name}</td>
                        <td className="py-2 text-center">
                          <input type="number" min="1" value={item.quantity}
                            onChange={(e) => updateItem(item.product_id, 'quantity', parseInt(e.target.value) || 1)}
                            className="w-16 text-center border rounded" />
                        </td>
                        <td className="py-2 text-right">
                          <input type="number" min="0" step="0.01" value={item.unit_cost}
                            onChange={(e) => updateItem(item.product_id, 'unit_cost', parseFloat(e.target.value) || 0)}
                            className="w-24 text-right border rounded" />
                        </td>
                        <td className="py-2 text-right">₹{item.subtotal.toFixed(2)}</td>
                        <td className="py-2 text-right">
                          <button onClick={() => removeItem(item.product_id)} className="text-red-600 hover:underline">Remove</button>
                        </td>
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr><td colSpan="5" className="py-6 text-center text-gray-400">No items added</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 h-fit">
              <div className="flex justify-between text-2xl font-bold mb-4">
                <span>Total</span>
                <span>₹{total.toFixed(2)}</span>
              </div>
              {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}
              {message && <p className="text-green-600 mb-4 text-sm">{message}</p>}
              <button
                onClick={handleCreatePurchase}
                className="w-full bg-green-600 text-white py-3 rounded hover:bg-green-700 font-bold"
              >
                Create Purchase Order
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="flex flex-wrap justify-between items-end gap-3 p-6 pb-0">
              <h2 className="text-xl font-bold">Purchase History</h2>
              <div className="flex flex-wrap gap-4">
                <Field label="Search">
                  <input
                    type="text"
                    placeholder="Search by supplier or #..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="px-4 py-2 border rounded text-sm w-full sm:w-64"
                  />
                </Field>
                <Field label="Sort By">
                  <select
                    value={historySortBy}
                    onChange={(e) => setHistorySortBy(e.target.value)}
                    className="px-4 py-2 border rounded text-sm"
                  >
                    {Object.entries(PURCHASE_SORT_OPTIONS).map(([key, { label }]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full mt-4">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left">#</th>
                    <th className="px-6 py-3 text-left">Supplier</th>
                    <th className="px-6 py-3 text-left">Date</th>
                    <th className="px-6 py-3 text-right">Total</th>
                    <th className="px-6 py-3 text-center">Status</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                {loading ? (
                  <TableSkeleton rows={6} cols={6} />
                ) : filteredPurchases.length === 0 ? (
                  <tbody>
                    <tr><td colSpan="6">
                      <EmptyState
                        title={historySearch.trim() ? 'No purchases match your search' : 'No purchases yet'}
                        message={historySearch.trim() ? undefined : 'Create your first purchase order above to start tracking stock coming in.'}
                      />
                    </td></tr>
                  </tbody>
                ) : (
                  <tbody>
                    {filteredPurchases.map(p => (
                      <tr key={p.id} className="row-in border-b hover:bg-gray-50">
                        <td className="px-6 py-4">{p.id}</td>
                        <td className="px-6 py-4">{p.supplier_name}</td>
                        <td className="px-6 py-4">{new Date(p.purchase_date).toLocaleDateString()}</td>
                        <td className="px-6 py-4 text-right">₹{p.total_amount.toFixed(2)}</td>
                        <td className="px-6 py-4 text-center">
                          <span className={`px-2 py-1 rounded text-xs ${p.status === 'received' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right space-x-3 whitespace-nowrap">
                          <button onClick={() => openPurchaseDetail(p.id)} className="text-blue-600 hover:underline">
                            View
                          </button>
                          {p.status !== 'received' && (
                            <button onClick={() => handleReceive(p.id)} className="text-blue-600 hover:underline">
                              Receive
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                )}
              </table>
            </div>
          </div>
        </div>
      </div>

      {viewingPurchase && (
        <div className="overlay-in fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-20">
          <div className="panel-in bg-white rounded-lg shadow-lg p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">Purchase #{viewingPurchase.id}</h2>
                <p className="text-sm text-gray-500">
                  {viewingPurchase.supplier_name} · {new Date(viewingPurchase.purchase_date).toLocaleString()}
                </p>
              </div>
              <button onClick={() => setViewingPurchase(null)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2">Product</th>
                  <th className="py-2">SKU</th>
                  <th className="py-2 text-center">Qty</th>
                  <th className="py-2 text-right">Unit Cost</th>
                  <th className="py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {viewingPurchase.items.map(item => (
                  <tr key={item.id} className="row-in border-b">
                    <td className="py-2">{item.product_name}</td>
                    <td className="py-2 text-gray-500">{item.sku}</td>
                    <td className="py-2 text-center">{item.quantity}</td>
                    <td className="py-2 text-right">₹{item.unit_cost}</td>
                    <td className="py-2 text-right">₹{item.subtotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t pt-3 space-y-1">
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>₹{viewingPurchase.total_amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-600 capitalize">
                <span>Status</span>
                <span>{viewingPurchase.status}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
