# PinOrbit Admin Dashboard

PinOrbit is an automated Pinterest recipe publishing management dashboard built with **Astro**, **Tailwind CSS**, and **Supabase**.

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+ or 20+
- npm 9+

### 2. Environment Configuration
Create a `.env` file in the root directory (or copy from `.env.example`):

```env
PUBLIC_SUPABASE_URL=https://zeryyrmhdueezzwyodhq.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inplcnl5cm1oZHVlZXp6d3lvZGhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3MTA0MTQsImV4cCI6MjEwMTI4NjQxNH0.5erFNHK-KOc-cNVmz8VdTPPUs8B4IkObOt0NToRH-Q4
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Development Server
```bash
npm run dev
```
Open [http://localhost:4321](http://localhost:4321) in your browser.

### 5. Production Build
```bash
npm run build
npm run preview
```

---

## 🔒 Read-Only Supabase Integration

The current interface operates in strict **Read-Only Mode** using Supabase's public `anon` key:

- **Dashboard (`/dashboard`)**: Displays real-time KPI counts (Accounts, Pending Pins, Posted Pins, Failed Pins), Recent Pins Queue, and Latest Execution Logs.
- **Accounts (`/accounts`)**: Lists registered Pinterest accounts, status, daily limits, linked boards count, and webhook URLs.
- **Boards (`/boards`)**: Displays Pinterest board mappings grouped by account.
- **Pins (`/pins`)**: Provides interactive status filtering and local real-time text search (by title, account, or board).
- **Logs (`/logs`)**: Shows execution audit logs and error messages.

### How to Verify Live Supabase Data
1. Look at the top-right header badge:
   - **`Supabase Live (Read-Only)`** (Green badge) indicates active connection to your Supabase instance.
   - If `.env` is unconfigured or unreachable, it falls back to **`Preview Mode (Mock Data)`** (Amber badge).
2. Insert a row directly into your Supabase database table (e.g. `accounts` or `pins`), then refresh the page to confirm the data is fetched live from Supabase.
