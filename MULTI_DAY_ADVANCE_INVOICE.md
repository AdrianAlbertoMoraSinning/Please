# Multi-day service and advance invoicing

## Deployment prerequisite

Apply `supabase/migrations/20261016123434_multi_day_service_periods.sql` to the PLEASE project (`jrukbqghdasbpkolrgkl`) before merging the application change. The migration deliberately aborts if the installed availability function differs from the expected same-day rejection. Review the live function in that case; do not replace it blindly. Its server-only permissions are preserved.

Validate availability for an actual active Provider over October 19–23, and check that single-day availability and unavailability exceptions still work. New multi-day assignments use the existing transactional Job creation RPC and its conflict checks. No extra daily Jobs are created. Availability is checked for the daily window between the selected start and end clock times. The full overall interval remains reserved, including intervening nights, so other Jobs cannot overlap it. This is a single service period, not a detailed daily itinerary editor.

## Administration

1. Open the existing customer request and choose **Create Job & Assign**.
2. Select the Provider, **Start Date**, start time, **End Date** and end time. Multi-day periods support up to 31 days. Use the agreed itinerary for the clock times.
3. Select **Flat Rate**, quantity **1**, and enter the total agreed service price. Provider compensation stays a separate value. The period length does not multiply a flat rate.
4. Send the assignment once. The request remains linked to one Job. Both calendars show its occupied days.
5. Open **Jobs → View → Prepare Advance Invoice**. Choose **Create Draft Invoice**, review amount, dates, client and description, then use the existing explicit invoice send action.
6. Payment does not complete the Job or the Provider assignment. When work completes, the existing finance automation retains the existing non-void invoice rather than creating a second one. Existing invoice duplicate checks remain in place.

The Service Maintenance editor also has independent start/end dates. Scheduled span includes elapsed time; it is not a daily labor-hours total. Automatic hourly billing synchronization is blocked for multi-day periods to avoid charging nights accidentally. Flat rates remain quantity 1. Once an invoice is issued, changed Job charges are rejected; schedule-only changes remain possible when charges stay identical.

## BCIT request

Production request `PLS-REQ-20261015-549823` was reviewed on October 16. It is READY_TO_ASSIGN and has no Job or invoice. Its description specifies October 19–23, Chevrolet Tahoe with dedicated driver, airport pickup, hotel trips and schools in Calgary/Okotoks/Foothills. The stored request does not specify the negotiated price, Provider or final-day finish time; Administration must enter those. No assignment or invoice was created or sent during development.

## Homepage

The previous portrait is replaced with service images already owned by the site. The carousel rotates every six seconds and supports previous/next, pause/play, hover/focus pausing, hidden-tab pausing and reduced-motion preference. It leaves the existing quote form intact.

## Validation

Runtime coverage verifies five-day and DST date conversion, all occupied calendar days, flat billing preservation, draft-only advance creation, no mail on draft creation, duplicate/cancelled invoice rejection and issued-invoice charge protection. Existing notification, invoice delivery/failure and single-day schedule tests are also run. Production multi-day creation and visual QA remain pending until the database migration can be applied and the preview inspected.
