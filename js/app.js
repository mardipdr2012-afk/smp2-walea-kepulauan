// ===== UTILITAS =====
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let siswa = [], qr = null, scanBusy = false, chart = null, fotoB64 = '', hapusNis = null, spinN = 0;
const BLN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function spin(on) { spinN = Math.max(0, spinN + (on ? 1 : -1)); $('loader').style.display = spinN ? 'flex' : 'none'; }
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
  if (loader) spin(1);
  fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: fn, token: TOKEN, data: (ARG_MAP[fn] || (a => a[0] || {}))(args) }) })
    .then(r => r.json())
    .then(r => { if (loader) spin(0); if (r && r.code === 'AUTH') return logout(); ok && ok(r); },
          e => { if (loader) spin(0); scanBusy = false; toast('Gagal terhubung ke server: ' + ((e && e.message) || e), 'danger'); fail && fail(e); });
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
  api('getDashboardData', [$('dashDate').value], r => {
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
      options: { plugins: { legend: { position: 'bottom', labels: { color: getComputedStyle(document.body).color } } } } });
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
  api('getSiswa', [], r => {
    if (!r.success) return toast(r.message, 'danger');
    siswa = r.data;
    $('mNis').innerHTML = '<option value="">-- Pilih Siswa --</option>' + siswa.filter(isAktif).map(s => `<option value="${esc(s.nis)}">${esc(s.nis)} - ${esc(s.nama)}</option>`).join('');
    const kls = [...new Set(siswa.map(s => s.kelas))].sort();
    const opt = '<option value="Semua">Semua Kelas</option>' + kls.map(k => `<option>${esc(k)}</option>`).join('');
    ['fKelas', 'sKelas'].forEach(id => { const cur = $(id).value; $(id).innerHTML = opt; if ([...$(id).options].some(o => o.value === cur)) $(id).value = cur; });
    $('dlKelas').innerHTML = kls.map(k => `<option value="${esc(k)}">`).join('');
    renderSiswa(); muatFoto(siswa.map(s => s.nis)); cb && cb();
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
      <td><span class="chip">${esc(s.kelas)}</span> <span class="chip chip-${s.jk === 'P' ? 'p' : 'l'}">${esc(s.jk)}</span></td>
      <td>${s.hp ? `<a class="wa-link" href="https://wa.me/${waNum(s.hp)}" target="_blank" rel="noopener"><i class="bi bi-whatsapp"></i> ${esc(s.hp)}</a>` : '<span class="text-muted">-</span>'}</td>
      <td><span class="st-pill ${on ? 'on' : 'off'}"><i class="bi bi-${on ? 'check-circle-fill' : 'dash-circle-fill'}"></i> ${on ? 'Aktif' : 'Nonaktif'}</span></td>
      <td class="text-end text-nowrap"><button class="btn btn-soft btn-sm" data-act="kartu" data-nis="${nis}"><i class="bi bi-person-vcard"></i> Kartu</button>
        <button class="ico-btn2" data-act="edit" data-nis="${nis}" title="Ubah data" aria-label="Ubah data"><i class="bi bi-pencil"></i></button>
        <button class="ico-btn2" data-act="status" data-nis="${nis}" title="${on ? 'Nonaktifkan' : 'Aktifkan'}" aria-label="${on ? 'Nonaktifkan' : 'Aktifkan'}"><i class="bi bi-${on ? 'pause-fill' : 'play-fill'}"></i></button>
        ${isAdmin() ? `<button class="ico-btn2 del" data-act="hapus" data-nis="${nis}" title="Hapus" aria-label="Hapus"><i class="bi bi-trash3"></i></button>` : ''}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="text-center text-muted py-4">Tidak ada data siswa.</td></tr>';
  pasangFoto();
}
// -- Foto: dimuat bertahap (8 siswa per panggilan) lalu disimpan di memori
function pasangFoto() {
  document.querySelectorAll('.sis-ava[data-nis]').forEach(el => {
    const f = fotoCache[el.dataset.nis];
    if (f && !el.querySelector('img')) { const im = new Image(); im.alt = ''; im.src = f; el.textContent = ''; el.appendChild(im); }
  });
}
function muatFoto(list, cb) {
  const perlu = list.filter(n => !(n in fotoCache)), chunks = [];
  for (let i = 0; i < perlu.length; i += 8) chunks.push(perlu.slice(i, i + 8));
  let i = 0;
  (function next() {
    if (i >= chunks.length) return cb && cb();
    const c = chunks[i++];
    api('getFotoBatch', [{ list: c }], r => {
      c.forEach(n => { const f = r.success && r.data ? String(r.data[n] || '') : ''; fotoCache[n] = f.startsWith('data:image/') ? f : ''; });
      pasangFoto(); next();
    }, false, () => cb && cb());
  })();
}
$('siswaBody').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const s = siswa.find(x => x.nis === b.dataset.nis); if (!s) return;
  if (b.dataset.act === 'kartu') bukaKartu(s);
  if (b.dataset.act === 'edit') bukaForm(s);
  if (b.dataset.act === 'status') {
    const baru = isAktif(s) ? 'Nonaktif' : 'Aktif';
    api('ubahStatusSiswa', [{ nis: s.nis, status: baru }], r => { toast(r.message, r.success ? 'success' : 'danger'); if (r.success) loadSiswa(); });
  }
  if (b.dataset.act === 'hapus') { hapusFn = () => api('hapusSiswa', [s.nis], r => { done(r); if (r.success) loadSiswa(); }); $('hapusTeks').textContent = `Hapus siswa ${s.nama} (NIS ${s.nis})?`; bootstrap.Modal.getOrCreateInstance($('mdlHapus')).show(); }
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
function prosesFoto(f) {   // potong ke rasio 3x4, kecilkan, kompres agar muat di sel Sheets
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
      setFoto(d, 'ganti');
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
    if (r.success) { delete fotoCache[d.nis]; bootstrap.Modal.getInstance($('mdlSiswa')).hide(); loadSiswa(); }
  });
};

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
  const el = $('kartu'); if (!el) return;
  if (!window.html2canvas) return toast('Fitur unduh belum siap. Muat ulang halaman.', 'danger');
  spin(1);
  html2canvas(el, { scale: 3, useCORS: true, backgroundColor: null }).then(c => { const a = document.createElement('a'); a.download = 'Kartu-' + kartuSiswa.nis + '.png'; a.href = c.toDataURL('image/png'); a.click(); })
    .catch(() => toast('Gagal membuat gambar kartu.', 'danger')).finally(() => spin(0));
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
function onScan(text) {
  if (scanBusy) return; scanBusy = true;
  const jenis = $('jenis').value, ket = jenis === 'Mata Pelajaran' ? $('mapel').value.trim() : '';
  if (jenis === 'Mata Pelajaran' && !ket) { toast('Harap isi nama mata pelajaran!', 'danger'); scanBusy = false; return; }
  hasil('Memproses NIS: ' + esc(text) + '...');
  api('simpanAbsensi', [text, 'Hadir', ket, jenis], r => {
    if (r.success) { hasil(`<h4 class="text-success">✅ Berhasil</h4><b>${esc(r.data.nama)}</b> (${esc(r.data.kelas)})<br><span class="badge text-bg-${badge(r.data.status)}">${esc(r.data.status)}</span>`); toast(r.message, 'success'); }
    else { hasil(`<h4 class="text-danger">❌ Gagal</h4>${esc(r.message)}`); toast(r.message, 'danger'); }
    setTimeout(resetHasil, 2500);
  }, false);
}
$('qrFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return; hasil('Membaca gambar...');
  stopScan().then(() => { qr = qr || new Html5Qrcode('reader'); return qr.scanFile(f, true); })
    .then(onScan).catch(() => { hasil('<h4 class="text-danger">❌ Gagal Membaca</h4>QR Code tidak ditemukan pada foto. Coba foto lain.'); setTimeout(resetHasil, 3000); })
    .finally(() => { $('qrFile').value = ''; });
};
$('jenis').onchange = () => $('mapel').classList.toggle('d-none', $('jenis').value !== 'Mata Pelajaran');
$('btnManual').onclick = () => {
  const nis = $('mNis').value, jenis = $('jenis').value; let ket = $('mKet').value.trim();
  if (!nis) return toast('Pilih siswa terlebih dahulu!', 'warning');
  if (jenis === 'Mata Pelajaran') {
    const m = $('mapel').value.trim(); if (!m) return toast('Isi nama mata pelajaran di atas!', 'warning');
    ket = ket ? m + ' - ' + ket : m;
  }
  api('simpanAbsensi', [nis, $('mStatus').value, ket, jenis], r => {
    toast(r.message, r.success ? 'success' : 'danger'); if (r.success) { $('mNis').value = ''; $('mKet').value = ''; }
  });
};

// ===== REKAP =====
function initFilter() {
  $('fTgl').innerHTML = '<option value="Semua">Semua Tanggal</option>' + Array.from({ length: 31 }, (_, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}">${v}</option>`; }).join('');
  $('fBln').innerHTML = '<option value="Semua">Semua Bulan</option>' + BLN.map((b, i) => `<option value="${String(i + 1).padStart(2, '0')}">${b}</option>`).join('');
  const y = new Date().getFullYear();
  $('fThn').innerHTML = '<option value="Semua">Semua Tahun</option>' + [y - 2, y - 1, y, y + 1].map(v => `<option>${v}</option>`).join('');
}
function loadRekap() {
  const f = { jenis: $('fJenis').value, kelas: $('fKelas').value, tgl: $('fTgl').value, bln: $('fBln').value, thn: $('fThn').value };
  api('getRekap', [f], r => { if (!r.success) return toast(r.message, 'danger'); renderRekap(r.data, f.jenis === 'Sekolah'); });
}
function renderRekap(rows, sekolah) {
  let out = rows;
  if (sekolah) { // gabungkan Masuk & Pulang per siswa per hari
    const m = new Map();
    rows.forEach(r => {
      const k = r.tanggal + '_' + r.nis; if (!m.has(k)) m.set(k, { ...r, masuk: '-', pulang: '-' });
      const g = m.get(k);
      if (r.jenis === 'Pulang') g.pulang = r.waktu; else { g.masuk = r.waktu; g.status = r.status; if (r.keterangan) g.keterangan = r.keterangan; }
    });
    out = [...m.values()];
  }
  $('rekapHead').innerHTML = sekolah
    ? '<tr><th>Tanggal</th><th>NIS</th><th>Nama</th><th>Kelas</th><th>Jam Masuk</th><th>Jam Pulang</th><th>Status</th><th>Keterangan</th></tr>'
    : '<tr><th>Tanggal</th><th>Waktu</th><th>NIS</th><th>Nama</th><th>Kelas</th><th>Status</th><th>Mapel / Keterangan</th></tr>';
  const st = r => `<span class="badge text-bg-${badge(r.status)}">${esc(r.status)}</span>`;
  $('rekapBody').innerHTML = out.length ? out.map(r => sekolah
    ? `<tr><td>${esc(r.tanggal)}</td><td>${esc(r.nis)}</td><td><b>${esc(r.nama)}</b></td><td>${esc(r.kelas)}</td><td>${esc(r.masuk)}</td><td>${esc(r.pulang)}</td><td>${st(r)}</td><td>${esc(r.keterangan || '-')}</td></tr>`
    : `<tr><td>${esc(r.tanggal)}</td><td>${esc(r.waktu)}</td><td>${esc(r.nis)}</td><td><b>${esc(r.nama)}</b></td><td>${esc(r.kelas)}</td><td>${st(r)}</td><td>${esc(r.keterangan || '-')}</td></tr>`).join('')
    : '<tr><td colspan="8" class="text-center text-muted">Belum ada data absensi.</td></tr>';
}

// ===== MODUL TAMBAHAN =====
let TOKEN = sessionStorage.getItem('tk') || '', USER = JSON.parse(sessionStorage.getItem('usr') || 'null');
const NAV = [['dashboard','Dashboard','speedometer2'],['scan','Scan','qr-code-scan'],['siswa','Data Siswa','people'],['guru','Data Guru','person-badge'],['akun','Kelola Akun','person-gear',1],
  ['rekap','Rekap Presensi','table'],['pelanggaran','Pelanggaran','exclamation-triangle'],['rekapPel','Rekap Pelanggaran','file-earmark-text'],['prestasi','Prestasi Siswa','award'],
  ['rekapPres','Rekap Prestasi','bar-chart'],['peringkat','Peringkat','trophy'],['pengaturan','Pengaturan','gear',1]];
const MOD = {
  guru: { t: 'Data Guru', s: 'Data_Guru', c: [['NIP',1],['Nama',2],['Mata Pelajaran',3],['L/P',4]],
    f: [['nip','NIP'],['nama','Nama Lengkap'],['mapel','Mata Pelajaran'],['jk','Jenis Kelamin','select',['L','P']]] },
  akun: { t: 'Kelola Akun', s: 'Akun', c: [['Username',1],['Nama',2],['Role',3]],
    f: [['username','Username'],['nama','Nama'],['role','Role','select',['guru','admin']],['password','Password (min. 6 karakter)','password']] },
  pelanggaran: { t: 'Pelanggaran', s: 'Pelanggaran', c: [['Tanggal',1],['Nama',3],['Kelas',4],['Pelanggaran',5],['Poin',6],['Ket.',7]],
    f: [['tanggal','Tanggal','date'],['nis','Siswa','siswa'],['jenis','Jenis Pelanggaran'],['poin','Poin','number'],['ket','Keterangan']] },
  prestasi: { t: 'Prestasi Siswa', s: 'Prestasi', c: [['Tanggal',1],['Nama',3],['Kelas',4],['Prestasi',5],['Poin',6],['Ket.',7]],
    f: [['tanggal','Tanggal','date'],['nis','Siswa','siswa'],['jenis','Prestasi'],['poin','Poin','number'],['ket','Keterangan']] }
};
const LOAD = { guru: () => loadMod('guru'), akun: () => loadMod('akun'), pelanggaran: () => loadMod('pelanggaran'), prestasi: () => loadMod('prestasi'),
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
  api('getList', [{ sheet: m.s }], r => {
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
function rekapCatat(id, sheet, title) {
  mkSection(id, `<div class="d-flex justify-content-between flex-wrap gap-2 mb-3 no-print"><h3 class="fw-bold mb-0">${title}</h3><div class="d-flex gap-2 flex-wrap"><select id="fk-${id}" class="form-select w-auto"></select><button class="btn btn-success" onclick="cetak('rekap')"><i class="bi bi-printer"></i> Cetak</button></div></div>
    <div class="card"><div class="table-responsive"><table class="table mb-0"><thead><tr><th>#</th><th>Nama</th><th>Kelas</th><th>Jumlah</th><th>Total Poin</th></tr></thead><tbody id="tb-${id}"></tbody></table></div></div>`);
  $('fk-' + id).onchange = () => loadRekapCatat(id, sheet);
}
function loadRekapCatat(id, sheet) {
  kelasOpts($('fk-' + id));
  api('getList', [{ sheet }], r => {
    if (!r.success) return toast(r.message, 'danger');
    const k = $('fk-' + id).value, g = {};
    r.data.forEach(x => { if (k !== 'Semua' && String(x[4]) !== k) return; const m = g[x[2]] = g[x[2]] || { nama: x[3], kelas: x[4], n: 0, p: 0 }; m.n++; m.p += Number(x[6]) || 0; });
    const a = Object.values(g).sort((x, y) => y.p - x.p);
    $('tb-' + id).innerHTML = a.length ? a.map((m, i) => `<tr><td>${i + 1}</td><td><b>${esc(m.nama)}</b></td><td>${esc(m.kelas)}</td><td>${m.n}</td><td>${m.p}</td></tr>`).join('') : empty(5);
  });
}
// -- Peringkat
function mkPeringkat() {
  mkSection('peringkat', `<div class="d-flex justify-content-between flex-wrap gap-2 mb-3"><div><h3 class="fw-bold mb-0">Peringkat</h3><small class="text-muted">Skor = poin prestasi − poin pelanggaran</small></div><select id="fk-peringkat" class="form-select w-auto"></select></div>
    <div class="card"><div class="table-responsive"><table class="table mb-0"><thead><tr><th>#</th><th>Nama</th><th>Kelas</th><th>Prestasi</th><th>Pelanggaran</th><th>Skor</th></tr></thead><tbody id="tb-peringkat"></tbody></table></div></div>`);
  $('fk-peringkat').onchange = loadPeringkat;
}
function loadPeringkat() {
  kelasOpts($('fk-peringkat'));
  api('getPeringkat', [{}], r => {
    if (!r.success) return toast(r.message, 'danger');
    const k = $('fk-peringkat').value, a = r.data.filter(x => k === 'Semua' || String(x.kelas) === k);
    $('tb-peringkat').innerHTML = a.length ? a.map((x, i) => `<tr><td>${['🥇','🥈','🥉'][i] || i + 1}</td><td><b>${esc(x.nama)}</b></td><td>${esc(x.kelas)}</td><td class="text-success">${x.prestasi}</td><td class="text-danger">${x.pelanggaran}</td><td><b>${x.skor}</b></td></tr>`).join('') : empty(6);
  });
}
// -- Pengaturan
function mkPengaturan() {
  mkSection('pengaturan', `<h3 class="fw-bold mb-3">Pengaturan</h3><form id="pengForm" class="card p-3" style="max-width:480px">${[['terlambat','Batas tepat waktu (lewat = Terlambat)'],['batasMasuk','Batas akhir absen masuk'],['mulaiPulang','Mulai absen pulang']].map(([k, l]) => `<label class="form-label">${l}</label><input type="time" name="${k}" class="form-control mb-3" required>`).join('')}<button class="btn btn-primary">Simpan</button></form>`);
  $('pengForm').onsubmit = e => { e.preventDefault(); api('simpanPengaturan', [Object.fromEntries(new FormData(e.target))], r => toast(r.message, r.success ? 'success' : 'danger')); };
}
function loadPeng() { api('getPengaturan', [{}], r => { if (r.success) Object.entries(r.data).forEach(([k, v]) => { $('pengForm').elements[k].value = v; }); }); }
// -- Login & sesi
function showLogin() { $('loginBox').style.display = 'flex'; }
function logout() { TOKEN = ''; USER = null; sessionStorage.clear(); stopScan(); showLogin(); }
function buildNav() {
  $('nav').innerHTML = NAV.filter(n => !n[3] || USER.role === 'admin').map(n => `<li><a class="nav-link" data-section="${n[0]}"><i class="bi bi-${n[2]}"></i> ${n[1]}</a></li>`).join('');
  document.querySelectorAll('[data-section]').forEach(l => l.onclick = () => navigateTo(l.dataset.section));
}
function start() {
  $('loginBox').style.display = 'none'; $('userInfo').innerHTML = `<div class="d-flex align-items-center gap-2"><span class="avatar">${esc(String(USER.nama).charAt(0).toUpperCase())}</span><div><b>${esc(USER.nama)}</b><br><small class="text-muted">${esc(USER.role)}</small></div></div>`;
  buildNav(); loadSiswa(); navigateTo('dashboard');
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
  $('dashDate').onchange = loadDash; $('btnRekap').onclick = loadRekap; $('btnLogout').onclick = logout;
  initFilter(); Object.keys(MOD).forEach(crud);
  rekapCatat('rekapPel', 'Pelanggaran', 'Rekap Pelanggaran'); rekapCatat('rekapPres', 'Prestasi', 'Rekap Prestasi'); mkPeringkat(); mkPengaturan();
  document.querySelector('.main-content').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.add) openForm(b.dataset.add);
    if (b.dataset.del) { const id = b.dataset.del, rid = b.dataset.id; hapusFn = () => api('hapusData', [{ sheet: MOD[id].s, id: rid }], r => { done(r); if (r.success) loadMod(id); }); $('hapusTeks').textContent = 'Hapus data ini?'; bootstrap.Modal.getOrCreateInstance($('mdlHapus')).show(); }
  });
  $('genForm').onsubmit = e => {
    e.preventDefault(); const id = e.target.dataset.mod;
    api('tambahData', [{ sheet: MOD[id].s, f: Object.fromEntries(new FormData(e.target)) }], r => { toast(r.message, r.success ? 'success' : 'danger'); if (r.success) { bootstrap.Modal.getInstance($('mdlForm')).hide(); loadMod(id); } });
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
  TOKEN && USER ? start() : showLogin();
});
