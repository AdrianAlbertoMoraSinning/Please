# STEP 19.1 — Customer Invoice Delivery & Review Requests

Baseline: **STEP 19 — Operational Finance Automation** (`bf9b54ef801005b74af785d359ff112b88a0fcf1`).

STEP 19.1 is intentionally narrow. It does not replace Stripe, the Stripe webhook, STEP 17/18 accounting, Operational Finance, Provider workflows, Booking, Tracking or Customer Payment integrity.

## Customer-requested workflow

1. A completed Job continues to produce a **DRAFT** invoice through STEP 19.
2. PLEASE Administration reviews the customer-facing invoice amount before delivery. This preserves the ability to change the final price when the real service scope differs from the original quote.
3. Administration uses **REVIEW & SEND INVOICE** / **SEND INVOICE**.
4. One visible action performs: save final DRAFT values → issue invoice → email customer.
5. The email contains invoice/service/total information, a direct **PAY NOW** link and e-Transfer instructions.
6. PAY NOW opens the existing tokenized public invoice and existing Stripe Checkout. The customer does **not** enter a Request Reference or email again.
7. e-Transfer remains an external money movement. PLEASE does not mark it paid until Administration records/validates receipt.
8. After payment, Administration can selectively use **SEND REVIEW REQUEST**. A successful review request is recorded in invoice history and duplicate sends are blocked.

## Safe delivery behavior

Invoice delivery uses a new `admin-invoice-delivery-action` function rather than changing the existing `admin-invoice-action` financial engine.

If email delivery fails after a DRAFT invoice was issued, the invoice remains **ISSUED**, not falsely **SENT**. Administration can retry with **SEND TO CUSTOMER**. The existing public invoice token and payment data remain intact.

## Configuration

- `PLEASE_ETRANSFER_EMAIL` — confirmed production destination: `info@pleaseservice.ca`. The code defaults to this address; the Netlify variable remains available as an explicit override.
- `PLEASE_GOOGLE_REVIEW_URL` — the code now defaults to the PLEASE Google Business Profile review deep-link derived from the listing CID `11821370300392660033` (`0xa40df1a7e941dc41`). The Netlify variable remains available as an override if Google later supplies a `g.page/.../review` or Place-ID link.

No SQL migration is required.

## Acceptance checks

- Completed Job exposes **REVIEW & SEND INVOICE** in Admin Jobs.
- DRAFT invoice remains editable until Administration approves the final amount.
- **SEND INVOICE** saves, issues and emails without requiring a second customer login/reference flow.
- Customer email shows final total, PAY NOW, and e-Transfer instructions.
- Existing Stripe checkout/webhook files remain byte-identical to STEP 19.
- Failed email leaves invoice ISSUED and retryable, never falsely SENT.
- Paid invoice exposes selective Google review request to the PLEASE Google Business Profile.
- Duplicate review request for the same invoice is blocked.
- Full retained regression suite remains green.
