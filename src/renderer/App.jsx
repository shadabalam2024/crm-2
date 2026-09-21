import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import Login from './pages/Login'
import { setUser } from './store/slices/auth'
import { supabase } from './lib/supabaseClient'
import { getPermissionsForRole } from './utils/permissions'
import Dashboard from './pages/Dashboard'
import BillingPage from './pages/Billing/BillingPage'
import InventoryPage from './pages/Inventory/InventoryPage'
import PurchasePage from './pages/Purchase/PurchasePage'
import CustomersPage from './pages/Customers/CustomersPage'
import ReturnsPage from './pages/Returns/ReturnsPage'
import DailyClosingPage from './pages/DailyClosing/DailyClosingPage'
import AnalyticsPage from './pages/Analytics/AnalyticsPage'
import SettingsPage from './pages/Settings/SettingsPage'
import InvoicePrint from './pages/InvoicePrint'

function AuthGate() {
  const user = useSelector(state => state.auth.user)

  if (!user) return <Login />

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/purchase" element={<PurchasePage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/returns" element={<ReturnsPage />} />
        <Route path="/daily-closing" element={<DailyClosingPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/print/:invoiceId" element={<InvoicePrint />} />
      </Routes>
    </BrowserRouter>
  )
}

function App() {
  const dispatch = useDispatch()
  const [isReady, setIsReady] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (!session?.user) {
          setSessionChecked(true)
          setIsReady(true)
          return
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle()

        const role = profile?.role || 'Cashier'
        const permissions = await getPermissionsForRole(role)

        dispatch(setUser({
          user: {
            id: session.user.id,
            email: session.user.email,
            role,
            permissions,
          },
          permissions,
        }))
      } catch (error) {
        console.warn('Session restore failed:', error)
      } finally {
        setSessionChecked(true)
        setIsReady(true)
      }
    }

    const timer = setTimeout(() => setIsReady(true), 200)
    restoreSession()

    return () => clearTimeout(timer)
  }, [dispatch])

  if (!isReady || !sessionChecked) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>
  }

  return <AuthGate />
}

export default App
