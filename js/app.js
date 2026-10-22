// ===== UTILITAS =====
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let siswa = [], qr = null, scanBusy = false, chart = null, fotoB64 = '', hapusNis = null, spinN = 0;
const BLN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function spin(on) { spinN = Math.max(0, spinN + (on ? 1 : -1)); $('loader').style.display = spinN ? 'flex' : 'none'; }
let barN = 0, noNet = false;
function bar(on) { barN = Math.max(0, barN + (on ? 1 : -1)); const b = $('topbar'); if (b) b.classList.toggle('on', barN > 0); }
// Cache sesi (hilang saat tab ditutup / logout) + stale-while-revalidate: tampil instan dari cache, segarkan di latar belakang
const SC = {
  get(k) { try { return JSON.parse(sessionStorage.getItem('c_' + k)); } catch (e) { return null; } },
  set(k, d) { try { sessionStorage.setItem('c_' + k, JSON.stringify({ t: Date.now(), d })); } catch (e) {} },
  clear() { Object.keys(sessionStorage).filter(k => k.startsWith('c_')).forEach(k => sessionStorage.removeItem(k)); }
};
function swr(fn, args, key, render) {
  const nc = key === 'list_Akun', c = nc ? null : SC.get(key), raw = c ? JSON.stringify(c.d) : null;
  if (c) { render({ success: true, data: c.d, message: 'OK' }); if (noNet || Date.now() - c.t < 20000) return; }
  api(fn, args, r => {
    if (r.success) { if (raw && JSON.stringify(r.data) === raw) { SC.set(key, r.data); return; } if (!nc) SC.set(key, r.data); }
    else if (c) return;
    render(r);
  }, false);
}
// Foto siswa: disimpan di IndexedDB selama sesi login (dihapus saat logout)
const IDB = new Promise(res => { try { const q = indexedDB.open('absen-foto', 1); q.onupgradeneeded = () => q.result.createObjectStore('f'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); } catch (e) { res(null); } });
function idbMany(keys) { return IDB.then(db => !db || !keys.length ? {} : new Promise(res => { const out = {}, tx = db.transaction('f'), st = tx.objectStore('f'); keys.forEach(k => { st.get(k).onsuccess = e => { const v = e.target.result; if (v && Date.now() - v.t < 43200000) out[k] = v.d; }; }); tx.oncomplete = tx.onerror = tx.onabort = () => res(out); })); }
function idbPut(o) { IDB.then(db => { if (!db) return; const st = db.transaction('f', 'readwrite').objectStore('f'); Object.keys(o).forEach(k => st.put({ t: Date.now(), d: o[k] }, k)); }); }
function idbDel(k) { IDB.then(db => { if (db) db.transaction('f', 'readwrite').objectStore('f').delete(k); }); }
function idbClear() { IDB.then(db => { if (db) db.transaction('f', 'readwrite').objectStore('f').clear(); }); }
function toast(msg, type = 'primary') {
  $('toast').className = 'toast align-items-center border-0 text-bg-' + type;
  $('toastMsg').textContent = msg;
  bootstrap.Toast.getOrCreateInstance($('toast'), { delay: 3500 }).show();
}
const ARG_MAP = {
  getSiswa: a => ({}), getFotoSiswa: a => ({ nis: a[0] }), simpanSiswa: a => a[0], hapusSiswa: a => ({ nis: a[0] }),
  simpanAbsensi: a => ({ nis: a[0], status: a[1], ket: a[2], jenis: a[3] }), getDashboardData: a => ({ iso: a[0] }), getRekap: a => a[0]
};
/** Semua panggilan server lewat fetch ke GAS (POST text/plain agar tidak kena CORS preflight) */
function api(fn, args, ok, loader = true, fail) {
  if (!GAS_URL || GAS_URL.includes('PASTE')) return toast('GAS_URL belum diisi di js/config.js', 'danger');
  bar(1); if (loader) spin(1);
  fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: fn, token: TOKEN, data: (ARG_MAP[fn] || (a => a[0] || {}))(args) }) })
    .then(r => r.json())
    .then(r => { bar(0); if (loader) spin(0); if (r && r.code === 'AUTH') return logout(); if (r && r.success && !/^get/.test(fn) && fn !== 'login') SC.clear(); ok && ok(r); },
          e => { bar(0); if (loader) spin(0); scanBusy = false; toast('Gagal terhubung ke server: ' + ((e && e.message) || e), 'danger'); fail && fail(e); });
}
const badge = s => ({ Hadir: 'success', Terlambat: 'warning', Alpa: 'danger' }[s] || 'info');

// ===== TEMA & NAVIGASI =====
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.setAttribute('data-bs-theme', t);
  localStorage.setItem('theme', t); $('themeSwitch').checked = t === 'dark';
}
function toggleSidebar(force) {
  $('sidebar').classList.toggle('show', force);
  let o = document.querySelector('.sidebar-overlay');
  if (!o) { o = document.createElement('div'); o.className = 'sidebar-overlay'; o.onclick = () => toggleSidebar(false); document.body.appendChild(o); }
  o.classList.toggle('show', $('sidebar').classList.contains('show'));
}
function navigateTo(id) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.toggle('active', s.id === 'section-' + id));
  document.querySelectorAll('[data-section]').forEach(l => {
    const on = l.dataset.section === id; l.classList.toggle('active', on); if (on && l.closest('.sidebar')) $('pageTitle').textContent = l.textContent.trim();
  });
  toggleSidebar(false);
  if (id === 'scan') startScan(); else stopScan();
  if (id === 'dashboard') loadDash();
  if (id === 'rekap') loadRekap();
  if (LOAD[id]) LOAD[id]();
}

// ===== DASHBOARD =====
function loadDash() {
  $('greet').textContent = salam() + (USER ? ', ' + String(USER.nama).split(' ')[0] : '') + ' 👋';
  if (!$('dashDate').value) $('dashDate').value = new Date().toLocaleDateString('sv-SE');
  setDateText();
  swr('getDashboardData', [$('dashDate').value], 'dash_' + $('dashDate').value, r => {
    if (!r.success) return toast(r.message, 'danger');
    const x = r.data;
    const t = x.total || 1;
    const k = [['Total Siswa', x.total, 'people', null], ['Hadir', x.hadir, 'check2-circle', x.hadir / t], ['Terlambat', x.terlambat, 'clock', x.terlambat / t],
               ['Izin/Sakit', x.izin, 'bandaid', x.izin / t], ['Alpa', x.alpa, 'x-circle', x.alpa / t], ['Belum Absen', x.belum, 'hourglass-split', x.belum / t]];
    $('kpi').innerHTML = k.map(([l, v, i, p]) => `<div class="kpi"><span class="kico"><i class="bi bi-${i}"></i></span><div class="flex-grow-1"><div class="kl">${l}</div><div class="kv">${v}${p !== null ? `<small>/${x.total}</small>` : ''}</div>${p !== null ? `<div class="bar"><i style="width:${Math.round(p * 100)}%"></i></div>` : ''}</div></div>`).join('');
    $('matrix').innerHTML = [['Tepat Waktu', x.hadir - x.terlambat, 'm1'], ['Terlambat', x.terlambat, 'm2'], ['Izin / Sakit', x.izin, 'm3'], ['Alpa', x.alpa, 'm4']].map(([l, v, c]) => `<div class="mx ${c}"><b>${v}</b><span>${l}</span></div>`).join('');
    $('insights').innerHTML = x.insights.map(i => `<li>${esc(i)}</li>`).join('');
    if (chart) chart.destroy();
    chart = new Chart($('chartStatus'), { type: 'doughnut',
      data: { labels: ['Tepat Waktu', 'Terlambat', 'Izin/Sakit', 'Alpa', 'Belum Absen'],
        datasets: [{ data: [x.hadir - x.terlambat, x.terlambat, x.izin, x.alpa, x.belum], backgroundColor: ['#123a78', '#3f6cb3', '#7fa1d3', '#b7cbe8', '#e1e9f5'], borderWidth: 0 }] },
      options: { animation: false, plugins: { legend: { position: 'bottom', labels: { color: getComputedStyle(document.body).color } } } } });
    $('recent').innerHTML = x.recent.length ? x.recent.map(r => `<div class="tl-item"><time>${esc(String(r.waktu).slice(0, 5))}</time><span class="dot"></span><div class="tl-pill"><b>${esc(r.nama)}</b><small>${esc(r.kelas)} · ${esc(r.jenis)}</small><span class="badge text-bg-${badge(r.status)}">${esc(r.status)}</span></div></div>`).join('')
      : '<p class="text-muted small">Belum ada absen pada tanggal ini.</p>';
  });
}

// ===== DATA SISWA (Data Induk) =====
let sisEdit = null, fotoMode = 'keep', kartuSiswa = null, hapusFn = null;   // fotoMode: keep | ganti | hapus
const fotoCache = {};                                                        // nis -> dataURL ('' = tanpa foto)
const isAdmin = () => !!(USER && USER.role === 'admin');
const isAktif = s => s.status !== 'Nonaktif';
const waNum = h => { let d = String(h || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '62' + d.slice(1); else if (d.startsWith('8')) d = '62' + d; return d; };
const fmtTgl = iso => new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

function loadSiswa(cb) {
  swr('getSiswa', [], 'siswa', r => {
    if (!r.success) return toast(r.message, 'danger');
    siswa = r.data;
    $('mNis').innerHTML = '<option value="">-- Pilih Siswa --</option>' + siswa.filter(isAktif).map(s => `<option value="${esc(s.nis)}">${esc(s.nis)} - ${esc(s.nama)}</option>`).join('');
    const kls = [...new Set(siswa.map(s => s.kelas))].sort();
    const opt = '<option value="Semua">Semua Kelas</option>' + kls.map(k => `<option>${esc(k)}</option>`).join('');
    ['fKelas', 'sKelas'].forEach(id => { const cur = $(id).value; $(id).innerHTML = opt; if ([...$(id).options].some(o => o.value === cur)) $(id).value = cur; });
    $('dlKelas').innerHTML = kls.map(k => `<option value="${esc(k)}">`).join('');
    renderSiswa();
    if ($('section-rekap').classList.contains('active') && rk.rows.length) { hitungRekap(); renderRekap(); }
    cb && cb();
  });
}
function renderSiswa() {
  const q = ($('sSearch').value || '').trim().toLowerCase(), k = $('sKelas').value, st = $('sStatus').value;
  const a = siswa.filter(s => (!q || (s.nama + ' ' + s.nis + ' ' + s.nisn).toLowerCase().includes(q)) && (k === 'Semua' || s.kelas === k) && (st === 'Semua' || s.status === st));
  const n = siswa.filter(isAktif).length;
  $('stTotal').textContent = siswa.length; $('stAktif').textContent = n; $('stNon').textContent = siswa.length - n;
  $('siswaBody').innerHTML = a.length ? a.map((s, i) => {
    const on = isAktif(s), nis = esc(s.nis);
    return `<tr><td class="text-muted">${i + 1}</td>
      <td><div class="d-flex align-items-center gap-3"><span class="sis-ava" data-nis="${nis}"><i class="bi bi-person-fill"></i></span><b>${esc(s.nama)}</b></div></td>
      <td><b>${nis}</b><div class="small text-muted">NISN: ${esc(s.nisn || '-')}</div></td>
      <td><span class="chip">${esc(s.kelas)}</span> <span class="chip chip-${s.jk === 'P' ? 'p' : 'l'}">${esc(s.jk)}</span>${waliDari(s.kelas) ? `<div class="small text-muted mt-1">Wali: ${esc(waliDari(s.kelas).nama)}</div>` : ''}${guruWaliDari(s.nis) ? `<div class="small text-muted">Guru Wali: ${esc(guruWaliDari(s.nis).nama)}</div>` : ''}</td>
      <td>${s.hp ? `<a class="wa-link" href="https://wa.me/${waNum(s.hp)}" target="_blank" rel="noopener"><i class="bi bi-whatsapp"></i> ${esc(s.hp)}</a> <button class="ico-btn2 ms-1" style="width:30px;height:30px" data-act="wa" data-nis="${nis}" title="Ubah No. WA" aria-label="Ubah No. WA"><i class="bi bi-pencil"></i></button>`
        : `<button class="btn btn-soft btn-sm" data-act="wa" data-nis="${nis}"><i class="bi bi-whatsapp text-success"></i> Isi No. WA</button>`}</td>
      <td><span class="st-pill ${on ? 'on' : 'off'}"><i class="bi bi-${on ? 'check-circle-fill' : 'dash-circle-fill'}"></i> ${on ? 'Aktif' : 'Nonaktif'}</span></td>
      <td class="text-end text-nowrap"><button class="btn btn-soft btn-sm" data-act="kartu" data-nis="${nis}"><i class="bi bi-person-vcard"></i> Kartu</button>
        <button class="ico-btn2" data-act="edit" data-nis="${nis}" title="Ubah data" aria-label="Ubah data"><i class="bi bi-pencil"></i></button>
        <button class="ico-btn2" data-act="status" data-nis="${nis}" title="${on ? 'Nonaktifkan' : 'Aktifkan'}" aria-label="${on ? 'Nonaktifkan' : 'Aktifkan'}"><i class="bi bi-${on ? 'pause-fill' : 'play-fill'}"></i></button>
        ${isAdmin() ? `<button class="ico-btn2 del" data-act="hapus" data-nis="${nis}" title="Hapus" aria-label="Hapus"><i class="bi bi-trash3"></i></button>` : ''}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="text-center text-muted py-4">Tidak ada data siswa.</td></tr>';
  pasangFoto();
  document.querySelectorAll('.sis-ava[data-nis]').forEach(el => { if (!(el.dataset.nis in fotoCache) && fotoIO) fotoIO.observe(el); });
  if (!fotoIO) muatFoto([...document.querySelectorAll('.sis-ava[data-nis]')].slice(0, 60).map(e => e.dataset.nis));
}
// -- Foto: dimuat bertahap (8 siswa per panggilan) lalu disimpan di memori
function pasangFoto() {
  document.querySelectorAll('.sis-ava[data-nis]').forEach(el => {
    const f = fotoCache[el.dataset.nis];
    if (f && !el.querySelector('img')) { const im = new Image(); im.alt = ''; im.src = f; el.textContent = ''; el.appendChild(im); }
  });
}
// Foto dimuat malas: hanya baris yang terlihat, 20 per panggilan, 3 panggilan paralel, cache IndexedDB
const fotoQ = new Set(); let fotoT = null;
const fotoIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => {
  es.forEach(e => { if (!e.isIntersecting) return; fotoIO.unobserve(e.target); const n = e.target.dataset.nis; if (n && !(n in fotoCache)) fotoQ.add(n); });
  if (fotoQ.size) { clearTimeout(fotoT); fotoT = setTimeout(() => { const l = [...fotoQ]; fotoQ.clear(); muatFoto(l); }, 120); }
}, { rootMargin: '300px' }) : null;
function muatFoto(list, cb) {
  const perlu = list.filter(n => !(n in fotoCache));
  idbMany(perlu).then(hit => {
    Object.keys(hit).forEach(n => { fotoCache[n] = hit[n]; });
    const sisa = perlu.filter(n => !(n in fotoCache)), chunks = [];
    for (let i = 0; i < sisa.length; i += 20) chunks.push(sisa.slice(i, i + 20));
    pasangFoto();
    if (!chunks.length) return cb && cb();
    let idx = 0, aktif = 0, selesai = false;
    const fin = () => { if (!selesai && idx >= chunks.length && !aktif) { selesai = true; cb && cb(); } };
    const pump = () => {
      while (aktif < 3 && idx < chunks.length) {
        const c = chunks[idx++]; aktif++;
        api('getFotoBatch', [{ list: c }], r => {
          const put = {};
          c.forEach(n => { const f = r.success && r.data ? String(r.data[n] || '') : ''; fotoCache[n] = f.startsWith('data:image/') ? f : ''; put[n] = fotoCache[n]; });
          if (r.success) idbPut(put);
          aktif--; pasangFoto(); pump(); fin();
        }, false, () => { aktif--; pump(); fin(); });
      }
    };
    pump();
  });
}
$('siswaBody').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const s = siswa.find(x => x.nis === b.dataset.nis); if (!s) return;
  if (b.dataset.act === 'kartu') bukaKartu(s);
  if (b.dataset.act === 'edit') bukaForm(s);
  if (b.dataset.act === 'wa') bukaWa(s);
  if (b.dataset.act === 'status') {
    const baru = isAktif(s) ? 'Nonaktif' : 'Aktif', lama = s.status;
    s.status = baru; renderSiswa(); toast('Status siswa diubah menjadi ' + baru + '.', 'success');   // instan, sinkron di latar belakang
    api('ubahStatusSiswa', [{ nis: s.nis, status: baru }], r => { if (!r.success) { s.status = lama; renderSiswa(); toast(r.message, 'danger'); } }, false, () => { s.status = lama; renderSiswa(); });
  }
  if (b.dataset.act === 'hapus') { hapusFn = () => { const bak = siswa.slice(); siswa = siswa.filter(x => x.nis !== s.nis); bootstrap.Modal.getInstance($('mdlHapus')).hide(); renderSiswa(); toast('Data siswa dihapus.', 'success'); api('hapusSiswa', [s.nis], r => { if (!r.success) { siswa = bak; renderSiswa(); toast(r.message, 'danger'); } }, false, () => { siswa = bak; renderSiswa(); }); }; $('hapusTeks').textContent = `Hapus siswa ${s.nama} (NIS ${s.nis})?`; bootstrap.Modal.getOrCreateInstance($('mdlHapus')).show(); }
});
function done(r) { bootstrap.Modal.getInstance($('mdlHapus')).hide(); toast(r.message, r.success ? 'success' : 'danger'); }
$('btnHapusOk').onclick = () => hapusFn && hapusFn();

// -- Form tambah / ubah
function setFoto(src, mode) {
  fotoB64 = src || ''; fotoMode = mode;
  const box = $('fPrevBox'); box.textContent = '';
  if (src) { const im = new Image(); im.alt = 'Pas foto'; im.src = src; box.appendChild(im); }
  else box.innerHTML = '<i class="bi bi-person-bounding-box"></i><small>Pas Foto</small>';
}
function bukaForm(s) {
  sisEdit = s ? s.nis : null;
  $('formSiswa').reset(); $('formSiswa').classList.remove('was-validated');
  $('sisFormTitle').textContent = s ? 'Ubah Data Siswa' : 'Tambah Siswa Baru';
  $('fNis').readOnly = !!s;
  if (s) { $('fNis').value = s.nis; $('fNisn').value = s.nisn; $('fNama').value = s.nama; $('fTempat').value = s.tempat; $('fTgl2').value = s.tglLahir; $('fJk').value = s.jk; $('fKls').value = s.kelas; $('fHp').value = s.hp; $('fStatus').value = s.status; }
  setFoto('', 'keep');
  if (s) {
    if (fotoCache[s.nis]) setFoto(fotoCache[s.nis], 'keep');
    else api('getFotoSiswa', [s.nis], r => {
      const f = r.success ? String(r.data || '') : ''; fotoCache[s.nis] = f.startsWith('data:image/') ? f : '';
      if (sisEdit === s.nis && fotoMode === 'keep' && fotoCache[s.nis]) setFoto(fotoCache[s.nis], 'keep');
    }, false);
  }
  bootstrap.Modal.getOrCreateInstance($('mdlSiswa')).show();
}
function prosesFoto(f, cb) {   // potong ke rasio 3x4, kecilkan, kompres agar muat di sel Sheets
  if (!f) return;
  const rd = new FileReader();
  rd.onload = ev => {
    const img = new Image();
    img.onerror = () => toast('File bukan gambar yang valid.', 'danger');
    img.onload = () => {
      const W = 240, H = 320, c = document.createElement('canvas'); c.width = W; c.height = H;
      const sr = 3 / 4, ir = img.width / img.height; let sw, sh, sx, sy;
      if (ir > sr) { sh = img.height; sw = sh * sr; sx = (img.width - sw) / 2; sy = 0; } else { sw = img.width; sh = sw / sr; sx = 0; sy = (img.height - sh) / 4; }
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
      let q = .75, d = c.toDataURL('image/jpeg', q);
      while (d.length > 44000 && q > .3) { q -= .1; d = c.toDataURL('image/jpeg', q); }
      (cb || (x => setFoto(x, 'ganti')))(d);
    };
    img.src = ev.target.result;
  };
  rd.readAsDataURL(f);
}
$('btnTambah').onclick = () => bukaForm(null);
$('btnAmbil').onclick = () => $('fFotoCam').click();
$('btnPilih').onclick = () => $('fFotoFile').click();
$('btnHapusFoto').onclick = () => setFoto('', sisEdit ? 'hapus' : 'keep');
['fFotoCam', 'fFotoFile'].forEach(id => { $(id).onchange = e => { prosesFoto(e.target.files[0]); e.target.value = ''; }; });
$('formSiswa').onsubmit = e => {
  e.preventDefault(); $('formSiswa').classList.add('was-validated');
  if (!$('formSiswa').checkValidity()) return;
  const d = { nis: $('fNis').value.trim(), nisn: $('fNisn').value.trim(), nama: $('fNama').value.trim(), tempat: $('fTempat').value.trim(), tglLahir: $('fTgl2').value,
    jk: $('fJk').value, kelas: $('fKls').value.trim(), hp: $('fHp').value.trim(), status: $('fStatus').value };
  if (sisEdit) { d.fotoMode = fotoMode; if (fotoMode === 'ganti') d.foto = fotoB64; } else d.foto = fotoMode === 'ganti' ? fotoB64 : '';
  api(sisEdit ? 'ubahSiswa' : 'simpanSiswa', [d], r => {
    toast(r.message, r.success ? 'success' : 'danger');
    if (r.success) { delete fotoCache[d.nis]; idbDel(d.nis); bootstrap.Modal.getInstance($('mdlSiswa')).hide(); loadSiswa(); }
  });
};

// -- Isi cepat No. WA orang tua / wali (langsung dari tabel)
let waSiswa = null;
function bukaWa(s) {
  waSiswa = s; $('waNama').innerHTML = `<b>${esc(s.nama)}</b> &middot; Kelas ${esc(s.kelas)} &middot; NIS ${esc(s.nis)}`;
  $('waInput').value = s.hp || ''; $('waErr').classList.add('d-none');
  bootstrap.Modal.getOrCreateInstance($('mdlWa')).show();
}
function simpanWa() {
  const s = waSiswa; if (!s) return;
  const hp = $('waInput').value.trim().replace(/[^\d+]/g, '');
  if (hp && !/^\+?\d{8,15}$/.test(hp)) return $('waErr').classList.remove('d-none');
  $('waErr').classList.add('d-none');
  api('ubahSiswa', [{ nis: s.nis, nisn: s.nisn, nama: s.nama, tempat: s.tempat, tglLahir: s.tglLahir, jk: s.jk, kelas: s.kelas, status: s.status, hp, fotoMode: 'keep' }], r => {
    toast(r.message, r.success ? 'success' : 'danger');
    if (r.success) { bootstrap.Modal.getInstance($('mdlWa')).hide(); loadSiswa(); }
  });
}

// -- Kartu pelajar
function kartuHTML(s, foto) {
  const ttl = [s.tempat, s.tglLahir ? fmtTgl(s.tglLahir) : ''].filter(Boolean).join(', ') || '-';
  const row = (l, v) => `<tr><td>${l}</td><td>:</td><td>${v}</td></tr>`;
  return `<div class="idc"><div class="idc-head"><img src="${esc(SEKOLAH.logo)}" crossorigin="anonymous" alt="">
    <div><div class="idc-pem">${esc(SEKOLAH.pemda)}<br>${esc(SEKOLAH.dinas)}</div><div class="idc-sch">${esc(SEKOLAH.nama)}</div>${SEKOLAH.alamat ? `<div class="idc-adr">${esc(SEKOLAH.alamat)}</div>` : ''}</div></div>
    <div class="idc-line"></div>
    <div class="idc-body"><div class="idc-top">
      <div class="idc-foto">${foto ? `<img src="${foto}" alt="">` : '<i class="bi bi-person-fill"></i><b>Pas Foto</b><small>3&times;4</small>'}</div>
      <div class="idc-qrwrap"><div class="idc-qr" data-qr="${esc(s.nis)}"></div><div class="idc-qrl"><i class="bi bi-qr-code"></i> QR Presensi</div></div></div>
      <table class="idc-info">${row('Nama', `<b>${esc(String(s.nama).toUpperCase())}</b>`)}${row('NIS / NISN', `<b>${esc(s.nis)}${s.nisn ? ' / ' + esc(s.nisn) : ''}</b>`)}${row('Jenis Kelamin', `<b>${s.jk === 'P' ? 'Perempuan' : 'Laki-laki'}</b>`)}${row('TTL', `<b>${esc(ttl)}</b>`)}${row('Kelas', `<b>${esc(s.kelas)}</b>`)}${row('No. HP Ortu', s.hp ? `<i class="bi bi-whatsapp" style="color:#22c55e"></i> ${esc(s.hp)}` : '-')}</table></div>
    <div class="idc-foot">Kartu identitas resmi siswa ${esc(SEKOLAH.nama)}.<br>Harap bawa kartu ini setiap hari untuk presensi.</div></div>`;
}
function isiQR(root) {
  root.querySelectorAll('[data-qr]').forEach(el => { el.innerHTML = ''; new QRCode(el, { text: el.dataset.qr, width: 110, height: 110, correctLevel: QRCode.CorrectLevel.H }); });
}
function renderKartu() {
  if (!kartuSiswa) return;
  $('kartuWrap').innerHTML = kartuHTML(kartuSiswa, fotoCache[kartuSiswa.nis] || '');
  $('kartuWrap').firstElementChild.id = 'kartu'; isiQR($('kartuWrap'));
}
function bukaKartu(s) {
  kartuSiswa = s; renderKartu();
  bootstrap.Modal.getOrCreateInstance($('mdlKartu')).show();
  if (!(s.nis in fotoCache)) api('getFotoSiswa', [s.nis], r => {
    const f = r.success ? String(r.data || '') : ''; fotoCache[s.nis] = f.startsWith('data:image/') ? f : '';
    if (kartuSiswa === s) renderKartu();
  }, false);
}
$('btnPng').onclick = () => {
  if (!kartuSiswa) return;
  if (!window.html2canvas) return toast('Fitur unduh belum siap. Muat ulang halaman.', 'danger');
  spin(1);   // salinan ukuran asli (54 x 85,6 mm) agar PNG tajam & tidak terpengaruh zoom pratinjau
  const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-9999px;top:0';
  box.innerHTML = kartuHTML(kartuSiswa, fotoCache[kartuSiswa.nis] || ''); document.body.appendChild(box); isiQR(box);
  setTimeout(() => html2canvas(box.firstElementChild, { scale: 4, useCORS: true, backgroundColor: null }).then(c => { const a = document.createElement('a'); a.download = 'Kartu-' + kartuSiswa.nis + '.png'; a.href = c.toDataURL('image/png'); a.click(); })
    .catch(() => toast('Gagal membuat gambar kartu.', 'danger')).finally(() => { box.remove(); spin(0); }), 150);
};
$('btnWa').onclick = () => {
  const s = kartuSiswa; if (!s) return;
  if (!s.hp) return toast('No. HP orang tua belum diisi. Ubah data siswa terlebih dahulu.', 'warning');
  const msg = `Yth. Orang Tua/Wali dari ${s.nama} (Kelas ${s.kelas}),\n\nBerikut kartu pelajar ${SEKOLAH.nama} atas nama ${s.nama} (NIS ${s.nis}). Mohon kartu dibawa setiap hari untuk presensi.\n\nTerima kasih.`;
  window.open('https://wa.me/' + waNum(s.hp) + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  toast('Unduh gambar kartu (PNG) lalu lampirkan di chat WhatsApp.', 'primary');
};
// -- Cetak kartu satu kelas
function infoCetak() { $('cInfo').textContent = siswa.filter(s => isAktif(s) && s.kelas === $('cKelas').value).length + ' kartu siswa aktif akan dicetak.'; }
$('btnCetakKelas').onclick = () => {
  const ks = [...new Set(siswa.filter(isAktif).map(s => s.kelas))].sort();
  if (!ks.length) return toast('Belum ada siswa aktif.', 'warning');
  $('cKelas').innerHTML = ks.map(k => `<option>${esc(k)}</option>`).join('');
  if (ks.includes($('sKelas').value)) $('cKelas').value = $('sKelas').value;
  infoCetak(); bootstrap.Modal.getOrCreateInstance($('mdlCetakKelas')).show();
};
$('cKelas').onchange = infoCetak;
$('btnCetakGo').onclick = () => {
  const list = siswa.filter(s => isAktif(s) && s.kelas === $('cKelas').value);
  bootstrap.Modal.getInstance($('mdlCetakKelas')).hide(); spin(1);
  muatFoto(list.map(s => s.nis), () => {
    $('printArea').innerHTML = list.map(s => kartuHTML(s, fotoCache[s.nis] || '')).join(''); isiQR($('printArea'));
    spin(0); setTimeout(() => cetak('kelas'), 500);
  });
};
function cetak(mode) {
  document.body.classList.add('print-' + mode); window.print(); document.body.classList.remove('print-' + mode);
}

// ===== DATA GURU (foto, jabatan, wali kelas, guru wali) =====
let guru = [], guruEdit = null, gFotoB64 = '', gFotoMode = 'keep';
const fotoGuru = {};                                                         // id -> dataURL ('' = tanpa foto)
const isWali = g => g.waliKelas === 'Ya';
const guruWaliDari = nis => guru.find(g => g.guruWali === 'Ya' && (g.siswaWali || []).includes(String(nis)));
const waliDari = k => guru.find(g => isWali(g) && String(g.kelasWali).toLowerCase() === String(k || '').toLowerCase());
const chipsPeran = g => [isWali(g) ? `<span class="chip chip-wk">Wali Kelas ${esc(g.kelasWali)}</span>` : '', g.guruWali === 'Ya' ? '<span class="chip chip-gw">Guru Wali' + ((g.siswaWali || []).length ? ' · ' + g.siswaWali.length + ' siswa' : '') + '</span>' : ''].filter(Boolean).join(' ') || '<span class="text-muted">-</span>';

function loadGuru(cb) {
  swr('getGuru', [], 'guru', r => {
    if (!r.success) { renderGuru(); return toast(/Action tidak dikenal/.test(r.message) ? 'Backend belum diperbarui. Tempel Kode.gs terbaru di Apps Script, lalu Deploy > Manage deployments > Edit > New version.' : r.message, 'danger'); }
    guru = r.data; renderGuru(); renderSiswa(); muatFotoGuru(guru.map(g => g.id)); cb && cb();
  }, false);
}
function renderGuru() {
  $('btnTambahGuru').classList.toggle('d-none', !isAdmin());
  $('gStTotal').textContent = guru.length; $('gStWk').textContent = guru.filter(isWali).length; $('gStGw').textContent = guru.filter(g => g.guruWali === 'Ya').length;
  const q = ($('gCari').value || '').trim().toLowerCase(), pr = $('gPeran').value;
  const a = guru.filter(g => (!q || (g.nama + ' ' + g.nip + ' ' + g.jabatan).toLowerCase().includes(q)) &&
    (pr === 'Semua' || (pr === 'Wali Kelas' && isWali(g)) || (pr === 'Guru Wali' && g.guruWali === 'Ya') || (pr === 'Lainnya' && !isWali(g) && g.guruWali !== 'Ya')));
  $('guruBody').innerHTML = a.length ? a.map((g, i) => {
    const id = esc(g.id);
    return `<tr><td class="text-muted">${i + 1}</td>
      <td><div class="d-flex align-items-center gap-3"><span class="sis-ava" data-gid="${id}"><i class="bi bi-person-fill"></i></span><b>${esc(g.nama)}</b></div></td>
      <td>${g.nip ? esc(g.nip) : '<span class="text-muted">-</span>'}</td>
      <td>${g.jabatan ? esc(g.jabatan) : '<span class="text-muted">-</span>'}</td>
      <td>${chipsPeran(g)}</td>
      <td>${g.hp ? `<a class="wa-link" href="https://wa.me/${waNum(g.hp)}" target="_blank" rel="noopener"><i class="bi bi-whatsapp"></i> ${esc(g.hp)}</a>` : '<span class="text-muted">-</span>'}</td>
      <td class="text-end text-nowrap">${isAdmin() ? `<button class="ico-btn2" data-act="edit" data-id="${id}" title="Ubah data" aria-label="Ubah data"><i class="bi bi-pencil"></i></button>
        <button class="ico-btn2 del" data-act="hapus" data-id="${id}" title="Hapus" aria-label="Hapus"><i class="bi bi-trash3"></i></button>` : '<span class="text-muted">-</span>'}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="text-center text-muted py-4">Belum ada data guru yang cocok.</td></tr>';
  pasangFotoGuru();
}
function pasangFotoGuru() {
  document.querySelectorAll('.sis-ava[data-gid]').forEach(el => {
    const f = fotoGuru[el.dataset.gid];
    if (f && !el.querySelector('img')) { const im = new Image(); im.alt = ''; im.src = f; el.textContent = ''; el.appendChild(im); }
  });
}
function muatFotoGuru(ids) {
  const perlu = ids.filter(n => !(n in fotoGuru)), chunks = [];
  for (let i = 0; i < perlu.length; i += 8) chunks.push(perlu.slice(i, i + 8));
  let i = 0;
  (function next() {
    if (i >= chunks.length) return;
    const c = chunks[i++];
    api('getFotoGuruBatch', [{ list: c }], r => {
      c.forEach(n => { const f = r.success && r.data ? String(r.data[n] || '') : ''; fotoGuru[n] = f.startsWith('data:image/') ? f : ''; });
      pasangFotoGuru(); next();
    }, false);
  })();
}
function setGFoto(src, mode) {
  gFotoB64 = src || ''; gFotoMode = mode;
  const box = $('gPrevBox'); box.textContent = '';
  if (src) { const im = new Image(); im.alt = 'Foto guru'; im.src = src; box.appendChild(im); }
  else box.innerHTML = '<i class="bi bi-person-bounding-box"></i><small>Foto</small>';
}
function bukaGuru(g) {
  guruEdit = g ? g.id : null;
  $('formGuru').reset(); $('formGuru').classList.remove('was-validated');
  $('guruFormTitle').textContent = g ? 'Ubah Data Guru' : 'Tambah Guru Baru';
  if (g) { $('gNama').value = g.nama; $('gNip').value = g.nip; $('gHp').value = g.hp; $('gJabatan').value = g.jabatan; $('gWali').value = g.waliKelas; $('gKelas').value = g.kelasWali; $('gGuruWali').value = g.guruWali; }
  gSel = new Set(g ? (g.siswaWali || []) : []); $('gSiswaCari').value = ''; tglKelasWali(); tglGuruWali(); setGFoto('', 'keep');
  if (g) {
    if (fotoGuru[g.id]) setGFoto(fotoGuru[g.id], 'keep');
    else api('getFotoGuruBatch', [{ list: [g.id] }], r => {
      const f = r.success && r.data ? String(r.data[g.id] || '') : ''; fotoGuru[g.id] = f.startsWith('data:image/') ? f : '';
      if (guruEdit === g.id && gFotoMode === 'keep' && fotoGuru[g.id]) setGFoto(fotoGuru[g.id], 'keep');
    }, false);
  }
  bootstrap.Modal.getOrCreateInstance($('mdlGuru')).show();
}
function tglKelasWali() { const on = $('gWali').value === 'Ya'; $('gKelasBox').classList.toggle('d-none', !on); $('gKelas').required = on; }
let gSel = new Set();
function tglGuruWali() {
  const on = $('gGuruWali').value === 'Ya'; $('gSiswaBox').classList.toggle('d-none', !on);
  if (!on) return;
  const ks = [...new Set(siswa.filter(isAktif).map(s => s.kelas))].sort(urutKelas);
  $('gSiswaKelas').innerHTML = '<option value="Semua">Semua Kelas</option>' + ks.map(k => `<option>${esc(k)}</option>`).join('');
  renderPilihSiswa();
}
function renderPilihSiswa() {
  const q = ($('gSiswaCari').value || '').trim().toLowerCase(), k = $('gSiswaKelas').value, ambil = {};
  guru.forEach(g => { if (g.id !== guruEdit && g.guruWali === 'Ya') (g.siswaWali || []).forEach(n => { ambil[n] = g.nama; }); });
  const a = siswa.filter(s => (isAktif(s) || gSel.has(s.nis)) && (k === 'Semua' || s.kelas === k) && (!q || (s.nama + ' ' + s.nis).toLowerCase().includes(q)));
  $('gSiswaList').innerHTML = a.length ? a.map(s => { const x = ambil[s.nis];
    return `<label class="pilih-row${x ? ' taken' : ''}"><input type="checkbox" class="form-check-input mt-0" value="${esc(s.nis)}" ${gSel.has(s.nis) ? 'checked' : ''} ${x ? 'disabled' : ''}><span><b>${esc(s.nama)}</b><small>${esc(s.kelas)} &middot; NIS ${esc(s.nis)}${x ? ' &middot; sudah diwalikan ' + esc(x) : ''}</small></span></label>`; }).join('')
    : '<div class="text-muted small p-3">Tidak ada siswa yang cocok.</div>';
  $('gSiswaCount').textContent = gSel.size + ' siswa dipilih';
}
function initGuru() {
  $('gGuruWali').onchange = tglGuruWali; $('gSiswaCari').oninput = renderPilihSiswa; $('gSiswaKelas').onchange = renderPilihSiswa;
  $('gSiswaList').onchange = e => { const c = e.target; if (c.type !== 'checkbox') return; c.checked ? gSel.add(c.value) : gSel.delete(c.value); $('gSiswaCount').textContent = gSel.size + ' siswa dipilih'; };
  $('gSiswaSemua').onclick = () => {
    const cb = [...$('gSiswaList').querySelectorAll('input:not(:disabled)')], semua = cb.length && cb.every(c => c.checked);
    cb.forEach(c => { c.checked = !semua; semua ? gSel.delete(c.value) : gSel.add(c.value); }); $('gSiswaCount').textContent = gSel.size + ' siswa dipilih';
  };
  $('gCari').oninput = renderGuru; $('gPeran').onchange = renderGuru; $('gWali').onchange = tglKelasWali;
  $('btnTambahGuru').onclick = () => bukaGuru(null);
  $('gBtnAmbil').onclick = () => $('gFotoCam').click(); $('gBtnPilih').onclick = () => $('gFotoFile').click();
  $('gBtnHapusFoto').onclick = () => setGFoto('', guruEdit ? 'hapus' : 'keep');
  ['gFotoCam', 'gFotoFile'].forEach(id => { $(id).onchange = e => { prosesFoto(e.target.files[0], d => setGFoto(d, 'ganti')); e.target.value = ''; }; });
  $('guruBody').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const g = guru.find(x => x.id === b.dataset.id); if (!g) return;
    if (b.dataset.act === 'edit') bukaGuru(g);
    if (b.dataset.act === 'hapus') { hapusFn = () => api('hapusGuru', [{ id: g.id }], r => { done(r); if (r.success) loadGuru(); }); $('hapusTeks').textContent = `Hapus data guru ${g.nama}?`; bootstrap.Modal.getOrCreateInstance($('mdlHapus')).show(); }
  });
  $('formGuru').onsubmit = e => {
    e.preventDefault(); $('formGuru').classList.add('was-validated');
    if (!$('formGuru').checkValidity()) return;
    if ($('gGuruWali').value === 'Ya' && !gSel.size) return toast('Guru Wali wajib memilih minimal satu siswa yang diwalikan.', 'warning');
    const d = { id: guruEdit || '', nama: $('gNama').value.trim(), nip: $('gNip').value.trim(), hp: $('gHp').value.trim(), jabatan: $('gJabatan').value.trim(),
      waliKelas: $('gWali').value, kelasWali: $('gWali').value === 'Ya' ? $('gKelas').value.trim() : '', guruWali: $('gGuruWali').value, siswaWali: $('gGuruWali').value === 'Ya' ? [...gSel] : [] };
    if (guruEdit) { d.fotoMode = gFotoMode; if (gFotoMode === 'ganti') d.foto = gFotoB64; } else d.foto = gFotoMode === 'ganti' ? gFotoB64 : '';
    api('simpanGuru', [d], r => {
      toast(r.message, r.success ? 'success' : 'danger');
      if (r.success) { if (guruEdit) delete fotoGuru[guruEdit]; bootstrap.Modal.getInstance($('mdlGuru')).hide(); loadGuru(); }
    });
  };
  $('btnWaSimpan').onclick = simpanWa;
}

// ===== SCANNER =====
function camUI(on) {
  $('reader').style.display = on ? 'block' : 'none'; $('camOverlay').style.display = on ? 'none' : 'block';
  $('btnCamOn').classList.toggle('d-none', on); $('btnCamOff').classList.toggle('d-none', !on);
}
function startScan() {
  camUI(true); qr = qr || new Html5Qrcode('reader'); if (qr.isScanning) return;
  const cfg = { fps: 10, qrbox: (w, h) => { const m = Math.floor(Math.min(w, h) * 0.7); return { width: m, height: m }; } };
  qr.start({ facingMode: 'environment' }, cfg, onScan, () => {})
    .catch(() => qr.start({ facingMode: 'user' }, cfg, onScan, () => {}))
    .catch(e => { toast('Kamera gagal: ' + (e.message || e) + '. Gunakan upload foto QR.', 'danger'); stopScan(); });
}
function stopScan() { camUI(false); return qr && qr.isScanning ? qr.stop().catch(() => {}) : Promise.resolve(); }
function hasil(html, cls = '') { $('scanResult').className = 'card p-3 text-center ' + cls; $('scanResult').innerHTML = html; }
function resetHasil() { scanBusy = false; hasil('Menunggu scan...', 'text-muted'); }
const sudahScan = new Set();
function onScan(text) {
  if (scanBusy) return; scanBusy = true;
  const jenis = $('jenis').value, ket = jenis === 'Mata Pelajaran' ? $('mapel').value.trim() : '';
  if (jenis === 'Mata Pelajaran' && !ket) { toast('Harap isi nama mata pelajaran!', 'danger'); scanBusy = false; return; }
  const nis = String(text).trim(), s = siswa.find(x => x.nis === nis), gagal = m => { hasil(`<h4 class="text-danger">❌ Gagal</h4>${esc(m)}`); toast(m, 'danger'); setTimeout(resetHasil, 1800); };
  if (siswa.length && !s) return gagal('QR Code tidak dikenali (NIS: ' + nis + ')');          // dicek lokal, tanpa menunggu server
  if (s && s.status === 'Nonaktif') return gagal('Siswa ' + s.nama + ' berstatus Nonaktif.');
  const kunci = today() + '|' + jenis + '|' + nis + '|' + ket;
  if (sudahScan.has(kunci)) return gagal((s ? s.nama : nis) + ' sudah diabsen (' + jenis + ') hari ini.');
  sudahScan.add(kunci);
  hasil(`<h4 class="text-primary">⏳ Menyimpan...</h4><b>${esc(s ? s.nama : nis)}</b>${s ? ' (' + esc(s.kelas) + ')' : ''}`);
  setTimeout(() => { scanBusy = false; }, 1200);   // siap memindai siswa berikutnya tanpa menunggu server
  api('simpanAbsensi', [text, 'Hadir', ket, jenis], r => {
    if (r.success) { hasil(`<h4 class="text-success">✅ Berhasil</h4><b>${esc(r.data.nama)}</b> (${esc(r.data.kelas)})<br><span class="badge text-bg-${badge(r.data.status)}">${esc(r.data.status)}</span>`); toast(r.message, 'success'); if (r.data.wa) kirimWA(nis, jenis); }
    else { sudahScan.delete(kunci); hasil(`<h4 class="text-danger">❌ Gagal</h4>${esc(r.message)}`); toast(r.message, 'danger'); }
    setTimeout(resetHasil, 2500);
  }, false, () => { sudahScan.delete(kunci); hasil('<h4 class="text-danger">❌ Gagal terhubung</h4>Silakan scan ulang.'); setTimeout(resetHasil, 2500); });
}
$('qrFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return; hasil('Membaca gambar...');
  stopScan().then(() => { qr = qr || new Html5Qrcode('reader'); return qr.scanFile(f, true); })
    .then(onScan).catch(() => { hasil('<h4 class="text-danger">❌ Gagal Membaca</h4>QR Code tidak ditemukan pada foto. Coba foto lain.'); setTimeout(resetHasil, 3000); })
    .finally(() => { $('qrFile').value = ''; });
};
$('jenis').onchange = () => $('mapel').classList.toggle('d-none', $('jenis').value !== 'Mata Pelajaran');
// -- WhatsApp otomatis & absen susulan
function kirimWA(nis, jenis) { api('kirimNotifAbsen', [{ nis, jenis }], r => { if (!r.success) toast(r.message, 'danger'); }, false, () => {}); }
function kirimBertahap(list, jenis, iso, i = 0) {
  if (i >= list.length) return toast('Notifikasi WhatsApp selesai dikirim.', 'success');
  toast('Mengirim WhatsApp ' + Math.min(i + 8, list.length) + ' / ' + list.length + '...', 'primary');
  const lanjut = () => kirimBertahap(list, jenis, iso, i + 8);
  api('kirimNotifAbsen', [{ list: list.slice(i, i + 8), jenis, tanggal: iso }], x => { if (!x.success) toast(x.message, 'danger'); lanjut(); }, false, lanjut);
}
function muatSusulan() {
  const iso = $('sTgl').value || today(), [thn, bln] = iso.split('-'), jenis = $('sJenis').value;
  swr('getRekapBulan', [{ bln, thn }], 'rk_' + thn + '-' + bln, r => {
    if (!r.success) return toast(r.message, 'danger');
    const d = iso.slice(8), ada = {}, opts = jenis === 'Pulang' ? ['Hadir'] : ['Hadir', 'Terlambat', 'Sakit', 'Izin', 'Alpa'];
    r.data.rows.forEach(x => { if (x[0] === d && x[7] === jenis) ada[x[2]] = x[5] + ' ' + String(x[1]).slice(0, 5); });
    const list = siswa.filter(s => isAktif(s) && s.kelas === $('sKls').value).sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));
    $('sBody').innerHTML = list.map((s, i) => ada[s.nis]
      ? `<tr class="table-secondary"><td>${i + 1}</td><td>${esc(s.nama)}</td><td colspan="2"><span class="badge text-bg-secondary">Sudah tercatat: ${esc(ada[s.nis])}</span></td></tr>`
      : `<tr data-nis="${esc(s.nis)}"><td>${i + 1}</td><td>${esc(s.nama)}</td><td><select class="form-select form-select-sm s-st"><option value="">&mdash; lewati &mdash;</option>${opts.map(o => `<option>${o}</option>`).join('')}</select></td><td><input type="time" class="form-control form-control-sm s-jam" style="width:112px"></td></tr>`).join('') || empty(4);
    hitungSusulan();
  });
}
function hitungSusulan() { $('sInfo').textContent = [...$('sBody').querySelectorAll('.s-st')].filter(x => x.value).length + ' siswa akan disimpan'; }
$('btnSusulan').onclick = () => {
  const ks = [...new Set(siswa.filter(isAktif).map(s => s.kelas))].sort(urutKelas);
  if (!ks.length) return toast('Data siswa belum dimuat.', 'warning');
  $('sKls').innerHTML = ks.map(k => `<option>${esc(k)}</option>`).join(''); $('sTgl').max = today(); if (!$('sTgl').value) $('sTgl').value = today();
  bootstrap.Modal.getOrCreateInstance($('mdlSusulan')).show(); muatSusulan();
};
$('sTgl').onchange = $('sKls').onchange = muatSusulan;
$('sJenis').onchange = () => { $('sJam').value = $('sJenis').value === 'Pulang' ? '13:00' : '07:00'; muatSusulan(); };
$('sBody').onchange = hitungSusulan;
$('sSemuaHadir').onclick = () => { $('sBody').querySelectorAll('.s-st').forEach(x => { x.value = 'Hadir'; }); hitungSusulan(); };
$('sSimpan').onclick = () => {
  const items = [...$('sBody').querySelectorAll('tr[data-nis]')].map(tr => ({ nis: tr.dataset.nis, status: tr.querySelector('.s-st').value, jam: tr.querySelector('.s-jam').value })).filter(x => x.status);
  if (!items.length) return toast('Belum ada siswa yang ditandai.', 'warning');
  if (!$('sJam').value) return toast('Isi jam standar terlebih dahulu.', 'warning');
  const jenis = $('sJenis').value, iso = $('sTgl').value, wa = $('sWA').checked;
  api('simpanAbsensiSusulan', [{ tanggal: iso, jenis, jam: $('sJam').value, items }], r => {
    toast(r.message, r.success ? 'success' : 'danger'); if (!r.success) return;
    bootstrap.Modal.getInstance($('mdlSusulan')).hide();
    if (wa && r.data.wa && r.data.nis.length) kirimBertahap(r.data.nis, jenis, iso);
    else if (wa && !r.data.wa) toast('WhatsApp belum aktif. Isi token dan pilih "Ya" di Pengaturan.', 'warning');
  });
};
$('btnManual').onclick = () => {
  const nis = $('mNis').value, jenis = $('jenis').value; let ket = $('mKet').value.trim();
  if (!nis) return toast('Pilih siswa terlebih dahulu!', 'warning');
  if (jenis === 'Mata Pelajaran') {
    const m = $('mapel').value.trim(); if (!m) return toast('Isi nama mata pelajaran di atas!', 'warning');
    ket = ket ? m + ' - ' + ket : m;
  }
  api('simpanAbsensi', [nis, $('mStatus').value, ket, jenis], r => {
    toast(r.message, r.success ? 'success' : 'danger'); if (r.success) { $('mNis').value = ''; $('mKet').value = ''; if (r.data && r.data.wa) kirimWA(nis, jenis); }
  }, false);
};

// ===== REKAP PRESENSI (bulanan) =====
const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
let rk = { bln: '', thn: '', rows: [], batas: { biasa: 0, jumat: 0 }, jenis: 'Sekolah', agg: [], efektif: 0 };
const mntOf = t => { const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); };
const hhmmOf = m => { const t = Math.round(m); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
const hariTgl = d => { const dt = new Date(+rk.thn, +rk.bln - 1, +d); return HARI_ID[dt.getDay()] + ', ' + (+d) + ' ' + BLN[+rk.bln - 1] + ' ' + rk.thn; };
const periodeTeks = () => BLN[+rk.bln - 1] + ' ' + rk.thn;
const ketHari = h => { const st = String(h.status).toLowerCase(); return (st === 'hadir' || st === 'terlambat') ? (h.pen ? 'Dipindai: ' + h.pen : '-') : (h.ket || '-') + (h.pen ? ' (Dicatat: ' + h.pen + ')' : ''); };
const judulKapital = t => String(t).split(' ').map(w => w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()).join(' ');
const urutKelas = (a, b) => String(a).localeCompare(String(b), 'id', { numeric: true });

function loadRekap() {
  const v = $('rBulan').value || today().slice(0, 7), [thn, bln] = v.split('-');
  swr('getRekapBulan', [{ bln, thn }], 'rk_' + v, r => {
    if (!r.success) return toast(r.message, 'danger');
    rk.bln = bln; rk.thn = thn; rk.rows = r.data.rows; rk.batas = r.data.batas;
    hitungRekap(); renderRekap();
  });
}
function hitungRekap() {
  const per = {}, hariSet = new Set();
  const get = (nis, nama, kelas) => per[nis] || (per[nis] = { nis, nama, kelas, hadir: 0, telat: 0, izin: 0, sakit: 0, alpa: 0, dm: [], pm: [], hari: {} });
  rk.rows.forEach(([d, jam, nis, nama, kelas, status, ket, jenis, pen]) => {
    if (jenis === 'Mata Pelajaran') return;
    const p = get(String(nis), nama, kelas), h = p.hari[d] = p.hari[d] || { d: +d, status: '', masuk: '', pulang: '', telatMnt: 0, ket: '', pen: '' };
    if (jenis === 'Pulang') { h.pulang = String(jam).slice(0, 5); p.pm.push(mntOf(jam)); return; }
    const st = String(status).toLowerCase(); hariSet.add(d);
    h.status = status; h.masuk = String(jam).slice(0, 5); h.ket = ket || ''; h.pen = pen || '';
    if (st === 'hadir') { p.hadir++; p.dm.push(mntOf(jam)); }
    else if (st === 'terlambat') {
      p.telat++; p.dm.push(mntOf(jam));
      const b = new Date(+rk.thn, +rk.bln - 1, +d).getDay() === 5 ? rk.batas.jumat : rk.batas.biasa;
      h.telatMnt = Math.max(0, mntOf(jam) - b);
    } else if (st === 'izin') p.izin++; else if (st === 'sakit') p.sakit++; else if (st === 'alpa') p.alpa++;
  });
  rk.efektif = hariSet.size;
  const avg = a => a.length ? hhmmOf(a.reduce((x, y) => x + y, 0) / a.length) : '-';
  rk.agg = siswa.filter(s => isAktif(s) || per[s.nis]).map(s => {
    const p = per[s.nis] || get(s.nis, s.nama, s.kelas);
    return { ...p, nama: s.nama, kelas: s.kelas, nisn: s.nisn, hp: s.hp, days: Object.values(p.hari).sort((a, b) => a.d - b.d),
      pct: rk.efektif ? Math.round((p.hadir + p.telat) / rk.efektif * 100) : null, avgD: avg(p.dm), avgP: avg(p.pm) };
  }).sort((a, b) => urutKelas(a.kelas, b.kelas) || String(a.nama).localeCompare(String(b.nama)));
}
function rekapTampil() {
  const k = $('fKelas').value, q = ($('rSearch').value || '').trim().toLowerCase();
  return rk.agg.filter(a => (k === 'Semua' || a.kelas === k) && (!q || (a.nama + ' ' + a.nis + ' ' + a.nisn).toLowerCase().includes(q)));
}
function mapelRows() {
  const k = $('fKelas').value, q = ($('rSearch').value || '').trim().toLowerCase();
  return rk.rows.filter(r => r[7] === 'Mata Pelajaran' && (k === 'Semua' || String(r[4]) === k) && (!q || (r[3] + ' ' + r[2]).toLowerCase().includes(q)))
    .sort((a, b) => (b[0] + b[1]).localeCompare(a[0] + a[1]));
}
function renderRekap() {
  const st = r => `<span class="badge text-bg-${badge(r)}">${esc(r)}</span>`;
  if (rk.jenis === 'Mata Pelajaran') {
    const a = mapelRows();
    $('rInfo').textContent = a.length + ' data presensi mata pelajaran pada ' + periodeTeks();
    $('rekapHead').innerHTML = '<tr><th>Tanggal</th><th>Waktu</th><th>NIS</th><th>Nama</th><th>Kelas</th><th>Status</th><th>Mapel / Keterangan</th></tr>';
    $('rekapBody').innerHTML = a.length ? a.map(r => `<tr><td>${esc(r[0] + '/' + rk.bln + '/' + rk.thn)}</td><td>${esc(String(r[1]).slice(0, 5))}</td><td>${esc(r[2])}</td><td><b>${esc(r[3])}</b></td><td><span class="chip">${esc(r[4])}</span></td><td>${st(r[5])}</td><td>${esc(r[6] || '-')}</td></tr>`).join('')
      : '<tr><td colspan="7" class="text-center text-muted py-4">Belum ada data.</td></tr>';
    return;
  }
  const a = rekapTampil();
  $('rInfo').textContent = rk.efektif + ' hari efektif tercatat';
  $('rekapHead').innerHTML = '<tr><th>Nama Siswa</th><th>Kelas</th><th>Hadir</th><th>Telat</th><th>Izin</th><th>Sakit</th><th>Alpa</th><th>%</th><th>Rata&sup2; Datang</th><th>Rata&sup2; Pulang</th><th>Kirim WA Ortu</th><th>Detail</th></tr>';
  $('rekapBody').innerHTML = a.length ? a.map(x => `<tr><td><b>${esc(x.nama)}</b><div class="small text-muted">NIS: ${esc(x.nis)} &bull; NISN: ${esc(x.nisn || '-')}</div></td>
    <td><span class="chip">${esc(x.kelas)}</span></td><td class="rk-h">${x.hadir}</td><td class="rk-t">${x.telat}</td><td>${x.izin}</td><td>${x.sakit}</td><td class="${x.alpa ? 'rk-a' : ''}">${x.alpa}</td>
    <td><b>${x.pct === null ? '-' : x.pct + '%'}</b></td><td>${x.avgD}</td><td>${x.avgP}</td>
    <td><button class="btn btn-wa btn-sm" data-act="wa" data-nis="${esc(x.nis)}"><i class="bi bi-whatsapp"></i> Kirim WA</button></td>
    <td><button class="btn btn-soft btn-sm" data-act="det" data-nis="${esc(x.nis)}"><i class="bi bi-clock-history"></i> Jam</button></td></tr>`).join('')
    : '<tr><td colspan="12" class="text-center text-muted py-4">Tidak ada data siswa.</td></tr>';
}
function kirimWaRekap(a) {
  if (!a.hp) return toast('No. HP orang tua belum diisi. Ubah di menu Data Siswa.', 'warning');
  const msg = `Yth. Orang Tua/Wali dari ${a.nama} (Kelas ${a.kelas}),\n\nRekap presensi bulan ${periodeTeks()} (${rk.efektif} hari efektif):\n- Hadir: ${a.hadir}\n- Terlambat: ${a.telat}\n- Izin: ${a.izin}\n- Sakit: ${a.sakit}\n- Alpa: ${a.alpa}\nPersentase kehadiran: ${a.pct === null ? '-' : a.pct + '%'}\n\nTerima kasih.\n${SEKOLAH.nama}`;
  window.open('https://wa.me/' + waNum(a.hp) + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
}
function bukaDetail(a) {
  $('detNama').textContent = a.nama;
  $('detSub').textContent = `NIS ${a.nis} \u2022 Kelas ${a.kelas} \u2022 ${periodeTeks()} \u2022 Hadir ${a.hadir}, Telat ${a.telat}, Izin ${a.izin}, Sakit ${a.sakit}, Alpa ${a.alpa}`;
  $('detBody').innerHTML = a.days.length ? a.days.map(h => `<tr><td>${esc(hariTgl(h.d))}</td><td>${h.status ? `<span class="badge text-bg-${badge(h.status)}">${esc(h.status)}</span>` : '-'}</td><td>${esc(h.masuk || '-')}</td><td>${esc(h.pulang || '-')}</td><td>${h.telatMnt ? h.telatMnt + ' mnt' : '-'}</td><td>${esc(ketHari(h))}</td></tr>`).join('')
    : '<tr><td colspan="6" class="text-center text-muted py-4">Belum ada data presensi pada bulan ini.</td></tr>';
  bootstrap.Modal.getOrCreateInstance($('mdlDetail')).show();
}
// -- Dokumen cetak (kop, tabel, tanda tangan)
// -- Rekap per hari (dihitung dari data bulan yang sama, jadi memakai cache)
let rMode = 'bulan', rh = { iso: '', rows: [] };
function loadHarian() {
  const iso = $('rTanggal').value || today(), [thn, bln] = iso.split('-'); $('rTanggal').value = iso;
  swr('getRekapBulan', [{ bln, thn }], 'rk_' + thn + '-' + bln, r => {
    if (!r.success) return toast(r.message, 'danger');
    rh.iso = iso; rh.rows = r.data.rows; renderHarian();
  });
}
function dataHarian() {
  const d = rh.iso.slice(8), k = $('fKelas').value, q = ($('rSearch').value || '').trim().toLowerCase(), m = {};
  rh.rows.forEach(x => {
    if (x[0] !== d) return; const n = m[x[2]] = m[x[2]] || {};
    if (x[7] === 'Masuk') { n.status = x[5]; n.masuk = String(x[1]).slice(0, 5); n.ket = x[6]; } else if (x[7] === 'Pulang') n.pulang = String(x[1]).slice(0, 5);
  });
  return siswa.filter(s => isAktif(s) && (k === 'Semua' || s.kelas === k) && (!q || (s.nama + ' ' + s.nis).toLowerCase().includes(q)))
    .sort((a, b) => urutKelas(a.kelas, b.kelas) || String(a.nama).localeCompare(String(b.nama), 'id'))
    .map(s => Object.assign({ nis: s.nis, nama: s.nama, kelas: s.kelas, status: 'Belum Absen', masuk: '', pulang: '', ket: '' }, m[s.nis] || {}));
}
const hitungHarian = a => { const c = {}; ['Hadir', 'Terlambat', 'Sakit', 'Izin', 'Alpa', 'Belum Absen'].forEach(s => { c[s] = a.filter(x => x.status === s).length; }); return c; };
const tglPanjang = iso => new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function renderHarian() {
  if (!rh.iso) return; const a = dataHarian(), c = hitungHarian(a);
  $('rhInfo').innerHTML = `<b>${esc(tglPanjang(rh.iso))}</b> &mdash; ${a.length} siswa &bull; Hadir <b>${c.Hadir}</b> &bull; Terlambat <b>${c.Terlambat}</b> &bull; Sakit <b>${c.Sakit}</b> &bull; Izin <b>${c.Izin}</b> &bull; Alpa <b>${c.Alpa}</b> &bull; Belum absen <b>${c['Belum Absen']}</b>`;
  $('rhBody').innerHTML = a.length ? a.map((x, i) => `<tr><td>${i + 1}</td><td><b>${esc(x.nama)}</b></td><td>${esc(x.kelas)}</td><td><span class="badge text-bg-${x.status === 'Belum Absen' ? 'secondary' : x.status === 'Sakit' || x.status === 'Izin' ? 'info' : badge(x.status)}">${esc(x.status)}</span></td><td>${esc(x.masuk || '-')}</td><td>${esc(x.pulang || '-')}</td><td>${esc(x.ket || '-')}</td></tr>`).join('') : empty(7);
}
function cetakHarian() {
  const a = dataHarian(); if (!a.length) return toast('Tidak ada data untuk dicetak.', 'warning');
  const c = hitungHarian(a), kls = [...new Set(a.map(x => String(x.kelas)))].sort(urutKelas), kf = $('fKelas').value === 'Semua' ? 'Semua Kelas' : $('fKelas').value;
  const tbl = '<table class="lap-tbl"><thead><tr><th>No</th><th>Nama Siswa</th><th>NIS</th><th>Kelas</th><th>Status</th><th>Jam Datang<br>(WITA)</th><th>Jam Pulang<br>(WITA)</th><th>Keterangan</th></tr></thead><tbody>'
    + a.map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(x.nama)}</td><td class="c">${esc(x.nis)}</td><td class="c">${esc(x.kelas)}</td><td class="c">${esc(x.status)}</td><td class="c">${esc(x.masuk || '-')}</td><td class="c">${esc(x.pulang || '-')}</td><td>${esc(x.ket || '-')}</td></tr>`).join('') + '</tbody></table>';
  $('laporan').innerHTML = kopHTML() + `<div class="lap-judul">LAPORAN PRESENSI HARIAN SISWA</div><div class="lap-meta">Hari, Tanggal: <b>${esc(tglPanjang(rh.iso))}</b> | Kelas: <b>${esc(kf)}</b> | Hadir: <b>${c.Hadir}</b> | Terlambat: <b>${c.Terlambat}</b> | Sakit: <b>${c.Sakit}</b> | Izin: <b>${c.Izin}</b> | Alpa: <b>${c.Alpa}</b> | Belum Absen: <b>${c['Belum Absen']}</b></div>` + tbl + ttdHTML(kls);
  $('pvTitle').textContent = 'Pratinjau Rekap Presensi Harian'; $('pvSub').textContent = 'Klik Cetak Sekarang lalu pilih "Save as PDF".';
  bootstrap.Modal.getOrCreateInstance($('mdlPreview')).show();
}
function kopHTML() {
  return `<div class="lap-kop"><img src="${esc(SEKOLAH.logo)}" alt=""><div class="lap-kop-t"><div>${esc(SEKOLAH.pemda)}</div><div>${esc(SEKOLAH.dinas)}</div><div class="lap-sch">${esc(SEKOLAH.nama)}</div>${SEKOLAH.alamat ? `<div class="lap-adr">${esc(SEKOLAH.alamat)}</div>` : ''}</div></div><div class="lap-rule"></div>`;
}
function ttdHTML(kelasList) {
  const tgl = (SEKOLAH.kota ? SEKOLAH.kota + ', ' : '') + new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const kepala = `<div class="lap-ttd"><div>Mengetahui,<br>Kepala ${esc(judulKapital(SEKOLAH.nama))}</div><div class="lap-sp"></div>${SEKOLAH.kepala ? `<div class="lap-nm">${esc(SEKOLAH.kepala)}</div>` : '<div class="lap-dots">&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;</div>'}<div>NIP. ${SEKOLAH.nipKepala ? esc(SEKOLAH.nipKepala) : '&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;'}</div></div>`;
  const dots = '&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;';
  const wali = kelasList.map(k => { const w = waliDari(k); return `<div class="lap-ttd"><div>${esc(tgl)}<br>Wali Kelas ${esc(k)}</div><div class="lap-sp"></div>${w ? `<div class="lap-nm">${esc(w.nama)}</div>` : `<div class="lap-dots">${dots}</div>`}<div>NIP. ${w && w.nip ? esc(w.nip) : '&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;&hellip;'}</div></div>`; }).join('');
  return `<div class="lap-ttds">${kepala}${wali}</div>`;
}
function lapDoc(judul, tabel, kelasList, labelJml, jml) {
  const k = $('fKelas').value === 'Semua' ? 'Semua Kelas' : $('fKelas').value;
  return kopHTML() + `<div class="lap-judul">${judul}</div><div class="lap-meta">Periode: <b>${esc(periodeTeks())}</b> | Kelas: <b>${esc(k)}</b> | Hari Efektif: <b>${rk.efektif} Hari</b> | ${labelJml}: <b>${jml}</b></div>` + tabel + ttdHTML(kelasList);
}
function tabelHasil(list) {
  return '<table class="lap-tbl"><thead><tr><th>No</th><th>Nama Siswa</th><th>NIS</th><th>Kelas</th><th>Hadir</th><th>Telat</th><th>Izin</th><th>Sakit</th><th>Alpa</th><th>%</th><th>Rata&sup2; Datang</th><th>Rata&sup2; Pulang</th></tr></thead><tbody>'
    + list.map((a, i) => `<tr><td class="c">${i + 1}</td><td>${esc(a.nama)}</td><td class="c">${esc(a.nis)}</td><td class="c">${esc(a.kelas)}</td><td class="c">${a.hadir}</td><td class="c">${a.telat}</td><td class="c">${a.izin}</td><td class="c">${a.sakit}</td><td class="c">${a.alpa}</td><td class="c">${a.pct === null ? '-' : a.pct + '%'}</td><td class="c">${a.avgD}</td><td class="c">${a.avgP}</td></tr>`).join('') + '</tbody></table>';
}
function tabelLengkap(list) {
  let h = '<table class="lap-tbl"><thead><tr><th>No</th><th>Hari, Tanggal</th><th>Status</th><th>Jam Datang<br>(WITA)</th><th>Jam Pulang<br>(WITA)</th><th>Terlambat</th><th>Keterangan</th></tr></thead><tbody>';
  list.forEach(a => {
    h += `<tr class="lap-grp"><td colspan="7">${esc(a.nama)} &bull; NIS ${esc(a.nis)} &bull; Kelas ${esc(a.kelas)} &bull; Hadir ${a.hadir}, Telat ${a.telat}, Izin ${a.izin}, Sakit ${a.sakit}, Alpa ${a.alpa}</td></tr>`;
    h += a.days.length ? a.days.map((d, i) => `<tr><td class="c">${i + 1}</td><td>${esc(hariTgl(d.d))}</td><td class="c">${esc(d.status || '-')}</td><td class="c">${esc(d.masuk || '-')}</td><td class="c">${esc(d.pulang || '-')}</td><td class="c">${d.telatMnt ? d.telatMnt + ' mnt' : '-'}</td><td>${esc(ketHari(d))}</td></tr>`).join('')
      : '<tr><td colspan="7" class="lap-none">Belum ada data presensi pada periode ini.</td></tr>';
  });
  return h + '</tbody></table>';
}
function tabelMapel(rows) {
  return '<table class="lap-tbl"><thead><tr><th>No</th><th>Tanggal</th><th>Waktu</th><th>Nama Siswa</th><th>Kelas</th><th>Status</th><th>Mata Pelajaran / Keterangan</th></tr></thead><tbody>'
    + rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(r[0] + '/' + rk.bln + '/' + rk.thn)}</td><td class="c">${esc(String(r[1]).slice(0, 5))}</td><td>${esc(r[3])}</td><td class="c">${esc(r[4])}</td><td class="c">${esc(r[5])}</td><td>${esc(r[6] || '-')}</td></tr>`).join('') + '</tbody></table>';
}
function bukaPreview(mode) {
  const mapel = rk.jenis === 'Mata Pelajaran';
  if (mapel && mode === 'lengkap') return toast('Cetak Lengkap hanya untuk Presensi Sekolah. Pilih tab Presensi Sekolah.', 'warning');
  let html, judul, sub;
  if (mapel) {
    const rows = mapelRows(); if (!rows.length) return toast('Tidak ada data untuk dicetak.', 'warning');
    html = lapDoc('LAPORAN PRESENSI MATA PELAJARAN', tabelMapel(rows), [...new Set(rows.map(r => String(r[4])))].sort(urutKelas), 'Jumlah Data', rows.length);
    judul = 'Pratinjau Cetak Presensi Mata Pelajaran'; sub = 'Klik Cetak Sekarang lalu pilih "Save as PDF".';
  } else {
    const list = rekapTampil(); if (!list.length) return toast('Tidak ada data siswa untuk dicetak.', 'warning');
    const kls = [...new Set(list.map(a => a.kelas))].sort(urutKelas);
    if (mode === 'lengkap') { html = lapDoc('LAPORAN LENGKAP PRESENSI SISWA (JAM DATANG &amp; PULANG)', tabelLengkap(list), kls, 'Jumlah Siswa', list.length); judul = 'Pratinjau Cetak Lengkap Presensi'; sub = 'Berisi jam datang & pulang setiap hari. Klik Cetak lalu pilih "Save as PDF".'; }
    else { html = lapDoc('LAPORAN REKAPITULASI PRESENSI SISWA', tabelHasil(list), kls, 'Jumlah Siswa', list.length); judul = 'Pratinjau Cetak Rekap Presensi'; sub = 'Ringkasan kehadiran per siswa. Klik Cetak lalu pilih "Save as PDF".'; }
  }
  $('pvTitle').textContent = judul; $('pvSub').textContent = sub; $('laporan').innerHTML = html;
  bootstrap.Modal.getOrCreateInstance($('mdlPreview')).show();
}
function initRekap() {
  $('rBulan').value = today().slice(0, 7);
  $('rBulan').onchange = loadRekap; $('fKelas').onchange = () => rMode === 'hari' ? renderHarian() : renderRekap(); $('rSearch').oninput = () => rMode === 'hari' ? renderHarian() : renderRekap();
  $('rTanggal').onchange = loadHarian; $('btnCetakHarian').onclick = cetakHarian;
  $('rModeTabs').onclick = e => {
    const b = e.target.closest('[data-m]'); if (!b) return; rMode = b.dataset.m; const hr = rMode === 'hari';
    document.querySelectorAll('#rModeTabs [data-m]').forEach(x => x.classList.toggle('active', x === b));
    ['rTanggal', 'rBulanCard', 'rJenisTabs', 'btnCetakHasil', 'btnCetakLengkap', 'rHarianCard', 'btnCetakHarian'].forEach(i => $(i).classList.toggle('d-none', ['rTanggal', 'rHarianCard', 'btnCetakHarian'].includes(i) ? !hr : hr));
    $('rBulan').closest('[class*="col-"]').classList.toggle('d-none', hr);
    if (hr) { if (!$('rTanggal').value) $('rTanggal').value = today(); loadHarian(); }
  };
  $('rJenisTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; rk.jenis = b.dataset.j; document.querySelectorAll('#rJenisTabs .pill-tab').forEach(x => x.classList.toggle('active', x === b)); renderRekap(); };
  $('btnCetakHasil').onclick = () => bukaPreview('hasil'); $('btnCetakLengkap').onclick = () => bukaPreview('lengkap');
  $('btnPvCetak').onclick = () => { $('printArea').innerHTML = $('laporan').innerHTML; cetak('laporan'); };
  $('rekapBody').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = rk.agg.find(x => x.nis === b.dataset.nis); if (!a) return;
    if (b.dataset.act === 'wa') kirimWaRekap(a);
    if (b.dataset.act === 'det') bukaDetail(a);
  });
}

// ===== MODUL TAMBAHAN =====
let TOKEN = sessionStorage.getItem('tk') || '', USER = JSON.parse(sessionStorage.getItem('usr') || 'null');
const NAV = [['dashboard','Dashboard','speedometer2'],['scan','Scan','qr-code-scan'],['siswa','Data Siswa','people'],['guru','Data Guru','person-badge'],['akun','Kelola Akun','person-gear',1],
  ['rekap','Rekap Presensi','table'],['pelanggaran','Pelanggaran','exclamation-triangle'],['rekapPel','Rekap Pelanggaran','file-earmark-text'],['prestasi','Prestasi Siswa','award'],
  ['rekapPres','Rekap Prestasi','bar-chart'],['peringkat','Peringkat','trophy'],['pengaturan','Pengaturan','gear',1]];
const MOD = {
  akun: { t: 'Kelola Akun', s: 'Akun', c: [['Username',1],['Nama',2],['Role',3]],
    f: [['username','Username'],['nama','Nama'],['role','Role','select',['guru','admin']],['password','Password (min. 6 karakter)','password']] },
  pelanggaran: { t: 'Pelanggaran', s: 'Pelanggaran', c: [['Tanggal',1],['Nama',3],['Kelas',4],['Pelanggaran',5],['Poin',6],['Ket.',7]],
    f: [['tanggal','Tanggal','date'],['nis','Siswa','siswa'],['jenis','Jenis Pelanggaran'],['poin','Poin','number'],['ket','Keterangan']] },
  prestasi: { t: 'Prestasi Siswa', s: 'Prestasi', c: [['Tanggal',1],['Nama',3],['Kelas',4],['Prestasi',5],['Poin',6],['Ket.',7]],
    f: [['tanggal','Tanggal','date'],['nis','Siswa','siswa'],['jenis','Prestasi'],['poin','Poin','number'],['ket','Keterangan']] }
};
const LOAD = { guru: () => loadGuru(), akun: () => loadMod('akun'), pelanggaran: () => loadMod('pelanggaran'), prestasi: () => loadMod('prestasi'),
  rekapPel: () => loadRekapCatat('rekapPel', 'Pelanggaran'), rekapPres: () => loadRekapCatat('rekapPres', 'Prestasi'), peringkat: loadPeringkat, pengaturan: loadPeng };
const today = () => new Date().toLocaleDateString('sv-SE');
const empty = n => `<tr><td colspan="${n}" class="text-center text-muted">Belum ada data.</td></tr>`;
function mkSection(id, html) { const s = document.createElement('section'); s.id = 'section-' + id; s.className = 'content-section'; s.innerHTML = html; document.querySelector('.main-content').appendChild(s); }
function kelasOpts(sel) {
  const cur = sel.value;
  sel.innerHTML = '<option value="Semua">Semua Kelas</option>' + [...new Set(siswa.map(s => s.kelas))].sort().map(k => `<option>${esc(k)}</option>`).join('');
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}
// -- CRUD generik (Guru, Akun, Pelanggaran, Prestasi)
function crud(id) {
  const m = MOD[id];
  mkSection(id, `<div class="d-flex justify-content-between align-items-center mb-3"><h3 class="fw-bold mb-0">${m.t}</h3><button class="btn btn-primary" data-add="${id}"><i class="bi bi-plus-lg"></i> Tambah</button></div>
    <div class="card"><div class="table-responsive"><table class="table mb-0"><thead><tr>${m.c.map(c => `<th>${c[0]}</th>`).join('')}<th></th></tr></thead><tbody id="tb-${id}"></tbody></table></div></div>`);
}
function loadMod(id) {
  const m = MOD[id];
  swr('getList', [{ sheet: m.s }], 'list_' + m.s, r => {
    if (!r.success) return toast(r.message, 'danger');
    $('tb-' + id).innerHTML = r.data.length ? r.data.slice().reverse().map(x => `<tr>${m.c.map(c => `<td>${esc(x[c[1]])}</td>`).join('')}<td class="text-nowrap"><button class="btn btn-sm btn-danger" data-del="${id}" data-id="${esc(x[0])}"><i class="bi bi-trash"></i></button></td></tr>`).join('') : empty(m.c.length + 1);
  });
}
function openForm(id) {
  const m = MOD[id]; $('formTitle').textContent = 'Tambah ' + m.t; $('genForm').dataset.mod = id;
  $('formBody').innerHTML = m.f.map(([k, l, t, o]) => {
    const inp = t === 'select' ? `<select class="form-select" name="${k}">${o.map(v => `<option>${v}</option>`).join('')}</select>`
      : t === 'siswa' ? `<select class="form-select" name="${k}" required>${siswa.filter(isAktif).map(s => `<option value="${esc(s.nis)}">${esc(s.nama)} (${esc(s.kelas)})</option>`).join('')}</select>`
      : `<input class="form-control" name="${k}" type="${t || 'text'}" ${t === 'number' ? 'min="0"' : ''} ${t === 'date' ? `value="${today()}"` : ''} ${k === 'ket' ? '' : 'required'}>`;
    return `<div class="mb-3"><label class="form-label">${l}</label>${inp}</div>`;
  }).join('');
  bootstrap.Modal.getOrCreateInstance($('mdlForm')).show();
}
// -- Rekap Pelanggaran / Prestasi (ringkasan per siswa)
const REKC = {};   // id -> { sheet, agg, periode }
function rekapCatat(id, sheet, title) {
  REKC[id] = { sheet, agg: [], periode: 'Semua Periode' };
  mkSection(id, `<div class="d-flex justify-content-between flex-wrap gap-2 mb-3 no-print"><h3 class="fw-bold mb-0">${title}</h3><div class="d-flex gap-2 flex-wrap align-items-center"><input type="month" id="fb-${id}" class="form-control w-auto" title="Bulan (kosongkan untuk semua periode)"><select id="fk-${id}" class="form-select w-auto"></select><button class="btn btn-soft" id="bh-${id}"><i class="bi bi-printer"></i> Cetak Hasil</button><button class="btn btn-sky" id="bl-${id}"><i class="bi bi-printer-fill"></i> Cetak Lengkap</button></div></div>
    <div class="card"><div class="table-responsive"><table class="table mb-0"><thead><tr><th>#</th><th>Nama</th><th>Kelas</th><th>Jumlah</th><th>Total Poin</th></tr></thead><tbody id="tb-${id}"></tbody></table></div></div>`);
  $('fk-' + id).onchange = $('fb-' + id).onchange = () => loadRekapCatat(id, sheet);
  $('bh-' + id).onclick = () => cetakCatat(id, 'hasil'); $('bl-' + id).onclick = () => cetakCatat(id, 'lengkap');
}
function loadRekapCatat(id, sheet) {
  kelasOpts($('fk-' + id));
  swr('getList', [{ sheet }], 'list_' + sheet, r => {
    if (!r.success) return toast(r.message, 'danger');
    const k = $('fk-' + id).value, b = $('fb-' + id).value, [thn, bln] = b ? b.split('-') : ['', ''], g = {};
    r.data.forEach(x => {
      if (k !== 'Semua' && String(x[4]) !== k) return;
      if (b) { const p = String(x[1]).split('/'); if (p[1] !== bln || p[2] !== thn) return; }
      const m = g[x[2]] = g[x[2]] || { nis: String(x[2]), nama: x[3], kelas: x[4], n: 0, p: 0, list: [] };
      m.n++; m.p += Number(x[6]) || 0; m.list.push(x);
    });
    const a = Object.values(g).sort((x, y) => y.p - x.p);
    REKC[id].agg = a; REKC[id].periode = b ? BLN[+bln - 1] + ' ' + thn : 'Semua Periode';
    $('tb-' + id).innerHTML = a.length ? a.map((m, i) => `<tr><td>${i + 1}</td><td><b>${esc(m.nama)}</b></td><td>${esc(m.kelas)}</td><td>${m.n}</td><td>${m.p}</td></tr>`).join('') : empty(5);
  });
}
// Cetak rekap Pelanggaran / Prestasi: kop surat + tabel + tanda tangan Kepala Sekolah & Wali Kelas
function cetakCatat(id, mode) {
  const c = REKC[id], a = c.agg || [];
  if (!a.length) return toast('Tidak ada data untuk dicetak.', 'warning');
  const nm = c.sheet === 'Pelanggaran' ? 'PELANGGARAN' : 'PRESTASI', jenis = c.sheet === 'Pelanggaran' ? 'Jenis Pelanggaran' : 'Prestasi';
  const kls = [...new Set(a.map(x => String(x.kelas)))].sort(urutKelas), kf = $('fk-' + id).value === 'Semua' ? 'Semua Kelas' : $('fk-' + id).value;
  const total = a.reduce((s, x) => s + x.p, 0), kej = a.reduce((s, x) => s + x.n, 0), lengkap = mode === 'lengkap';
  const tbl = lengkap
    ? `<table class="lap-tbl"><thead><tr><th>No</th><th>Tanggal</th><th>${jenis}</th><th>Poin</th><th>Keterangan</th><th>Pencatat</th></tr></thead><tbody>`
      + a.map(m => `<tr class="lap-grp"><td colspan="6">${esc(m.nama)} &bull; NIS ${esc(m.nis)} &bull; Kelas ${esc(m.kelas)} &bull; ${m.n} catatan &bull; Total ${m.p} poin</td></tr>`
        + m.list.map((x, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(x[1])}</td><td>${esc(x[5])}</td><td class="c">${esc(x[6])}</td><td>${esc(x[7] || '-')}</td><td>${esc(x[8] || '-')}</td></tr>`).join('')).join('') + '</tbody></table>'
    : '<table class="lap-tbl"><thead><tr><th>No</th><th>Nama Siswa</th><th>NIS</th><th>Kelas</th><th>Jumlah</th><th>Total Poin</th></tr></thead><tbody>'
      + a.map((m, i) => `<tr><td class="c">${i + 1}</td><td>${esc(m.nama)}</td><td class="c">${esc(m.nis)}</td><td class="c">${esc(m.kelas)}</td><td class="c">${m.n}</td><td class="c">${m.p}</td></tr>`).join('') + '</tbody></table>';
  $('laporan').innerHTML = kopHTML() + `<div class="lap-judul">LAPORAN ${lengkap ? 'LENGKAP' : 'REKAPITULASI'} ${nm} SISWA</div><div class="lap-meta">Periode: <b>${esc(c.periode)}</b> | Kelas: <b>${esc(kf)}</b> | Jumlah Siswa: <b>${a.length}</b> | Jumlah Catatan: <b>${kej}</b> | Total Poin: <b>${total}</b></div>` + tbl + ttdHTML(kls);
  $('pvTitle').textContent = 'Pratinjau Cetak ' + (lengkap ? 'Lengkap ' : 'Rekap ') + (nm[0] + nm.slice(1).toLowerCase());
  $('pvSub').textContent = 'Klik Cetak Sekarang lalu pilih "Save as PDF".';
  bootstrap.Modal.getOrCreateInstance($('mdlPreview')).show();
}
// -- Peringkat
function mkPeringkat() {
  mkSection('peringkat', `<div class="d-flex justify-content-between flex-wrap gap-2 mb-3"><div><h3 class="fw-bold mb-0">Peringkat</h3><small class="text-muted">Skor = poin prestasi − poin pelanggaran</small></div><select id="fk-peringkat" class="form-select w-auto"></select></div>
    <div class="card"><div class="table-responsive"><table class="table mb-0"><thead><tr><th>#</th><th>Nama</th><th>Kelas</th><th>Prestasi</th><th>Pelanggaran</th><th>Skor</th></tr></thead><tbody id="tb-peringkat"></tbody></table></div></div>`);
  $('fk-peringkat').onchange = loadPeringkat;
}
function loadPeringkat() {
  kelasOpts($('fk-peringkat'));
  swr('getPeringkat', [{}], 'ring', r => {
    if (!r.success) return toast(r.message, 'danger');
    const k = $('fk-peringkat').value, a = r.data.filter(x => k === 'Semua' || String(x.kelas) === k);
    $('tb-peringkat').innerHTML = a.length ? a.map((x, i) => `<tr><td>${['🥇','🥈','🥉'][i] || i + 1}</td><td><b>${esc(x.nama)}</b></td><td>${esc(x.kelas)}</td><td class="text-success">${x.prestasi}</td><td class="text-danger">${x.pelanggaran}</td><td><b>${x.skor}</b></td></tr>`).join('') : empty(6);
  });
}
// -- Pengaturan
const HARI = [[1, 'Senin'], [2, 'Selasa'], [3, 'Rabu'], [4, 'Kamis'], [5, 'Jumat'], [6, 'Sabtu'], [7, 'Minggu']];
const PENG_KEYS = ['gerbangBuka', 'terlambat', 'batasMasuk', 'mulaiPulang', 'gerbangBukaJumat', 'terlambatJumat', 'mulaiPulangJumat', 'minHariPeringkat', 'tahunAjaran', 'fonnteToken', 'waOtomatis'];
const tglPendek = iso => String(iso).split('-').reverse().join('/');
function mkPengaturan() {
  const jam = (k, l, req) => `<div class="col-12 col-md-6"><label class="form-label" for="p_${k}">${l}</label><input id="p_${k}" name="${k}" type="time" class="form-control" ${req ? 'required' : ''}></div>`;
  mkSection('pengaturan', `
    <div class="sis-card">
      <div class="sis-title fs-5">Pengaturan Presensi &amp; Jam Operasional</div>
      <div class="sis-sub mb-3">Atur jam buka gerbang, batas hadir tepat waktu, batas toleransi, jam pulang minimal, dan tahun ajaran aktif</div>
      <form id="pengForm"><div class="row g-3">
        ${jam('gerbangBuka', 'Gerbang dibuka (HH:mm)', 1)}${jam('terlambat', 'Batas hadir tepat waktu (HH:mm)', 1)}
        ${jam('batasMasuk', 'Batas toleransi keterlambatan (HH:mm)', 1)}${jam('mulaiPulang', 'Jam pulang minimal (HH:mm)', 1)}
        ${jam('gerbangBukaJumat', 'Gerbang dibuka hari Jumat (HH:mm)')}${jam('terlambatJumat', 'Batas hadir tepat waktu hari Jumat (HH:mm)')}
        ${jam('mulaiPulangJumat', 'Jam pulang minimal hari Jumat (HH:mm)')}
        <div class="col-12 col-md-6"><label class="form-label" for="p_minHariPeringkat">Minimal hari untuk peringkat kehadiran</label><input id="p_minHariPeringkat" name="minHariPeringkat" type="number" min="1" max="31" class="form-control" required></div>
        <div class="col-12 col-md-6"><label class="form-label" for="p_tahunAjaran">Tahun ajaran aktif</label><input id="p_tahunAjaran" name="tahunAjaran" class="form-control" placeholder="2026/2027" pattern="\\d{4}/\\d{4}"></div>
        <div class="col-12 col-md-6"><label class="form-label" for="p_fonnteToken">Token API WhatsApp Fonnte (Opsional untuk server otomatis)</label>
          <div class="input-group"><input id="p_fonnteToken" name="fonnteToken" type="password" class="form-control" autocomplete="new-password"><button type="button" class="btn btn-soft btn-eye" id="btnEyeTok" aria-label="Tampilkan token"><i class="bi bi-eye"></i></button></div></div>
        <div class="col-12 col-md-6"><label class="form-label" for="p_waOtomatis">Kirim WhatsApp Otomatis ke Orang Tua, Guru Wali &amp; Guru Kelas Setelah Absen / Pelanggaran (Ya / Tidak)</label><select id="p_waOtomatis" name="waOtomatis" class="form-select"><option>Ya</option><option>Tidak</option></select></div>
        <div class="col-12 col-md-6"><label class="form-label" for="p_tesHp">Uji kirim WhatsApp ke nomor</label><div class="input-group"><input id="p_tesHp" class="form-control" placeholder="08xxxxxxxxxx" inputmode="tel"><button type="button" class="btn btn-soft" id="btnTesWA"><i class="bi bi-send"></i> Kirim Uji</button></div><small class="text-muted d-block mt-1">Memakai token yang diisi di kolom token (tidak perlu disimpan dulu).</small></div>
      </div><button class="btn btn-sky mt-3"><i class="bi bi-check2"></i> Simpan Pengaturan</button></form>
    </div>
    <div class="sis-card">
      <div class="sis-title fs-5">Hari Belajar &amp; Hari Libur</div>
      <div class="sis-sub mb-3">Pada hari yang bukan hari belajar atau tanggal libur, scan ditolak dan siswa <b>tidak</b> ditandai Alpa otomatis.</div>
      <div class="form-label">Hari belajar rutin</div>
      <div class="hari-wrap" id="hariWrap">${HARI.map(([n, l]) => `<label class="hari-chip"><input type="checkbox" value="${n}"> ${l}</label>`).join('')}</div>
      <button type="button" class="btn btn-sky mt-3" id="btnSimpanHari"><i class="bi bi-check2"></i> Simpan Hari Belajar</button>
      <hr class="my-4">
      <div class="form-label">Tambah hari libur (tanggal tertentu / rentang)</div>
      <form id="liburForm" class="row g-2 align-items-end">
        <div class="col-6 col-md-3"><label class="form-label small text-muted" for="l_dari">Dari tanggal</label><input id="l_dari" type="date" class="form-control" required></div>
        <div class="col-6 col-md-3"><label class="form-label small text-muted" for="l_sampai">Sampai (opsional)</label><input id="l_sampai" type="date" class="form-control"></div>
        <div class="col-12 col-md-4"><label class="form-label small text-muted" for="l_ket">Keterangan</label><input id="l_ket" class="form-control" placeholder="mis. Libur Semester, HUT RI" maxlength="100"></div>
        <div class="col-12 col-md-2"><button class="btn btn-sky w-100"><i class="bi bi-plus-lg"></i> Tambah</button></div>
      </form>
      <div id="liburList" class="mt-3 d-grid gap-2"></div>
    </div>`);
  $('section-pengaturan').classList.add('sis-scope');
  $('pengForm').onsubmit = e => { e.preventDefault(); api('simpanPengaturan', [Object.fromEntries(new FormData(e.target))], r => toast(r.message, r.success ? 'success' : 'danger')); };
  $('btnTesWA').onclick = () => api('tesWA', [{ hp: $('p_tesHp').value, token: $('p_fonnteToken').value }], r => toast(r.message, r.success ? 'success' : 'danger'));
  $('btnEyeTok').onclick = () => { const i = $('p_fonnteToken'), on = i.type === 'password'; i.type = on ? 'text' : 'password'; $('btnEyeTok').innerHTML = `<i class="bi bi-eye${on ? '-slash' : ''}"></i>`; };
  $('btnSimpanHari').onclick = () => {
    const hari = [...document.querySelectorAll('#hariWrap input:checked')].map(i => +i.value);
    if (!hari.length) return toast('Pilih minimal satu hari belajar.', 'warning');
    api('simpanHariBelajar', [{ hari }], r => toast(r.message, r.success ? 'success' : 'danger'));
  };
  $('liburForm').onsubmit = e => {
    e.preventDefault();
    api('tambahLibur', [{ dari: $('l_dari').value, sampai: $('l_sampai').value, ket: $('l_ket').value.trim() }], r => {
      toast(r.message, r.success ? 'success' : 'danger'); if (r.success) { e.target.reset(); loadPeng(); }
    });
  };
  $('liburList').onclick = e => {
    const b = e.target.closest('button[data-lib]'); if (!b) return;
    hapusFn = () => api('hapusLibur', [{ id: b.dataset.lib }], r => { done(r); if (r.success) loadPeng(); });
    $('hapusTeks').textContent = 'Hapus hari libur ini?'; bootstrap.Modal.getOrCreateInstance($('mdlHapus')).show();
  };
}
function loadPeng() {
  api('getPengaturan', [{}], r => {
    if (!r.success) return toast(r.message, 'danger');
    const d = r.data;
    PENG_KEYS.forEach(k => { const el = $('pengForm').elements[k]; if (el) el.value = d[k] ?? ''; });
    document.querySelectorAll('#hariWrap input').forEach(i => { i.checked = d.hariBelajar.includes(+i.value); });
    $('liburList').innerHTML = d.libur.length ? d.libur.map(x => `<div class="libur-item"><div><b>${esc(tglPendek(x.dari))}${x.sampai && x.sampai !== x.dari ? ' &ndash; ' + esc(tglPendek(x.sampai)) : ''}</b><div class="small text-muted">${esc(x.ket || 'Libur')}</div></div>
      <button type="button" class="ico-btn2 del" data-lib="${esc(x.id)}" aria-label="Hapus hari libur"><i class="bi bi-trash3"></i></button></div>`).join('')
      : '<small class="text-muted">Belum ada hari libur tercatat.</small>';
  });
}
// -- Login & sesi
function showLogin() { $('loginBox').style.display = 'flex'; }
function logout() { TOKEN = ''; USER = null; sessionStorage.clear(); idbClear(); Object.keys(fotoCache).forEach(k => delete fotoCache[k]); stopScan(); showLogin(); }
function buildNav() {
  $('nav').innerHTML = NAV.filter(n => !n[3] || USER.role === 'admin').map(n => `<li><a class="nav-link" data-section="${n[0]}"><i class="bi bi-${n[2]}"></i> ${n[1]}</a></li>`).join('');
  document.querySelectorAll('[data-section]').forEach(l => l.onclick = () => navigateTo(l.dataset.section));
}
// Mulai aplikasi: 1 panggilan (siswa+guru+dashboard) alih-alih 3; tampil instan dari cache bila ada
function boot() {
  const t = today(), run = () => { loadGuru(); loadSiswa(); navigateTo('dashboard'); };
  if (SC.get('siswa')) { noNet = true; run(); noNet = false; }
  api('getBoot', [{ iso: t }], r => {
    if (r.success) { SC.set('siswa', r.data.siswa); SC.set('guru', r.data.guru); if (r.data.dash) SC.set('dash_' + t, r.data.dash); }
    noNet = r.success; run(); noNet = false;
    setTimeout(() => { const m = t.slice(0, 7); if (!SC.get('rk_' + m)) api('getRekapBulan', [{ bln: t.slice(5, 7), thn: t.slice(0, 4) }], x => { if (x.success) SC.set('rk_' + m, x.data); }, false); }, 2500);
  }, false);
}
function start() {
  $('loginBox').style.display = 'none'; $('userInfo').innerHTML = `<div class="d-flex align-items-center gap-2"><span class="avatar">${esc(String(USER.nama).charAt(0).toUpperCase())}</span><div><b>${esc(USER.nama)}</b><br><small class="text-muted">${esc(USER.role)}</small></div></div>`;
  buildNav(); boot();
}

// ===== TAMPILAN =====
function setDateText() {
  const d = new Date($('dashDate').value + 'T00:00:00');
  $('dateText').textContent = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();
  $('dayText').textContent = d.toLocaleDateString('id-ID', { weekday: 'long' }).toUpperCase();
}
function salam() { const h = new Date().getHours(); return h < 11 ? 'Selamat Pagi' : h < 15 ? 'Selamat Siang' : h < 18 ? 'Selamat Sore' : 'Selamat Malam'; }
// ===== INISIALISASI =====
document.addEventListener('DOMContentLoaded', () => {
  setTheme(localStorage.getItem('theme') || 'light');
  $('themeSwitch').onchange = () => setTheme($('themeSwitch').checked ? 'dark' : 'light');
  $('btnMenu').onclick = $('btnMenu2').onclick = () => toggleSidebar();
  $('dashDate').onchange = loadDash; $('btnLogout').onclick = logout;
  initRekap(); initGuru(); Object.keys(MOD).forEach(crud);
  rekapCatat('rekapPel', 'Pelanggaran', 'Rekap Pelanggaran'); rekapCatat('rekapPres', 'Prestasi', 'Rekap Prestasi'); mkPeringkat(); mkPengaturan();
  document.querySelector('.main-content').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.add) openForm(b.dataset.add);
    if (b.dataset.del) { const id = b.dataset.del, rid = b.dataset.id; hapusFn = () => api('hapusData', [{ sheet: MOD[id].s, id: rid }], r => { done(r); if (r.success) loadMod(id); }); $('hapusTeks').textContent = 'Hapus data ini?'; bootstrap.Modal.getOrCreateInstance($('mdlHapus')).show(); }
  });
  $('genForm').onsubmit = e => {
    e.preventDefault(); const id = e.target.dataset.mod;
    api('tambahData', [{ sheet: MOD[id].s, f: Object.fromEntries(new FormData(e.target)) }], r => { toast(r.message, r.success ? 'success' : 'danger'); if (r.success) { bootstrap.Modal.getInstance($('mdlForm')).hide(); loadMod(id); if (r.data && r.data.wa) api('kirimNotifPelanggaran', [{ id: r.data.id }], x => { if (!x.success) toast(x.message, 'danger'); }, false, () => {}); } });
  };
  $('loginForm').onsubmit = e => {
    e.preventDefault();
    api('login', [{ username: $('lUser').value.trim(), password: $('lPass').value }], r => {
      if (!r.success) return toast(r.message, 'danger');
      TOKEN = r.data.token; USER = { nama: r.data.nama, role: r.data.role };
      sessionStorage.setItem('tk', TOKEN); sessionStorage.setItem('usr', JSON.stringify(USER)); $('lPass').value = ''; start();
    });
  };
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { navigateTo(b.dataset.go); if (b.dataset.then) $(b.dataset.then).click(); });
  const openDate = () => { try { $('dashDate').showPicker(); } catch (e) { $('dashDate').focus(); } };
  $('dateBadge').onclick = openDate; $('dateBadge').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDate(); } };
  $('btnTheme').onclick = () => $('themeSwitch').click();
  $('sSearch').oninput = renderSiswa; $('sKelas').onchange = renderSiswa; $('sStatus').onchange = renderSiswa;
  $('gSearch').oninput = () => { if (!$('section-siswa').classList.contains('active')) navigateTo('siswa'); $('sSearch').value = $('gSearch').value; renderSiswa(); };
  TOKEN && USER ? start() : (idbClear(), showLogin());
});
