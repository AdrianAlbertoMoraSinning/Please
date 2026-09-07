# Archived tests

`step15_7_notification_routing_static.legacy.js` is retained only as historical evidence for STEP 15.7.
It was previously located in the repository root while resolving paths as if it lived under `/tests`, and its notification-routing assertions predate later STEP 15.8–16.0 function changes.
It is intentionally not part of the current `.test.js` execution set. Current regression tests are the files directly under `/tests`.

`step16_0_cal_accounting_bridge_static.legacy.js` is retained as historical evidence for the STEP 16 manual bridge. STEP 17 intentionally removes synchronous accounting hooks and the user-facing Sync button, so those assertions are no longer current architecture requirements.
