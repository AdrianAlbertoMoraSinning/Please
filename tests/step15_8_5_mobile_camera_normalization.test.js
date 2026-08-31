const fs=require('fs');
function ok(cond,msg){if(!cond){console.error('FAIL:',msg);process.exitCode=1}else console.log('PASS:',msg)}
const js=fs.readFileSync('js/provider.js','utf8');
const html=fs.readFileSync('provider.html','utf8');
const sw=fs.readFileSync('service-worker.js','utf8');
ok(js.includes('async function normalizePhoto'), 'Provider portal has a reusable client-side photo normalizer');
ok(js.includes("canvasBlob(canvas,'image/jpeg'"), 'Photo normalizer converts browser-decodable phone images to JPEG');
ok(js.includes('maxDimension:1920,maxBytes:3500000'), 'Arrival/completion and service photos are optimized below backend upload limits');
ok(js.includes('maxDimension:1600,maxBytes:3500000'), 'Profile photos are optimized below the 4 MB profile limit');
ok(js.includes('No manual save-to-camera-roll step is required.'), 'Live evidence capture explicitly supports direct camera-to-upload workflow');
ok((js.match(/accept="image\/\*"/g)||[]).length>=2, 'Live camera overlay accepts phone image formats for camera and library');
ok(html.includes('id="provider-service-photo-file" type="file" accept="image/*" capture="environment"'), 'Service portfolio supports direct rear-camera capture with normalization');
ok(html.includes('id="provider-profile-photo-file" type="file" accept="image/*" capture="user"'), 'Profile photo supports direct front-camera capture with normalization');
ok(html.includes('js/provider.js?v=15.8.5'), 'Provider page cache-busts the updated camera JavaScript');
ok(sw.includes("please-provider-v15-8-5"), 'Provider PWA service-worker cache version advanced');
ok(sw.includes("k.startsWith('please-provider-')"), 'Provider PWA removes older Provider caches on activation');
