function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

(async () => {
  const user = await guardRole('student');
  if (!user) return;
  wireLogout();
  await loadProfile();
  await loadAnnouncements();
})();

async function loadProfile() {
  const res = await fetch('/api/student/me');
  const data = await res.json();
  const s = data.student;
  document.getElementById('profileFacts').innerHTML = `
    <li><span>Full name</span><span>${escapeHtml(data.full_name)}</span></li>
    <li><span>Username</span><span>${escapeHtml(data.username)}</span></li>
    <li><span>Class</span><span>${escapeHtml(s?.class_name || 'Information coming soon')}</span></li>
    <li><span>Roll number</span><span>${escapeHtml(s?.roll_no || 'Information coming soon')}</span></li>
    <li><span>Guardian</span><span>${escapeHtml(s?.guardian_name || 'Information coming soon')}</span></li>
    <li><span>Guardian contact</span><span>${escapeHtml(s?.guardian_contact || 'Information coming soon')}</span></li>
  `;
}

async function loadAnnouncements() {
  const list = document.getElementById('annList');
  const res = await fetch('/api/dashboard/announcements');
  const rows = await res.json();
  if (!rows.length) { list.innerHTML = '<div class="empty-note">No announcements yet.</div>'; return; }
  list.innerHTML = rows.map(a => `
    <div class="ann-card">
      <div class="ann-meta"><span class="audience-tag">${escapeHtml(a.audience)}</span><span>${new Date(a.announcement_date).toLocaleDateString()} · ${escapeHtml(a.posted_by)}</span></div>
      <h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.body)}</p>
    </div>
  `).join('');
}
