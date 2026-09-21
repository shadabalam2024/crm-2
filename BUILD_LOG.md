# Build Log: CRM

## Goal & scope decision

Built a shop management system on Supabase — billing, inventory, purchasing, customers, returns, daily cash closing, analytics, and settings — backed by Postgres with real security, not just a UI sitting on top of a database.

Left out on purpose: real-time updates, and a full mobile redesign. Fixed what was actually broken on smaller screens instead of redesigning every page for mobile.

## Stack & tooling

React, Vite, Redux Toolkit, Tailwind, Recharts on the frontend. Supabase for Postgres, Auth, Storage, Edge Functions, and Row Level Security — no separate backend server. Used the Supabase CLI to run migrations and deploy functions directly against the live project, for fast feedback. Used AI-assisted tooling to speed up repetitive implementation work.

## Key decisions & trade-offs

- **Role-based authorization**, not per-user. Roles are Admin, Manager, Cashier, Warehouse, enforced with Row Level Security. Trade-off: a Cashier can see every customer and invoice, not just their own.
- **Multi-step operations run as single Postgres functions**, not a chain of client-side calls. Receiving a purchase, processing a return, recording a payment, closing the day — each touches multiple tables and has to succeed or fail together, so each is one atomic function with the permission check built in.
- **Migrations run through the CLI against the live project**, not pasted into a dashboard by hand — faster to catch real problems early.

## Hard parts / dead ends

- The core tables didn't exist yet in the live project. Had to build the base schema before anything else could go in.
- A Postgres function that returns a full row needs direct assignment, not `SELECT ... INTO` — cost some debugging time to track down.
- Found and fixed a couple of pre-existing bugs along the way, including one where empty query results were silently replaced by fake placeholder data, which is what broke deleting a real inventory item.

## How I verified it works

- Ran a full production build after every batch of changes.
- Wrote a script that exercises the whole flow end to end — add a product, receive a purchase, sell it, return part of it, record a payment, close the day, run every analytics function — against the live database under an admin session.
- Checked the schema directly after each migration to confirm tables and functions actually landed.
- Seeded realistic demo data so graphs and history views show real numbers, not empty charts.
- With more time: I'd add an automated test suite. There isn't one yet.

## Known limitations

- No real-time updates.
- Completing a sale doesn't reduce stock yet — only purchases and returns touch stock.
- Manual cost-price edits in Inventory don't log to price history.
- Authorization is role-based, not per-user.
- Analytics profit uses each product's current cost price, not its cost at the time of sale.
- No automated tests yet.
- Built for a single shop, no multi-tenant support.

## Time spent

Rough breakdown: schema and security design, backend logic for purchases/returns/payments/closing, wiring the frontend to Supabase, deployment and testing, demo data and bug fixes, docs, and a UI polish pass.
