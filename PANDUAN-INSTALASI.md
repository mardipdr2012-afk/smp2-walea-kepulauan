# PANDUAN INSTALASI — Absen Siswa SMP Negeri 2 Walea Kepulauan (v3.0)

Aplikasi dipecah dua: **backend** (Google Apps Script, data tetap di Google Sheets yang sama) dan **frontend** (GitHub Pages).
Database TIDAK berubah, jadi semua data absensi & siswa lama tetap aman.

## BAGIAN 1 — Backend (Google Apps Script)
1. Buka proyek Apps Script absensi Anda yang sekarang (script.google.com).
2. Buka file `Kode.gs` → hapus seluruh isinya → paste isi `Kode.gs` versi 3.0 → Simpan.
3. File `Index`, `Stylesheet`, `JavaScript` (HTML) sudah tidak dipakai. Boleh dihapus (opsional, tidak mengganggu).
4. (Opsional) Pilih fungsi `setupAppEnvironment` → Run untuk memverifikasi database. Fungsi ini aman diulang dan tidak mengubah data.
5. **Terapkan → Kelola deployment → ikon pensil (Edit) → Versi: "Versi baru" → Terapkan.**
   - Pastikan: Jalankan sebagai **Saya**, Yang memiliki akses **Siapa saja**.
   - Dengan cara ini URL `/exec` tetap sama. Kalau membuat "Deployment baru", URL-nya berganti.
6. Salin URL `/exec`.
7. Uji di browser: buka `URL/exec?action=ping` → harus muncul JSON berisi `"success":true`.

## BAGIAN 2 — Frontend
1. Ekstrak `absen-smpn2-walea.zip`. Folder hasil ekstraksi **`absen-smpn2-walea`** inilah folder proyek (tempat `git init`).
2. Buka `js/config.js` dengan Notepad, ganti `GANTI_DENGAN_URL_EXEC_ANDA` dengan URL `/exec`. Simpan.
3. Di dalam folder itu harus langsung terlihat: `index.html`, `css`, `js`, `img`. Kalau yang terlihat hanya satu folder lagi, masuk ke dalamnya dulu.

## BAGIAN 3 — Deploy ke GitHub Pages
1. Install Git (https://git-scm.com/download/win), cek dengan `git --version`.
2. Buat akun GitHub, lalu buat repository **Public** baru (jangan centang README/.gitignore/license).
3. Setting identitas (sekali saja):
   ```
   git config --global user.name "Nama Anda"
   git config --global user.email "email@akun-github.com"
   ```
4. Buka PowerShell **di folder `absen-smpn2-walea`**, lalu `dir` — wajib terlihat `index.html` di daftar.
5. Jalankan satu per satu:
   ```
   git init
   git add .
   git commit -m "Upload pertama"
   git branch -M main
   git remote add origin https://github.com/USERNAME/NAMA-REPO.git
   git push -u origin main
   ```
   Saat diminta password, isi dengan **Personal Access Token** (https://github.com/settings/tokens → Generate new token (classic) → centang `repo`). Saat paste token, layar tampak kosong — itu normal.
6. Di GitHub: repo → Settings → Pages → Source **Deploy from a branch** → Branch `main` / `(root)` → Save → centang **Enforce HTTPS**.
7. Tunggu 1–2 menit, buka `https://USERNAME.github.io/NAMA-REPO/`.

## Update di kemudian hari
```
git add .
git commit -m "Deskripsi perubahan"
git push
```
Kalau tampilan lama masih muncul: Ctrl+Shift+R.

## Catatan perubahan v3.0
- Kamera QR kini lebih mungkin berfungsi (GitHub Pages memakai HTTPS dan tidak di dalam iframe Apps Script).
- Daftar siswa disimpan di cache server 5 menit supaya scan lebih cepat. Jika Anda mengedit Data_Siswa langsung di Google Sheets, perubahan baru terbaca maksimal 5 menit kemudian (tambah/hapus lewat aplikasi langsung berlaku).
- Perbaikan: Input Manual (Sakit/Izin/Alpa) kini selalu tercatat sebagai jenis "Masuk" walau dropdown Jenis Absen sedang di "Pulang".
- Logo dipisah menjadi `img/logo.png` agar halaman lebih ringan.

## Troubleshooting cepat
| Gejala | Penyebab / Solusi |
|---|---|
| Toast "GAS_URL belum diisi" | `js/config.js` belum diisi → edit, lalu add/commit/push |
| "Jawaban server bukan JSON" | Deployment belum "Siapa saja" atau belum Versi baru → deploy ulang |
| Situs GitHub 404 | `index.html` tidak di root repo → push dari folder yang benar |
| Halaman tanpa styling | Folder `css/` `js/` tidak ikut → pastikan `git init` di folder proyek |
| Data kosong/error setelah ganti kode GAS | Lupa "Versi baru" saat Terapkan |
