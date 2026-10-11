# PlayTube Klasik

Website video full-stack dengan tampilan ala YouTube klasik. Teknologi: Node.js, Express, SQLite, HTML/CSS/JavaScript, Socket.IO, dan WebRTC.

## Fitur
- Registrasi, login, logout, password disimpan dalam bentuk hash.
- Upload file video MP4, WebM, OGG, MOV (maksimum 500 MB).
- Database SQLite untuk akun, metadata video, likes, komentar, playlist, riwayat, dan live.
- Pencarian, kategori, halaman tontonan, like/unlike, komentar.
- Playlist pribadi dan riwayat tontonan untuk pengguna yang login.
- Dashboard admin: statistik, hapus video, hapus pengguna.
- Live streaming kamera/mikrofon via WebRTC dan Socket.IO untuk signaling.

## Persyaratan
- Node.js 18 atau lebih baru
- npm
- Browser modern. Akses kamera/mikrofon memerlukan `localhost` atau HTTPS.

## Menjalankan di Windows
1. Ekstrak ZIP ke folder, misalnya `C:\PlayTube`.
2. Instal Node.js LTS dari https://nodejs.org jika belum tersedia.
3. Buka folder proyek di File Explorer, klik kanan ruang kosong lalu pilih **Open in Terminal**.
4. Jalankan:
   ```bash
   npm install
   npm start
   ```
5. Buka http://localhost:3000 di browser.

## Login admin awal
- Username: `admin`
- Password: `Admin123!`

Ganti kredensial untuk pemakaian serius dengan mengatur environment variable sebelum server pertama kali dijalankan. Contoh PowerShell:
```powershell
$env:ADMIN_USERNAME="namaadmin"
$env:ADMIN_PASSWORD="password-admin-yang-kuat"
$env:SESSION_SECRET="string-rahasia-panjang-dan-acak"
npm start
```
Akun admin dibuat saat pertama kali database dibuat. Jika admin sudah ada, mengubah environment variable tidak mengubah password akun yang sudah tersimpan.

## Catatan penting
- File database dibuat di `data/playtube.sqlite`, file video di `uploads/`.
- Simpan cadangan kedua lokasi tersebut.
- Live streaming ini memakai koneksi peer-to-peer WebRTC. Untuk penggunaan publik/internet, hosting harus memakai HTTPS, dan beberapa jaringan memerlukan server TURN. Demo ini bukan infrastruktur streaming berskala besar; jumlah penonton akan membebani koneksi pengunggah.
- Server sesi default memakai MemoryStore, cocok untuk pengembangan lokal saja. Untuk produksi, gunakan session store yang persisten, proteksi CSRF/rate-limit, validasi file yang lebih kuat, batas penyimpanan, moderasi, dan konfigurasi reverse proxy.
- Penghapusan akun pengguna oleh admin menghapus record video pengguna dari database; bersihkan file upload terkait secara manual bila diperlukan.
- Pastikan hanya mengunggah video yang kamu miliki atau berhak distribusikan.
