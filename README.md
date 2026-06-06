# PaySats

**Project:** Paysats · **Team:** paysats (Nick × Vib)

Agent-first Bitcoin super app with an MCP server, built on **Privy × Base**.

> IDRX × Base · USDC · x402 · Privy — built for the South East Asia market to deposit, save (DCA), borrow, and cash out.

## What's new on this branch (`mcp/privy`)

This branch turns PaySats into an **agentic Bitcoin super app**: an AI agent (e.g. Claude) connects to a hosted **MCP server** and operates the user's wallet on Base, while every on-chain action is signed **server-side via Privy's device-authorization grant** (no browser pop-ups). It targets the South East Asia market with rupiah on/off-ramps through IDRX.

**Flows the agent can run end-to-end:**

- **Deposit (IDR → IDRX):** create an IDR deposit; the user pays via bank/QRIS and IDRX is minted to their Privy smart wallet on Base.
- **Save (DCA into Bitcoin):** recurring IDRX → cbBTC swaps on a daily/weekly/monthly schedule. Low balance auto-returns a deposit link for the shortfall instead of failing.
- **Borrow (USDC against BTC):** lock cbBTC into **Morpho** as collateral and borrow USDC, capped at a safe LTV — `approve + supplyCollateral + borrow` batched into one sponsored UserOp.
- **Cash out (USDC → IDR):** convert USDC to IDR via IDRX redeem and disburse to a saved bank / e-wallet (GoPay, BCA, etc.).

**MCP tools exposed:** `get_account`, `create_idr_deposit`, `get_deposit_status`, `setup_dca`, `get_dca_status`, `cancel_dca`, `get_dca_history`, `get_credit`, `borrow_against_btc`, `list_payout_destinations`, `cash_out_to_bank`.

**Auth:** custom OAuth 2.0 + RFC 8628 device-authorization grant bridging the MCP client to a Privy user/session, so the server can sign transactions on the user's behalf within a Privy policy.

**Stack additions:** `@modelcontextprotocol` / `mcp-handler` MCP server (`app/api/mcp/[transport]`), OAuth endpoints (`app/api/oauth/*`, `app/.well-known/*`), Privy device-auth + server signing (`services/privy/*`), Morpho credit service (`services/credit/*`), IDRX mint/redeem/destinations services (`services/idrx/*`), DCA order/signing services (`services/dca/*`), and Base mainnet (chain `8453`, cbBTC + USDC + Morpho Blue).

**Example transactions (BaseScan):**

- **IDR deposit (IDRX mint):** [`0x713ae0f8…56d9af35b`](https://basescan.org/tx/0x713ae0f87b9ede60f49cfa8e03209558210690438a70d6c73c62fc056d9af35b)
- **IDR DCA → cbBTC:** [`0x4c039751…d58e6083`](https://basescan.org/tx/0x4c039751e39d3a028b484c4e84e5c35a5346efd55fec3aebbf053450d58e6083)

---

# PaySats — produk web (mobile-first)

Aplikasi produk PaySats: autentikasi Privy (Google + dompet embedded), onboarding IDRX (KYC), permintaan mint IDRX, dan riwayat transaksi. Tidak ada landing pemasaran; fokus pada alur produk.

## Stack

- Next.js (App Router), TypeScript, Tailwind CSS v4
- Privy (`@privy-io/react-auth`, `@privy-io/server-auth`)
- Prisma + SQLite (ganti `DATABASE_URL` ke Postgres untuk produksi)
- Wrapper API server untuk IDRX (signing & rahasia hanya di server)
- `patch-package`: patch kecil pada Next.js 16 agar `<div hidden>` di `MetadataWrapper` memakai `suppressHydrationWarning` (mencegah peringatan hydration ketika ekstensi browser menyuntikkan atribut seperti `bis_skin_checked`). Berkas ada di [`patches/next+16.2.3.patch`](patches/next+16.2.3.patch); jalankan `npm install` agar patch diterapkan. Setelah upgrade `next`, sesuaikan atau hapus patch jika sudah tidak diperlukan.

## Setup lokal

1. **Salin environment**

   ```bash
   cp .env.example .env
   ```

   Isi `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `ENCRYPTION_KEY` (64 karakter hex), `IDRX_ORG_API_KEY`, `IDRX_ORG_API_SECRET`, dan `IDRX_API_BASE_URL` (sandbox atau produksi). Opsional: `NEXT_PUBLIC_BTC_ERC20_ADDRESS` (mis. cbBTC di Base) untuk tab saldo BTC di Beranda.

2. **Install & database**

   ```bash
   npm install
   npx prisma migrate dev
   ```

3. **Jalankan**

   ```bash
   npm run dev
   ```

   Buka [http://localhost:3000](http://localhost:3000) — kamu akan diarahkan ke `/auth`.

## Privy

- Di dashboard Privy: aktifkan **Google** sebagai metode login.
- Aktifkan **embedded Ethereum wallet**; gunakan `createOnLogin: users-without-wallets` (sudah dikonfigurasi di `app/providers.tsx`).
- Pastikan domain lokal / produksi diizinkan di pengaturan aplikasi Privy.

## IDRX

- Onboarding organisasi memakai kredensial **org** di env (`IDRX_ORG_*`). Respons onboarding berisi **apiKey / apiSecret per user**; keduanya disimpan **terenkripsi** di database dan dipakai untuk mint + riwayat.
- Endpoint internal:

  - `POST /api/idrx/onboarding` — `multipart/form-data` (proxy ke IDRX)
  - `POST /api/idrx/mint-request` — JSON
  - `GET /api/idrx/transactions` — normalisasi ke tipe `MintTransaction`

- Signing mengikuti dokumentasi IDRX (HMAC-SHA256, secret di-decode dari base64, digest base64url). Untuk onboarding multipart, body yang ditandatangani adalah objek field teks saja (tanpa file); jika sandbox menolak signature, sesuaikan dengan contoh resmi IDRX.

## Arsitektur & ekstensi

- `services/idrx/` — klien IDRX
- `services/wallet/` — utilitas alamat EVM
- `services/dca/` — stub tabungan rutin / DCA ke cbBTC (belum diimplementasi)
- `services/chainlink/` — stub otomasi keeper (belum diimplementasi)

## Build produksi

```bash
npm run build
```

Tanpa `NEXT_PUBLIC_PRIVY_APP_ID`, build tetap berhasil tetapi Privy tidak di-mount; set variabel tersebut untuk aplikasi yang dipakai pengguna.

## Keamanan

- Jangan mengekspos `IDRX_ORG_*`, `PRIVY_APP_SECRET`, `ENCRYPTION_KEY`, atau kredensial per-user IDRX ke klien.
- Gunakan HTTPS di produksi; rotasi kunci jika bocor.

## Skrip

| Skrip          | Fungsi                |
| -------------- | --------------------- |
| `npm run dev`  | Server pengembangan   |
| `npm run build`| Build + `prisma generate` |
| `npm run lint` | ESLint                |
| `npm run db:migrate` | Prisma migrate dev |
| `npm run db:studio`  | Prisma Studio      |
