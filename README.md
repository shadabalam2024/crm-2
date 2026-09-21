# CRM

A web-based point-of-sale and inventory management system for retail shops — billing, inventory, purchasing, customers, returns, daily cash closing, and analytics, backed entirely by Supabase.

## Docs

- **[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)** — backend choice, services used, security model and how it's verified, setup from zero, demo data and test logins. Start here.
- **[docs/DATA_MODEL.md](docs/DATA_MODEL.md)** — full schema reference: every table, column, relationship, and RPC function.

## Quick start

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

For provisioning a Supabase project from scratch (schema, RLS, demo data, test logins), see [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md).

## Stack

React 18 + Redux Toolkit + React Router + Tailwind + Recharts, on Vite. Supabase (Postgres, Auth, Storage, Edge Functions, Row Level Security) for everything else — no separate backend server.
