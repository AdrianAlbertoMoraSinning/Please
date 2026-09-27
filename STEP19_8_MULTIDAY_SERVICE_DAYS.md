# PLEASE Step 19.8 — service days

A customer request may now be scheduled across several days. Administration creates the first Job from the Service Request as before, then uses **+ ADD SERVICE DAY** on the assigned request for each later day. Each day is a separate operational Job with its own date, start and end times, Provider team, billing items and lifecycle. The same Provider may be assigned on multiple days because those are separate Jobs.

The Service Request drawer shows the linked days and scheduled hours. The customer's existing secure tracking link shows the same days; it names a Provider only after that Provider confirms. The first Job remains the primary Job for existing invoice and lifecycle workflows. Each later Job retains its own invoice and completion workflow; an active later day prevents the overall tracking status from reporting the entire service as completed.

Additional Jobs carry an internal `[PLEASE-REQUEST-DAY:<request UUID>:<date>]` marker. The admin endpoint writes the marker from the authenticated request record and overwrites customer identity supplied by the browser. The central Job editor preserves the marker on edits. No database migration is required. If a Job is created but a browser refresh fails, reopen the original request to see the saved day before retrying.

For the reported relocation, qualify the number of hours for **loading**, **move/transport**, and **return** separately. The original 25 hours is the total estimate, not the schedule for September 28 alone. Create the first day, then the second and third days, choosing each date, hours, Providers and rates. Do not enter a 25-hour shift on September 28.

Limitations: days are created one at a time and have separate Job references and invoices. The primary invoice workflow does not automatically consolidate all days into a single invoice. The request editor's original estimated hours remains the customer's intake value; the day list shows the scheduled total.
