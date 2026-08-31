# STEP 15.8.5 — Direct Mobile Camera & Photo Normalization

Implemented on top of STEP 15.8.4.

## Provider mobile camera behavior

- Arrival and completion evidence keeps the existing `TAKE PHOTO` mobile camera flow.
- Camera and device-library inputs now accept any browser-decodable image format (`image/*`), including phone formats that may be returned as HEIC/HEIF.
- Before upload, the Provider Portal decodes the selected image in the browser, corrects browser-supported image orientation, scales it to a practical maximum dimension, and converts it to JPEG.
- The optimized JPEG target is below the existing backend limits, so a modern phone camera image does not have to be manually saved to the camera roll before upload.
- Arrival/completion and service portfolio photos use a maximum dimension of 1920 px.
- Profile photos use a maximum dimension of 1600 px.
- The prepared upload target is 3.5 MB or less, keeping it below both the 4 MB profile-photo limit and the 8 MB service/evidence limits.
- `CHOOSE FROM DEVICE` remains available as a fallback.
- SVG is rejected before processing.
- If the browser itself cannot decode the phone's image format, the Provider receives a clear retry message instead of a generic backend MIME/size error.

## PWA/cache

- Provider page asset query versions were advanced to 15.8.5.
- Provider service-worker cache was advanced to `please-provider-v15-8-5` and old PLEASE Provider caches are cleaned during activation.

## Database / backend

No SQL migration is required. Existing backend MIME validation remains JPG/PNG/WEBP; the browser now sends normalized JPEG for Provider camera/photo workflows.
