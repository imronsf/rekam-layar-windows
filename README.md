<div align="center">

<img src="build/icon.png" width="96" alt="Rekam Studio">

# Rekam Studio

**Perekam layar HD untuk Windows, dengan tampilan modern dan minimalis.**
Ringan, lancar, dan gratis.

[![Download](https://img.shields.io/github/v/release/imronsf/rekam-layar-windows?label=Download&style=for-the-badge&color=ff3d52)](https://github.com/imronsf/rekam-layar-windows/releases/latest)
![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?style=for-the-badge&logo=windows)
![License](https://img.shields.io/badge/License-MIT-3ccf91?style=for-the-badge)

<img src="docs/screenshot-main.png" alt="Tampilan Rekam Studio" width="860">

</div>

---

## ✨ Fitur

| | |
|---|---|
| 🎨 **Latar + bayangan** | Video tampil "mengambang" di atas latar gradien atau gambar sendiri, dengan sudut membulat dan bayangan yang bisa diatur |
| 📱 **Rasio fleksibel** | Asli, 16:9 landscape, 9:16 portrait (Reels/TikTok/Shorts), atau 1:1 persegi |
| 🖥️ **Layar atau jendela** | Rekam seluruh layar atau satu jendela saja, dengan pratinjau langsung |
| 🎬 **Kualitas HD** | 720p, 1080p, 2K, hingga 4K, pada 30 atau 60 fps, dengan kualitas Standar, Tinggi, atau Ultra |
| ⚡ **Akselerasi hardware** | MP4 (H.264 + AAC) di-encode oleh GPU, sehingga rekaman tetap mulus dan CPU tidak terbebani |
| 🔊 **Audio sistem + mikrofon** | Keduanya bisa direkam sekaligus, dilengkapi peredam bising, meter level, dan tombol bisukan mik |
| ⏸️ **Jeda & lanjut** | Hitung mundur 3 detik, jeda/lanjut, dan pintasan keyboard global |
| 💾 **Langsung ke disk** | Data ditulis ke file setiap detik, jadi aman untuk rekaman berjam-jam |
| 🙈 **Tidak ikut terekam** | Jendela Rekam Studio otomatis disembunyikan dari hasil rekaman |
| 📂 **Pustaka rekaman** | Putar, buka folder, atau hapus rekaman (file dipindahkan ke Recycle Bin) |
| 📐 **Responsif** | Tampilan menyesuaikan ukuran jendela, dari layar penuh sampai jendela kecil |

---

## 📥 Cara Pemasangan

### Cara 1: Installer (disarankan)

1. Buka halaman **[Releases](https://github.com/imronsf/rekam-layar-windows/releases/latest)**.
2. Unduh file **`RekamStudio-Setup-x.x.x.exe`**.
3. Jalankan file tersebut, pilih folder instalasi, lalu klik **Install**.
4. Buka **Rekam Studio** dari Desktop atau Start Menu.

> **Muncul peringatan "Windows protected your PC"?**
> Peringatan ini wajar untuk aplikasi baru yang belum memiliki sertifikat digital berbayar.
> Klik **More info**, lalu **Run anyway**.

### Cara 2: Portable (tanpa instalasi)

1. Unduh **`RekamStudio-Portable-x.x.x.exe`** dari halaman [Releases](https://github.com/imronsf/rekam-layar-windows/releases/latest).
2. Simpan di folder mana saja (bisa juga di flashdisk), lalu klik dua kali untuk menjalankan.

### Menghapus aplikasi

Buka **Settings → Apps → Installed apps**, cari **Rekam Studio**, lalu klik **Uninstall**.

---

## 🎯 Cara Menggunakan

1. **Pilih sumber** di tab **Sumber**: *Layar* untuk seluruh layar, atau *Jendela* untuk satu aplikasi.
2. **Atur hasil video** di tab **Pengaturan**:
   - **Rasio**: Asli, 16:9, 9:16 (portrait), atau 1:1
   - **Latar belakang**: pilih gradien, klik ⊘ untuk tanpa latar, atau ＋ untuk gambar sendiri
   - **Ukuran video**, **Sudut membulat**, dan **Bayangan** diatur lewat slider, dan hasilnya langsung terlihat di pratinjau
   - Resolusi, fps, kualitas, format, dan audio juga diatur di tab ini
3. Klik **tombol merah** untuk mulai merekam. Klik lagi untuk berhenti dan menyimpan.
4. Hasil rekaman ada di tab **Rekaman** dan tersimpan otomatis di folder `Videos\Rekam Studio`.

### Pintasan keyboard

| Pintasan | Fungsi |
|---|---|
| <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>R</kbd> | Mulai / hentikan rekaman |
| <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>P</kbd> | Jeda / lanjutkan |

Pintasan ini tetap berfungsi saat aplikasi diminimalkan.

<div align="center">
<img src="docs/screenshot-portrait.png" alt="Mode portrait 9:16 dengan latar Senja" width="720">
<br><sub>Mode portrait 9:16 dengan latar <i>Senja</i>, siap untuk Reels, TikTok, atau Shorts</sub>
</div>

### Tips

- Untuk rekaman yang paling lancar, pakai format **MP4** dengan kualitas **Tinggi**.
- Perkiraan ukuran file: 1080p 60 fps kualitas Tinggi menghasilkan ±95 MB per menit.
- Aktifkan **Minimalkan saat merekam** supaya jendela aplikasi langsung tersembunyi setelah rekaman dimulai.

---

## 💻 Persyaratan Sistem

- Windows 10 (versi 2004 atau lebih baru) atau Windows 11, 64-bit
- RAM 4 GB atau lebih
- Ruang disk yang cukup untuk menyimpan rekaman

---

## 🛠️ Untuk Developer

Dibuat dengan [Electron](https://www.electronjs.org/). Pastikan [Node.js](https://nodejs.org/) 20 atau lebih baru sudah terpasang.

```bash
git clone https://github.com/imronsf/rekam-layar-windows.git
cd rekam-layar-windows
npm install
npm start
```

| Perintah | Fungsi |
|---|---|
| `npm start` | Menjalankan aplikasi dalam mode pengembangan |
| `npm run selftest` | Uji otomatis semua mode (tanpa latar, 16:9, 9:16, 1:1 saat diminimalkan), lalu memastikan tiap file bisa diputar dengan ukuran yang benar |
| `npm run dist` | Membuat installer dan versi portable di folder `dist/` |

### Struktur proyek

```
main.js            Proses utama: jendela, capture, penulisan file, pintasan
preload.js         Jembatan API yang aman antara renderer dan proses utama
renderer/          Antarmuka (HTML, CSS, JavaScript)
  compositor.js    Penyusun latar, bayangan, dan rasio video (frame demi frame)
tools/             Pembuat ikon dan uji otomatis
build/icon.png     Ikon aplikasi
```

---

<div align="center">

Dikembangkan oleh **[imron.sf](https://github.com/imronsf)** · Lisensi [MIT](LICENSE)

</div>
