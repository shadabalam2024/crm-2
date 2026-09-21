import { useState, useEffect } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import Navbar from '../../components/Navbar'
import Sidebar from '../../components/Sidebar'
import EmptyState from '../../components/EmptyState'
import { Skeleton, TableSkeleton } from '../../components/Skeleton'
import { supabase } from '../../lib/supabaseClient'

const toDateInput = (d) => d.toISOString().split('T')[0]

export default function AnalyticsPage() {
  const today = new Date()
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(today.getDate() - 30)

  const [startDate, setStartDate] = useState(toDateInput(thirtyDaysAgo))
  const [endDate, setEndDate] = useState(toDateInput(today))
  const [trend, setTrend] = useState([])
  const [profitAnalysis, setProfitAnalysis] = useState([])
  const [categoryPerformance, setCategoryPerformance] = useState([])
  const [salesReport, setSalesReport] = useState([])

  const [productSearchTerm, setProductSearchTerm] = useState('')
  const [productSearchResults, setProductSearchResults] = useState([])
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [productPerformance, setProductPerformance] = useState(null)

  const [trendLoading, setTrendLoading] = useState(true)
  const [rangeLoading, setRangeLoading] = useState(true)
  const [productLoading, setProductLoading] = useState(false)

  useEffect(() => {
    loadTrend()
  }, [])

  useEffect(() => {
    loadRangeData()
  }, [startDate, endDate])

  useEffect(() => {
    if (selectedProduct) {
      loadProductPerformance()
    }
  }, [selectedProduct, startDate, endDate])

  const loadTrend = async () => {
    const { data, error } = await supabase.rpc('sales_trend')
    if (error) {
      console.error('Failed to load sales trend:', error)
      setTrend([])
      setTrendLoading(false)
      return
    }
    setTrend((data || []).map(d => ({ ...d, sales: d.sales || 0 })))
    setTrendLoading(false)
  }

  const loadRangeData = async () => {
    setRangeLoading(true)
    const [profitRes, categoryRes, salesRes] = await Promise.all([
      supabase.rpc('profit_analysis', { p_start_date: startDate, p_end_date: endDate }),
      supabase.rpc('category_performance', { p_start_date: startDate, p_end_date: endDate }),
      supabase.rpc('sales_report', { p_start_date: startDate, p_end_date: endDate })
    ])
    setProfitAnalysis(profitRes.data || [])
    setCategoryPerformance(categoryRes.data || [])
    setSalesReport(salesRes.data || [])
    setRangeLoading(false)
  }

  const handleProductSearch = async (value) => {
    setProductSearchTerm(value)
    if (!value.trim()) {
      setProductSearchResults([])
      return
    }
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .or(`name.ilike.%${value}%,sku.ilike.%${value}%,barcode.ilike.%${value}%`)
      .not('is_custom', 'is', true)
      .limit(10)
    if (error) {
      setProductSearchResults([])
      return
    }
    setProductSearchResults(data || [])
  }

  const selectProduct = (product) => {
    setSelectedProduct(product)
    setProductSearchTerm(product.name)
    setProductSearchResults([])
  }

  const clearProduct = () => {
    setSelectedProduct(null)
    setProductSearchTerm('')
    setProductPerformance(null)
  }

  const loadProductPerformance = async () => {
    setProductLoading(true)
    const { data, error } = await supabase.rpc('product_performance', {
      p_product_id: selectedProduct.id,
      p_start_date: startDate,
      p_end_date: endDate
    })
    if (error) {
      console.error('Failed to load product performance:', error)
      setProductPerformance(null)
      setProductLoading(false)
      return
    }
    setProductPerformance(data)
    setProductLoading(false)
  }

  const totalRevenue = salesReport.reduce((sum, d) => sum + (d.total_sales || 0), 0)
  const totalInvoices = salesReport.reduce((sum, d) => sum + (d.invoice_count || 0), 0)
  const totalProfit = profitAnalysis.reduce((sum, p) => sum + (p.profit || 0), 0)

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1">
        <Navbar />
        <div className="p-4 sm:p-8">
          <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
            <h1 className="text-3xl font-bold">Analytics</h1>
            <div className="flex items-end gap-2 text-sm">
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border rounded" />
              </div>
              <span className="text-gray-400 pb-2">to</span>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border rounded" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="row-in bg-white p-6 rounded-lg shadow">
              <p className="text-gray-600">Revenue (range)</p>
              {rangeLoading ? <Skeleton className="h-8 w-24 mt-1" /> : <p className="text-3xl font-bold">₹{totalRevenue.toFixed(0)}</p>}
            </div>
            <div className="row-in bg-white p-6 rounded-lg shadow">
              <p className="text-gray-600">Profit (range)</p>
              {rangeLoading ? <Skeleton className="h-8 w-24 mt-1" /> : <p className="text-3xl font-bold">₹{totalProfit.toFixed(0)}</p>}
            </div>
            <div className="row-in bg-white p-6 rounded-lg shadow">
              <p className="text-gray-600">Invoices (range)</p>
              {rangeLoading ? <Skeleton className="h-8 w-16 mt-1" /> : <p className="text-3xl font-bold">{totalInvoices}</p>}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-xl font-bold mb-4">Product Performance</h2>
            <label className="block text-xs text-gray-500 mb-1">Product</label>
            <div className="relative mb-4 max-w-md">
              {selectedProduct ? (
                <div className="flex items-center justify-between border rounded px-4 py-2 bg-gray-50">
                  <span className="font-medium">{selectedProduct.name}</span>
                  <button onClick={clearProduct} className="text-gray-400 hover:text-gray-700 text-sm">Change</button>
                </div>
              ) : (
                <input
                  type="text"
                  placeholder="Search a product to see its performance..."
                  value={productSearchTerm}
                  onChange={(e) => handleProductSearch(e.target.value)}
                  className="w-full px-4 py-2 border rounded"
                />
              )}
              {!selectedProduct && productSearchTerm && (
                <div className="absolute z-10 w-full bg-white border rounded mt-1 shadow-lg max-h-64 overflow-y-auto">
                  {productSearchResults.length > 0 ? (
                    productSearchResults.map(p => (
                      <button
                        key={p.id}
                        onClick={() => selectProduct(p)}
                        className="row-in w-full text-left px-4 py-2 hover:bg-gray-100 flex justify-between text-sm"
                      >
                        <span>{p.name}</span>
                        <span className="text-gray-500">{p.sku}</span>
                      </button>
                    ))
                  ) : (
                    <p className="px-4 py-3 text-sm text-gray-400">No products match "{productSearchTerm}"</p>
                  )}
                </div>
              )}
            </div>

            {selectedProduct && (productLoading || productPerformance) && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div className="bg-gray-50 p-4 rounded">
                    <p className="text-xs text-gray-500">Qty Sold (range)</p>
                    {productLoading ? <Skeleton className="h-6 w-12 mt-1" /> : <p className="text-xl font-bold">{productPerformance.quantity_sold}</p>}
                  </div>
                  <div className="bg-gray-50 p-4 rounded">
                    <p className="text-xs text-gray-500">Revenue (range)</p>
                    {productLoading ? <Skeleton className="h-6 w-16 mt-1" /> : <p className="text-xl font-bold">₹{productPerformance.revenue.toFixed(0)}</p>}
                  </div>
                  <div className="bg-gray-50 p-4 rounded">
                    <p className="text-xs text-gray-500">Profit (range)</p>
                    {productLoading ? <Skeleton className="h-6 w-16 mt-1" /> : <p className="text-xl font-bold">₹{productPerformance.profit.toFixed(0)}</p>}
                  </div>
                </div>
                {productLoading ? (
                  <Skeleton className="h-[220px] w-full" />
                ) : productPerformance.daily.length === 0 ? (
                  <EmptyState title="No sales for this product" message="Try a wider date range." />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={productPerformance.daily}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="quantity_sold" fill="#2563eb" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-xl font-bold mb-4">Sales Trend (last 30 days)</h2>
            {trendLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : trend.length === 0 ? (
              <EmptyState title="No sales data yet" message="Once you complete a sale, your trend will show up here." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => `₹${v}`} />
                  <Line type="monotone" dataKey="sales" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-6 overflow-x-auto">
              <h2 className="text-xl font-bold mb-4">Profit by Product</h2>
              {rangeLoading ? (
                <table className="w-full text-sm"><TableSkeleton rows={5} cols={4} /></table>
              ) : profitAnalysis.length === 0 ? (
                <EmptyState title="No sales in this range" message="Try a wider date range." />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2">Product</th>
                      <th className="py-2 text-right">Qty</th>
                      <th className="py-2 text-right">Profit</th>
                      <th className="py-2 text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitAnalysis.map(p => (
                      <tr key={p.id} className="row-in border-b">
                        <td className="py-2">{p.name}</td>
                        <td className="py-2 text-right">{p.quantity_sold}</td>
                        <td className="py-2 text-right">₹{p.profit.toFixed(0)}</td>
                        <td className="py-2 text-right">{p.margin}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bg-white rounded-lg shadow p-6 overflow-x-auto">
              <h2 className="text-xl font-bold mb-4">Category Performance</h2>
              {rangeLoading ? (
                <table className="w-full text-sm"><TableSkeleton rows={5} cols={3} /></table>
              ) : categoryPerformance.length === 0 ? (
                <EmptyState title="No sales in this range" message="Try a wider date range." />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2">Category</th>
                      <th className="py-2 text-right">Items Sold</th>
                      <th className="py-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryPerformance.map((c, i) => (
                      <tr key={i} className="row-in border-b">
                        <td className="py-2">{c.category || 'Uncategorized'}</td>
                        <td className="py-2 text-right">{c.items_sold}</td>
                        <td className="py-2 text-right">₹{c.revenue.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
