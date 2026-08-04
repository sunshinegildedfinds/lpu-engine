This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Staging listing queue support

Production remains the safe default: omit `LPU_DEPLOYMENT_ENV`, or set it to
`production`. Production queue creation uses the original column set and does
not send staging metadata.

To provision a separate staging deployment, apply the existing queue migration
and then the additive `supabase/migrations/20260803000000_add_listing_queue_staging_metadata.sql`
to the staging database. Configure these server-side variables there:

- `LPU_DEPLOYMENT_ENV=staging`
- `LPU_STAGING_TEST_RUN_ID=<UUID>` (recommended to group a test run; a UUID is generated if omitted)
- `LPU_STAGING_TTL_HOURS=24` (optional positive integer; 24 is the default)
- The existing `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
  `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET` values for the staging project.

Staging-created titles are visibly prefixed with `[STAGING TEST]`, and records
receive `environment`, `test_run_id`, and `expires_at`. The authenticated
staging-only exact-ID hard-delete endpoint is:
`DELETE /api/lpu/staging/listing-queue/:id` with JSON `{ "id": ":id" }`.
It refuses unmarked records and deletes that record's photo objects before its
metadata and queue row.

`cleanupExpiredStagingListingQueueItems()` is available in the server helper for
a future authenticated job. No scheduler, cron configuration, or live cleanup
invocation is included in this repository change. It reports per-record cleanup
failures by phase; retrying is safe because already-removed Storage objects are
treated as complete while the exact database record remains the only target.
Before deleting an object, cleanup also refuses a path referenced by another
queue item, preventing cross-record Storage deletion from malformed metadata.
