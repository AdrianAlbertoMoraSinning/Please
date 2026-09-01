# STEP 15.8.6 — Client Adjustments: Booking, Tracking Relationship, Calendar Recovery & Provider Rates

This release is built on STEP 15.8.5 and preserves the existing Admin, Provider, Developer, tracking, notification, financial-separation and mobile-camera workflows.

## Implemented adjustments

1. **Book Your Service is more compact**
   - `BOOK YOUR SERVICE` is the primary page title.
   - The former large `Tell us what you need and when.` headline is now a smaller subtitle.
   - Introductory copy and the booking disclaimer are compacted so customer fields appear much sooner with less scrolling.

2. **Moving-specific intake removed**
   - Bedrooms, square feet and inventory are no longer requested from customers.
   - New Book Your Service requests store the legacy Moving columns as `null`.
   - Administration no longer asks staff to maintain the Moving-specific fields.
   - Historical database columns/values are preserved; no destructive migration is performed.

3. **Master Calendar / Create Job 502 recovery**
   - Service and Provider Rate catalog queries have compatibility fallbacks when optional ordering/description columns differ between deployments.
   - Auxiliary calendar queries are isolated so one optional dataset cannot crash the entire calendar with a generic 502.
   - Source-request linking has a recovery path after Job creation to avoid a successful Job being reported as a failed conversion.

4. **PLS-REQ ↔ PLS-JOB relationship is operationally searchable**
   - Jobs can already be searched using either reference; the UI now makes this explicit.
   - Service Requests are enriched with their related `PLS-JOB` reference and can be searched by either number.
   - Assigned requests provide a direct `OPEN RELATED JOB` action.
   - Detail views show both `Customer Tracking Reference` and `Service Job Reference`.

5. **Provider Rate can be adjusted during Job creation**
   - Each Provider billing row now displays an editable Provider Rate (or Provider % for percentage-based compensation).
   - The Job financial preview recalculates Customer Revenue, Provider Cost and PLEASE Gross Profit using the edited Provider value.
   - When assignments are successfully sent, a changed Provider Rate is persisted back to that exact Provider Service Rate Item.
   - Existing Job billing snapshots remain frozen and are not retroactively changed.
   - Rate changes are recorded in Provider Technical History and the affected Provider receives a notification.
   - If Job creation fails after a rate was staged, the server attempts to restore the prior Provider Rate.

## Database

No new SQL migration is required for STEP 15.8.6. It uses columns and tables already present in the deployed PLEASE schema.
