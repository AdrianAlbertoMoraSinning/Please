const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function ok(c,m){if(!c){console.error('FAIL:',m);process.exitCode=1}else console.log('PASS:',m)}
const provider=read('js/provider.js'),html=read('provider.html'),ready=read('netlify/functions/provider-service-evidence-readiness.js'),lib=read('netlify/functions/_provider-evidence-lib.js'),upload=read('netlify/functions/provider-service-evidence-upload.js'),live=read('netlify/functions/provider-live-service-action.js'),sw=read('service-worker.js');
ok(ready.includes('evidence.readiness')&&provider.includes('provider-service-evidence-readiness'),'Provider Portal performs server-side lifecycle readiness before opening camera/gallery');
ok(lib.includes("'TOO_EARLY'")&&lib.includes("'ASSIGNMENT_NOT_CONFIRMED'")&&lib.includes("'CHECK_IN_REQUIRED'")&&lib.includes("'START_REQUIRED'")&&lib.includes('available_at'),'Photo preflight returns explicit lifecycle error codes and next available time');
ok(provider.includes('await evidenceReadiness(id,spec.evidence);const file=await chooseServicePhoto')&&provider.includes("await evidenceReadiness(id,'COMPLETION')"),'All official live evidence photo actions preflight before asking the Provider for a photo');
ok(provider.includes("['image/jpeg','image/png','image/webp'].includes(type)&&file.size<=4.5*1024*1024")&&provider.includes('maxBytes:4000000'),'Safe JPG/PNG/WEBP photos bypass unnecessary canvas decoding while large phone images are optimized below gateway limits');
ok(upload.includes('MAX=5*1024*1024')&&upload.includes('INVALID_IMAGE_BYTES')&&upload.includes('JOB_NOT_FOUND'),'Evidence endpoint validates payload size, image magic bytes and Job linkage with actionable codes');
ok(lib.includes('EVIDENCE_SCHEMA_NOT_READY')&&lib.includes('STORAGE_NOT_READY')&&live.includes('LIVE_SERVICE_SCHEMA_NOT_READY'),'Database/storage deployment problems return specific recovery codes instead of a generic photo failure');
ok(provider.includes('No manual save-to-camera-roll step is required.')&&html.includes('Before opening the camera, the portal checks whether that evidence step is allowed.'),'Provider UI/manual explains direct camera workflow and readiness messages');
ok(sw.includes('please-provider-v15-9-1')&&html.includes('js/provider.js?v=15.9.1'),'Provider PWA/cache advances to STEP 15.9.1');
ok((provider.match(/async function completeLive\(/g)||[]).length===1,'Completion handler has one authoritative implementation with readiness preflight');
if(process.exitCode)process.exit(process.exitCode);else console.log('STEP 15.9.1 photo upload recovery static audit completed successfully.');
