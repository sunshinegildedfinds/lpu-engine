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

`LPU_DEPLOYMENT_ENV` is required and fails closed. Its only accepted values are
the exact strings `production` and `staging`; missing, capitalized, padded, or
unknown values are configuration errors. Production queue creation does not
send staging metadata.

To provision a separate staging deployment, apply the existing queue migration
and then the additive `supabase/migrations/20260803000000_add_listing_queue_staging_metadata.sql`
to the staging database. Configure these server-side variables there:

- `LPU_DEPLOYMENT_ENV=staging`
- `LPU_STAGING_TEST_RUN_ID=<UUID>` (recommended to group a test run; a UUID is generated if omitted)
- `LPU_STAGING_TTL_HOURS=24` (optional positive integer; 24 is the default)
- The existing `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
  `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET=lpu-generator-images-staging` values for
  the staging project.

Staging Storage must use the private bucket named
`lpu-generator-images-staging`. The app must obtain signed upload URLs from the
server; direct anonymous uploads and public object URLs are production-only.
Staging uploads require a queue-owner session, accept only JPEG, PNG, or WebP,
and are limited to 10 MB per image. Configure that exact private bucket with
the same 10 MB file-size limit and the exact MIME allowlist `image/jpeg`,
`image/png`, and `image/webp`; the server verifies those settings before it
issues an upload capability. The server generates the staging object path and
creates short-lived signed read URLs for previews and generation. Never
configure public-read Storage policies for this staging bucket.

In staging, generation and public web-comps requests also require the
queue-owner session before their request body is processed. Sign in through
`/lpu-v2`; `/lpu` and `/lpu-extension` direct unauthenticated staging users to
that flow instead of making an unauthenticated model request. This gate is
staging-only and production retains its existing behavior.

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
Cleanup additionally refuses to delete from any bucket except the exact private
`lpu-generator-images-staging` bucket; it has no fallback production bucket.

## Queue create idempotency and Vendoo completion

Apply
`supabase/migrations/20260818000000_harden_queue_completion.sql` before deploying
the corresponding backend. It pins `public.set_updated_at()` to an empty search
path, adds optional Queue-create idempotency columns plus a unique operation-ID
index, and installs the service-role-only terminal completion function. It does
not add a public or authenticated database policy.

Ordinary owner UI Queue creates remain compatible by omitting all autonomous
identity fields. Autonomous clients must include the complete trio
`agentItemFingerprint`, `createOperationId`, and `createRequestSha256` in
`POST /api/lpu/listing-queue`. The hash is SHA-256 over UTF-8 compact JSON for
the business request after removing only `createOperationId` and
`createRequestSha256`, so the item fingerprint remains bound, and after sorting
every object's keys by Unicode code point; array order is preserved. Idempotent
autonomous requests also reject JSON numbers so Python and JavaScript cannot
disagree over numeric serialization. They reject Queue photo rows because the current photo metadata
insert is not part of the parent-row transaction (the Universal Mac workflow
sends none), and autonomous Queue rows cannot later add photo metadata through
the generic PATCH route. The first success returns HTTP 201 and `replayed: false`.
Repeating the same operation ID, fingerprint, and request hash returns the
original row with HTTP 200 and `replayed: true`; reusing an operation ID for
different content returns 409.

`POST /api/lpu/listing-queue/:id/vendoo-completion` is the only supported way to
mark an autonomous Queue item sent to Vendoo. It requires the existing Queue
owner session and an exact receipt containing the matching Queue ID,
`expectedStatus: "lpu_generated"`, SHA-256 identities for the item, transformed
LP-U, Vendoo draft, field ledger, and final manifest, the exact five verified
marketplaces (`ebay`, `etsy`, `poshmark`, `mercari`, `depop`), the terminal
item-bound SEO review hash, and the client completion timestamp. The database
locks the row, verifies the current LP-U hash, stored item fingerprint, and
exact deployment environment, updates only
status/receipt/server completion time, returns exact retries unchanged, and
rejects conflicting or wrong-state retries with 409. Generic Queue updates
cannot set or overwrite these terminal fields.

The owner UI's browser-extension bridge is not proof that Vendoo received,
saved, or retained a listing. After posting a payload to that bridge, it keeps
the Queue item `payload_ready` and may store only the exact nonterminal receipt
`{ schemaVersion: 1, kind: "posted_to_extension_unverified",
verificationStatus: "unverified", postedAt: <ISO timestamp> }`. The generic
PATCH route rejects other Vendoo receipt shapes and can never use that receipt
to set `sent_to_vendoo` or `sent_to_vendoo_at`.
