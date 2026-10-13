function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

(async () => {
  const user = await guardRole('teacher');
  if (!user) return;
  wireLogout();
  await loadProfile();
  await loadAnnouncements();
})();

async function loadProfile() {
  const res = await fetch('/api/teacher/me');
  const data = await res.json();
  document.getElementById('profileFacts').innerHTML = `
    <li><span>Full name</span><span>${escapeHtml(data.full_name)}</span></li>
    <li><span>Username</span><span>${escapeHtml(data.username)}</span></li>
    <li><span>Subject</span><span>${escapeHtml(data.teacher?.subject || 'Information coming soon')}</span></li>
  `;
  document.getElementById('bio').value = data.teacher?.bio || '';

  const classesBlock = document.getElementById('classesBlock');
  const annAudience = document.getElementById('annAudience');
  if (!data.classes.length) {
    classesBlock.innerHTML = '<div class="empty-note">No classes have been assigned to you yet. Once the Principal/Admin assigns your classes, they will appear here.</div>';
  } else {
    classesBlock.innerHTML = '<ul class="fact-list">' + data.classes.map(c =>
      `<li><span>${escapeHtml(c.class_name)}</span><span>${escapeHtml(c.subject)}</span></li>`
    ).join('') + '</ul>';
    data.classes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = 'class:' + c.class_name;
      opt.textContent = 'Class ' + c.class_name + ' only';
      annAudience.appendChild(opt);
    });
  }
}

document.getElementById('saveBio').addEventListener('click', async () => {
  const msg = document.getElementById('profileMsg');
  msg.className = 'form-msg';
  const res = await fetch('/api/teacher/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bio: document.getElementById('bio').value }) });
  if (!res.ok) { msg.className = 'form-msg show error'; msg.textContent = 'Could not save.'; TLM.error('Could not save your bio.'); return; }
  msg.className = 'form-msg show success'; msg.textContent = 'Saved.';
  TLM.success('Your bio was saved.', 'Profile saved');
});

document.getElementById('annForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('annMsg');
  msg.className = 'form-msg';
  const payload = {
    title: document.getElementById('annTitle').value.trim(),
    body: document.getElementById('annBody').value.trim(),
    audience: document.getElementById('annAudience').value
  };
  const res = await fetch('/api/teacher/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) { msg.className = 'form-msg show error'; msg.textContent = data.error || 'Could not post.'; TLM.error(msg.textContent); return; }
  msg.className = 'form-msg show success'; msg.textContent = 'Posted.';
  TLM.success('Your students can see it now.', 'Announcement posted');
  e.target.reset();
  loadAnnouncements();
});

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
