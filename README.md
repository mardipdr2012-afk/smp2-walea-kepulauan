# Absen Siswa — SMP Negeri 2 Walea Kepulauan (Frontend)

Frontend statis untuk GitHub Pages. Data & logika absensi ada di Google Apps Script (`Kode.gs`, tidak ikut di folder ini).

## Struktur
```
index.html
css/style.css
js/config.js   <- isi GAS_URL (URL /exec) di sini
js/api.js      <- komunikasi fetch() ke Apps Script
js/app.js      <- logika aplikasi
img/logo.png
```

## Cara pakai singkat
1. Deploy `Kode.gs` sebagai Web App (Execute as: Me, Access: Anyone), salin URL `/exec`.
2. Buka `js/config.js`, ganti `GANTI_DENGAN_URL_EXEC_ANDA` dengan URL tersebut.
3. Push folder ini ke GitHub, aktifkan Pages (branch `main`, folder `/ (root)`).

Detail lengkap: lihat `PANDUAN-INSTALASI.md`.
