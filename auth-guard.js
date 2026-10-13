// Include on every dashboard page. Call guardRole('admin'|'teacher'|'student').
async function guardRole(expectedRole) {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { location.href = '/login.html'; return null; }
    const user = await res.json();
    if (user.must_change_password) { location.href = '/change-password.html'; return null; }
    if (user.role !== expectedRole) {
      location.href = user.role === 'admin' ? '/admin.html' : user.role === 'teacher' ? '/teacher-dashboard.html' : '/student-dashboard.html';
      return null;
    }
    const nameEl = document.getElementById('sessionName');
    if (nameEl) nameEl.textContent = user.full_name;
    return user;
  } catch (e) {
    location.href = '/login.html';
    return null;
  }
}

function wireLogout() {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  });
}
