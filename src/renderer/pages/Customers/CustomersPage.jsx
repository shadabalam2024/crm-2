import { useState, useEffect } from 'react'
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

const emptyForm = { name: '', phone: '', email: '', address: '', is_recurring: false }

export default function CustomersPage() {
  const [customers, setCustomers] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [payingCustomer, setPayingCustomer] = useState(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMode, setPaymentMode] = useState('cash')
  const [viewingCustomer, setViewingCustomer] = useState(null)
  const [viewingDetail, setViewingDetail] = useState(null)
  const [viewingPayments, setViewingPayments] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadCustomers()
  }, [])

  const loadCustomers = async () => {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setCustomers([])
      setLoading(false)
      return
    }

    setCustomers(data || [])
    setLoading(false)
  }

  const openAddForm = () => {
    setForm(emptyForm)
    setEditingId(null)
    setError('')
    setShowForm(true)
  }

  const openEditForm = (customer) => {
    setForm({
      name: customer.name,
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      is_recurring: !!customer.is_recurring
    })
    setEditingId(customer.id)
    setError('')
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (editingId) {
      const { error } = await supabase
        .from('customers')
        .update(form)
        .eq('id', editingId)

      if (error) {
        setError(error.message || 'Failed to save customer')
        return
      }
    } else {
      const { error } = await supabase
        .from('customers')
        .insert([{ ...form, created_at: new Date().toISOString() }])

      if (error) {
        setError(error.message || 'Failed to save customer')
        return
      }
    }

    setShowForm(false)
    loadCustomers()
  }

  const openPayment = (customer) => {
    setPayingCustomer(customer)
    setPaymentAmount('')
    setPaymentMode('cash')
  }

  const handleRecordPayment = async (e) => {
    e.preventDefault()
    const { error } = await supabase.rpc('record_customer_payment', {
      p_customer_id: payingCustomer.id,
      p_amount: parseFloat(paymentAmount) || 0,
      p_payment_mode: paymentMode,
    })
    if (!error) {
      setPayingCustomer(null)
      loadCustomers()
      if (viewingCustomer?.id === payingCustomer.id) openView(payingCustomer)
    } else {
      alert(error.message || 'Failed to record payment')
    }
  }

  const openView = async (customer) => {
    setViewingCustomer(customer)
    setViewingDetail(null)
    setViewingPayments(null)

    supabase
      .from('invoices')
      .select('*')
      .eq('customer_id', customer.id)
      .order('invoice_date', { ascending: false })
      .then(({ data }) => setViewingDetail({ invoices: data || [] }))

    supabase
      .from('customer_payments')
      .select('*, invoices(bill_number)')
      .eq('customer_id', customer.id)
      .order('payment_date', { ascending: false })
      .then(({ data }) => setViewingPayments(
        (data || []).map(p => ({ ...p, bill_number: p.invoices?.bill_number }))
      ))
  }

  const filteredCustomers = customers.filter(c =>
    !search.trim() ||
    c.name.toLowerCase().includes(search.trim().toLowerCase()) ||
    (c.phone || '').includes(search.trim())
  )

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1">
        <Navbar />
        <div className="p-4 sm:p-8">
          <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
            <h1 className="text-3xl font-bold">Customers</h1>
            <button onClick={openAddForm} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              + Add Customer
            </button>
          </div>

          <Field label="Search" className="max-w-sm mb-4">
            <input
              type="text"
              placeholder="Search by name or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 border rounded"
            />
          </Field>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left">Name</th>
                    <th className="px-6 py-3 text-left">Phone</th>
                    <th className="px-6 py-3 text-left">Email</th>
                    <th className="px-6 py-3 text-center">Recurring</th>
                    <th className="px-6 py-3 text-right">Credit Balance</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                {loading ? (
                  <TableSkeleton rows={6} cols={6} />
                ) : filteredCustomers.length === 0 ? (
                  <tbody>
                    <tr><td colSpan="6">
                      <EmptyState
                        title={search.trim() ? 'No customers match your search' : 'No customers yet'}
                        message={search.trim() ? undefined : 'Add your first customer to start tracking credit sales.'}
                        actionLabel={search.trim() ? undefined : '+ Add Customer'}
                        onAction={search.trim() ? undefined : openAddForm}
                      />
                    </td></tr>
                  </tbody>
                ) : (
                  <tbody>
                    {filteredCustomers.map(c => (
                      <tr key={c.id} className="row-in border-b hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <button onClick={() => openView(c)} className="text-blue-600 hover:underline">{c.name}</button>
                        </td>
                        <td className="px-6 py-4">{c.phone}</td>
                        <td className="px-6 py-4 text-gray-500">{c.email}</td>
                        <td className="px-6 py-4 text-center">{c.is_recurring ? '✓' : ''}</td>
                        <td className={`px-6 py-4 text-right ${c.credit_balance > 0 ? 'text-orange-600 font-bold' : ''}`}>
                          ₹{c.credit_balance.toFixed(0)}
                        </td>
                        <td className="px-6 py-4 text-right space-x-3 whitespace-nowrap">
                          {c.credit_balance > 0 && (
                            <button onClick={() => openPayment(c)} className="text-green-600 hover:underline">Record Payment</button>
                          )}
                          <button onClick={() => openEditForm(c)} className="text-blue-600 hover:underline">Edit</button>
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

      {showForm && (
        <div className="overlay-in fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-20">
          <div className="panel-in bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">{editingId ? 'Edit Customer' : 'Add Customer'}</h2>
            <form onSubmit={handleSubmit}>
              <Field label="Name" className="mb-3">
                <input
                  type="text" placeholder="Name" required
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-2 border rounded"
                />
              </Field>
              <Field label="Phone" className="mb-3">
                <input
                  type="text" placeholder="Phone"
                  value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full px-4 py-2 border rounded"
                />
              </Field>
              <Field label="Email" className="mb-3">
                <input
                  type="email" placeholder="Email"
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-4 py-2 border rounded"
                />
              </Field>
              <Field label="Address" className="mb-3">
                <textarea
                  placeholder="Address"
                  value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-4 py-2 border rounded"
                />
              </Field>
              <label className="flex items-center gap-2 mb-4 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={form.is_recurring}
                  onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })}
                />
                Recurring customer
              </label>

              {error && <p className="text-red-500 mb-4 text-sm">{error}</p>}

              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border py-2 rounded hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
                  {editingId ? 'Save Changes' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {payingCustomer && (
        <div className="overlay-in fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-20">
          <div className="panel-in bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold mb-1">Record Payment</h2>
            <p className="text-sm text-gray-500 mb-4">
              {payingCustomer.name} · Balance ₹{payingCustomer.credit_balance.toFixed(0)}
            </p>
            <form onSubmit={handleRecordPayment}>
              <Field label="Amount" className="mb-4">
                <input
                  type="number" min="0" step="0.01" required autoFocus placeholder="Amount"
                  value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-4 py-2 border rounded"
                />
              </Field>
              <Field label="Payment Mode" className="mb-4">
                <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="w-full px-4 py-2 border rounded">
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                </select>
              </Field>
              <div className="flex gap-3">
                <button type="button" onClick={() => setPayingCustomer(null)} className="flex-1 border py-2 rounded hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewingCustomer && (
        <div className="overlay-in fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-20">
          <div className="panel-in bg-white rounded-lg shadow-lg p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">{viewingCustomer.name}</h2>
                <p className="text-sm text-gray-500">{viewingCustomer.phone}</p>
              </div>
              <button onClick={() => { setViewingCustomer(null); setViewingDetail(null); setViewingPayments(null) }} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <h3 className="font-bold mb-2">Invoice History</h3>
            {!viewingDetail && (
              <table className="w-full text-sm"><TableSkeleton rows={3} cols={4} /></table>
            )}
            {viewingDetail && viewingDetail.invoices?.length === 0 && (
              <EmptyState title="No invoices yet" message="Invoices for this customer will show up here." />
            )}
            {viewingDetail && viewingDetail.invoices?.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2">Bill #</th>
                    <th className="py-2">Date</th>
                    <th className="py-2 text-right">Amount</th>
                    <th className="py-2 text-right">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingDetail.invoices.map(inv => {
                    const due = inv.total_amount - inv.amount_paid - (inv.refunded_amount || 0)
                    return (
                      <tr key={inv.id} className="row-in border-b">
                        <td className="py-2">{inv.bill_number}</td>
                        <td className="py-2">{new Date(inv.invoice_date).toLocaleDateString()}</td>
                        <td className="py-2 text-right">₹{inv.total_amount.toFixed(2)}</td>
                        <td className={`py-2 text-right ${due > 0 ? 'text-orange-600 font-bold' : 'text-green-600'}`}>
                          {due > 0 ? `₹${due.toFixed(2)}` : 'Paid'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            <h3 className="font-bold mb-2 mt-6">Payment History</h3>
            {!viewingPayments && (
              <table className="w-full text-sm"><TableSkeleton rows={3} cols={4} /></table>
            )}
            {viewingPayments && viewingPayments.length === 0 && (
              <EmptyState title="No payments recorded yet" message="Payments recorded for this customer will show up here." />
            )}
            {viewingPayments && viewingPayments.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2">Date</th>
                    <th className="py-2">Applied To</th>
                    <th className="py-2">Mode</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingPayments.map(p => (
                    <tr key={p.id} className="row-in border-b">
                      <td className="py-2">{new Date(p.payment_date).toLocaleString()}</td>
                      <td className="py-2 text-gray-500">{p.bill_number || 'Advance / general'}</td>
                      <td className="py-2 text-gray-500 capitalize">{p.payment_mode || 'cash'}</td>
                      <td className="py-2 text-right text-green-600">₹{p.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
