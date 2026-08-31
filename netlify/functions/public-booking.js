// STEP 15.8.4 — stable public booking endpoint.
// Uses the hardened booking implementation while publishing a fresh Netlify function route.
const booking=require('./public-service-request');
exports.handler=booking.handler;
