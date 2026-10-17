/* Firebase web configuration is public by design; protect data with Firebase Security Rules. */
const firebaseConfig = {
  apiKey: 'AIzaSyBxT0wuNhr2NFpZUpbRDk6iWJ5llKe7nVs',
  authDomain: 'arabica-8dc79.firebaseapp.com',
  projectId: 'arabica-8dc79',
  storageBucket: 'arabica-8dc79.firebasestorage.app',
  messagingSenderId: '336731907442',
  appId: '1:336731907442:web:8c848f939dcc85bfbfa9eb',
  measurementId: 'G-6K7TWCWPEG'
};
// Obtain this public site key from Firebase App Check (reCAPTCHA v3) for your live domain.
const firebaseAppCheckSiteKey = '';

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
if (firebaseAppCheckSiteKey) firebase.appCheck().activate(firebaseAppCheckSiteKey, true);
