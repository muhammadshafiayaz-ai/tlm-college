// Shared success/error toasts + a soft audio chime (no audio file needed).
// Usage: TLM.success('Saved!'), TLM.error('Something went wrong'), TLM.toast(msg, 'success'|'error', title)
(function () {
  const SOUND_KEY = 'tlm_sound';
  let ctx = null;

  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { return true; }
  }
  function setSound(on) {
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (e) {}
  }

  // Browsers only allow audio after a user gesture, so warm the engine up on the first tap/click/keypress.
  function prime() {
    try {
      if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); }
      if (ctx && ctx.state === 'suspended') ctx.resume();
    } catch (e) {}
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, prime, { passive: true }));

  // Gentle three-note rising chime (E5 - A5 - E6), sine waves with a soft attack and long decay.
  function chime() {
    if (!soundOn()) return;
    prime();
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime + 0.02;
      [[659.25, 0], [880, 0.12], [1318.5, 0.24]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        const s = t0 + delay;
        gain.gain.setValueAtTime(0.0001, s);
        gain.gain.exponentialRampToValueAtTime(0.09, s + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start(s); osc.stop(s + 0.95);
      });
    } catch (e) {}
  }

  function host() {
    let h = document.getElementById('toastHost');
    if (!h) {
      h = document.createElement('div');
      h.id = 'toastHost';
      h.setAttribute('aria-live', 'polite');
      document.body.appendChild(h);
    }
    return h;
  }

  function toast(message, type, title) {
    type = type === 'error' ? 'error' : 'success';
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const dur = type === 'error' ? 6500 : 4500;
    el.style.setProperty('--dur', dur + 'ms');
    const heading = title || (type === 'error' ? 'Something went wrong' : 'Success');
    el.innerHTML =
      '<div class="t-ico">' + (type === 'error' ? '!' : '✓') + '</div>' +
      '<div class="t-body"><b></b><span></span></div>' +
      '<button class="t-x" aria-label="Dismiss">×</button><div class="t-bar"></div>';
    el.querySelector('b').textContent = heading;
    el.querySelector('span').textContent = message || '';
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
    el.querySelector('.t-x').addEventListener('click', close);
    host().appendChild(el);
    setTimeout(close, dur);
    if (type === 'success') chime();
    return el;
  }

  window.TLM = {
    toast,
    success: (m, t) => toast(m, 'success', t),
    error: (m, t) => toast(m, 'error', t),
    chime, soundOn, setSound
  };
})();
