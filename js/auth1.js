document.addEventListener('DOMContentLoaded', async () => {
  await appReady;
  const loginForm = document.getElementById('login-form');
  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-password')?.value;
    if (!email || !password) return showToast('Please enter your email and password.', 'error');
    try { await authService.login(email, password); showToast('Welcome back to Cafflora Coffee.'); setTimeout(() => { window.location.href = './account.html'; }, 600); }
    catch (error) { showToast(error.message || 'Login failed. Please check your details.', 'error'); }
  });

  const registerForm = document.getElementById('register-form');
  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fullName = document.getElementById('register-name')?.value.trim();
    const mobile = document.getElementById('register-mobile')?.value.trim();
    const email = document.getElementById('register-email')?.value.trim();
    const password = document.getElementById('register-password')?.value;
    const confirm = document.getElementById('register-confirm')?.value;
    if (!fullName || !mobile || !email || !password || !confirm) return showToast('Please complete all registration fields.', 'error');
    if (password.length < 6) return showToast('Password must contain at least 6 characters.', 'error');
    if (password !== confirm) return showToast('Passwords do not match.', 'error');
    try { await authService.register({ fullName, mobile, email, password }); showToast('Registration successful.'); setTimeout(() => { window.location.href = './account.html'; }, 600); }
    catch (error) { showToast(error.code === 'auth/email-already-in-use' ? 'An account with this email already exists.' : error.message || 'Registration failed.', 'error'); }
  });

  const adminLoginForm = document.getElementById('admin-login-form');
  adminLoginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('admin-email')?.value.trim();
    const password = document.getElementById('admin-password')?.value;
    if (!email || !password) return showToast('Enter your admin email and password.', 'error');
    try { await authService.adminLogin(email, password); showToast('Admin access granted.'); setTimeout(() => { window.location.href = './index.html'; }, 500); }
    catch (error) { showToast(error.message || 'Invalid admin credentials.', 'error'); }
  });
});
