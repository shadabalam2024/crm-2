import { useState, useEffect, useRef } from 'react'
import Navbar from '../../components/Navbar'
import Sidebar from '../../components/Sidebar'
import EmptyState from '../../components/EmptyState'
import { TableSkeleton } from '../../components/Skeleton'
import { supabase } from '../../lib/supabaseClient'

const emptyForm = {
  name: '', sku: '', barcode: '', category_id: '',
  cost_price: '', selling_price: '', current_stock: '', min_stock_level: '5'
}

const csvEscape = (value) => {
  const str = String(value ?? '')
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

export default function InventoryPage() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [newCategory, setNewCategory] = useState('')
  const [adjustingProduct, setAdjustingProduct] = useState(null)
  const [adjustStock, setAdjustStock] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('stock-desc')
  const [exportMessage, setExportMessage] = useState('')
  const [exportError, setExportError] = useState(false)
  const [viewingHistoryFor, setViewingHistoryFor] = useState(null)
  const [priceHistory, setPriceHistory] = useState(null)
  const [loading, setLoading] = useState(true)
  const barcodeInputRef = useRef(null)

  useEffect(() => {
    (async () => {
      await Promise.all([loadProducts(), loadCategories()])
      setLoading(false)
    })()
  }, [])

  useEffect(() => {
    if (showForm && !editingId) {
      barcodeInputRef.current?.focus()
    }
  }, [showForm, editingId])

  const handleBarcodeFieldKeyDown = (e) => {
    // Scanners send Enter after typing the code - don't let that submit the whole form
    if (e.key === 'Enter') e.preventDefault()
  }

  const handleExportCsv = () => {
    setExportMessage('')

    if (products.length === 0) {
      setExportError(true)
      setExportMessage('No products to export')
      return
    }

    const categoryName = (id) => categories.find(c => c.id === id)?.name || ''
    const header = ['Name', 'SKU', 'Barcode', 'Category', 'Cost Price', 'Selling Price', 'Current Stock', 'Min Stock Level']
    const rows = products.map(p => [
      p.name, p.sku, p.barcode, categoryName(p.category_id),
      p.cost_price, p.selling_price, p.current_stock, p.min_stock_level,
    ])
    const csv = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)

    setExportError(false)
    setExportMessage('Exported inventory.csv')
    setTimeout(() => setExportMessage(''), 5000)
  }

  const openPriceHistory = async (product) => {
    setViewingHistoryFor(product)
    const { data: history } = await supabase
      .from('price_history')
      .select('*')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })

    setPriceHistory(history || [])
  }

  const loadProducts = async () => {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setProducts([])
      return
    }

    setProducts(data || [])
  }

  const loadCategories = async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('name', { ascending: true })

    if (error) {
      setCategories([])
      return
    }

    setCategories(data || [])
  }

  const openAddForm = () => {
    setForm(emptyForm)
    setEditingId(null)
    setError('')
    setShowForm(true)
  }

  const openEditForm = (product) => {
    setForm({
      name: product.name,
      sku: product.sku || '',
      barcode: product.barcode || '',
      category_id: product.category_id || '',
      cost_price: product.cost_price,
      selling_price: product.selling_price,
      current_stock: product.current_stock,
      min_stock_level: product.min_stock_level
    })
    setEditingId(product.id)
    setError('')
    setShowForm(true)
  }

  const handleAddCategory = async () => {
    if (!newCategory.trim()) return

    const trimmed = newCategory.trim()

    const { data: existing, error: existingError } = await supabase
      .from('categories')
      .select('*')
      .ilike('name', trimmed)
      .maybeSingle()

    if ((existing || existingError) && existing?.id) {
      setForm(f => ({ ...f, category_id: existing.id }))
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
    setForm(f => ({ ...f, category_id: data.id }))
    setNewCategory('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const payload = {
      name: form.name,
      sku: form.sku || null,
      barcode: form.barcode || null,
      category_id: form.category_id || null,
      cost_price: parseFloat(form.cost_price),
      selling_price: parseFloat(form.selling_price),
      current_stock: parseInt(form.current_stock) || 0,
      min_stock_level: parseInt(form.min_stock_level) || 5
    }

    if (editingId) {
      const { error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', editingId)

      if (error) {
        setError(error.message || 'Failed to save product')
        return
      }
    } else {
      const { error } = await supabase
        .from('products')
        .insert([{ ...payload, created_at: new Date().toISOString() }])

      if (error) {
        setError(error.message || 'Failed to save product')
        return
      }
    }

    setShowForm(false)
    loadProducts()
  }

  const handleDelete = async (product) => {
    if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) return

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', product.id)

    if (error) {
      alert(error.message || 'Failed to delete product')
      return
    }

    loadProducts()
  }

  const openAdjustStock = (product) => {
    setAdjustingProduct(product)
    setAdjustStock(String(product.current_stock))
    setAdjustReason('')
  }

  const handleAdjustStock = async (e) => {
    e.preventDefault()

    const { error } = await supabase
      .from('products')
      .update({ current_stock: parseInt(adjustStock) || 0 })
      .eq('id', adjustingProduct.id)

    if (error) {
      alert(error.message || 'Failed to adjust stock')
      return
    }

    setAdjustingProduct(null)
    loadProducts()
  }

  const SORT_OPTIONS = {
    'stock-desc': { label: 'Most in Stock', sort: (a, b) => b.current_stock - a.current_stock },
    'stock-asc': { label: 'Least in Stock', sort: (a, b) => a.current_stock - b.current_stock },
    'newest': { label: 'Newest Added', sort: (a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id },
    'oldest': { label: 'Oldest Added', sort: (a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id },
    'name': { label: 'Name (A-Z)', sort: (a, b) => a.name.localeCompare(b.name) }
  }

  const filteredProducts = products
    .filter(p => {
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return p.name.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q)
    })
    .sort(SORT_OPTIONS[sortBy].sort)

  const duplicateBarcode = form.barcode.trim()
    ? products.find(p => p.barcode === form.barcode.trim() && p.id !== editingId)
    : null
  const duplicateSku = form.sku.trim()
    ? products.find(p => p.sku === form.sku.trim() && p.id !== editingId)
    : null

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1">
        <Navbar />
        <div className="p-4 sm:p-8">
          <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
            <h1 className="text-3xl font-bold">Inventory</h1>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleExportCsv}
                className="border border-gray-300 px-4 py-2 rounded hover:bg-gray-50"
              >
                Export to Excel
              </button>
              <button
                onClick={openAddForm}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                + Add Product
              </button>
            </div>
          </div>
          {exportMessage && <p className={`text-sm mb-4 ${exportError ? 'text-red-600' : 'text-green-600'}`}>{exportMessage}</p>}

          <div className="flex flex-wrap gap-4 mb-4">
            <div className="flex-1 min-w-[180px] max-w-sm">
              <label className="block text-xs text-gray-500 mb-1">Search</label>
              <input
                type="text"
                placeholder="Search by name, SKU, or barcode..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-4 py-2 border rounded"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-4 py-2 border rounded"
              >
                {Object.entries(SORT_OPTIONS).map(([key, { label }]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-6 py-3 text-left">Product</th>
                  <th className="px-6 py-3 text-left">SKU</th>
                  <th className="px-6 py-3 text-left">Category</th>
                  <th className="px-6 py-3 text-right">Stock</th>
                  <th className="px-6 py-3 text-right">Cost</th>
                  <th className="px-6 py-3 text-right">Price</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              {loading ? (
                <TableSkeleton rows={8} cols={7} />
              ) : (
                <tbody>
                  {filteredProducts.map(p => (
                    <tr key={p.id} className={`row-in border-b hover:bg-gray-50 ${p.current_stock <= p.min_stock_level ? 'bg-orange-50' : ''}`}>
                      <td className="px-6 py-4">{p.name}</td>
                      <td className="px-6 py-4 text-gray-500">{p.sku}</td>
                      <td className="px-6 py-4 text-gray-500">{p.category_name || '-'}</td>
                      <td className={`px-6 py-4 text-right ${p.current_stock <= p.min_stock_level ? 'text-orange-600 font-bold' : ''}`}>
                        {p.current_stock}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => openPriceHistory(p)} className="text-blue-600 hover:underline">
                          ₹{p.cost_price}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">₹{p.selling_price}</td>
                      <td className="px-6 py-4 text-right space-x-3 whitespace-nowrap">
                        <button onClick={() => openAdjustStock(p)} className="text-blue-600 hover:underline">Stock</button>
                        <button onClick={() => openEditForm(p)} className="text-blue-600 hover:underline">Edit</button>
                        <button onClick={() => handleDelete(p)} className="text-red-600 hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && (
                    <tr><td colSpan="7">
                      {search.trim() ? (
                        <EmptyState title="No products match your search" message="Try a different name, SKU, or barcode." />
                      ) : (
                        <EmptyState title="No products yet" message="Add your first product to start tracking inventory." actionLabel="+ Add Product" onAction={openAddForm} />
                      )}
                    </td></tr>
                  )}
                </tbody>
              )}
            </table>
            </div>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="overlay-in fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-20">
          <div className="panel-in bg-white rounded-lg shadow-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">{editingId ? 'Edit Product' : 'Add Product'}</h2>
            <form onSubmit={handleSubmit}>
              <label className="block text-xs text-gray-500 mb-1">Product Name</label>
              <input
                type="text" placeholder="Product Name" required
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-2 border rounded mb-3"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">SKU</label>
                  <input
                    type="text" placeholder="SKU"
                    value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className={`w-full px-4 py-2 border rounded ${duplicateSku ? 'border-red-500' : ''}`}
                  />
                  {duplicateSku && (
                    <div className="text-xs mt-1">
                      <p className="text-red-600">Already used by "{duplicateSku.name}"</p>
                      <button type="button" onClick={() => openEditForm(duplicateSku)} className="text-blue-600 hover:underline">
                        Edit "{duplicateSku.name}" instead
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Barcode (scan or type)</label>
                  <input
                    ref={barcodeInputRef}
                    type="text" placeholder="Scan barcode..."
                    value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    onKeyDown={handleBarcodeFieldKeyDown}
                    className={`w-full px-4 py-2 border rounded ${duplicateBarcode ? 'border-red-500' : ''}`}
                  />
                  {duplicateBarcode && (
                    <div className="text-xs mt-1">
                      <p className="text-red-600">Already used by "{duplicateBarcode.name}"</p>
                      <button type="button" onClick={() => openEditForm(duplicateBarcode)} className="text-blue-600 hover:underline">
                        Edit "{duplicateBarcode.name}" instead
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">Category</label>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  className="w-full px-4 py-2 border rounded mb-2"
                >
                  <option value="">No Category</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <label className="block text-xs text-gray-500 mb-1">New Category</label>
                <div className="flex gap-2">
                  <input
                    type="text" placeholder="New category name"
                    value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
                    className="flex-1 px-4 py-2 border rounded text-sm"
                  />
                  <button type="button" onClick={handleAddCategory} className="px-3 py-2 border rounded text-sm hover:bg-gray-50">
                    Add
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Cost Price</label>
                  <input
                    type="number" step="0.01" min="0" required placeholder="0.00"
                    value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                    className="w-full px-4 py-2 border rounded"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Selling Price</label>
                  <input
                    type="number" step="0.01" min="0" required placeholder="0.00"
                    value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                    className="w-full px-4 py-2 border rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {editingId ? 'Current Stock (use "Stock" action to adjust)' : 'Opening Stock'}
                  </label>
                  <input
                    type="number" min="0" placeholder="0"
                    value={form.current_stock}
                    disabled={!!editingId}
                    onChange={(e) => setForm({ ...form, current_stock: e.target.value })}
                    className="w-full px-4 py-2 border rounded disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Min Stock Level</label>
                  <input
                    type="number" min="0" placeholder="5"
                    value={form.min_stock_level} onChange={(e) => setForm({ ...form, min_stock_level: e.target.value })}
                    className="w-full px-4 py-2 border rounded"
                  />
                </div>
              </div>

              {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border py-2 rounded hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!!duplicateBarcode || !!duplicateSku}
                  className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {editingId ? 'Save Changes' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {adjustingProduct && (
        <div className="overlay-in fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-20">
          <div className="panel-in bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold mb-1">Adjust Stock</h2>
            <p className="text-sm text-gray-500 mb-4">{adjustingProduct.name}</p>
            <form onSubmit={handleAdjustStock}>
              <label className="block text-xs text-gray-500 mb-1">New Stock Quantity</label>
              <input
                type="number" min="0" required autoFocus
                value={adjustStock} onChange={(e) => setAdjustStock(e.target.value)}
                className="w-full px-4 py-2 border rounded mb-3"
              />
              <label className="block text-xs text-gray-500 mb-1">Reason</label>
              <input
                type="text" placeholder="e.g. stock count correction, damage"
                value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)}
                className="w-full px-4 py-2 border rounded mb-4"
              />
              <div className="flex gap-3">
                <button type="button" onClick={() => setAdjustingProduct(null)} className="flex-1 border py-2 rounded hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewingHistoryFor && (
        <div className="overlay-in fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-20">
          <div className="panel-in bg-white rounded-lg shadow-lg p-6 w-full max-w-4xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">Price History</h2>
                <p className="text-sm text-gray-500">{viewingHistoryFor.name}</p>
              </div>
              <button onClick={() => { setViewingHistoryFor(null); setPriceHistory(null) }} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            {!priceHistory && (
              <table className="w-full text-sm"><TableSkeleton rows={4} cols={6} /></table>
            )}
            {priceHistory && priceHistory.length === 0 && (
              <EmptyState title="No price changes yet" message="Current cost was set when the product was created." />
            )}
            {priceHistory && priceHistory.length > 0 && (
              <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-3 px-3 whitespace-nowrap">Date</th>
                    <th className="py-3 px-3">Source</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Qty</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Old Rate</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">New Rate</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {priceHistory.map(h => {
                    const hasOld = h.old_cost_price != null
                    const diff = hasOld ? h.new_cost_price - h.old_cost_price : 0
                    const pct = hasOld && h.old_cost_price !== 0 ? (diff / h.old_cost_price) * 100 : null
                    const increased = hasOld && diff > 0
                    const decreased = hasOld && diff < 0
                    return (
                      <tr key={h.id} className="row-in border-b align-top">
                        <td className="py-3 px-3 whitespace-nowrap">{new Date(h.changed_at).toLocaleString()}</td>
                        <td className="py-3 px-3 text-gray-500">
                          {h.source === 'purchase' ? `Purchase${h.supplier_name ? ` (${h.supplier_name})` : ''}` : 'Manual edit'}
                          {h.source === 'purchase' && h.unit_cost != null && (
                            <div className="text-xs text-gray-400 mt-0.5">bought at ₹{h.unit_cost.toFixed(2)}/unit</div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">{h.quantity ?? '-'}</td>
                        <td className="py-3 px-3 text-right text-gray-500 whitespace-nowrap">{hasOld ? `₹${h.old_cost_price.toFixed(2)}` : '—'}</td>
                        <td className="py-3 px-3 text-right font-medium whitespace-nowrap">₹{h.new_cost_price.toFixed(2)}</td>
                        <td className={`py-3 px-3 text-right font-medium whitespace-nowrap ${increased ? 'text-red-600' : decreased ? 'text-green-600' : 'text-gray-400'}`}>
                          {hasOld
                            ? <>{increased ? '▲' : decreased ? '▼' : '—'} ₹{Math.abs(diff).toFixed(2)}<div className="text-xs font-normal">{pct !== null ? `(${diff >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(1)}%)` : ''}</div></>
                            : 'Initial'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
