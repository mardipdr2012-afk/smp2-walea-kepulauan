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
function api(fn, args, ok, loader = true) {
  if (!GAS_URL || GAS_URL.includes('PASTE')) return toast('GAS_URL belum diisi di js/config.js', 'danger');
  if (loader) spin(1);
  fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: fn, token: TOKEN, data: (ARG_MAP[fn] || (a => a[0] || {}))(args) }) })
    .then(r => r.json())
    .then(r => { if (loader) spin(0); if (r && r.code === 'AUTH') return logout(); ok && ok(r); },
          e => { if (loader) spin(0); scanBusy = false; toast('Gagal terhubung ke server: ' + ((e && e.message) || e), 'danger'); });
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
  if (!$('dashDate').value) $('dashDate').value = new Date().toLocaleDateString('sv-SE');
  api('getDashboardData', [$('dashDate').value], r => {
    if (!r.success) return toast(r.message, 'danger');
    const x = r.data;
    const k = [['Total Siswa', x.total, '#3b82f6'], ['Hadir', x.hadir, '#10b981'], ['Terlambat', x.terlambat, '#f59e0b'],
               ['Izin/Sakit', x.izin, '#06b6d4'], ['Alpa', x.alpa, '#ef4444'], ['Belum Absen', x.belum, '#94a3b8']];
    $('kpi').innerHTML = k.map(([l, v, c]) => `<div class="col-6 col-md-4 col-xl-2"><div class="stat-card" style="border-left-color:${c}"><div class="v">${v}</div><div class="l">${l}</div></div></div>`).join('');
    $('insights').innerHTML = x.insights.map(i => `<li>${esc(i)}</li>`).join('');
    if (chart) chart.destroy();
    chart = new Chart($('chartStatus'), { type: 'doughnut',
      data: { labels: ['Tepat Waktu', 'Terlambat', 'Izin/Sakit', 'Alpa', 'Belum Absen'],
        datasets: [{ data: [x.hadir - x.terlambat, x.terlambat, x.izin, x.alpa, x.belum], backgroundColor: ['#10b981', '#f59e0b', '#06b6d4', '#ef4444', '#94a3b8'], borderWidth: 0 }] },
      options: { plugins: { legend: { position: 'bottom', labels: { color: getComputedStyle(document.body).color } } } } });
    $('recent').innerHTML = x.recent.length ? x.recent.map(r => `<tr><td>${esc(r.waktu)}</td><td><b>${esc(r.nama)}</b></td><td>${esc(r.kelas)}</td>
      <td><span class="badge text-bg-${r.jenis === 'Pulang' ? 'warning' : 'primary'}">${esc(r.jenis)}</span></td>
      <td><span class="badge text-bg-${badge(r.status)}">${esc(r.status)}</span></td></tr>`).join('')
      : '<tr><td colspan="5" class="text-center text-muted">Belum ada absen pada tanggal ini.</td></tr>';
  });
}

// ===== DATA SISWA =====
function loadSiswa(cb) {
  api('getSiswa', [], r => {
    if (!r.success) return toast(r.message, 'danger');
    siswa = r.data;
    $('siswaBody').innerHTML = siswa.length ? siswa.map(s => `<tr><td>${esc(s.nis)}</td><td><b>${esc(s.nama)}</b></td><td>${esc(s.kelas)}</td><td>${esc(s.jk)}</td>
      <td class="text-nowrap"><button class="btn btn-sm btn-primary" data-act="kartu" data-nis="${esc(s.nis)}">Kartu Pelajar</button>
      <button class="btn btn-sm btn-danger" data-act="hapus" data-nis="${esc(s.nis)}">Hapus</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="text-center text-muted">Belum ada data siswa.</td></tr>';
    $('mNis').innerHTML = '<option value="">-- Pilih Siswa --</option>' + siswa.map(s => `<option value="${esc(s.nis)}">${esc(s.nis)} - ${esc(s.nama)}</option>`).join('');
    const cur = $('fKelas').value;
    $('fKelas').innerHTML = '<option value="Semua">Semua Kelas</option>' + [...new Set(siswa.map(s => s.kelas))].sort().map(k => `<option>${esc(k)}</option>`).join('');
    if ([...$('fKelas').options].some(o => o.value === cur)) $('fKelas').value = cur;
    cb && cb();
  });
}
$('siswaBody').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const s = siswa.find(x => x.nis === b.dataset.nis); if (!s) return;
  if (b.dataset.act === 'kartu') bukaKartu(s);
  if (b.dataset.act === 'hapus') { hapusNis = s.nis; hapusFn = null; $('hapusTeks').textContent = `Hapus siswa ${s.nama} (NIS ${s.nis})?`; bootstrap.Modal.getOrCreateInstance($('mdlHapus')).show(); }
});
let hapusFn = null;
function done(r) { bootstrap.Modal.getInstance($('mdlHapus')).hide(); toast(r.message, r.success ? 'success' : 'danger'); }
$('btnHapusOk').onclick = () => (hapusFn || (() => api('hapusSiswa', [hapusNis], r => { done(r); if (r.success) loadSiswa(); })))();
$('btnTambah').onclick = () => { $('formSiswa').reset(); $('formSiswa').classList.remove('was-validated'); $('fPrev').classList.add('d-none'); fotoB64 = ''; bootstrap.Modal.getOrCreateInstance($('mdlSiswa')).show(); };
$('fFoto').onchange = e => {
  const f = e.target.files[0]; fotoB64 = ''; $('fPrev').classList.add('d-none'); if (!f) return;
  const rd = new FileReader();
  rd.onload = ev => { const img = new Image(); img.onload = () => {
    const c = document.createElement('canvas'); c.width = 200; c.height = Math.round(img.height * 200 / img.width);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    fotoB64 = c.toDataURL('image/jpeg', 0.6); $('fPrev').src = fotoB64; $('fPrev').classList.remove('d-none');
  }; img.src = ev.target.result; };
  rd.readAsDataURL(f);
};
$('formSiswa').onsubmit = e => {
  e.preventDefault(); $('formSiswa').classList.add('was-validated');
  if (!$('formSiswa').checkValidity()) return;
  api('simpanSiswa', [{ nis: $('fNis').value, nama: $('fNama').value, kelas: $('fKls').value, jk: $('fJk').value, foto: fotoB64 }], r => {
    toast(r.message, r.success ? 'success' : 'danger');
    if (r.success) { bootstrap.Modal.getInstance($('mdlSiswa')).hide(); loadSiswa(); }
  });
};

// ===== KARTU PELAJAR (foto dimuat sesuai kebutuhan) =====
function bukaKartu(s) {
  $('kNama').textContent = s.nama; $('kNis').textContent = 'NIS: ' + s.nis; $('kKelas').textContent = 'Kelas: ' + s.kelas;
  $('kFoto').innerHTML = 'Tanpa<br>Foto'; $('kQr').innerHTML = '';
  new QRCode($('kQr'), { text: s.nis, width: 90, height: 90, correctLevel: QRCode.CorrectLevel.H });
  bootstrap.Modal.getOrCreateInstance($('mdlKartu')).show();
  api('getFotoSiswa', [s.nis], r => { if (r.success && String(r.data).startsWith('data:image')) $('kFoto').innerHTML = `<img src="${r.data}">`; }, false);
}
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
      : t === 'siswa' ? `<select class="form-select" name="${k}" required>${siswa.map(s => `<option value="${esc(s.nis)}">${esc(s.nama)} (${esc(s.kelas)})</option>`).join('')}</select>`
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
  $('loginBox').style.display = 'none'; $('userInfo').textContent = USER.nama + ' (' + USER.role + ')';
  buildNav(); loadSiswa(); navigateTo('dashboard');
}

// ===== INISIALISASI =====
document.addEventListener('DOMContentLoaded', () => {
  setTheme(localStorage.getItem('theme') || 'dark');
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
  TOKEN && USER ? start() : showLogin();
});
