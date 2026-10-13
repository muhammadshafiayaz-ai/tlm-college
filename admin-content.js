// Admin panel: manage Principal message/photo, Teacher profiles and Gallery images.
// Talks to the new /api/content/* (read) and /api/admin/content/* (write) endpoints.
(function () {
  const $ = (id) => document.getElementById(id);
  const MAX = 4 * 1024 * 1024;          // server limit per image (Vercel body limit)
  const MAX_PICK = 25 * 1024 * 1024;     // what the admin may pick - big photos are auto-resized below
  const OK_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
  const initials = (n) => String(n || '?').replace(/^(Sir|Miss|Mr|Mrs|Ms|Dr)\.?\s+/i, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

  async function request(url, method, body) {
    const opts = { method };
    if (body instanceof FormData) opts.body = body;                       // file uploads
    else if (body) { opts.body = JSON.stringify(body); opts.headers = { 'Content-Type': 'application/json' }; }
    const res = await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error('Your session has expired. Please log in again.');
      throw new Error(data.error || 'Something went wrong.');
    }
    return data;
  }
  const checkImage = (f) => {
    const ext = f.name.split('.').pop().toLowerCase();
    if (!OK_EXT.includes(ext)) return `"${f.name}" is not a supported image (use JPG, PNG, WEBP or GIF).`;
    const isGif = ext === 'gif';
    if (isGif && f.size > MAX) return `"${f.name}" is larger than 4 MB (animated GIFs cannot be resized).`;
    if (!isGif && f.size > MAX_PICK) return `"${f.name}" is too large.`;
    return null;
  };
  // Shrink big photos in the browser so each upload stays under Vercel's ~4.5 MB request limit.
  async function shrink(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'gif' || file.size <= 1.5 * 1024 * 1024) return file;
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
      const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = 0.85, blob;
      do { blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); q -= 0.1; } while (blob && blob.size > MAX * 0.9 && q > 0.3);
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch (e) { return file; }
  }
  const setPreview = (box, src) => { box.innerHTML = src ? `<img src="${escapeHtml(src)}" alt="">` : 'No photo'; };
  const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.dataset.label = btn.dataset.label || btn.textContent; btn.textContent = on ? (label || 'Saving…') : btn.dataset.label; };

  // =====================================================
  // PRINCIPAL
  // =====================================================
  const pr = { photo: null };
  async function loadPrincipal() {
    try {
      const p = await (await fetch('/api/content/principal')).json();
      if (!p) return;
      $('prName').value = p.name || ''; $('prTitle').value = p.title || ''; $('prMessage').value = p.message || '';
      pr.photo = p.photo_path || null;
      setPreview($('prPreview'), pr.photo);
      $('prRemoveWrap').style.display = pr.photo ? 'flex' : 'none';
      $('prRemove').checked = false; $('prPhoto').value = '';
      $('prCount').textContent = $('prMessage').value.length + ' / 6000';
    } catch (e) { TLM.error('Could not load the Principal details.'); }
  }
  $('prMessage').addEventListener('input', () => { $('prCount').textContent = $('prMessage').value.length + ' / 6000'; });
  $('prPhoto').addEventListener('change', () => {
    const f = $('prPhoto').files[0];
    if (!f) { setPreview($('prPreview'), pr.photo); return; }
    const bad = checkImage(f);
    if (bad) { TLM.error(bad, 'Invalid image'); $('prPhoto').value = ''; return; }
    setPreview($('prPreview'), URL.createObjectURL(f));
    $('prRemove').checked = false;
  });
  $('prRemove').addEventListener('change', () => { if ($('prRemove').checked) { $('prPhoto').value = ''; setPreview($('prPreview'), null); } else setPreview($('prPreview'), pr.photo); });
  $('prForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('name', $('prName').value); fd.append('title', $('prTitle').value); fd.append('message', $('prMessage').value);
    if ($('prRemove').checked) fd.append('remove_photo', '1');
    if ($('prPhoto').files[0]) fd.append('photo', await shrink($('prPhoto').files[0]));
    busy($('prSave'), true, 'Saving…');
    try {
      await request('/api/admin/content/principal', 'PUT', fd);
      TLM.success("The Principal's message is now live on the website.", 'Saved');
      await loadPrincipal();
    } catch (err) { TLM.error(err.message); }
    finally { busy($('prSave'), false); }
  });

  // =====================================================
  // TEACHERS
  // =====================================================
  let teachers = [];
  function resetTeacherForm() {
    $('tpForm').reset(); $('tpId').value = '';
    $('tpFormTitle').textContent = 'Add a teacher profile'; $('tpSave').textContent = 'Add teacher'; $('tpSave').dataset.label = 'Add teacher';
    $('tpCancel').style.display = 'none'; $('tpBanner').classList.remove('show');
    $('tpRemoveWrap').style.display = 'none'; setPreview($('tpPreview'), null);
  }
  async function loadTeachers() {
    const list = $('tpList');
    try {
      teachers = await (await fetch('/api/content/teachers')).json();
      if (!teachers.length) { list.innerHTML = '<div class="empty-note" style="grid-column:1/-1">No teacher profiles yet. Add the first one above.</div>'; return; }
      list.innerHTML = teachers.map(t => `
        <div class="admin-card">
          ${t.photo_path ? `<img class="ac-img" src="${escapeHtml(t.photo_path)}" alt="${escapeHtml(t.name)}" loading="lazy">` : `<div class="ac-img">${escapeHtml(initials(t.name))}</div>`}
          <div class="ac-body">
            <b>${escapeHtml(t.name)}</b><small>${escapeHtml(t.designation)}</small>
            <small>Order: ${t.sort_order}${t.bio ? '' : ' · no bio yet'}</small>
            <div class="ac-actions">
              <button class="rowbtn" data-edit="${t.id}">Edit</button>
              <button class="rowbtn danger" data-del="${t.id}">Delete</button>
            </div>
          </div>
        </div>`).join('');
    } catch (e) { list.innerHTML = '<div class="empty-note" style="grid-column:1/-1">Could not load teacher profiles.</div>'; }
  }
  $('tpList').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (edit) {
      const t = teachers.find(x => x.id === Number(edit.dataset.edit)); if (!t) return;
      $('tpId').value = t.id; $('tpName').value = t.name; $('tpDesignation').value = t.designation;
      $('tpBio').value = t.bio || ''; $('tpOrder').value = t.sort_order; $('tpPhoto').value = '';
      setPreview($('tpPreview'), t.photo_path); $('tpRemove').checked = false;
      $('tpRemoveWrap').style.display = t.photo_path ? 'flex' : 'none';
      $('tpFormTitle').textContent = 'Edit teacher profile'; $('tpSave').textContent = 'Save changes'; $('tpSave').dataset.label = 'Save changes';
      $('tpCancel').style.display = 'inline-flex';
      $('tpBanner').textContent = 'Editing: ' + t.name + ' — change the details below and press "Save changes".'; $('tpBanner').classList.add('show');
      $('tpForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (del) {
      const t = teachers.find(x => x.id === Number(del.dataset.del)); if (!t) return;
      if (!confirm(`Remove "${t.name}" from the website? This cannot be undone.`)) return;
      try {
        await request('/api/admin/content/teachers/' + t.id, 'DELETE');
        TLM.success(`${t.name} was removed from the Teachers page.`, 'Teacher removed');
        if ($('tpId').value === String(t.id)) resetTeacherForm();
        loadTeachers();
      } catch (err) { TLM.error(err.message); }
    }
  });
  $('tpCancel').addEventListener('click', resetTeacherForm);
  $('tpPhoto').addEventListener('change', () => {
    const f = $('tpPhoto').files[0]; if (!f) return;
    const bad = checkImage(f);
    if (bad) { TLM.error(bad, 'Invalid image'); $('tpPhoto').value = ''; return; }
    setPreview($('tpPreview'), URL.createObjectURL(f)); $('tpRemove').checked = false;
  });
  $('tpRemove').addEventListener('change', () => {
    if ($('tpRemove').checked) { $('tpPhoto').value = ''; setPreview($('tpPreview'), null); }
    else { const t = teachers.find(x => x.id === Number($('tpId').value)); setPreview($('tpPreview'), t && t.photo_path); }
  });
  $('tpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('tpId').value;
    const fd = new FormData();
    fd.append('name', $('tpName').value); fd.append('designation', $('tpDesignation').value); fd.append('bio', $('tpBio').value);
    if ($('tpOrder').value !== '') fd.append('sort_order', $('tpOrder').value);
    if ($('tpRemove').checked) fd.append('remove_photo', '1');
    if ($('tpPhoto').files[0]) fd.append('photo', await shrink($('tpPhoto').files[0]));
    busy($('tpSave'), true, 'Saving…');
    try {
      await request(id ? '/api/admin/content/teachers/' + id : '/api/admin/content/teachers', id ? 'PUT' : 'POST', fd);
      TLM.success(id ? 'The profile was updated on the website.' : 'The new teacher now appears on the Teachers page.', id ? 'Profile updated' : 'Teacher added');
      resetTeacherForm(); loadTeachers();
    } catch (err) { TLM.error(err.message); }
    finally { busy($('tpSave'), false); }
  });

  // =====================================================
  // GALLERY
  // =====================================================
  let gallery = [];
  async function loadGallery() {
    const list = $('glList');
    try {
      gallery = await (await fetch('/api/content/gallery')).json();
      if (!gallery.length) { list.innerHTML = '<div class="empty-note" style="grid-column:1/-1">The gallery is empty. Upload the first photos above.</div>'; return; }
      list.innerHTML = gallery.map(g => `
        <div class="admin-card">
          <img class="ac-img" src="${escapeHtml(g.image_path)}" alt="${escapeHtml(g.caption || 'Gallery photo')}" loading="lazy">
          <div class="ac-body">
            <small>${g.caption ? escapeHtml(g.caption) : '<i>No caption</i>'}</small>
            <div class="ac-actions">
              <button class="rowbtn" data-cap="${g.id}">Edit caption</button>
              <button class="rowbtn danger" data-del="${g.id}">Delete</button>
            </div>
          </div>
        </div>`).join('');
    } catch (e) { list.innerHTML = '<div class="empty-note" style="grid-column:1/-1">Could not load the gallery.</div>'; }
  }
  $('glFiles').addEventListener('change', () => {
    const box = $('glPreview'); box.innerHTML = '';
    const files = Array.from($('glFiles').files);
    if (files.length > 20) { TLM.error('Please choose 20 photos or fewer at a time.', 'Too many photos'); $('glFiles').value = ''; return; }
    for (const f of files) {
      const bad = checkImage(f);
      if (bad) { TLM.error(bad, 'Invalid image'); $('glFiles').value = ''; box.innerHTML = ''; return; }
    }
    box.innerHTML = files.map(f => `<div class="admin-card"><img class="ac-img" src="${URL.createObjectURL(f)}" alt=""><div class="ac-body"><small>${escapeHtml(f.name)}</small></div></div>`).join('');
  });
  $('glForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = Array.from($('glFiles').files);
    if (!files.length) { TLM.error('Please choose at least one photo.'); return; }
    busy($('glSave'), true, 'Uploading…');
    let done = 0;
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append('images', await shrink(f));
        fd.append('caption', $('glCaption').value);
        $('glSave').textContent = `Uploading ${done + 1} of ${files.length}…`;
        await request('/api/admin/content/gallery', 'POST', fd);
        done++;
      }
      TLM.success(`${done} photo${done === 1 ? '' : 's'} added to the gallery.`, 'Upload complete');
      $('glForm').reset(); $('glPreview').innerHTML = ''; loadGallery();
    } catch (err) {
      TLM.error(done ? `${done} photo(s) uploaded, then: ${err.message}` : err.message);
      if (done) loadGallery();
    }
    finally { busy($('glSave'), false); }
  });
  $('glList').addEventListener('click', async (e) => {
    const cap = e.target.closest('[data-cap]'), del = e.target.closest('[data-del]');
    if (cap) {
      const g = gallery.find(x => x.id === Number(cap.dataset.cap)); if (!g) return;
      const next = prompt('Caption for this photo (leave empty for none):', g.caption || '');
      if (next === null) return;
      try {
        await request('/api/admin/content/gallery/' + g.id, 'PUT', { caption: next });
        TLM.success('The caption was updated.', 'Caption saved'); loadGallery();
      } catch (err) { TLM.error(err.message); }
    }
    if (del) {
      const g = gallery.find(x => x.id === Number(del.dataset.del)); if (!g) return;
      if (!confirm('Delete this photo from the gallery? This cannot be undone.')) return;
      try {
        await request('/api/admin/content/gallery/' + g.id, 'DELETE');
        TLM.success('The photo was removed from the gallery.', 'Photo deleted'); loadGallery();
      } catch (err) { TLM.error(err.message); }
    }
  });

  loadPrincipal(); loadTeachers(); loadGallery();
})();
