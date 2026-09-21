import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Sidebar from '../../components/Sidebar'
import EmptyState from '../../components/EmptyState'
import { TableSkeleton } from '../../components/Skeleton'
import { supabase } from '../../lib/supabaseClient'

function Field({ label, className = '', children }) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

export default function ReturnsPage() {
  const [searchParams] = useSearchParams()

  const [billQuery, setBillQuery] = useState(searchParams.get('bill') || '')
  const [searchResults, setSearchResults] = useState([])
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [lines, setLines] = useState({}) // invoiceItemId -> { quantity, restock, disposition }
  const [damageLog, setDamageLog] = useState([])
  const [damageSearch, setDamageSearch] = useState('')
  const [reason, setReason] = useState('')
  const [refundMode, setRefundMode] = useState('cash')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [returnsList, setReturnsList] = useState([])
  const [historySearch, setHistorySearch] = useState('')
  const [viewingReturn, setViewingReturn] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([loadReturns(), loadDamageLog()]).finally(() => setLoading(false))
    const initialBill = searchParams.get('bill')
    if (initialBill) runSearch(initialBill)
  }, [])

  const loadReturns = async () => {
    const { data, error: err } = await supabase
      .from('returns')
      .select('*, invoices(bill_number, customer_name)')
      .order('return_date', { ascending: false })

    if (err) {
      setReturnsList([])
      return
    }

    setReturnsList((data || []).map(r => ({
      ...r,
      bill_number: r.invoices?.bill_number,
      customer_name: r.invoices?.customer_name,
    })))
  }

  const loadDamageLog = async () => {
    const { data, error: err } = await supabase
      .from('return_items')
      .select('id, quantity, subtotal, disposition, products(name), returns(return_number, return_date, reason, invoices(bill_number))')
      .eq('restocked', false)
      .order('return_date', { foreignTable: 'returns', ascending: false })

    if (err) {
      setDamageLog([])
      return
    }

    setDamageLog((data || []).map(item => ({
      id: item.id,
      quantity: item.quantity,
      subtotal: item.subtotal,
      disposition: item.disposition,
      product_name: item.products?.name,
      return_number: item.returns?.return_number,
      return_date: item.returns?.return_date,
      return_reason: item.returns?.reason,
      bill_number: item.returns?.invoices?.bill_number,
    })))
  }

  const runSearch = async (query) => {
    setError('')
    setSelectedInvoice(null)
    const trimmed = query.trim()
    if (!trimmed) return

    const { data, error: err } = await supabase
      .from('invoices')
      .select('*')
      .ilike('bill_number', `%${trimmed}%`)
      .order('invoice_date', { ascending: false })
      .limit(10)

    if (err) {
      setSearchResults([])
      return
    }

    const results = data || []
    setSearchResults(results)
    if (results.length === 1) {
      openInvoice(results[0].id)
    }
  }

  const searchInvoice = (e) => {
    e.preventDefault()
    runSearch(billQuery)
  }

  const openInvoice = async (invoiceId) => {
    setError('')
    setMessage('')

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle()

    if (invoiceError || !invoice) {
      setError('Invoice not found')
      return
    }

    const { data: items, error: itemsError } = await supabase
      .rpc('get_invoice_return_details', { p_invoice_id: invoiceId })

    if (itemsError) {
      setError('Invoice not found')
      return
    }

    const detail = { ...invoice, items: items || [] }
    setSelectedInvoice(detail)
    setSearchResults([])
    const initialLines = {}
    for (const item of detail.items) {
      initialLines[item.id] = { quantity: 0, restock: true, disposition: '' }
    }
    setLines(initialLines)
    setRefundMode('cash')
    setReason('')
  }

  const setLineQty = (itemId, quantity, max) => {
    const q = Math.max(0, Math.min(max, Number(quantity) || 0))
    setLines(prev => ({ ...prev, [itemId]: { ...prev[itemId], quantity: q } }))
  }

  const setLineRestock = (itemId, restock) => {
    setLines(prev => ({ ...prev, [itemId]: { ...prev[itemId], restock, disposition: restock ? '' : prev[itemId]?.disposition } }))
  }

  const setLineDisposition = (itemId, disposition) => {
    setLines(prev => ({ ...prev, [itemId]: { ...prev[itemId], disposition } }))
  }

  const refundTotal = selectedInvoice
    ? selectedInvoice.items.reduce((sum, item) => {
        const q = lines[item.id]?.quantity || 0
        const effectiveUnitPrice = item.subtotal / item.quantity
        return sum + effectiveUnitPrice * q
      }, 0)
    : 0

  const dueOnInvoice = selectedInvoice ? selectedInvoice.total_amount - selectedInvoice.amount_paid - selectedInvoice.refunded_amount : 0

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')

    const items = Object.entries(lines)
      .filter(([, v]) => v.quantity > 0)
      .map(([invoiceItemId, v]) => ({ invoiceItemId, quantity: v.quantity, restock: v.restock, disposition: v.restock ? null : v.disposition }))

    if (items.length === 0) {
      setError('Enter a quantity to return for at least one item')
      return
    }

    if (items.some(i => !i.restock && !i.disposition)) {
      setError('Select a reason (Damaged/Defective/Other) for any item you are not restocking')
      return
    }

    const { error: err } = await supabase.rpc('create_return', {
      p_invoice_id: selectedInvoice.id,
      p_items: items.map(i => ({
        invoice_item_id: i.invoiceItemId,
        quantity: i.quantity,
        restock: i.restock,
        disposition: i.disposition,
      })),
      p_reason: reason || null,
      p_refund_mode: refundMode,
    })

    if (!err) {
      loadReturns()
      loadDamageLog()
      await openInvoice(selectedInvoice.id)
      setMessage(`Return processed - refund ₹${refundTotal.toFixed(2)}`)
    } else {
      setError(err.message || 'Failed to process return')
    }
  }

  const openReturnDetail = async (returnId) => {
    const { data: ret, error: retError } = await supabase
      .from('returns')
      .select('*, invoices(bill_number, customer_name)')
      .eq('id', returnId)
      .maybeSingle()

    if (retError || !ret) {
      setViewingReturn(null)
      return
    }

    const { data: items } = await supabase
      .from('return_items')
      .select('*, products(name)')
      .eq('return_id', returnId)

    setViewingReturn({
      ...ret,
      bill_number: ret.invoices?.bill_number,
      customer_name: ret.invoices?.customer_name,
      items: (items || []).map(item => ({ ...item, product_name: item.products?.name })),
    })
  }

  const filteredReturns = returnsList.filter(r => {
    const q = historySearch.toLowerCase()
    return !q || r.return_number.toLowerCase().includes(q) || r.bill_number?.toLowerCase().includes(q) || r.customer_name?.toLowerCase().includes(q)
  })

  const dispositionLabel = { damaged: 'Damaged', defective: 'Defective', other: 'Other' }

  const filteredDamageLog = damageLog.filter(d => {
    const q = damageSearch.toLowerCase()
    return !q || d.product_name.toLowerCase().includes(q) || d.bill_number?.toLowerCase().includes(q) || d.return_number.toLowerCase().includes(q)
  })

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1">
        <Navbar />
        <div className="p-4 sm:p-8">
          <h1 className="text-3xl font-bold mb-6">Returns & Refunds</h1>

          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <form onSubmit={searchInvoice} className="flex items-end gap-3 mb-4">
              <Field label="Bill Number" className="flex-1 max-w-sm">
                <input
                  type="text"
                  placeholder="e.g. INV-00001"
                  value={billQuery}
                  onChange={(e) => setBillQuery(e.target.value)}
                  className="w-full px-4 py-2 border rounded"
                />
              </Field>
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                Find Invoice
              </button>
            </form>

            {searchResults.length > 1 && (
              <div className="border rounded divide-y mb-4">
                {searchResults.map(inv => (
                  <button
                    key={inv.id}
                    onClick={() => openInvoice(inv.id)}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex justify-between"
                  >
                    <span>{inv.bill_number} — {inv.customer_name || 'Walk-in'}</span>
                    <span className="text-gray-500">{new Date(inv.invoice_date).toLocaleDateString()} · ₹{inv.total_amount.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            )}
            {searchResults.length === 0 && billQuery && !selectedInvoice && (
              <EmptyState title="No matching invoices" message="Check the bill number and try again." />
            )}

            {selectedInvoice && (
              <form onSubmit={handleSubmit}>
                <div className="flex justify-between items-start mb-4 bg-gray-50 rounded p-4">
                  <div>
                    <p className="font-bold">{selectedInvoice.bill_number}</p>
                    <p className="text-sm text-gray-500">{selectedInvoice.customer_name || 'Walk-in'} · {new Date(selectedInvoice.invoice_date).toLocaleDateString()} · {selectedInvoice.payment_mode}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p>Total: ₹{selectedInvoice.total_amount.toFixed(2)}</p>
                    {selectedInvoice.payment_mode === 'credit' && (
                      <p className={dueOnInvoice > 0 ? 'text-orange-600 font-bold' : 'text-green-600'}>
                        {dueOnInvoice > 0 ? `Due: ₹${dueOnInvoice.toFixed(2)}` : 'Fully paid'}
                      </p>
                    )}
                  </div>
                </div>

                {selectedInvoice.items.every(item => item.quantity - item.already_returned === 0) && (
                  <p className="text-sm text-gray-500 bg-gray-50 border rounded p-3 mb-4">
                    Every item on this invoice has already been returned — there's nothing left to process.
                  </p>
                )}

                <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 px-2">Product</th>
                      <th className="py-2 px-2 text-right whitespace-nowrap">Sold</th>
                      <th className="py-2 px-2 text-right whitespace-nowrap">Returned</th>
                      <th className="py-2 px-2 text-right whitespace-nowrap">Return Qty</th>
                      <th className="py-2 px-2 text-center whitespace-nowrap">Restock</th>
                      <th className="py-2 px-2 text-right whitespace-nowrap">Refund</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoice.items.map(item => {
                      const returnable = item.quantity - item.already_returned
                      const effectiveUnitPrice = item.subtotal / item.quantity
                      const q = lines[item.id]?.quantity || 0
                      return (
                        <tr key={item.id} className="row-in border-b">
                          <td className="py-2 px-2">{item.product_name}</td>
                          <td className="py-2 px-2 text-right">{item.quantity}</td>
                          <td className="py-2 px-2 text-right text-gray-500">{item.already_returned}</td>
                          <td className="py-2 px-2 text-right">
                            {returnable === 0 ? (
                              <span className="text-xs text-gray-400 italic">Fully returned</span>
                            ) : (
                              <input
                                type="number"
                                min="0"
                                max={returnable}
                                value={q}
                                onChange={(e) => setLineQty(item.id, e.target.value, returnable)}
                                className="w-20 px-2 py-1 border rounded text-right"
                              />
                            )}
                          </td>
                          <td className="py-2 px-2 text-center">
                            {returnable === 0 ? (
                              <span className="text-gray-300">—</span>
                            ) : (
                            <input
                              type="checkbox"
                              checked={!!lines[item.id]?.restock}
                              disabled={!!item.is_custom}
                              onChange={(e) => setLineRestock(item.id, e.target.checked)}
                            />
                            )}
                            {!lines[item.id]?.restock && !item.is_custom && returnable > 0 && (
                              <select
                                value={lines[item.id]?.disposition || ''}
                                onChange={(e) => setLineDisposition(item.id, e.target.value)}
                                className={`block mt-1 text-xs border rounded px-1 py-0.5 ${!lines[item.id]?.disposition && q > 0 ? 'border-red-400' : ''}`}
                              >
                                <option value="">Reason...</option>
                                <option value="damaged">Damaged</option>
                                <option value="defective">Defective</option>
                                <option value="other">Other</option>
                              </select>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right whitespace-nowrap">₹{(effectiveUnitPrice * q).toFixed(2)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <Field label="Reason (optional)">
                    <input
                      type="text"
                      placeholder="e.g. Defective, wrong item, customer changed mind"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full px-4 py-2 border rounded"
                    />
                  </Field>
                  <Field label="Refund Mode">
                    <select value={refundMode} onChange={(e) => setRefundMode(e.target.value)} className="w-full px-4 py-2 border rounded">
                      <option value="cash">Cash Refund (money handed back)</option>
                      <option value="credit_adjust" disabled={selectedInvoice.payment_mode !== 'credit' || dueOnInvoice <= 0}>
                        Adjust Against Due{selectedInvoice.payment_mode !== 'credit' ? ' (credit invoices only)' : dueOnInvoice <= 0 ? ' (no due left)' : ''}
                      </option>
                    </select>
                  </Field>
                </div>

                <div className="flex justify-between items-center">
                  <p className="text-lg font-bold">Refund Amount: ₹{refundTotal.toFixed(2)}</p>
                  <button type="submit" disabled={refundTotal <= 0} className="bg-red-600 text-white px-6 py-2 rounded hover:bg-red-700 disabled:opacity-50">
                    Process Return
                  </button>
                </div>
              </form>
            )}

            {message && <p className="text-green-600 mt-4">{message}</p>}
            {error && <p className="text-red-600 mt-4">{error}</p>}
          </div>

          <h2 className="text-xl font-bold mb-3">Recent Returns</h2>
          <Field label="Search" className="max-w-sm mb-4">
            <input
              type="text"
              placeholder="Search by return #, bill #, or customer..."
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              className="w-full px-4 py-2 border rounded"
            />
          </Field>
          <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto">
            {loading ? (
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left">Return #</th>
                    <th className="px-6 py-3 text-left">Bill #</th>
                    <th className="px-6 py-3 text-left">Customer</th>
                    <th className="px-6 py-3 text-left">Date</th>
                    <th className="px-6 py-3 text-left">Mode</th>
                    <th className="px-6 py-3 text-right">Refund</th>
                  </tr>
                </thead>
                <TableSkeleton rows={5} cols={6} />
              </table>
            ) : filteredReturns.length === 0 ? (
              <EmptyState
                title={historySearch ? 'No matching returns' : 'No returns recorded yet'}
                message={historySearch ? 'Try a different search term.' : 'Processed returns will show up here.'}
              />
            ) : (
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left">Return #</th>
                    <th className="px-6 py-3 text-left">Bill #</th>
                    <th className="px-6 py-3 text-left">Customer</th>
                    <th className="px-6 py-3 text-left">Date</th>
                    <th className="px-6 py-3 text-left">Mode</th>
                    <th className="px-6 py-3 text-right">Refund</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReturns.map(r => (
                    <tr key={r.id} className="row-in border-b hover:bg-gray-50 cursor-pointer" onClick={() => openReturnDetail(r.id)}>
                      <td className="px-6 py-3">{r.return_number}</td>
                      <td className="px-6 py-3">{r.bill_number}</td>
                      <td className="px-6 py-3">{r.customer_name || 'Walk-in'}</td>
                      <td className="px-6 py-3">{new Date(r.return_date).toLocaleString()}</td>
                      <td className="px-6 py-3">{r.refund_mode === 'cash' ? 'Cash Refund' : 'Adjust Against Due'}</td>
                      <td className="px-6 py-3 text-right">₹{r.refund_amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <h2 className="text-xl font-bold mb-3 mt-8">Damaged / Defective Log</h2>
          <Field label="Search" className="max-w-sm mb-4">
            <input
              type="text"
              placeholder="Search by product, bill #, or return #..."
              value={damageSearch}
              onChange={(e) => setDamageSearch(e.target.value)}
              className="w-full px-4 py-2 border rounded"
            />
          </Field>
          <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto">
            {loading ? (
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left">Date</th>
                    <th className="px-6 py-3 text-left">Product</th>
                    <th className="px-6 py-3 text-right">Qty</th>
                    <th className="px-6 py-3 text-left">Reason</th>
                    <th className="px-6 py-3 text-left">Bill #</th>
                    <th className="px-6 py-3 text-left">Return #</th>
                  </tr>
                </thead>
                <TableSkeleton rows={5} cols={6} />
              </table>
            ) : filteredDamageLog.length === 0 ? (
              <EmptyState
                title={damageSearch ? 'No matching items' : 'No damaged/defective items logged yet'}
                message={damageSearch ? 'Try a different search term.' : 'Items marked damaged or defective during a return show up here.'}
              />
            ) : (
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left">Date</th>
                    <th className="px-6 py-3 text-left">Product</th>
                    <th className="px-6 py-3 text-right">Qty</th>
                    <th className="px-6 py-3 text-left">Reason</th>
                    <th className="px-6 py-3 text-left">Bill #</th>
                    <th className="px-6 py-3 text-left">Return #</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDamageLog.map(d => (
                    <tr key={d.id} className="row-in border-b hover:bg-gray-50">
                      <td className="px-6 py-3">{new Date(d.return_date).toLocaleDateString()}</td>
                      <td className="px-6 py-3">{d.product_name}</td>
                      <td className="px-6 py-3 text-right">{d.quantity}</td>
                      <td className="px-6 py-3">
                        <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">
                          {dispositionLabel[d.disposition] || d.disposition || 'Other'}
                        </span>
                      </td>
                      <td className="px-6 py-3">{d.bill_number}</td>
                      <td className="px-6 py-3">{d.return_number}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {viewingReturn && (
        <div className="overlay-in fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-20">
          <div className="panel-in bg-white rounded-lg shadow-lg p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">{viewingReturn.return_number}</h2>
                <p className="text-sm text-gray-500">Against {viewingReturn.bill_number} · {viewingReturn.customer_name || 'Walk-in'}</p>
              </div>
              <button onClick={() => setViewingReturn(null)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <p className="text-sm text-gray-500 mb-1">{new Date(viewingReturn.return_date).toLocaleString()}</p>
            {viewingReturn.reason && <p className="text-sm mb-3">Reason: {viewingReturn.reason}</p>}
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2">Product</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Refund</th>
                  <th className="py-2 text-center">Restocked</th>
                </tr>
              </thead>
              <tbody>
                {viewingReturn.items.map(item => (
                  <tr key={item.id} className="row-in border-b">
                    <td className="py-2">{item.product_name}</td>
                    <td className="py-2 text-right">{item.quantity}</td>
                    <td className="py-2 text-right">₹{item.subtotal.toFixed(2)}</td>
                    <td className="py-2 text-center">{item.restocked ? '✓' : dispositionLabel[item.disposition] || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-between font-bold">
              <span>Refund Mode: {viewingReturn.refund_mode === 'cash' ? 'Cash' : 'Adjust Against Due'}</span>
              <span>₹{viewingReturn.refund_amount.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
