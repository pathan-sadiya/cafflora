document.addEventListener('DOMContentLoaded', async () => {
  await appReady;
  await authInitialized;
  const loginForm = document.getElementById('login-form');
  if (loginForm && authService.getCurrentUser() && !authService.getFirebaseUser()?.isAnonymous) {
    window.location.replace('./account.html');
    return;
  }
  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (loginForm.dataset.submitting === 'true') return;
    const phone = document.getElementById('login-phone')?.value.trim();
    const password = document.getElementById('login-password')?.value;
    if (!phone || !password) return showToast('Please enter your mobile number and password.', 'error');
    loginForm.dataset.submitting = 'true';
    const submitButton = loginForm.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      await authService.login(phone, password);
      showToast('Welcome back to Cafflora Coffee.');
      setTimeout(() => { window.location.href = './account.html'; }, 600);
    } catch (error) {
      console.error(error);
      const message = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(error.code)
        ? 'Mobile number or password is incorrect.'
        : authErrorMessage(error, 'Login failed.');
      showToast(message, 'error');
      loginForm.dataset.submitting = 'false';
      if (submitButton) submitButton.disabled = false;
    }
  });

  const registerForm = document.getElementById('register-form');
  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (registerForm.dataset.submitting === 'true') return;
    const fullName = document.getElementById('register-name')?.value.trim();
    const mobile = document.getElementById('register-mobile')?.value.trim();
    const password = document.getElementById('register-password')?.value;
    if (!fullName || !mobile || !password) return showToast('Please enter your name, mobile number, and password.', 'error');
    const mobileDigits = mobile.replace(/\D/g, '');
    if (mobileDigits.length < 7 || mobileDigits.length > 15) return showToast('Enter a valid mobile number with 7 to 15 digits.', 'error');
    if (password.length < 6) return showToast('Password must contain at least 6 characters.', 'error');
    registerForm.dataset.submitting = 'true';
    const submitButton = registerForm.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      await authService.register({ fullName, mobile, password });
      showToast('Registration successful.');
      setTimeout(() => { window.location.href = './account.html'; }, 600);
    } catch (error) {
      console.error(error);
      const message = error.code === 'auth/email-already-in-use'
        ? 'An account with this mobile number already exists. Please sign in.'
        : authErrorMessage(error, 'Registration failed.');
      showToast(message, 'error');
    } finally {
      registerForm.dataset.submitting = 'false';
      if (submitButton) submitButton.disabled = false;
    }
  });

  const adminLoginForm = document.getElementById('admin-login-form');
  if (adminLoginForm && authService.isAdmin()) { window.location.href = './index.html'; return; }
  adminLoginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (adminLoginForm.dataset.submitting === 'true') return;
    const email = document.getElementById('admin-email')?.value.trim();
    const password = document.getElementById('admin-password')?.value;
    if (!email || !password) return showToast('Enter your admin email and password.', 'error');
    adminLoginForm.dataset.submitting = 'true';
    const submitButton = adminLoginForm.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      await authService.adminLogin(email, password);
      showToast('Admin access granted.');
      const returnPage = new URLSearchParams(window.location.search).get('return');
      const destination = ['menu', 'tables', 'orders', 'customers', 'analytics'].includes(returnPage) ? returnPage : 'index';
      setTimeout(() => { window.location.href = `./${destination}.html`; }, 500);
    } catch (error) {
      console.error(error);
      showToast(authErrorMessage(error, 'Invalid admin credentials.'), 'error');
      adminLoginForm.dataset.submitting = 'false';
      if (submitButton) submitButton.disabled = false;
    }
  });
});
