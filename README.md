# PinOrbit Admin Dashboard

PinOrbit is an automated Pinterest recipe publishing management dashboard built with **Astro**, **Tailwind CSS**, and **Supabase**.

## 🚀 Features & Modules

- **Dashboard (`/dashboard`)**: Displays real-time KPI counts, Multi-Webhook Orchestration metrics, Recent Pins Queue, System Logs, and Recent Importer Session summaries.
- **Accounts (`/accounts`)**: Lists registered Pinterest accounts, status, daily limits, linked boards, and multi-webhook management modal.
- **Multi-Webhook Orchestration**: Supports multiple Make.com outbound webhooks per account with monthly capacity meters, priority routing, primary toggle, and failure tracking.
- **Scheduled Posts Importer (`/imports`)**: Staged per-account importer supporting CSV file upload and public Google Sheet link parsing, board validation, duplicate warning, and bulk creation of pending pins.
- **Boards (`/boards`)**: Displays Pinterest board mappings grouped by account with Add/Edit board modals.
- **Pins Queue & History (`/pins`)**: Provides interactive status filtering, account filter dropdown, source badges, and real-time text search.
- **System Logs (`/logs`)**: Shows execution audit logs and error messages with CSV export.
- **Audit Trail (`/audit`)**: Automated database audit logs tracking administrative mutations on accounts, boards, and webhooks with before/after JSON diff inspection and CSV export.

---

## 🔒 Security & Authorization

- Client-side Supabase Auth integration with secure `requireAuth()` route protection.
- Row Level Security (RLS) policies tied to `public.admin_users` and `public.is_admin()`.
- Sensitive webhook endpoint URLs strictly masked across public display views and audit inspection logs.

---

## 🚀 Development & Build

### 1. Install Dependencies
```bash
npm install
```

### 2. Development Server
```bash
npm run dev
```
Open [http://localhost:4321](http://localhost:4321) in your browser.

### 3. Production Build
```bash
npm run build
npm run preview
```
