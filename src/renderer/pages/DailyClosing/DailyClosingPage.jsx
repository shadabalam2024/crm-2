import { useState, useEffect } from 'react'
import Navbar from '../../components/Navbar'
import Sidebar from '../../components/Sidebar'
import EmptyState from '../../components/EmptyState'
import { Skeleton, TableSkeleton } from '../../components/Skeleton'
import { supabase } from '../../lib/supabaseClient'

function Field({ label, className = '', children }) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

function todayStr() {
  const d = new Date()
  const tz = d.getTimezoneOffset() * 60000
  return new Date(d - tz).toISOString().slice(0, 10)
}

export default function DailyClosingPage() {
  const [date, setDate] = useState(todayStr())
  const [figures, setFigures] = useState(null)
  const [existing, setExisting] = useState(null)
  const [openingCash, setOpeningCash] = useState('')
  const [actualCash, setActualCash] = useState('')
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState('')

  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(true)

  useEffect(() => {
    loadHistory()
  }, [])

  useEffect(() => {
    loadPreview(date)
  }, [date])

  const loadHistory = async () => {
    const { data, error } = await supabase.rpc('get_closing_history', { p_limit: 60 })
    setHistory(error ? [] : (data || []))
    setHistoryLoading(false)
  }

  const loadPreview = async (d) => {
    setPreviewLoading(true)
    setMessage('')
    const { data, error } = await supabase.rpc('get_closing_preview', { p_date: d })
    const row = !error && data && data[0] ? data[0] : null

    const figuresResult = {
      cashSales: row?.cash_sales || 0,
      cardSales: row?.card_sales || 0,
      creditSales: row?.credit_sales || 0,
      paymentsReceivedCash: row?.payments_received_cash || 0,
      paymentsReceivedCard: row?.payments_received_card || 0,
      refundsCash: row?.refunds_cash || 0
    }
    const existingResult = row?.existing_id ? {
      id: row.existing_id,
      closing_date: row.existing_closing_date,
      opening_cash: row.existing_opening_cash,
      actual_cash: row.existing_actual_cash,
      expected_cash: row.existing_expected_cash,
      variance: row.existing_variance,
      notes: row.existing_notes,
      closed_at: row.existing_closed_at
    } : null
    const suggestedOpeningCash = row?.suggested_opening_cash || 0

    setFigures(figuresResult)
    setExisting(existingResult)
    setOpeningCash(String(existingResult ? existingResult.opening_cash : suggestedOpeningCash))
    setActualCash(existingResult ? String(existingResult.actual_cash) : '')
    setNotes(existingResult?.notes || '')
    setPreviewLoading(false)
  }

  const openingNum = parseFloat(openingCash) || 0
  const actualNum = parseFloat(actualCash) || 0
  const expectedCash = figures ? openingNum + figures.cashSales + figures.paymentsReceivedCash - figures.refundsCash : 0
  const variance = actualNum - expectedCash

  const handleSave = async (e) => {
    e.preventDefault()
    setMessage('')
    const { error } = await supabase.rpc('save_daily_closing', {
      p_date: date,
      p_opening_cash: openingNum,
      p_actual_cash: actualNum,
      p_notes: notes || null
    })
    if (!error) {
      await loadPreview(date)
      loadHistory()
      setMessage('Closing saved')
    } else {
      setMessage(error.message || 'Failed to save closing')
    }
  }

  const varianceLabel = (v) => {
    if (Math.abs(v) < 0.005) return { text: 'Matches exactly', className: 'text-green-600' }
    if (v > 0) return { text: `₹${v.toFixed(2)} over`, className: 'text-blue-600' }
    return { text: `₹${Math.abs(v).toFixed(2)} short`, className: 'text-red-600' }
  }

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1">
        <Navbar />
        <div className="p-4 sm:p-8">
          <h1 className="text-3xl font-bold mb-6">Daily Closing</h1>

          <div className="bg-white rounded-lg shadow p-6 mb-6 max-w-2xl">
            <div className="flex items-end gap-3 mb-2">
              <Field label="Date">
                <input
                  type="date"
                  value={date}
                  max={todayStr()}
                  onChange={(e) => { if (e.target.value) setDate(e.target.value) }}
                  className="px-4 py-2 border rounded"
                />
              </Field>
              <button type="button" onClick={() => setDate(todayStr())} className="text-sm text-blue-600 hover:underline mb-2">
                Today
              </button>
              {existing && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded mb-2">Already closed - editing will overwrite</span>}
            </div>
            <p className="text-sm text-gray-500 mb-6">
              Showing: <span className="font-medium text-gray-700">
                {new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </span> — if this isn't the date you meant to type, use the calendar icon or the Today button instead.
            </p>

            {(figures || previewLoading) && (
              <form onSubmit={handleSave}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm mb-6">
                  <div className="flex justify-between"><span className="text-gray-500">Cash Sales</span>{previewLoading ? <Skeleton className="h-4 w-16" /> : <span>₹{figures.cashSales.toFixed(2)}</span>}</div>
                  <div className="flex justify-between"><span className="text-gray-500">Card Sales</span>{previewLoading ? <Skeleton className="h-4 w-16" /> : <span>₹{figures.cardSales.toFixed(2)}</span>}</div>
                  <div className="flex justify-between"><span className="text-gray-500">Credit Sales (not cash)</span>{previewLoading ? <Skeleton className="h-4 w-16" /> : <span>₹{figures.creditSales.toFixed(2)}</span>}</div>
                  <div className="flex justify-between"><span className="text-gray-500">Cash Payments Received</span>{previewLoading ? <Skeleton className="h-4 w-16" /> : <span>₹{figures.paymentsReceivedCash.toFixed(2)}</span>}</div>
                  <div className="flex justify-between"><span className="text-gray-500">Card Payments Received</span>{previewLoading ? <Skeleton className="h-4 w-16" /> : <span>₹{figures.paymentsReceivedCard.toFixed(2)}</span>}</div>
                  <div className="flex justify-between"><span className="text-gray-500">Cash Refunds Issued</span>{previewLoading ? <Skeleton className="h-4 w-16" /> : <span className="text-red-600">-₹{figures.refundsCash.toFixed(2)}</span>}</div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <Field label="Opening Cash">
                    <input
                      type="number" min="0" step="0.01"
                      value={openingCash}
                      onChange={(e) => setOpeningCash(e.target.value)}
                      className="w-full px-4 py-2 border rounded"
                    />
                  </Field>
                  <Field label="Actual Cash Counted">
                    <input
                      type="number" min="0" step="0.01" required autoFocus
                      value={actualCash}
                      onChange={(e) => setActualCash(e.target.value)}
                      className="w-full px-4 py-2 border rounded"
                    />
                  </Field>
                </div>

                <div className="bg-gray-50 rounded p-4 mb-4 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Expected Cash in Drawer</span>
                    {previewLoading ? <Skeleton className="h-4 w-16" /> : <span className="font-medium">₹{expectedCash.toFixed(2)}</span>}
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Variance</span>
                    {previewLoading ? <Skeleton className="h-4 w-16" /> : <span className={varianceLabel(variance).className}>{varianceLabel(variance).text}</span>}
                  </div>
                </div>

                <Field label="Notes (optional)" className="mb-4">
                  <input
                    type="text"
                    placeholder="e.g. Gave wrong change earlier, short by ₹50"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-4 py-2 border rounded"
                  />
                </Field>

                <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
                  {existing ? 'Update Closing' : 'Save Closing'}
                </button>
                {message && <p className={`mt-3 text-sm ${message === 'Closing saved' ? 'text-green-600' : 'text-red-600'}`}>{message}</p>}
              </form>
            )}
          </div>

          <h2 className="text-xl font-bold mb-3">Closing History</h2>
          <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto">
            {historyLoading ? (
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left">Date</th>
                    <th className="px-6 py-3 text-right">Expected</th>
                    <th className="px-6 py-3 text-right">Actual</th>
                    <th className="px-6 py-3 text-right">Variance</th>
                    <th className="px-6 py-3 text-left">Closed By</th>
                  </tr>
                </thead>
                <TableSkeleton rows={5} cols={5} />
              </table>
            ) : history.length === 0 ? (
              <EmptyState title="No closings recorded yet" message="Save your first daily closing above and it will show up here." />
            ) : (
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left">Date</th>
                    <th className="px-6 py-3 text-right">Expected</th>
                    <th className="px-6 py-3 text-right">Actual</th>
                    <th className="px-6 py-3 text-right">Variance</th>
                    <th className="px-6 py-3 text-left">Closed By</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => {
                    const v = varianceLabel(h.variance)
                    return (
                      <tr key={h.id} className="row-in border-b hover:bg-gray-50 cursor-pointer" onClick={() => setDate(h.closing_date)}>
                        <td className="px-6 py-3">{h.closing_date}</td>
                        <td className="px-6 py-3 text-right">₹{h.expected_cash.toFixed(2)}</td>
                        <td className="px-6 py-3 text-right">₹{h.actual_cash.toFixed(2)}</td>
                        <td className={`px-6 py-3 text-right ${v.className}`}>{v.text}</td>
                        <td className="px-6 py-3">{h.closed_by_username || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
