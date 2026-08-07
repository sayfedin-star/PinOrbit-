# Customization & Rebranding Guide

This guide details how to adapt, rebrand, and customize this starter for your new SaaS product.

---

## 1. Project Metadata & Manifest

Update the package name and project identifiers in `package.json` and `wrangler.jsonc`:

```json
// package.json
{
  "name": "your-saas-name",
  "version": "1.0.0"
}
```

```json
// wrangler.jsonc
{
  "name": "your-saas-name"
}
```

---

## 2. Branding, Logos, and Colors

1. **Brand Colors**: Customize theme tokens and accent colors in `tailwind.config.mjs`:
   ```js
   // tailwind.config.mjs
   theme: {
     extend: {
       colors: {
         brand: {
           50: '#f0fdf4',
           500: '#22c55e',
           600: '#16a34a',
           700: '#15803d',
         },
       },
     },
   }
   ```
2. **App Icons & Assets**: Replace `public/favicon.svg` and marketing images in `public/` with your product assets.
3. **Application Title**: Update application title defaults and metadata in `src/layouts/Layout.astro` and `src/components/Navigation.astro`.

---

## 3. Extending Schemas & Database Entities

When introducing new features:

1. **Create New Migration Files**: Place migrations in `supabase/scheduling/migrations/`, `supabase/competitors/migrations/`, or `supabase/analytics/migrations/` depending on the domain.
2. **Preserve Workspace Isolation**: Include `workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE` on all new tenant tables.
3. **Enable Row-Level Security**: Apply the tenant RLS policies outlined in [docs/security.md](security.md).
4. **Update TypeScript Definitions**: Add entity interfaces to `src/lib/types.ts`.

---

## 4. Adapting Business Logic & Webhooks

- **Webhook Dispatch**: Update webhook payload schemas and retry logic in `src/lib/supabase.ts` and `src/server/services/queue-service.ts`.
- **Scheduled Jobs**: Modify automated cron intervals and Edge Functions in `supabase/functions/` to match your ingestion requirements.
