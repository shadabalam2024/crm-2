import { useState, useEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Sidebar from '../../components/Sidebar'
import EmptyState from '../../components/EmptyState'
import { TableSkeleton } from '../../components/Skeleton'
import { supabase } from '../../lib/supabaseClient'
import { createScanTracker } from '../../utils/scanTracker'
import useGlobalScanRedirect from '../../hooks/useGlobalScanRedirect'



const normalize = (value = '') => value.toString().trim().toLowerCase()

const formatInvoiceDate = (value) => {
  const safeValue = value || new Date().toISOString()
  const date = new Date(safeValue)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

const scoreProductMatch = (product, query) => {
  const q = normalize(query)
  if (!q) return 0

  const matches = [
    product.name,
    product.sku,
    product.barcode,
    product.category_name,
  ].filter(Boolean)

  let score = 0
  for (const text of matches) {
    const value = normalize(text)
    if (!value) continue
    if (value === q) score += 100
    if (value.startsWith(q)) score += 40
    if (value.includes(q)) score += 20
  }

  return score
}

export default function BillingPage() {
  const user = useSelector(state => state.auth.user)

  const [billNumber, setBillNumber] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [cart, setCart] = useState([])
  const [customers, setCustomers] = useState([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [discountType, setDiscountType] = useState('flat')
  const [discount, setDiscount] = useState(0)
  const [paymentMode, setPaymentMode] = useState('cash')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [scanFlash, setScanFlash] = useState(null)
  const searchInputRef = useRef(null)
  const scanTrackerRef = useRef(createScanTracker())

  const [invoiceHistory, setInvoiceHistory] = useState([])
  const [historySearch, setHistorySearch] = useState('')
  const [viewingInvoice, setViewingInvoice] = useState(null)
  const [lastInvoiceId, setLastInvoiceId] = useState(null)
  const [gstRate, setGstRate] = useState(0)
  const [showCustomItemForm, setShowCustomItemForm] = useState(false)
  const [customItemName, setCustomItemName] = useState('')
  const [customItemPrice, setCustomItemPrice] = useState('')
  const [loading, setLoading] = useState(true)

  const printInvoice = (invoiceId) => {
    if (!invoiceId) return
    window.open(`/print/${invoiceId}`, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    loadBillNumber()
    searchInputRef.current?.focus()
    ;(async () => {
      await Promise.all([loadCustomers(), loadInvoiceHistory(), loadShopSettings()])
      setLoading(false)
    })()
  }, [])

  const loadShopSettings = async () => {
    const { data, error } = await supabase
      .from('shop_settings')
      .select('*')
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      setGstRate(0)
      return
    }

    setGstRate(Number(data.gst_rate) || 0)
  }

  const loadInvoiceHistory = async () => {
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .order('invoice_date', { ascending: false })
      .limit(50)

    if (error) {
      setInvoiceHistory([])
      return
    }

    setInvoiceHistory(data || [])
  }

  const openInvoiceDetail = async (invoiceId) => {
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle()

    if (invoiceError || !invoice) {
      setViewingInvoice(null)
      return
    }

    const { data: items } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId)

    setViewingInvoice({ ...invoice, items: items || [] })
  }

  const loadBillNumber = async () => {
    const { data, error } = await supabase
      .from('invoices')
      .select('bill_number')
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !data || data.length === 0) {
      setBillNumber('INV-0001')
      return
    }

    const latest = data[0]?.bill_number || 'INV-0000'
    const num = Number(String(latest).replace(/\D/g, '')) || 0
    setBillNumber(`INV-${String(num + 1).padStart(4, '0')}`)
  }

  const loadCustomers = async () => {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setCustomers([])
      return
    }

    setCustomers(data || [])
  }

  const recalcItem = (item) => {
    const lineTotal = item.quantity * item.unit_price
    const itemDiscount = item.discountType === 'percent'
      ? lineTotal * (Number(item.discountValue || 0) / 100)
      : Math.min(Math.max(0, Number(item.discountValue || 0)), lineTotal)
    return { ...item, itemDiscount, subtotal: lineTotal - itemDiscount }
  }

  const flashScan = (name) => {
    setScanFlash(name)
    setTimeout(() => setScanFlash(current => current === name ? null : current), 1200)
  }

  const addToCart = (product, viaScan = false) => {
    setError('')
    if (viaScan) flashScan(product.name)
    setCart(prev => {
      const existing = prev.find(item => item.product_id === product.id)
      if (existing) {
        if (existing.quantity + 1 > product.current_stock) {
          setError(`Only ${product.current_stock} in stock for ${product.name}`)
          return prev
        }
        return prev.map(item =>
          item.product_id === product.id
            ? recalcItem({ ...item, quantity: item.quantity + 1 })
            : item
        )
      }
      if (product.current_stock < 1) {
        setError(`${product.name} is out of stock`)
        return prev
      }
      return [...prev, {
        product_id: product.id,
        name: product.name,
        unit_price: product.selling_price,
        current_stock: product.current_stock,
        isCustom: !!product.is_custom,
        quantity: 1,
        discountType: 'flat',
        discountValue: 0,
        itemDiscount: 0,
        subtotal: product.selling_price
      }]
    })
    setSearchTerm('')
    setSearchResults([])
    searchInputRef.current?.focus()
  }

  const handleAddCustomItem = async (e) => {
    e.preventDefault()
    setError('')

    if (!customItemName.trim() || !customItemPrice || Number(customItemPrice) <= 0) {
      setError('Enter a name and a price greater than 0 for the custom item')
      return
    }

    const { data: product, error: insertError } = await supabase
      .from('products')
      .insert([{
        name: customItemName.trim(),
        cost_price: 0,
        selling_price: parseFloat(customItemPrice),
        current_stock: 0,
        min_stock_level: 0,
        is_custom: true,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single()

    if (insertError) {
      setError(insertError.message || 'Failed to add custom item')
      return
    }

    addToCart({
      id: product.id,
      name: product.name,
      selling_price: product.selling_price,
      current_stock: 999999,
      is_custom: true
    })
    setCustomItemName('')
    setCustomItemPrice('')
    setShowCustomItemForm(false)
  }

  const handleSearch = async (value) => {
    scanTrackerRef.current.onKeystroke()
    setSearchTerm(value)

    const query = value.trim()
    if (!query) {
      setSearchResults([])
      scanTrackerRef.current.reset()
      return
    }

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .or(`name.ilike.%${query}%,sku.ilike.%${query}%,barcode.ilike.%${query}%`)
      .limit(10)

    if (error) {
      setSearchResults([])
      return
    }

    setSearchResults(data || [])
  }

  // Shared by the search field's own Enter handler AND by useGlobalScanRedirect (when
  // a scan lands in some other field entirely, e.g. Customer Name, because that's what
  // had focus - the redirect hook strips it back out of that field and routes it here).
  const processScannedCode = async (code, { scanLike = true } = {}) => {
    const cleanedCode = code.trim()
    setSearchTerm(cleanedCode)

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .or(`barcode.eq."${cleanedCode}",name.ilike.%${cleanedCode}%,sku.ilike.%${cleanedCode}%`)
      .limit(10)

    if (error) {
      setError(`No product found for "${cleanedCode}"`)
      setSearchResults([])
      return
    }

    const exact = (data || []).find(product => normalize(product.barcode) === normalize(cleanedCode))
    if (exact) {
      addToCart(exact, true)
      setSearchTerm('')
      setSearchResults([])
      return
    }

    const list = data || []

    if (list.length === 0) {
      setError(`No product found for "${cleanedCode}"`)
      setSearchResults([])
    } else if (scanLike && list.length === 1) {
      addToCart(list[0], true)
      setSearchTerm('')
      setSearchResults([])
    } else {
      setSearchResults(list)
    }
  }

  const handleBarcodeEnter = async (e) => {
    if (e.key !== 'Enter' || !searchTerm.trim()) return
    e.preventDefault()
    await processScannedCode(searchTerm.trim(), { scanLike: scanTrackerRef.current.isScanLike() })
    scanTrackerRef.current.reset()
  }

  useGlobalScanRedirect(searchInputRef, (code) => processScannedCode(code, { scanLike: true }))

  const updateQuantity = (productId, quantity) => {
    setError('')
    setCart(prev => prev.map(item => {
      if (item.product_id !== productId) return item
      const qty = Math.max(1, quantity)
      if (qty > item.current_stock) {
        setError(`Only ${item.current_stock} in stock for ${item.name}`)
        return item
      }
      return recalcItem({ ...item, quantity: qty })
    }))
  }

  const updateItemDiscount = (productId, discountValue) => {
    setCart(prev => prev.map(item =>
      item.product_id === productId ? recalcItem({ ...item, discountValue }) : item
    ))
  }

  const updateItemDiscountType = (productId, discountType) => {
    setCart(prev => prev.map(item =>
      item.product_id === productId ? recalcItem({ ...item, discountType }) : item
    ))
  }

  const removeFromCart = (productId) => {
    setCart(prev => prev.filter(item => item.product_id !== productId))
  }

  const nameQuery = customerName.trim().toLowerCase()
  const phoneQuery = customerPhone.trim()
  const customerMatches = (!selectedCustomer && (nameQuery || phoneQuery))
    ? customers.filter(c =>
        (!nameQuery || c.name.toLowerCase().includes(nameQuery)) &&
        (!phoneQuery || (c.phone || '').includes(phoneQuery))
      ).slice(0, 6)
    : []

  const selectCustomer = (c) => {
    setSelectedCustomer(c)
    setCustomerName(c.name || '')
    setCustomerPhone(c.phone || '')
  }

  const clearCustomer = () => {
    setSelectedCustomer(null)
    setCustomerName('')
    setCustomerPhone('')
  }

  const handleQuickAddCustomer = async () => {
    if (!customerName.trim()) {
      setError('Enter a name for the new customer')
      return
    }

    const trimmedName = customerName.trim()
    const trimmedPhone = customerPhone.trim()

    const { data: existingCustomers, error: customerSearchError } = await supabase
      .from('customers')
      .select('*')
      .ilike('name', trimmedName)
      .limit(20)

    if (customerSearchError) {
      setError(customerSearchError.message || 'Failed to add customer')
      return
    }

    const existing = (existingCustomers || []).find(c => c.name.toLowerCase() === trimmedName.toLowerCase() && (!trimmedPhone || c.phone === trimmedPhone))
    if (existing) {
      selectCustomer(existing)
      return
    }

    const { data, error } = await supabase
      .from('customers')
      .insert([{ name: trimmedName, phone: trimmedPhone, email: '', address: '', credit_balance: 0, created_at: new Date().toISOString() }])
      .select()
      .single()

    if (error) {
      setError(error.message || 'Failed to add customer')
      return
    }

    setCustomers(prev => [...prev, data])
    selectCustomer(data)
  }

  const filteredHistory = invoiceHistory.filter(inv =>
    !historySearch.trim() ||
    inv.bill_number.toLowerCase().includes(historySearch.trim().toLowerCase()) ||
    (inv.customer_name || '').toLowerCase().includes(historySearch.trim().toLowerCase())
  )

  const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0)
  const discountAmount = discountType === 'percent'
    ? cartTotal * (Number(discount || 0) / 100)
    : Number(discount || 0)
  const taxableAmount = Math.max(0, cartTotal - discountAmount)
  const gstAmount = taxableAmount * (gstRate / 100)
  const grandTotal = taxableAmount + gstAmount

  const handleCompleteSale = async () => {
    setError('')
    setMessage('')

    if (cart.length === 0) {
      setError('Cart is empty')
      return
    }
    if (paymentMode === 'credit' && !selectedCustomer) {
      setError('Select a customer for credit sales')
      return
    }

    const invoicePayload = {
      bill_number: billNumber,
      customer_id: selectedCustomer?.id || null,
      customer_name: selectedCustomer?.name || 'Walk-in Customer',
      total_amount: grandTotal,
      discount_amount: discountAmount,
      gst_amount: gstAmount,
      payment_mode: paymentMode,
      invoice_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      user_id: user?.id || null,
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert([invoicePayload])
      .select()
      .single()

    if (invoiceError) {
      setError(invoiceError.message || 'Failed to create invoice')
      return
    }

    const invoiceItems = cart.map(item => ({
      invoice_id: invoice.id,
      product_id: item.product_id,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      discount: item.itemDiscount || 0,
      discount_type: item.discountType || 'flat',
      discount_value: item.discountValue || 0,
      created_at: new Date().toISOString(),
    }))

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(invoiceItems)

    if (itemsError) {
      setError(itemsError.message || 'Invoice created but items failed to save')
      return
    }

    setMessage(`Invoice ${invoice.bill_number} created successfully`)
    setLastInvoiceId(invoice.id)
    setCart([])
    setDiscount(0)
    setDiscountType('flat')
    clearCustomer()
    setPaymentMode('cash')
    loadBillNumber()
    loadInvoiceHistory()
  }

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1">
        <Navbar />
        <div className="p-4 sm:p-8">
          <div className="flex flex-wrap justify-between items-center gap-2 mb-6">
            <h1 className="text-3xl font-bold">Billing (POS)</h1>
            <span className="text-gray-600 font-mono">{billNumber}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-lg shadow p-6">
              <div className="flex gap-2 mb-4 items-end">
                <div className="relative flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Scan or Search Product</label>
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Scan barcode or search product..."
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
                          onClick={() => addToCart(p)}
                          className="row-in w-full text-left px-4 py-2 hover:bg-gray-100 flex justify-between"
                        >
                          <span>{p.name} <span className="text-gray-400 text-sm">({p.sku})</span></span>
                          <span className="text-gray-600">₹{p.selling_price} · {p.current_stock} in stock</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchTerm.trim() && searchResults.length === 0 && (
                    <div className="absolute z-10 w-full bg-white border rounded mt-1 shadow-lg">
                      <EmptyState title="No products found" message={`No match for "${searchTerm.trim()}"`} />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowCustomItemForm(v => !v)}
                  className="px-4 py-2 border rounded hover:bg-gray-50 whitespace-nowrap"
                >
                  + Custom Item
                </button>
              </div>

              {showCustomItemForm && (
                <form onSubmit={handleAddCustomItem} className="border rounded p-4 mb-4 bg-gray-50 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <p className="col-span-2 text-xs text-gray-500 -mt-1 mb-1">
                    For a one-off sale that isn't in your product catalog. It won't affect stock or appear in Inventory.
                  </p>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Item Name</label>
                    <input required placeholder="e.g. Repair service" value={customItemName}
                      onChange={(e) => setCustomItemName(e.target.value)}
                      className="w-full px-3 py-2 border rounded" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Price</label>
                    <input required type="number" min="0.01" step="0.01" placeholder="0.00" value={customItemPrice}
                      onChange={(e) => setCustomItemPrice(e.target.value)}
                      className="w-full px-3 py-2 border rounded" />
                  </div>
                  <button type="submit" className="col-span-2 bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
                    Add to Cart
                  </button>
                </form>
              )}

              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2">Product</th>
                    <th className="py-2 text-right">Price</th>
                    <th className="py-2 text-center">Qty</th>
                    <th className="py-2 text-right">Discount</th>
                    <th className="py-2 text-right">Subtotal</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map(item => (
                    <tr key={item.product_id} className="row-in border-b">
                      <td className="py-2">{item.name}</td>
                      <td className="py-2 text-right">₹{item.unit_price}</td>
                      <td className="py-2 text-center">
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.product_id, parseInt(e.target.value) || 1)}
                          className="w-16 text-center border rounded"
                        />
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={item.discountValue || ''}
                            onChange={(e) => updateItemDiscount(item.product_id, parseFloat(e.target.value) || 0)}
                            className="w-16 text-right border rounded"
                          />
                          <div className="flex border rounded overflow-hidden text-xs">
                            <button
                              type="button"
                              onClick={() => updateItemDiscountType(item.product_id, 'flat')}
                              className={`px-1.5 py-1 ${item.discountType === 'flat' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}
                            >
                              ₹
                            </button>
                            <button
                              type="button"
                              onClick={() => updateItemDiscountType(item.product_id, 'percent')}
                              className={`px-1.5 py-1 ${item.discountType === 'percent' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}
                            >
                              %
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 text-right">₹{item.subtotal.toFixed(2)}</td>
                      <td className="py-2 text-right">
                        <button onClick={() => removeFromCart(item.product_id)} className="text-red-600 hover:underline">
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {cart.length === 0 && (
                    <tr>
                      <td colSpan="6" className="py-8 text-center text-gray-400">Cart is empty</td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 h-fit">
              <label className="block text-sm text-gray-600 mb-1">Customer</label>

              {selectedCustomer ? (
                <div className="flex items-center justify-between border rounded px-4 py-2 mb-4 bg-gray-50">
                  <div>
                    <p className="font-medium">{selectedCustomer.name}</p>
                    <p className="text-xs text-gray-500">{selectedCustomer.phone}</p>
                  </div>
                  <button onClick={clearCustomer} className="text-gray-400 hover:text-gray-700 text-sm">Change</button>
                </div>
              ) : (
                <div className="relative mb-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Name</label>
                      <input
                        type="text"
                        placeholder="Name"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full px-4 py-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Phone</label>
                      <input
                        type="text"
                        placeholder="Phone"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        className="w-full px-4 py-2 border rounded"
                      />
                    </div>
                  </div>
                  {customerMatches.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border rounded mt-1 shadow-lg max-h-48 overflow-y-auto">
                      {customerMatches.map(c => (
                        <button
                          key={c.id}
                          onClick={() => selectCustomer(c)}
                          className="w-full text-left px-4 py-2 hover:bg-gray-100 flex justify-between text-sm"
                        >
                          <span>{c.name}</span>
                          <span className="text-gray-500">{c.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {(nameQuery || phoneQuery) && customerMatches.length === 0 && (
                    <div className="border rounded p-3 mt-1 bg-gray-50">
                      <p className="text-xs text-gray-500 mb-2">
                        No customer found{phoneQuery ? ` for "${customerPhone}"` : ''} - fill in name &amp; phone to register
                      </p>
                      <button
                        type="button"
                        onClick={handleQuickAddCustomer}
                        className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
                      >
                        + Add & Select
                      </button>
                    </div>
                  )}
                </div>
              )}

              <label className="block text-sm text-gray-600 mb-1">Discount</label>
              <div className="flex gap-2 mb-4">
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={discount || ''}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="flex-1 h-[56px] px-4 py-2 border border-gray-300 rounded-lg text-2xl text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                <div className="flex h-[56px] w-[140px] overflow-hidden rounded-lg border border-gray-300 bg-white">
                  <button
                    type="button"
                    onClick={() => setDiscountType('flat')}
                    className={`flex-1 text-lg font-medium ${discountType === 'flat' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                  >
                    AED
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountType('percent')}
                    className={`flex-1 text-xl font-medium border-l border-gray-300 ${discountType === 'percent' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                  >
                    %
                  </button>
                </div>
              </div>
              {discountType === 'percent' && Number(discount) > 0 && (
                <p className="text-xs text-gray-500 -mt-3 mb-4">= AED {discountAmount.toFixed(2)} off</p>
              )}

              <label className="block text-sm text-gray-600 mb-1">Payment Mode</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                className="w-full px-4 py-2 border rounded mb-4"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="credit">Credit</option>
              </select>

              <div className="border-t pt-4 mb-4">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>₹{cartTotal.toFixed(2)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Discount</span>
                    <span>-₹{discountAmount.toFixed(2)}</span>
                  </div>
                )}
                {gstRate > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>GST ({gstRate}%)</span>
                    <span>₹{gstAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-2xl font-bold mt-2">
                  <span>Total</span>
                  <span>₹{grandTotal.toFixed(2)}</span>
                </div>
              </div>

              {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}
              {message && (
                <div className="flex items-center justify-between mb-4">
                  <p className="text-green-600 text-sm">{message}</p>
                  {lastInvoiceId && (
                    <button onClick={() => printInvoice(lastInvoiceId)} className="text-blue-600 hover:underline text-sm">
                      Print
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={handleCompleteSale}
                className="w-full bg-green-600 text-white py-3 rounded hover:bg-green-700 font-bold"
              >
                Complete Sale
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden mt-8">
            <div className="flex flex-wrap justify-between items-end gap-3 p-6 pb-0">
              <h2 className="text-xl font-bold">Sales History</h2>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Search</label>
                <input
                  type="text"
                  placeholder="Search by bill # or customer..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="px-4 py-2 border rounded text-sm w-full sm:w-64"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full mt-4">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-6 py-3 text-left">Bill #</th>
                  <th className="px-6 py-3 text-left">Customer</th>
                  <th className="px-6 py-3 text-left">Date</th>
                  <th className="px-6 py-3 text-right">Total</th>
                  <th className="px-6 py-3 text-center">Payment</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              {loading ? (
                <TableSkeleton rows={5} cols={6} />
              ) : (
              <tbody>
                {filteredHistory.map(inv => (
                  <tr key={inv.id} className="row-in border-b hover:bg-gray-50">
                    <td className="px-6 py-4 font-mono text-sm">{inv.bill_number}</td>
                    <td className="px-6 py-4">{inv.customer_name || 'Walk-in'}</td>
                    <td className="px-6 py-4">{formatInvoiceDate(inv.invoice_date || inv.created_at)}</td>
                    <td className="px-6 py-4 text-right">₹{inv.total_amount.toFixed(2)}</td>
                    <td className="px-6 py-4 text-center capitalize">{inv.payment_mode}</td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => openInvoiceDetail(inv.id)} className="text-blue-600 hover:underline">View</button>
                    </td>
                  </tr>
                ))}
                {filteredHistory.length === 0 && (
                  <tr><td colSpan="6">
                    {historySearch.trim() ? (
                      <EmptyState title="No invoices match your search" message="Try a different bill number or customer name." />
                    ) : (
                      <EmptyState title="No sales yet" message="Completed sales will show up here." />
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

      {viewingInvoice && (
        <div className="overlay-in fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-20">
          <div className="panel-in bg-white rounded-lg shadow-lg p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold font-mono">{viewingInvoice.bill_number}</h2>
                <p className="text-sm text-gray-500">{formatInvoiceDate(viewingInvoice.invoice_date || viewingInvoice.created_at)}</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => printInvoice(viewingInvoice.id)} className="text-blue-600 hover:underline text-sm">Print</button>
                <Link to={`/returns?bill=${viewingInvoice.bill_number}`} className="text-red-600 hover:underline text-sm">Return Items</Link>
                <button onClick={() => setViewingInvoice(null)} className="text-gray-400 hover:text-gray-700">✕</button>
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2">Product</th>
                  <th className="py-2 text-center">Qty</th>
                  <th className="py-2 text-right">Price</th>
                  <th className="py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {viewingInvoice.items.map(item => (
                  <tr key={item.id} className="row-in border-b">
                    <td className="py-2">{item.product_name}</td>
                    <td className="py-2 text-center">{item.quantity}</td>
                    <td className="py-2 text-right">₹{item.unit_price}</td>
                    <td className="py-2 text-right">₹{item.subtotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="border-t pt-3 space-y-1">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Discount</span>
                <span>₹{viewingInvoice.discount_amount.toFixed(2)}</span>
              </div>
              {viewingInvoice.gst_amount > 0 && (
                <div className="flex justify-between text-sm text-gray-600">
                  <span>GST</span>
                  <span>₹{viewingInvoice.gst_amount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>₹{viewingInvoice.total_amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-600 capitalize">
                <span>Payment Mode</span>
                <span>{viewingInvoice.payment_mode}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
