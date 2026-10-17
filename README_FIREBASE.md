# Firebase setup for Cafflora Coffee

The existing site is plain HTML with classic browser scripts and no bundler. To avoid changing its layout/build workflow, the browser uses Firebase's version-pinned compat CDN SDK (there is no root `npm install firebase` step); the trusted Cloud Functions backend uses npm packages. The Firebase web API key and App Check site key are public configuration, not admin secrets. Access is enforced by the rules, App Check, and custom admin claims.

## Console setup (required)

1. In Firebase project `arabica-8dc79`, register/confirm the Web App configuration in `js/firebase-config.js`.
2. In **Authentication → Sign-in method**, enable **Email/Password** and **Anonymous**. Add the deployed website domain under **Authentication → Settings → Authorized domains**. Customers enter their name, mobile number, and password; the app maps the normalized mobile number to an internal Email/Password identity. This does not verify phone ownership by SMS, and customers cannot use email-based password recovery. Admin accounts continue to use their regular email and password.
3. Create a **Cloud Firestore** database in production mode and a **Storage** bucket.
4. In **App Check**, register the Web App with **reCAPTCHA v3**, add each production domain, and put its public site key in `firebaseAppCheckSiteKey` in `js/firebase-config.js`. Both callable functions enforce App Check, so order placement/status updates are rejected until this is configured. After monitoring valid traffic, enable App Check enforcement for Firestore and Storage in the console.
5. Enable billing (Blaze) for Cloud Functions, then install Node.js 20+ and Firebase CLI (`npm install -g firebase-tools`). From the project root, run `firebase login`, `firebase use arabica-8dc79`, and `firebase deploy --only firestore:rules,storage,functions`.
6. Run the website over localhost or HTTPS (not by opening HTML with `file://`). Configure Firebase Hosting or your static host to serve the project root; do not publish service-account credentials.
7. Open `/admin/login.html` after creating the first admin account as described below. On the Menu page, select **Import existing starter menu** to write the existing 17-item site catalogue to Firestore. No sample orders are imported. Add uploaded product images and update homepage content using the admin panel.

## Create the first secure admin

1. The Firebase Authentication account with UID `MHx9d4SOLhci8zY7T18iXlhVoi93` is explicitly authorized by the browser, Firestore rules, Storage rules, and order-status function. Sign in at `/admin/login.html` with that account's Firebase email and password.
2. Deploy the updated rules and function before using admin features. The UID is an authorization identifier, not a password; Firebase Authentication still requires the account credentials.
3. Additional admins continue to use the server-assigned `admin: true` claim for Storage and Cloud Functions, and an `admins/{uid}` Firestore document for website access. Grant/revoke additional claims using `functions/scripts/set-admin-claim.js` from a trusted machine.

## Order and security behavior

- `createOrder` is a callable Cloud Function. It reads current product prices/availability from Firestore, computes subtotal, delivery fee and discount, binds orders to the Firebase UID (including anonymous guest accounts), and uses a per-checkout idempotency key to avoid duplicate order documents. Client-supplied totals/statuses are ignored.
- `updateOrderStatus` validates the configured admin UID or the server-assigned admin claim and allowed status transitions. Customer order reads are restricted to their UID; administrators can read all orders. Guest tracking uses an unguessable random token document containing status only.
- Product and homepage content reads are public; writes require the configured admin UID or an `admins/{uid}` document. Image uploads are limited to the configured admin UID or claim holders, 5 MB, and image MIME types. Product image URLs pasted in the admin menu are saved to Firestore; they are not copied into Firebase Storage.
- The website currently exposes Cash on Delivery for delivery and Pay at Café for dine-in. UPI/card choices are not accepted until payment processing is implemented.
- Existing browser localStorage carts remain local by design. Legacy local sample orders are not migrated. The current catalogue must be explicitly imported once by an administrator or recreated from the admin menu.

## Verification scope

Static checks can validate syntax and paths, but real authentication, Firestore, Storage, Cloud Functions, deployed rules, image upload and concurrent order behavior require the Firebase project services and credentials above. Those live-project operations cannot be claimed as tested until performed against the configured project. Use Firebase Emulator Suite or a non-production Firebase project before production rollout.
