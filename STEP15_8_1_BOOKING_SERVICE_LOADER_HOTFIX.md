# PLEASE STEP 15.8.1 — Booking Service Loader Hotfix

This hotfix addresses the public Book Your Service screen observed after STEP 15.8 deployment.

## Fixes
- The Selected Service panel now truly stays hidden until a service has been selected/prefilled.
- The public service-list endpoint now requests only the required `id` and `name` fields.
- A compatibility fallback retries ordering by name if an older service catalog does not expose `sort_order`.
- The browser loader explicitly restores the correct hidden/visible state and shows a clearer refresh message if the endpoint is unavailable.
- Cache-busting on `service-request.html` is advanced to `15.8.1`.

No Supabase migration is required.
