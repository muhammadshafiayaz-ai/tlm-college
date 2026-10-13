// Public website behaviour: navigation, scroll animations, live content, admission form.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  }
  const initials = (name) => String(name || '?').replace(/^(Sir|Miss|Mr|Mrs|Ms|Dr)\.?\s+/i, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json(); }

  // ---------- header + mobile menu ----------
  const header = $('header');
  const navToggle = $('#navToggle'), navLinks = $('#navLinks');
  const onScroll = () => header && header.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open);
    });
    $$('a', navLinks).forEach(a => a.addEventListener('click', () => navLinks.classList.remove('open')));
  }

  // ---------- home page: smooth scrolling + scroll-spy ----------
  // On the home page the menu items are #anchors that glide to each section.
  const isHome = document.body.dataset.page === 'home';
  if (isHome) {
    $$('a[href^="#"]').forEach(a => a.addEventListener('click', (e) => {
      const target = a.getAttribute('href') === '#home' ? document.body : $(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      if (target === document.body) window.scrollTo({ top: 0, behavior: 'smooth' });
      else target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', a.getAttribute('href'));
    }));
    const spyLinks = $$('#navLinks a[href^="#"]');
    const sections = spyLinks.map(a => $(a.getAttribute('href'))).filter(Boolean);
    if ('IntersectionObserver' in window && sections.length) {
      const spy = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          spyLinks.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + en.target.id));
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      sections.forEach(s => spy.observe(s));
    }
  }

  // ---------- scroll reveal + animated counters ----------
  let revealIO = null;
  function observeReveals() {
    const els = $$('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    if (!revealIO) {
      revealIO = new IntersectionObserver((entries) => entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add('in'); revealIO.unobserve(en.target); }
      }), { threshold: 0.12 });
    }
    els.forEach((e, i) => { if (!e.style.getPropertyValue('--d')) e.style.setProperty('--d', (i % 4) * 0.08 + 's'); revealIO.observe(e); });
  }
  function runCounters() {
    $$('[data-count]').forEach(el => {
      const end = parseInt(el.dataset.count, 10), suffix = el.dataset.suffix || '';
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = end + suffix; return; }
      const start = performance.now(), dur = 1400;
      const tick = (now) => {
        const p = Math.min((now - start) / dur, 1);
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  observeReveals(); runCounters();

  // ---------- principal ----------
  const principalBox = $('#principalBox');
  async function loadPrincipal() {
    if (!principalBox) return;
    const preview = principalBox.dataset.mode === 'preview';
    try {
      const p = await getJSON('/api/content/principal');
      if (!p) throw new Error('none');
      let msg = (p.message || '').trim();
      let more = '';
      if (!msg) msg = "A personal message from the Principal will appear here soon.";
      else if (preview && msg.length > 360) { msg = msg.slice(0, 360).replace(/\s+\S*$/, '') + '…'; more = '<a class="link-more" href="/principal.html">Read the full message <span>→</span></a>'; }
      else if (preview) more = '<a class="link-more" href="/principal.html">Meet the Principal <span>→</span></a>';
      const photo = p.photo_path
        ? `<img src="${escapeHtml(p.photo_path)}" alt="${escapeHtml(p.name)}" loading="lazy">`
        : `<div class="avatar" aria-hidden="true">${escapeHtml(initials(p.name))}</div>`;
      principalBox.innerHTML = `
        <div class="p-photo reveal">${photo}</div>
        <div class="reveal">
          <span class="quote-mark" aria-hidden="true">“</span>
          <p class="p-message">${escapeHtml(msg)}</p>
          <h3 class="p-name">${escapeHtml(p.name)}</h3>
          <div class="p-title">${escapeHtml(p.title)}</div>
          ${more}
        </div>`;
    } catch (e) {
      principalBox.innerHTML = '<div class="empty-note" style="grid-column:1/-1">The Principal\'s message could not be loaded right now.</div>';
    }
    observeReveals();
  }

  // ---------- teachers ----------
  const teacherGrid = $('#teacherGrid');
  async function loadTeachers() {
    if (!teacherGrid) return;
    const limit = parseInt(teacherGrid.dataset.limit || '0', 10);
    try {
      let rows = await getJSON('/api/content/teachers');
      if (!rows.length) { teacherGrid.outerHTML = '<div class="empty-note">Teacher profiles will appear here soon.</div>'; return; }
      const total = rows.length;
      if (limit) rows = rows.slice(0, limit);
      teacherGrid.innerHTML = rows.map(t => `
        <article class="tcard reveal">
          ${t.photo_path ? `<img class="tphoto" src="${escapeHtml(t.photo_path)}" alt="${escapeHtml(t.name)}" loading="lazy">`
                         : `<div class="tavatar" aria-hidden="true">${escapeHtml(initials(t.name))}</div>`}
          <h3>${escapeHtml(t.name)}</h3>
          <div class="subject">${escapeHtml(t.designation)}</div>
          <p class="tbio">${escapeHtml(t.bio || 'Profile details coming soon.')}</p>
        </article>`).join('');
      const more = $('#teachersMore');
      if (more && limit && total <= limit) more.style.display = 'none';
    } catch (e) {
      teacherGrid.innerHTML = '<div class="empty-note" style="grid-column:1/-1">Teacher profiles could not be loaded right now.</div>';
    }
    observeReveals();
  }

  // ---------- gallery + lightbox ----------
  const galleryGrid = $('#galleryGrid');
  let galleryItems = [], lbIndex = 0, lb = null;
  function buildLightbox() {
    lb = document.createElement('div');
    lb.className = 'lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true');
    lb.innerHTML = '<button class="lb-btn lb-close" aria-label="Close">×</button><button class="lb-btn lb-prev" aria-label="Previous">‹</button>' +
      '<figure><img alt=""><figcaption></figcaption></figure><button class="lb-btn lb-next" aria-label="Next">›</button>';
    document.body.appendChild(lb);
    $('.lb-close', lb).onclick = closeLb;
    $('.lb-prev', lb).onclick = () => showLb(lbIndex - 1);
    $('.lb-next', lb).onclick = () => showLb(lbIndex + 1);
    lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', (e) => {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowLeft') showLb(lbIndex - 1);
      if (e.key === 'ArrowRight') showLb(lbIndex + 1);
    });
  }
  function showLb(i) {
    if (!galleryItems.length) return;
    lbIndex = (i + galleryItems.length) % galleryItems.length;
    const it = galleryItems[lbIndex];
    $('img', lb).src = it.image_path; $('img', lb).alt = it.caption || 'School gallery photo';
    $('figcaption', lb).textContent = it.caption || '';
  }
  function openLb(i) { if (!lb) buildLightbox(); showLb(i); lb.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeLb() { lb.classList.remove('open'); document.body.style.overflow = ''; }

  async function loadGallery() {
    if (!galleryGrid) return;
    const limit = parseInt(galleryGrid.dataset.limit || '0', 10);
    try {
      galleryItems = await getJSON('/api/content/gallery');
      if (!galleryItems.length) {
        galleryGrid.outerHTML = '<div class="empty-note">Campus photos will appear here soon.</div>';
        const more = $('#galleryMore'); if (more) more.style.display = 'none';
        return;
      }
      const shown = limit ? galleryItems.slice(0, limit) : galleryItems;
      galleryGrid.innerHTML = shown.map((g, i) => `
        <button class="g-item reveal" data-i="${i}" aria-label="${escapeHtml(g.caption || 'Open photo')}">
          <img src="${escapeHtml(g.image_path)}" alt="${escapeHtml(g.caption || 'School gallery photo')}" loading="lazy">
          ${g.caption ? `<span class="cap">${escapeHtml(g.caption)}</span>` : ''}
        </button>`).join('');
      $$('.g-item', galleryGrid).forEach(b => b.addEventListener('click', () => openLb(parseInt(b.dataset.i, 10))));
      const more = $('#galleryMore');
      if (more && limit && galleryItems.length <= limit) more.style.display = 'none';
    } catch (e) {
      galleryGrid.innerHTML = '<div class="empty-note" style="grid-column:1/-1">The gallery could not be loaded right now.</div>';
    }
    observeReveals();
  }

  // ---------- announcements ----------
  const annList = $('#annList');
  function audienceLabel(a) {
    if (a === 'all') return 'Everyone';
    if (a === 'teachers') return 'Teachers';
    if (a === 'students') return 'Students';
    if (a && a.startsWith('class:')) return 'Class ' + a.split(':')[1];
    return a || 'Everyone';
  }
  async function loadAnnouncements() {
    if (!annList) return;
    const limit = parseInt(annList.dataset.limit || '0', 10);
    try {
      let items = await getJSON('/api/announcements');
      if (!items.length) { annList.innerHTML = '<div class="empty-note">No announcements have been posted yet.</div>'; return; }
      if (limit) items = items.slice(0, limit);
      annList.innerHTML = items.map(a => `
        <div class="ann-card reveal">
          <div class="ann-meta">
            <span class="audience-tag">${escapeHtml(audienceLabel(a.audience))}</span>
            <span>${new Date(a.announcement_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · Posted by ${escapeHtml(a.posted_by)}</span>
          </div>
          <h3>${escapeHtml(a.title)}</h3>
          <p>${escapeHtml(a.body)}</p>
        </div>`).join('');
    } catch (e) {
      annList.innerHTML = '<div class="empty-note">Announcements could not be loaded right now.</div>';
    }
    observeReveals();
  }

  // ---------- admission form ----------
  const form = $('#admissionForm');
  if (form) {
    const formMsg = $('#formMsg'), submitBtn = $('#submitBtn'), formLoading = $('#formLoading');
    const showMsg = (kind, html) => { formMsg.className = 'form-msg show ' + kind; formMsg.innerHTML = html; formMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    const MAX = 2 * 1024 * 1024;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      formMsg.className = 'form-msg';

      // friendly client-side checks (the server still validates everything)
      for (const [id, exts] of [['photo', ['jpg', 'jpeg', 'png']], ['document', ['jpg', 'jpeg', 'png', 'pdf']]]) {
        const f = form.elements[id] && form.elements[id].files[0];
        if (!f) continue;
        const ext = f.name.split('.').pop().toLowerCase();
        if (!exts.includes(ext)) { const m = 'Please upload a ' + exts.join('/').toUpperCase() + ' file for the ' + id + '.'; showMsg('error', m); TLM.error(m, 'Check your file'); return; }
        if (f.size > MAX) { const m = 'The ' + id + ' must be 2 MB or smaller.'; showMsg('error', m); TLM.error(m, 'File too large'); return; }
      }

      submitBtn.disabled = true; formLoading.style.display = 'inline';
      try {
        const res = await fetch('/api/admissions', { method: 'POST', body: new FormData(form) });
        const result = await res.json();
        if (!res.ok) {
          const m = result.error || 'Something went wrong. Please check the form and try again.';
          showMsg('error', escapeHtml(m)); TLM.error(m, 'Could not submit');
        } else {
          showMsg('success',
            `Thank you. Your application has been received.<br>Application ID: <span class="app-id">${escapeHtml(result.applicationId)}</span><br>` +
            `Status: Pending review.<br>Please keep this ID for future reference.`);
          TLM.success('Your application ID is ' + result.applicationId + '.', 'Application submitted');
          form.reset();
        }
      } catch (err) {
        showMsg('error', 'Could not reach the server. Please try again later.');
        TLM.error('Could not reach the server. Please try again later.');
      } finally {
        submitBtn.disabled = false; formLoading.style.display = 'none';
      }
    });
  }

  loadPrincipal(); loadTeachers(); loadGallery(); loadAnnouncements();
})();
