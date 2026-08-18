# STEP 10.4 — Customer Tracking

Adds secure public tracking for PLEASE customer service requests.

## Security model
- The public URL contains a random 48-character tracking token.
- Supabase stores only the SHA-256 hash in `service_requests.tracking_token_hash`.
- The browser never receives PLEASE internal notes, Provider compensation, Provider Payments or PLEASE profit/margin data.
- Tracking data is returned only by the server-side Netlify Function `public-request-tracking`.

## Customer-visible data
- Request reference and service
- Friendly request/job status
- Preferred schedule until an assignment exists
- Assigned/confirmed schedule when available
- Assigned professional name/title (no private contact information)
- Pending schedule-change status without internal/provider reason text
- Job reference
- Invoice and payment status when an issued invoice exists
- Secure link to the public invoice
- Customer-safe timeline

## Existing requests
Requests created before this deployment already have a token hash, but the plaintext token cannot be recovered from the hash. Test STEP 10.4 with a new public Service Request so the new confirmation screen can display/copy its secure tracking link.

No SQL migration is required for STEP 10.4 because STEP 10.1 already created `tracking_token_hash`.
