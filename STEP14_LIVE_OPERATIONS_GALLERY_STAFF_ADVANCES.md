# PLEASE — STEP 14 Live Operations + Gallery + Staff + Advances

This package extends the existing portal without replacing the validated Customer Request, Admin, Developer, Provider, Calendar, Job, Invoice, Provider Payment, Report, Tracking or Security workflows.

## Implemented now

- Gallery Experience public page using the 52 supplied WhatsApp photos/videos.
- Gallery Experience navigation on the main public customer pages.
- Provider live-service controls: I'VE ARRIVED, START SERVICE, REQUEST MORE TIME and COMPLETE SERVICE.
- Actual arrival/start/completion timestamps stored on the Job.
- Internal service-event history with customer-facing message text.
- Administration > Live Operations with active jobs, 24-hour reminder messages, recent service events and pending extension requests.
- Manual COPY MESSAGE actions for reminder/event messages. No external email/SMS provider is used.
- Provider extension request captures additional minutes, hourly billing item, customer addition and provider addition.
- Customer Tracking can approve/decline a pending time extension. Approval is recorded for Maria Paula/Administration; Administration performs the final operational approval.
- Admin-approved extension automatically moves the assignment end time, blocks the Provider longer in Master Calendar and adds an approved extension billing line to the Job.
- Because customer invoices are generated from Job billing items after completion, the approved extension is included in the subsequent invoice automatically.
- Provider compensation for approved extension is included in Job billing, allowing the existing Provider Payment creation logic to include it at completion.
- Provider Advances register in Administration > Provider Payments.
- Advance reconciliation: available advances are applied before recording the final cash/e-transfer amount on a Provider Payment.
- Developer can classify an account as Independent Provider or PLEASE Staff.
- Developer can create a fixed PLEASE Staff account directly without a Work With Us application. Services can then be authorized from Provider Accounts; the staff member manages availability through the Provider Portal.
- Provider Portal is installable as a PWA/mobile home-screen app and opens directly to assignments.
- Friendly public routes prepared: `/book`, `/gallery`, `/track`.
- Social-link integration scaffolding added. Links remain hidden until official Instagram/Facebook/TikTok URLs are supplied.

## Intentionally deferred

Automatic email/SMS delivery is disabled. PLEASE will wait until control of the final domain and corporate mail configuration is available. Live Operations prepares messages for manual delivery meanwhile.

No banking or external money-transfer API is used for Provider Advances. The module records and reconciles advances only.

## Required deployment order

1. Run `supabase/STEP14_LIVE_SERVICE_OPERATIONS.sql` in Supabase SQL Editor.
2. Confirm `Success. No rows returned`.
3. Upload the changed files listed in `UPLOAD_ONLY_STEP14.txt` to GitHub.
4. Wait for Netlify production deploy.
5. Regression test: Provider Confirm > Arrive > Start > Extension > Customer response > Admin approve > Calendar end update > Complete > Invoice > Provider Payment.
