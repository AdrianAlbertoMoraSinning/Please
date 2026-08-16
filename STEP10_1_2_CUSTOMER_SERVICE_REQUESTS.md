# STEP 10.1 + 10.2 — Customer Service Request & Administration Queue

This release adds the first two parts of the customer booking intake flow without changing the existing Job / Provider assignment engine.

## Public flow

`service-request.html` lets a customer submit contact, service, address, work description and preferred schedule. Submission creates a `PLS-REQ-...` reference in `service_requests` through a Netlify Function. It does **not** create a Job and does **not** reserve a Provider.

The homepage quick quote form now forwards the customer into this controlled request flow instead of ending in the legacy Netlify quote workflow.

## Administration

A new **Service Requests** menu is available between Master Calendar and Jobs. PLEASE can:

- view and search incoming requests;
- START REVIEW;
- mark a request READY TO ASSIGN;
- keep internal notes;
- cancel a request with reason;
- review immutable status history.

## Status workflow

`NEW → REVIEWING → READY_TO_ASSIGN`

`CANCELLED` is available before assignment.

`ASSIGNED` is reserved for STEP 10.3 when **Create Job & Assign** will reuse the existing Master Calendar / Job Assignment workflow.

## Database install

Run:

`supabase/STEP10_1_2_CUSTOMER_SERVICE_REQUESTS.sql`

Expected result: `Success. No rows returned`.

## Security

The public browser never receives the Supabase secret. Public submissions pass through `public-service-request.js`. Service Requests and history have RLS enabled and are administered through the server-side service key and the existing PLEASE custom Admin session.
