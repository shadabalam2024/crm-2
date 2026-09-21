import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function InvoicePrint() {
  const { invoiceId } = useParams()
  const [invoice, setInvoice] = useState(null)
  const [shop, setShop] = useState({})

  useEffect(() => {
    const load = async () => {
      const [{ data: inv }, { data: items }, { data: shopSettings }] = await Promise.all([
        supabase.from('invoices').select('*').eq('id', invoiceId).maybeSingle(),
        supabase.from('invoice_items').select('*').eq('invoice_id', invoiceId),
        supabase.from('shop_settings').select('*').limit(1).maybeSingle(),
      ])
      setInvoice(inv ? { ...inv, items: items || [] } : null)
      setShop(shopSettings || {})
    }
    load()
  }, [invoiceId])

  useEffect(() => {
    if (!invoice) return
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [invoice])

  if (!invoice) {
    return <div style={{ padding: 20, fontFamily: 'sans-serif' }}>Loading invoice...</div>
  }

  const paperWidth = Number(shop.thermal_paper_width) || 80

  const subtotal = invoice.items.reduce((sum, item) => sum + item.subtotal + (item.discount || 0), 0)
  const itemDiscounts = invoice.items.reduce((sum, item) => sum + (item.discount || 0), 0)

  return (
    <div style={{ fontFamily: "'Courier New', monospace", fontSize: 13, color: '#000', padding: 16, maxWidth: Math.round(340 * (paperWidth / 80)), margin: '0 auto' }}>
      <style>{`
        @page { size: ${paperWidth}mm auto; margin: 3mm; }
        @media print {
          .no-print { display: none !important; }
        }
        body { background: #fff; }
      `}</style>

      <button
        onClick={() => window.print()}
        className="no-print"
        style={{ width: '100%', padding: '8px 0', marginBottom: 16, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'sans-serif' }}
      >
        Print
      </button>

      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        {shop.logo_path && (
          <img src={shop.logo_path} alt="Logo" style={{ maxWidth: 80, maxHeight: 80, margin: '0 auto 6px', display: 'block' }} />
        )}
        <div style={{ fontSize: 18, fontWeight: 'bold' }}>{shop.shop_name || 'CRM'}</div>
        {shop.shop_address && <div>{shop.shop_address}</div>}
        {shop.shop_phone && <div>Ph: {shop.shop_phone}</div>}
        {shop.gst_number && <div>GSTIN: {shop.gst_number}</div>}
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Bill #: {invoice.bill_number}</span>
        <span>{new Date(invoice.invoice_date || invoice.created_at || new Date().toISOString()).toLocaleString()}</span>
      </div>
      {invoice.customer_name && (
        <div>Customer: {invoice.customer_name}{invoice.customer_phone ? ` (${invoice.customer_phone})` : ''}</div>
      )}
      {invoice.created_by_username && <div>Cashier: {invoice.created_by_username}</div>}

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '46%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '20%' }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: '1px solid #000', textAlign: 'left' }}>
            <th style={{ padding: '2px 4px 2px 0' }}>Item</th>
            <th style={{ padding: '2px 4px', textAlign: 'center' }}>Qty</th>
            <th style={{ padding: '2px 4px', textAlign: 'right' }}>Price</th>
            <th style={{ padding: '2px 0', textAlign: 'right' }}>Amt</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map(item => (
            <tr key={item.id}>
              <td style={{ padding: '2px 4px 2px 0', wordBreak: 'break-word' }}>{item.product_name}</td>
              <td style={{ padding: '2px 4px', textAlign: 'center' }}>{item.quantity}</td>
              <td style={{ padding: '2px 4px', textAlign: 'right' }}>{item.unit_price}</td>
              <td style={{ padding: '2px 0', textAlign: 'right' }}>{item.subtotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Subtotal</span>
        <span>₹{subtotal.toFixed(2)}</span>
      </div>
      {itemDiscounts > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Item Discounts</span>
          <span>-₹{itemDiscounts.toFixed(2)}</span>
        </div>
      )}
      {invoice.discount_amount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Discount</span>
          <span>-₹{invoice.discount_amount.toFixed(2)}</span>
        </div>
      )}
      {invoice.gst_amount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>GST{shop.gst_number ? ` (${shop.gst_number})` : ''}</span>
          <span>₹{invoice.gst_amount.toFixed(2)}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 15, marginTop: 4 }}>
        <span>Total</span>
        <span>₹{invoice.total_amount.toFixed(2)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span>Payment Mode</span>
        <span style={{ textTransform: 'capitalize' }}>{invoice.payment_mode}</span>
      </div>

      {(shop.payment_terms || shop.return_policy) && (
        <>
          <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />
          {shop.payment_terms && <div style={{ fontSize: 11 }}>{shop.payment_terms}</div>}
          {shop.return_policy && <div style={{ fontSize: 11, marginTop: 4 }}>{shop.return_policy}</div>}
        </>
      )}

      <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12 }}>Thank you for shopping with us!</div>
    </div>
  )
}
