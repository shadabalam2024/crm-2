# Data model

CRM is a Vite + React SPA backed entirely by Supabase
(Postgres + Auth + Storage + Edge Functions). There is no separate
application server — the browser talks to Supabase directly using the
public anon key, and every access rule is enforced in the database via Row
Level Security (RLS). This document is generated from the **live schema**
(pulled via `supabase db query`), not just the migration files, so it
reflects what's actually deployed.

## Entity overview

| Table | Purpose |
|---|---|
| `profiles` | One row per `auth.users` row. Carries `username` and `role`. |
| `permissions` | Maps each `role` to a JSON object of feature flags (`billing`, `inventory`, `purchase`, `customers`, `dashboard`, `analytics`, `settings`, `returns`, `daily_closing`). Read by the frontend at login to gate UI. |
| `categories` | Product categories. |
| `products` | Catalog + stock. `is_custom = true` marks one-off Billing line items that aren't real inventory. |
| `price_history` | Audit log of cost-price changes (currently only written by `receive_purchase`). |
| `suppliers` | Purchase-order suppliers. |
| `purchases` / `purchase_items` | Purchase orders and their line items. A purchase starts `pending` and becomes `received` via the `receive_purchase` RPC, which is also what actually moves stock. |
| `customers` | Customer directory + running `credit_balance`. |
| `customer_payments` | Payments applied against a customer's credit balance (FIFO against their oldest unpaid credit invoices, via `record_customer_payment`). |
| `invoices` / `invoice_items` | Sales. `amount_paid`/`refunded_amount` track how much of `total_amount` has actually been collected/refunded. |
| `returns` / `return_items` | Refunds against a past invoice, created atomically via `create_return`. |
| `daily_closings` | End-of-day cash reconciliation, one row per `closing_date`, written by `save_daily_closing` (server computes every figure — the client only supplies opening/actual cash and notes). |
| `shop_settings` | Singleton row (`id = 1`) — shop info shown on invoices, plus thermal-print cosmetic settings and the logo URL. |

## Relationships

```
categories 1──* products *──1 (nullable) invoice_items *──1 invoices *──1 (nullable) customers
                  │                            │                              │
                  │                            └──* return_items *──1 returns ┘
                  │
                  ├──* price_history *──1 (nullable) purchases *──1 suppliers
                  │
                  └──* purchase_items *──1 purchases

customers 1──* customer_payments *──1 (nullable) invoices
profiles.id ──1:1── auth.users.id
permissions.role ── (matched by value, not FK) ── profiles.role
```

Deleting a `product` cascades its `price_history` but only nulls out its
`product_id` on `invoice_items`/`return_items` (so historical bills still
show the product name even after the catalog row is gone, since
`invoice_items.product_name` is denormalized at sale time). Deleting an
`invoice` cascades its `invoice_items` and `returns`.

## Full column reference

### `profiles`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK, → `auth.users.id` | no | — |
| username | text, unique | no | — |
| full_name | text | yes | — |
| role | text (`Admin`\|`Manager`\|`Cashier`\|`Warehouse`, checked) | no | `'Cashier'` |
| created_at | timestamptz | yes | `now()` |

A `handle_new_user` trigger on `auth.users` auto-creates the matching
`profiles` row on signup. An `enforce_profile_role_guard` trigger blocks a
non-Admin from changing their own `role` (self-escalation guard), and a
check constraint restricts `role` to the four known values.

### `permissions`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| role | text, unique | no | — |
| permissions | jsonb | no | — |

### `categories`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| name | text, unique | no | — |
| created_at | timestamptz | no | `now()` |

### `products`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| name | text | no | — |
| sku | text, unique (partial, where not null) | yes | — |
| barcode | text, unique (partial, where not null) | yes | — |
| category_id | uuid → `categories.id`, `SET NULL` | yes | — |
| cost_price | numeric | no | `0` |
| selling_price | numeric | no | `0` |
| current_stock | numeric | no | `0` |
| min_stock_level | numeric | no | `5` |
| is_custom | boolean | no | `false` |
| created_at | timestamptz | no | `now()` |

### `price_history`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| product_id | uuid → `products.id`, `CASCADE` | yes | — |
| old_cost_price | numeric | yes | — |
| new_cost_price | numeric | yes | — |
| unit_cost | numeric | yes | — |
| quantity | numeric | yes | — |
| source | text (`'purchase'` today) | yes | — |
| purchase_id | uuid → `purchases.id`, `NO ACTION` | yes | — |
| changed_at | timestamptz | no | `now()` |

### `suppliers`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| name | text | no | — |
| contact_person / phone / email / address | text | yes | — |
| created_at | timestamptz | no | `now()` |

### `purchases`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| supplier_id | uuid → `suppliers.id`, `NO ACTION` | no | — |
| purchase_date | timestamptz | no | `now()` |
| total_amount | numeric | no | `0` |
| status | text (`pending`\|`received`, checked) | no | `'pending'` |
| user_id | uuid → `auth.users.id` | yes | — |
| created_at | timestamptz | no | `now()` |

### `purchase_items`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| purchase_id | uuid → `purchases.id`, `CASCADE` | no | — |
| product_id | uuid → `products.id`, `NO ACTION` | no | — |
| quantity / unit_cost / subtotal | numeric | no | — |

### `customers`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| name | text | no | — |
| phone / email / address | text | yes | — |
| credit_balance | numeric | no | `0` |
| is_recurring | boolean | no | `false` |
| created_at | timestamptz | no | `now()` |

### `customer_payments`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| customer_id | uuid → `customers.id`, `CASCADE` | no | — |
| invoice_id | uuid → `invoices.id`, `SET NULL` | yes | — |
| amount | numeric | no | — |
| payment_mode | text | no | `'cash'` |
| payment_date | timestamptz | no | `now()` |

### `invoices`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| bill_number | text, unique | no | — |
| customer_id | uuid → `customers.id`, `SET NULL` | yes | — |
| customer_name | text (denormalized at sale time) | yes | — |
| total_amount / discount_amount / gst_amount | numeric | no | `0` |
| payment_mode | text (`cash`\|`card`\|`credit`) | no | `'cash'` |
| invoice_date | timestamptz | no | `now()` |
| user_id | uuid → `auth.users.id` | yes | — |
| created_at | timestamptz | no | `now()` |
| amount_paid | numeric | no | `0` |
| refunded_amount | numeric | no | `0` |

### `invoice_items`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| invoice_id | uuid → `invoices.id`, `CASCADE` | no | — |
| product_id | uuid → `products.id`, `SET NULL` | yes | — |
| product_name | text (denormalized) | yes | — |
| quantity / unit_price / subtotal | numeric | no | — |
| discount | numeric | no | `0` |
| discount_type | text (`flat`\|`percent`) | yes | `'flat'` |
| discount_value | numeric | yes | `0` |
| created_at | timestamptz | no | `now()` |

### `returns`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| return_number | text, unique (`RET-00001` style) | no | — |
| invoice_id | uuid → `invoices.id`, `CASCADE` | no | — |
| customer_id | uuid → `customers.id`, `SET NULL` | yes | — |
| return_date | timestamptz | no | `now()` |
| reason | text | yes | — |
| refund_amount | numeric | no | `0` |
| refund_mode | text (`cash`\|`credit_adjust`, checked) | no | `'cash'` |
| user_id | uuid → `auth.users.id` | yes | — |
| created_at | timestamptz | no | `now()` |

### `return_items`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| return_id | uuid → `returns.id`, `CASCADE` | no | — |
| invoice_item_id | uuid → `invoice_items.id`, `CASCADE` | no | — |
| product_id | uuid → `products.id`, `SET NULL` | yes | — |
| quantity / unit_price / subtotal | numeric | no | — |
| restocked | boolean | no | `false` |
| disposition | text (`damaged`\|`defective`\|`other`, checked) | yes | — |
| created_at | timestamptz | no | `now()` |

### `daily_closings`
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid, PK | no | `gen_random_uuid()` |
| closing_date | date, unique | no | — |
| opening_cash / cash_sales / card_sales / credit_sales / payments_received_cash / payments_received_card / refunds_cash / expected_cash / actual_cash / variance | numeric | no | `0` |
| notes | text | yes | — |
| closed_by | uuid → `auth.users.id` | yes | — |
| closed_at | timestamptz | no | `now()` |

### `shop_settings` (singleton, `id = 1`)
| Column | Type | Null | Default |
|---|---|---|---|
| id | integer, PK | no | `1` |
| shop_name / shop_address / shop_phone / shop_email / gst_number / payment_terms / return_policy / logo_path | text | yes | — |
| gst_rate | numeric | no | `0` |
| thermal_printing_enabled | boolean | no | `false` |
| thermal_paper_width | integer | no | `80` |

## Storage

| Bucket | Public | Purpose |
|---|---|---|
| `shop-assets` | yes (read) | Shop logo, uploaded from Settings → Shop Info. Write/delete restricted to `Admin` via storage RLS; anyone can read (needed for the print-invoice page, which has no session). |

## RPC functions (`supabase.rpc(...)`)

All are `SECURITY DEFINER` and check the caller's role via `current_role()`
internally (so RLS on the underlying tables doesn't need to allow the write
directly — the function is the only sanctioned path).

| Function | Args | Returns | Role gate | Purpose |
|---|---|---|---|---|
| `current_role()` | — | text | any authenticated | Helper: caller's `profiles.role`. Used inside RLS policies and other functions. |
| `get_email_for_username(p_username)` | text | text | anon + authenticated | Resolves a login username to its email (joins `auth.users`) for the login screen, without exposing the rest of `profiles` to anon. |
| `receive_purchase(p_purchase_id)` | uuid | void | Admin, Warehouse | Marks a purchase received: for each line, recomputes `products.cost_price` as a weighted average, bumps `current_stock`, logs `price_history`, flips `purchases.status`. Atomic. |
| `create_return(p_invoice_id, p_items, p_reason, p_refund_mode)` | uuid, jsonb, text, text | `returns` row | Admin, Manager, Cashier | Validates each line (ownership, returnable quantity, restock/disposition rule), inserts the return + items, restocks non-custom products, updates `invoices.refunded_amount` and (if `credit_adjust`) `customers.credit_balance`. Atomic. |
| `get_invoice_return_details(p_invoice_id)` | uuid | table | Admin, Manager, Cashier | An invoice's line items annotated with `already_returned`, for the Returns UI. |
| `record_customer_payment(p_customer_id, p_amount, p_payment_mode)` | uuid, numeric, text | void | Admin, Manager, Cashier | Applies a payment FIFO against the customer's oldest unpaid credit invoices, records `customer_payments`, reduces `credit_balance`. Atomic. |
| `get_closing_preview(p_date)` | date | table | Admin, Manager, Cashier | Live-computed cash/card/credit sales, payments received, cash refunds for a date, plus a suggested opening cash (previous day's actual, carried forward). |
| `save_daily_closing(p_date, p_opening_cash, p_actual_cash, p_notes)` | date, numeric, numeric, text | `daily_closings` row | Admin, Manager, Cashier | Recomputes every figure server-side (never trusts a client-sent total), computes `expected_cash`/`variance`, upserts on `closing_date`. |
| `get_closing_history(p_limit)` | integer, default 60 | table | Admin, Manager, Cashier | Past closings, newest first, joined to the closing user's username. |
| `sales_report(p_start_date, p_end_date)` | date, date | table | Admin, Manager | Daily invoice count + total sales in a range. |
| `profit_analysis(p_start_date, p_end_date)` | date, date | table | Admin, Manager | Per-product revenue/cost/profit/margin in a range (cost uses the product's *current* cost_price, not cost-at-sale-time). |
| `category_performance(p_start_date, p_end_date)` | date, date | table | Admin, Manager | Per-category items sold, revenue, avg price. |
| `sales_trend()` | — | table | Admin, Manager | Daily sales for the last 30 days. |
| `product_performance(p_product_id, p_start_date, p_end_date)` | uuid, date, date | jsonb | Admin, Manager | One product's daily breakdown + range totals. |
| `today_sales()` | — | jsonb | any authenticated | Today's invoice count, revenue by payment mode, profit — feeds Dashboard (visible to every role, not analytics-gated). |
| `top_products(p_limit)` | integer, default 5 | table | any authenticated | All-time top sellers by quantity — feeds Dashboard. |
| `low_stock_products()` | — | table | any authenticated | Products at or below `min_stock_level` — feeds Dashboard's alert widget. |
| `sales_trend_by_period(p_period, p_start_date, p_end_date)` | text (`day`\|`week`\|`month`), date, date | table | any authenticated | Bucketed sales for Dashboard's trend chart. |

## Edge Functions

| Function | Purpose |
|---|---|
| `admin-users` (`supabase/functions/admin-users/index.ts`) | Create/delete a user, reset a password. Runs with the service-role key (never exposed to the browser); verifies the caller is `Admin` via their `profiles` row before touching `auth.admin.*`. Called from Settings → Users & Roles via `supabase.functions.invoke('admin-users', {...})`. |

## Auth & permission model

- Auth is plain Supabase Auth (email/password). The login screen also
  accepts a username, resolved to an email via `get_email_for_username`.
- Every table has RLS enabled. Authorization is **role-based**, not
  per-user: a `Cashier` can see every customer/invoice, not just ones they
  personally created. There is no per-row ownership model in this app.
- The role → feature mapping lives in `permissions` (read once at login by
  the frontend to decide which nav links/pages to show) and is mirrored,
  independently, by each table's RLS policies (so hiding a nav link is a UX
  nicety — the real enforcement is server-side).
- A user cannot escalate their own role (`profiles` trigger), and `role` is
  constrained to `Admin`/`Manager`/`Cashier`/`Warehouse`.

## Setting this up from scratch

1. Create a Supabase project. Note its project ref and anon key.
2. Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (see `.env.example`).
3. Run every file in `supabase/*.sql` against the project, **in this exact
   order** (later files depend on tables/functions earlier ones create):
   ```
   000_base_schema.sql
   rls_policies.sql
   customers_and_invoices.sql
   purchase.sql
   returns.sql
   daily_closing.sql
   analytics.sql
   settings.sql
   ```
   Either paste each into the Supabase SQL editor, or with the CLI:
   `supabase link --project-ref <ref>` then
   `supabase db query --linked --file supabase/<name>.sql` for each, in order.
4. Deploy the Edge Function: `supabase functions deploy admin-users`.
5. Create at least one `profiles` row with `role = 'Admin'` for your own
   account (directly in the SQL editor, or sign up then update the row —
   there is no first-run bootstrap flow in the app).
6. `npm install && npm run dev`.
