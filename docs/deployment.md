# Deployment Guide (Cloudflare Pages)

This guide walks you through deploying the starter to Cloudflare Pages using the official Astro SSR Cloudflare adapter (`@astrojs/cloudflare`).

---

## 1. Cloudflare Pages Build Settings

When creating a new Cloudflare Pages project linked to your Git repository, configure the following build parameters in the Cloudflare Dashboard:

| Setting | Value |
|---|---|
| **Framework Preset** | Astro |
| **Build Command** | `npm run build` |
| **Build Output Directory** | `dist` |
| **Node.js Version** | `20.x` or `22.x` (Set via `NODE_VERSION=20.18.0` in Environment Variables) |

---

## 2. Environment Variables Configuration

Configure the following secrets and environment variables under **Settings > Environment variables** in your Cloudflare Pages dashboard.

### Production & Preview Environment Variables

```ini
# Project 1: Scheduling & Auth Authority
SCHEDULING_SUPABASE_URL=https://your-project-1.supabase.co
SCHEDULING_SUPABASE_PUBLISHABLE_KEY=your_project_1_publishable_key
SCHEDULING_SUPABASE_SECRET_KEY=your_project_1_secret_key

# Project 2: Competitors (Server-Only)
COMPETITORS_SUPABASE_URL=https://your-project-2.supabase.co
COMPETITORS_SUPABASE_SECRET_KEY=your_project_2_secret_key

# Project 3: Analytics (Server-Only)
ANALYTICS_SUPABASE_URL=https://your-project-3.supabase.co
ANALYTICS_SUPABASE_SECRET_KEY=your_project_3_secret_key

# Site URL Configuration
PUBLIC_SITE_URL=https://your-domain.pages.dev
```

> [!IMPORTANT]
> Mark `SCHEDULING_SUPABASE_SECRET_KEY`, `COMPETITORS_SUPABASE_SECRET_KEY`, and `ANALYTICS_SUPABASE_SECRET_KEY` as **Encrypted / Secret** in the Cloudflare Pages settings to ensure they are never exposed in build logs.

---

## 3. Custom Domain & SSL

1. In Cloudflare Pages, navigate to **Custom domains**.
2. Add your apex domain or subdomain (e.g., `app.yourdomain.com`).
3. Cloudflare will automatically provision Universal SSL certificates and route traffic to the edge runtime.

---

## 4. Wrangler CLI Deployment (Alternative)

If deploying via the CLI rather than Git integration:

```bash
# Authenticate with Cloudflare
npx wrangler login

# Build the project
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=my-saas-starter
```
