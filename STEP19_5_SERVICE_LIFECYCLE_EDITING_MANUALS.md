# PLEASE — STEP 19.5 Service Lifecycle Editing, Follow-up Services & Portal Manuals

## Purpose
Give PLEASE Administration a clear, safe editing model across the service lifecycle without rewriting completed operational or financial history.

## Lifecycle rules
- Service Request before conversion: Service Type, date/time, hours, address, description and notes are editable. READY TO ASSIGN can jump directly to Master Calendar.
- Job assigned but not completed: Service Maintenance remains the operational editor for Service Type, date/time, duration, address and Job billing.
- Service Type changes validate every active Provider. An incompatible Provider must be replaced first.
- PENDING/CONFIRMED Provider replacement: Jobs → Assignment History → CHANGE PROVIDER. The existing guarded removal is used, history is retained, and Master Calendar opens Correct & Reassign for the same Job.
- Started work: execution identity/history remains protected; controlled schedule/extension rules continue.
- Completed Job: Service Maintenance becomes read/review mode. Final customer rate is reviewed from the linked Invoice; historical Provider identity/evidence/schedule is not rewritten.
- Follow-up service: Customers and Jobs can launch a new service for the same customer with customer/address prefilled. The follow-up is a separate Job.

## Manuals
- Administration includes `admin-manual.html` and a User Manual sidebar link.
- Provider Portal manual is updated for replacement and DECLINED/CANCELLED visibility rules.

## Database
No SQL migration is required.
