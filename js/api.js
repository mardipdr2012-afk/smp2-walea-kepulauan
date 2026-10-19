// ============================================
// API CLIENT — komunikasi ke Google Apps Script via fetch()
// ============================================
// Pemetaan nama fungsi lama (google.script.run) -> action API.
// GET  : membaca data      (parameter lewat query string)
// POST : menulis/menghapus (body JSON, Content-Type text/plain agar tanpa preflight CORS)
const ENDPOINT = {
  getSiswa:         { method: 'GET',  params: () => ({}) },
  getFotoSiswa:     { method: 'GET',  params: a => ({ nis: a[0] }) },
  getDashboardData: { method: 'GET',  params: a => ({ tanggal: a[0] }) },
  getRekap:         { method: 'GET',  params: a => a[0] },
  simpanSiswa:      { method: 'POST', params: a => a[0] },
  hapusSiswa:       { method: 'POST', params: a => ({ nis: a[0] }) },
  simpanAbsensi:    { method: 'POST', params: a => ({ nis: a[0], status: a[1], ket: a[2], jenis: a[3] }) }
};
const API_TIMEOUT_MS = 40000;

/** Memanggil API. Mengembalikan Promise berisi objek { success, data, message }. */
async function callServer(fn, args = []) {
  if (!GAS_URL || GAS_URL.indexOf('script.google.com') < 0) {
    throw new Error('GAS_URL belum diisi. Edit file js/config.js lalu push ulang.');
  }
  const ep = ENDPOINT[fn];
  if (!ep) throw new Error('Fungsi API tidak dikenal: ' + fn);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const p = ep.params(args);
    let res;
    if (ep.method === 'GET') {
      const qs = new URLSearchParams({ action: fn, ...p, _t: Date.now() });
      res = await fetch(GAS_URL + '?' + qs.toString(), { signal: ctrl.signal, cache: 'no-store' });
    } else {
      res = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // WAJIB text/plain
        body: JSON.stringify({ action: fn, data: p }),
        signal: ctrl.signal
      });
    }
    if (!res.ok) throw new Error('Server menjawab dengan kode ' + res.status);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Server terlalu lama menjawab. Coba lagi.');
    if (e instanceof SyntaxError) throw new Error('Jawaban server bukan JSON. Pastikan Web App di-deploy: Execute as Me, akses Anyone.');
    throw e;
  } finally { clearTimeout(timer); }
}
