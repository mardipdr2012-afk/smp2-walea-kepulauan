# Panduan Instalasi — Absen Siswa (GitHub Pages + Apps Script)

## A. Pasang backend (di browser, sekali saja)
1. Buka Google Sheet database → **Ekstensi → Apps Script**.
2. Hapus semua file lama (code.gs, setup.gs, Index.html, Style.html, Script.html).
3. Buat satu file **Kode.gs**, tempel isi `Kode.gs` yang baru. Simpan.
4. Pilih fungsi `setupAppEnvironment` → **Run** → beri izin. Data lama tidak diubah; 4 sheet baru dibuat (Data_Guru, Akun, Pelanggaran, Prestasi).
   Buka **Execution log**: di sana tertulis **username & password admin awal**. Catat, lalu buat akun admin baru di menu Kelola Akun dan hapus akun awal.
5. **Deploy → New deployment → Web app**: *Execute as* = **Me**, *Who has access* = **Anyone** → Deploy.
6. Salin URL berakhiran `/exec`, uji di browser dengan menambah `?action=ping` → harus muncul `"API aktif"`.

## B. Isi konfigurasi frontend
Ekstrak ZIP. Buka `js/config.js`, tempel URL `/exec` di `GAS_URL`.

## C. Folder kerja Git
Folder hasil ekstrak ZIP, yaitu **`absen-smpn2-walea`**, adalah folder tempat `git init` dijalankan.
Isinya harus langsung terlihat: `index.html`, `css\`, `js\`. Jangan masuk lebih dalam, jangan naik satu level.

## D. Push ke GitHub (dari terminal, JANGAN upload via web)
```
git init
git add .
git commit -m "Upload pertama"
git branch -M main
git remote add origin https://github.com/USERNAME/NAMA-REPO.git
git push -u origin main
```
Password saat push = **Personal Access Token** (scope `repo`), bukan password akun.

## E. Aktifkan Pages
Repo → **Settings → Pages** → Deploy from a branch → **main** / **(root)** → Save. Centang **Enforce HTTPS**.
Situs: `https://USERNAME.github.io/NAMA-REPO/`

## F. Update
```
git add .
git commit -m "Perubahan"
git push
```
Jika backend (Kode.gs) diubah: **Deploy → Manage deployments → Edit → New version**.
