#!/usr/bin/env node
// Run only on a trusted administrator workstation with GOOGLE_APPLICATION_CREDENTIALS set.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const email = process.argv[2];
const action = process.argv[3] || 'grant';
if (!email || !['grant', 'revoke'].includes(action)) {
  console.error('Usage: node scripts/set-admin-claim.js <user-email> [grant|revoke]');
  process.exit(2);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a private service-account JSON file; never put that file in the website.');
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId: 'arabica-8dc79' });
(async () => {
  const user = await getAuth().getUserByEmail(email);
  const claims = { ...(user.customClaims || {}) };
  if (action === 'grant') claims.admin = true;
  else delete claims.admin;
  await getAuth().setCustomUserClaims(user.uid, claims);
  await getAuth().revokeRefreshTokens(user.uid);
  console.log(`${action === 'grant' ? 'Granted' : 'Revoked'} admin claim for ${user.email} (${user.uid}). Have the user sign in again.`);
  process.exit(0);
})().catch((error) => { console.error(error.message); process.exit(1); });
