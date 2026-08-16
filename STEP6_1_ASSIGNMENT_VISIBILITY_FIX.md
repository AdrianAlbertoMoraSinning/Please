# STEP 6.1 — Assignment Visibility & Availability Messaging

This patch addresses two operational issues found during the first live assignment test:

1. Provider assignments are now fetched independently from job records and merged server-side, so every assignment linked to the logged-in provider is visible in the Provider Portal.
2. An already-open Provider Portal refreshes automatically every 15 seconds and when the browser tab becomes active again.
3. The Provider Availability page now includes **PLEASE Reserved / Unavailable Times**. Pending and confirmed assignments explicitly mark the provider unavailable for another PLEASE service during those windows.
4. The Admin Master Calendar now checks the selected start/end client-side and shows a red **NOT AVAILABLE** message when the requested time is outside published availability, overlaps an unavailable exception, or overlaps a pending/confirmed assignment.
5. After PLEASE creates an assignment, the Master Calendar automatically jumps to the week containing that assignment, so the pending block is immediately visible.
6. The Admin sidebar Jobs counter now counts operational jobs with assignments as well as Needs Assignment jobs.

No SQL migration is required for this patch. Existing assignments remain intact.
