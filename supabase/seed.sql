-- Demo data seed. Safe to run more than once: it checks for its own
-- marker category and skips entirely if it has already run.
--
-- Run with: npm run seed
-- (or directly: supabase db query --linked --file supabase/seed.sql)

do $$
declare
  v_cat_id uuid;
  v_earbuds uuid;
  v_powerbank uuid;
  v_charger uuid;
  v_mouse uuid;
  v_watch uuid;
  v_speaker uuid;
  v_priya uuid;
  v_rahul uuid;
  v_inv uuid;
begin
  if exists (select 1 from public.categories where name = 'Electronics') then
    raise notice 'Seed data already present (Electronics category exists) - skipping.';
    return;
  end if;

  insert into public.categories (name) values ('Electronics') returning id into v_cat_id;

  insert into public.products (name, sku, barcode, category_id, cost_price, selling_price, current_stock, min_stock_level)
  values ('Wireless Bluetooth Earbuds', 'ELE-EAR-01', '890200000001', v_cat_id, 800, 1499, 30, 5)
  returning id into v_earbuds;

  insert into public.products (name, sku, barcode, category_id, cost_price, selling_price, current_stock, min_stock_level)
  values ('20000mAh Power Bank', 'ELE-PWB-01', '890200000002', v_cat_id, 900, 1699, 25, 5)
  returning id into v_powerbank;

  insert into public.products (name, sku, barcode, category_id, cost_price, selling_price, current_stock, min_stock_level)
  values ('USB-C Fast Charger 33W', 'ELE-CHG-01', '890200000003', v_cat_id, 350, 699, 50, 8)
  returning id into v_charger;

  insert into public.products (name, sku, barcode, category_id, cost_price, selling_price, current_stock, min_stock_level)
  values ('Wireless Mouse', 'ELE-MOU-01', '890200000004', v_cat_id, 250, 499, 40, 6)
  returning id into v_mouse;

  insert into public.products (name, sku, barcode, category_id, cost_price, selling_price, current_stock, min_stock_level)
  values ('Smart Watch', 'ELE-WCH-01', '890200000005', v_cat_id, 1800, 3499, 15, 3)
  returning id into v_watch;

  insert into public.products (name, sku, barcode, category_id, cost_price, selling_price, current_stock, min_stock_level)
  values ('Bluetooth Speaker', 'ELE-SPK-01', '890200000006', v_cat_id, 1100, 1999, 20, 4)
  returning id into v_speaker;

  insert into public.customers (name, phone, is_recurring) values ('Priya Sharma', '9812345601', true) returning id into v_priya;
  insert into public.customers (name, phone) values ('Rahul Verma', '9812345602') returning id into v_rahul;

  insert into public.invoices (bill_number, customer_name, total_amount, amount_paid, payment_mode, invoice_date, created_at)
  values ('DEMO-0001', 'Walk-in Customer', 2897, 2897, 'cash', now() - interval '11 days', now() - interval '11 days')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal) values
    (v_inv, v_earbuds, 'Wireless Bluetooth Earbuds', 1, 1499, 1499),
    (v_inv, v_charger, 'USB-C Fast Charger 33W', 2, 699, 1398);

  insert into public.invoices (bill_number, customer_name, total_amount, amount_paid, payment_mode, invoice_date, created_at)
  values ('DEMO-0002', 'Walk-in Customer', 1699, 1699, 'card', now() - interval '10 days', now() - interval '10 days')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal) values
    (v_inv, v_powerbank, '20000mAh Power Bank', 1, 1699, 1699);

  insert into public.invoices (bill_number, customer_id, customer_name, total_amount, amount_paid, payment_mode, invoice_date, created_at)
  values ('DEMO-0003', v_priya, 'Priya Sharma', 3499, 0, 'credit', now() - interval '9 days', now() - interval '9 days')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal) values
    (v_inv, v_watch, 'Smart Watch', 1, 3499, 3499);
  update public.customers set credit_balance = credit_balance + 3499 where id = v_priya;

  insert into public.invoices (bill_number, customer_name, total_amount, amount_paid, payment_mode, invoice_date, created_at)
  values ('DEMO-0004', 'Walk-in Customer', 2997, 2997, 'cash', now() - interval '8 days', now() - interval '8 days')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal) values
    (v_inv, v_speaker, 'Bluetooth Speaker', 1, 1999, 1999),
    (v_inv, v_mouse, 'Wireless Mouse', 2, 499, 998);

  insert into public.invoices (bill_number, customer_name, total_amount, amount_paid, payment_mode, invoice_date, created_at)
  values ('DEMO-0005', 'Walk-in Customer', 1998, 1998, 'card', now() - interval '7 days', now() - interval '7 days')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal) values
    (v_inv, v_mouse, 'Wireless Mouse', 4, 499, 1998);

  insert into public.invoices (bill_number, customer_name, total_amount, amount_paid, payment_mode, invoice_date, created_at)
  values ('DEMO-0006', 'Walk-in Customer', 1998, 1998, 'cash', now() - interval '6 days', now() - interval '6 days')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal) values
    (v_inv, v_charger, 'USB-C Fast Charger 33W', 1, 699, 699),
    (v_inv, v_powerbank, '20000mAh Power Bank', 1, 1699, 1699) ;

  insert into public.invoices (bill_number, customer_id, customer_name, total_amount, amount_paid, payment_mode, invoice_date, created_at)
  values ('DEMO-0007', v_rahul, 'Rahul Verma', 3398, 1000, 'credit', now() - interval '5 days', now() - interval '5 days')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal) values
    (v_inv, v_powerbank, '20000mAh Power Bank', 2, 1699, 3398);
  update public.customers set credit_balance = credit_balance + 2398 where id = v_rahul;
  insert into public.customer_payments (customer_id, invoice_id, amount, payment_mode, payment_date)
  values (v_rahul, v_inv, 1000, 'cash', now() - interval '2 days');

  insert into public.invoices (bill_number, customer_name, total_amount, amount_paid, payment_mode, invoice_date, created_at)
  values ('DEMO-0008', 'Walk-in Customer', 2998, 2998, 'cash', now() - interval '4 days', now() - interval '4 days')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal) values
    (v_inv, v_earbuds, 'Wireless Bluetooth Earbuds', 2, 1499, 2998);

  insert into public.invoices (bill_number, customer_name, total_amount, amount_paid, payment_mode, invoice_date, created_at)
  values ('DEMO-0009', 'Walk-in Customer', 3998, 3998, 'card', now() - interval '3 days', now() - interval '3 days')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal) values
    (v_inv, v_watch, 'Smart Watch', 1, 3499, 3499),
    (v_inv, v_mouse, 'Wireless Mouse', 1, 499, 499);

  insert into public.invoices (bill_number, customer_name, total_amount, amount_paid, payment_mode, invoice_date, created_at)
  values ('DEMO-0010', 'Walk-in Customer', 3998, 3998, 'cash', now() - interval '1 day', now() - interval '1 day')
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal) values
    (v_inv, v_speaker, 'Bluetooth Speaker', 2, 1999, 3998);

  insert into public.invoices (bill_number, customer_name, total_amount, amount_paid, payment_mode, invoice_date, created_at)
  values ('DEMO-0011', 'Walk-in Customer', 3198, 3198, 'cash', now(), now())
  returning id into v_inv;
  insert into public.invoice_items (invoice_id, product_id, product_name, quantity, unit_price, subtotal) values
    (v_inv, v_earbuds, 'Wireless Bluetooth Earbuds', 1, 1499, 1499),
    (v_inv, v_powerbank, '20000mAh Power Bank', 1, 1699, 1699);

  raise notice 'Seed complete: 6 products, 2 customers, 11 invoices over the last 11 days.';
end $$;
