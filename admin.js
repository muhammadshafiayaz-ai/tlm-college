function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

(async () => {
  const user = await guardRole('admin');
  if (!user) return;
  wireLogout();
  wireSoundToggle();
  loadAccounts();
  loadAdmissions();
  loadAnnouncementsAdmin();
  loadTeachersForAssignment();
  loadClassAssignments();
})();

// ---- Tabs ----
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('[id^="tab-"]').forEach(p =>
      p.style.display = (p.id === 'tab-' + btn.dataset.tab) ? 'block' : 'none'
    );
  });
});

// =========================================================
// ACCOUNTS
// =========================================================
const accRole = document.getElementById('accRole');
accRole.addEventListener('change', () => {
  document.getElementById('accSubjectWrap').style.display = accRole.value === 'teacher' ? 'block' : 'none';
  const isStudent = accRole.value === 'student';
  ['accClassWrap', 'accRollWrap', 'accGuardianNameWrap', 'accGuardianContactWrap'].forEach(id =>
    document.getElementById(id).style.display = isStudent ? 'block' : 'none'
  );
});

document.getElementById('accForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('accMsg');
  msg.className = 'form-msg';
  const payload = {
    full_name: document.getElementById('accFullName').value.trim(),
    username: document.getElementById('accUsername').value.trim(),
    temp_password: document.getElementById('accPassword').value,
    role: accRole.value,
    subject: document.getElementById('accSubject').value.trim(),
    class_name: document.getElementById('accClass').value.trim(),
    roll_no: document.getElementById('accRoll').value.trim(),
    guardian_name: document.getElementById('accGuardianName').value.trim(),
    guardian_contact: document.getElementById('accGuardianContact').value.trim(),
    is_active: document.getElementById('accStatus').value === '1'
  };
  const res = await fetch('/api/admin/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) { msg.className = 'form-msg show error'; msg.textContent = data.error; TLM.error(data.error || 'Could not create the account.'); return; }
  msg.className = 'form-msg show success'; msg.textContent = 'Account created.';
  TLM.success('The new account is ready to use.', 'Account created');
  e.target.reset();
  ['accSubjectWrap', 'accClassWrap', 'accRollWrap', 'accGuardianNameWrap', 'accGuardianContactWrap'].forEach(id =>
    document.getElementById(id).style.display = 'none'
  );
  loadAccounts();
});

async function loadAccounts() {
  const q = document.getElementById('accSearch').value.trim();
  const role = document.getElementById('accRoleFilter').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (role) params.set('role', role);
  const body = document.getElementById('accBody');
  body.innerHTML = '<tr><td colspan="7">Loading…</td></tr>';
  const res = await fetch('/api/admin/accounts?' + params.toString());
  const rows = await res.json();
  if (!rows.length) { body.innerHTML = '<tr><td colspan="7">No accounts found.</td></tr>'; return; }
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.full_name)}</td>
      <td>${escapeHtml(r.username)}</td>
      <td style="text-transform:capitalize;">${r.role}</td>
      <td>${escapeHtml(r.teacher_subject || r.student_class || '—')}</td>
      <td><span class="badge ${r.is_active ? 'approved' : 'rejected'}">${r.is_active ? 'Active' : 'Inactive'}</span></td>
      <td>${r.must_change_password ? 'Yes' : 'No'}</td>
      <td>
        <button class="rowbtn" onclick="editAccount(${r.id})">Edit username</button>
        <button class="rowbtn" onclick="resetPassword(${r.id})">Reset password</button>
        <button class="rowbtn ${r.is_active ? 'danger' : ''}" onclick="toggleStatus(${r.id}, ${r.is_active ? 0 : 1})">${r.is_active ? 'Deactivate' : 'Activate'}</button>
      </td>
    </tr>
  `).join('');
}

async function editAccount(id) {
  const newUsername = prompt('New username (leave blank to keep unchanged):');
  const newFullName = prompt('New full name (leave blank to keep unchanged):');
  if (newUsername === null && newFullName === null) return;
  const res = await fetch('/api/admin/accounts/' + id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: newUsername || undefined, full_name: newFullName || undefined })
  });
  const data = await res.json();
  if (!res.ok) { TLM.error(data.error || 'Could not update account.'); return; }
  TLM.success('The account details were saved.', 'Account updated');
  loadAccounts();
}

async function resetPassword(id) {
  const pw = prompt('New temporary password (min 6 characters):');
  if (!pw) return;
  const res = await fetch(`/api/admin/accounts/${id}/reset-password`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword: pw })
  });
  const data = await res.json();
  if (!res.ok) { TLM.error(data.error || 'Could not reset password.'); return; }
  TLM.success('The user must change it on next login.', 'Password reset');
  loadAccounts();
}

async function toggleStatus(id, next) {
  const res = await fetch(`/api/admin/accounts/${id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !!next })
  });
  if (!res.ok) { TLM.error('Could not update status.'); return; }
  TLM.success(next ? 'The account is active again.' : 'The account has been deactivated.', 'Status updated');
  loadAccounts();
}

document.getElementById('accRefresh').addEventListener('click', loadAccounts);
document.getElementById('accSearch').addEventListener('keyup', e => { if (e.key === 'Enter') loadAccounts(); });
document.getElementById('accRoleFilter').addEventListener('change', loadAccounts);

// =========================================================
// ADMISSIONS
// =========================================================
const admBody = document.getElementById('admBody');

async function loadAdmissions() {
  const q = document.getElementById('admSearch').value.trim();
  const status = document.getElementById('admStatusFilter').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  admBody.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
  const res = await fetch('/api/admissions?' + params.toString());
  const rows = await res.json();
  if (!rows.length) { admBody.innerHTML = '<tr><td colspan="8">No applications found.</td></tr>'; return; }
  admBody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.application_id)}</td>
      <td>${escapeHtml(r.student_name)}</td>
      <td>${escapeHtml(r.class_applied_for)}</td>
      <td>${escapeHtml(r.guardian_name)}</td>
      <td>${escapeHtml(r.guardian_contact)}</td>
      <td><span class="badge ${r.status}">${r.status}</span></td>
      <td>${new Date(r.submitted_at).toLocaleDateString()}</td>
      <td>
        <button class="rowbtn" onclick="viewApplication(${r.id})">View</button>
        <button class="rowbtn primary" onclick="setStatus(${r.id},'approved')">Approve</button>
        <button class="rowbtn" onclick="setStatus(${r.id},'pending')">Pending</button>
        <button class="rowbtn danger" onclick="setStatus(${r.id},'rejected')">Reject</button>
        <button class="rowbtn danger" onclick="deleteApplication(${r.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function viewApplication(id) {
  const res = await fetch('/api/admissions/' + id);
  if (!res.ok) { TLM.error('Could not load application.'); return; }
  const a = await res.json();
  alert(
    `Application ${a.application_id}\n\nStudent: ${a.student_name}\nDOB: ${a.dob}\nGender: ${a.gender}\n` +
    `Previous school: ${a.previous_school || '—'}\nClass applied for: ${a.class_applied_for}\n\n` +
    `Guardian: ${a.guardian_name} (${a.guardian_relationship})\nContact: ${a.guardian_contact}\nEmail: ${a.guardian_email || '—'}\n` +
    `Address: ${a.home_address}\n\nAdditional info: ${a.additional_info || '—'}\n` +
    `Photo: ${a.photo_path || 'none'}\nDocument: ${a.document_path || 'none'}\n\nStatus: ${a.status}`
  );
}

async function setStatus(id, status) {
  const res = await fetch('/api/admissions/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  if (!res.ok) { TLM.error('Could not update status.'); return; }
  TLM.success('Application marked as ' + status + '.', 'Status updated');
  loadAdmissions();
}

async function deleteApplication(id) {
  if (!confirm('Delete this application permanently?')) return;
  const res = await fetch('/api/admissions/' + id, { method: 'DELETE' });
  if (!res.ok) { TLM.error('Could not delete.'); return; }
  TLM.success('The application was deleted.', 'Deleted');
  loadAdmissions();
}

document.getElementById('admRefresh').addEventListener('click', loadAdmissions);
document.getElementById('admSearch').addEventListener('keyup', e => { if (e.key === 'Enter') loadAdmissions(); });
document.getElementById('admStatusFilter').addEventListener('change', loadAdmissions);

// =========================================================
// ANNOUNCEMENTS
// =========================================================
const annBody2 = document.getElementById('annBody2');

document.getElementById('annAudience').addEventListener('change', (e) => {
  document.getElementById('annClassWrap').style.display = e.target.value === 'class' ? 'block' : 'none';
});

document.getElementById('annForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  let audience = document.getElementById('annAudience').value;
  if (audience === 'class') audience = 'class:' + (document.getElementById('annClassName').value.trim() || 'unspecified');
  const payload = {
    title: document.getElementById('annTitle').value.trim(),
    body: document.getElementById('annBody').value.trim(),
    audience,
    posted_by: "Principal's Office",
    announcement_date: document.getElementById('annDate').value || null,
    is_published: true
  };
  const res = await fetch('/api/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) { TLM.error('Could not publish announcement.'); return; }
  TLM.success('Your announcement is now live.', 'Announcement published');
  e.target.reset();
  document.getElementById('annClassWrap').style.display = 'none';
  loadAnnouncementsAdmin();
});

async function loadAnnouncementsAdmin() {
  annBody2.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
  const res = await fetch('/api/announcements/all');
  const rows = await res.json();
  if (!rows.length) { annBody2.innerHTML = '<tr><td colspan="6">No announcements yet.</td></tr>'; return; }
  annBody2.innerHTML = rows.map(a => `
    <tr>
      <td>${escapeHtml(a.title)}</td>
      <td>${escapeHtml(a.audience)}</td>
      <td>${new Date(a.announcement_date).toLocaleDateString()}</td>
      <td>${escapeHtml(a.posted_by)}</td>
      <td>${a.is_published ? 'Yes' : 'No'}</td>
      <td>
        <button class="rowbtn" onclick="editAnnouncement(${a.id})">Edit</button>
        <button class="rowbtn" onclick="togglePublish(${a.id}, ${a.is_published ? 0 : 1})">${a.is_published ? 'Unpublish' : 'Publish'}</button>
        <button class="rowbtn danger" onclick="deleteAnnouncement(${a.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function editAnnouncement(id) {
  const res = await fetch('/api/announcements/all');
  const rows = await res.json();
  const a = rows.find(r => r.id === id);
  if (!a) return;
  const title = prompt('Title', a.title); if (title === null) return;
  const body = prompt('Body', a.body); if (body === null) return;
  const audience = prompt('Audience (all / teachers / students / class:9th A)', a.audience); if (audience === null) return;
  const upd = await fetch('/api/announcements/' + id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, audience, posted_by: a.posted_by, announcement_date: a.announcement_date })
  });
  if (!upd.ok) { TLM.error('Could not update.'); return; }
  TLM.success('The announcement was updated.', 'Saved');
  loadAnnouncementsAdmin();
}

async function togglePublish(id, next) {
  const res = await fetch(`/api/announcements/${id}/publish`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_published: next }) });
  if (!res.ok) { TLM.error('Could not update.'); return; }
  TLM.success(next ? 'The announcement is now visible.' : 'The announcement is now hidden.', 'Updated');
  loadAnnouncementsAdmin();
}

async function deleteAnnouncement(id) {
  if (!confirm('Delete this announcement permanently?')) return;
  const res = await fetch('/api/announcements/' + id, { method: 'DELETE' });
  if (!res.ok) { TLM.error('Could not delete.'); return; }
  TLM.success('The announcement was deleted.', 'Deleted');
  loadAnnouncementsAdmin();
}

// =========================================================
// CLASSES (teacher <-> class <-> subject assignments)
// =========================================================
async function loadTeachersForAssignment() {
  const sel = document.getElementById('assignTeacher');
  const res = await fetch('/api/admin/teachers');
  const rows = await res.json();
  rows.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.full_name} (${t.subject})`;
    sel.appendChild(opt);
  });
}

async function loadClassAssignments() {
  const body = document.getElementById('assignBody');
  body.innerHTML = '<tr><td colspan="4">Loading…</td></tr>';
  const res = await fetch('/api/admin/class-assignments');
  const rows = await res.json();
  if (!rows.length) { body.innerHTML = '<tr><td colspan="4">No assignments yet.</td></tr>'; return; }
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.teacher_name)}</td>
      <td>${escapeHtml(r.class_name)}</td>
      <td>${escapeHtml(r.subject)}</td>
      <td><button class="rowbtn danger" onclick="deleteAssignment(${r.id})">Remove</button></td>
    </tr>
  `).join('');
}

document.getElementById('assignForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('assignMsg');
  msg.className = 'form-msg';
  const payload = {
    teacher_id: Number(document.getElementById('assignTeacher').value),
    class_name: document.getElementById('assignClassName').value.trim(),
    subject: document.getElementById('assignSubject').value.trim()
  };
  const res = await fetch('/api/admin/class-assignments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) { msg.className = 'form-msg show error'; msg.textContent = data.error || 'Could not create assignment.'; TLM.error(msg.textContent); return; }
  msg.className = 'form-msg show success'; msg.textContent = 'Assigned.';
  TLM.success('The teacher is now assigned to that class.', 'Assigned');
  e.target.reset();
  loadClassAssignments();
});

async function deleteAssignment(id) {
  if (!confirm('Remove this assignment?')) return;
  const res = await fetch('/api/admin/class-assignments/' + id, { method: 'DELETE' });
  if (!res.ok) { TLM.error('Could not remove.'); return; }
  TLM.success('The assignment was removed.', 'Removed');
  loadClassAssignments();
}

// ---- Notification sound on/off (remembered in this browser) ----
function wireSoundToggle() {
  const btn = document.getElementById('soundBtn');
  if (!btn) return;
  const paint = () => { btn.textContent = TLM.soundOn() ? '🔔' : '🔕'; btn.title = TLM.soundOn() ? 'Notification sound: on' : 'Notification sound: off'; };
  paint();
  btn.addEventListener('click', () => { TLM.setSound(!TLM.soundOn()); paint(); if (TLM.soundOn()) TLM.chime(); });
}
