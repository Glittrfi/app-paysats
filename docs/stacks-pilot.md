# PaySats Stacks Pilot — Milestone 1

Stacks integration foundation + USDCx → sBTC swap via Bitflow, funded by the
Stacks Endowment (Getting Started track). This document covers setup,
architecture, and how to verify the Milestone 1 acceptance criteria.

## What shipped

- **Stacks wallet connection** (Leather / Xverse / any `@stacks/connect`
  wallet). Wallets stay fully self-custodial; PaySats never holds keys.
- **Account linking**: the connected Stacks address is linked to the user's
  PaySats account (Privy-authenticated), the foundation for Milestone 2
  history and Milestone 3 MCP reads.
- **Balance reads**: STX, USDCx, and sBTC balances via the Hiro API.
- **USDCx → sBTC swap** through the Bitflow DEX aggregator, with:
  - live quote + route display,
  - an explicit in-app review panel (amount in, estimated out, minimum
    received at the chosen slippage bound, venue),
  - wallet approval required before anything is broadcast (two approval
    layers: in-app review, then the wallet's own signing prompt),
  - on-chain post-conditions (`PostConditionMode.Deny`) so the transaction
    aborts if the output falls below the slippage bound,
  - transaction status tracking with Hiro Explorer links,
  - a durable `StacksSwap` record per swap (evidence trail).

## Setup

1. Install dependencies (already in `package.json`):
   `@stacks/connect`, `@stacks/transactions`, `@stacks/network`,
   `@bitflowlabs/core-sdk`.
2. Apply the database migration:

   ```bash
   npx prisma migrate deploy
   ```

3. Configure the environment (see `.env.example`):

   ```bash
   NEXT_PUBLIC_STACKS_NETWORK=mainnet   # or "testnet"
   ```

   No Bitflow API key is needed (public limit: 500 req/min/IP). Optional
   `BITFLOW_API_KEY` / `READONLY_CALL_API_KEY` / `KEEPER_API_KEY` raise limits.

4. Run the app (`npm run dev`) and open **Home → "Stacks pilot · sBTC"** or
   navigate to `/stacks`.

## Networks: testnet vs mainnet

| Capability | Testnet | Mainnet |
| --- | --- | --- |
| Wallet connect + account linking | Yes | Yes |
| STX / USDCx / sBTC balances | Yes | Yes |
| USDCx → sBTC swap via Bitflow | **No** | Yes |

**Finding (Milestone 1 risk check):** the Bitflow SDK and its aggregator API
are hardwired to Stacks mainnet (`STACKS_MAINNET` in the SDK context; the
routing API only indexes mainnet pools). There is no testnet USDCx/sBTC
route. The swap demo therefore runs on **mainnet with small amounts**, which
the milestone acceptance criteria explicitly allow ("testnet or mainnet").
The rest of the foundation (wallet, linking, balances) is network-switchable
via `NEXT_PUBLIC_STACKS_NETWORK`, and testnet users get a Hiro faucet link
when their STX balance is zero.

Verified route (July 2026): `USDCx → aeUSDC → STX → sBTC` through
`SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.router-stableswap-xyk-multihop-v-1-2`
(`swap-helper-b`), quoted at ~14,679 sats per 10 USDCx.

## Contracts and endpoints

| Item | Mainnet | Testnet |
| --- | --- | --- |
| USDCx (SIP-010) | `SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx` (FT: `usdcx-token`) | `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx` (FT: `usdcx-token`) |
| sBTC (SIP-010) | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` | `ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT.sbtc-token` (Hiro faucet deployment) |
| Hiro API | `https://api.hiro.so` | `https://api.testnet.hiro.so` |
| Bitflow API | `https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev` | n/a |

Note: the Bitflow SDK's built-in default API host is retired and returns 404;
the working gateway above is set in `lib/stacks/config.ts` (overridable via
`NEXT_PUBLIC_BITFLOW_API_HOST`).

## Architecture

```
features/stacks/stacks-client.tsx   UI: connect, balances, swap, history
hooks/use-stacks-wallet.ts          @stacks/connect session + /api/stacks/link
hooks/use-stacks-balances.ts        balances via /api/stacks/balances
hooks/use-stacks-swap.ts            quote fetch, Bitflow executeSwap, tx polling
lib/stacks/config.ts                network/token/host constants
lib/stacks/tx.ts                    Hiro tx status reads (browser-safe)
services/stacks/balances.ts         Hiro balances (server)
services/stacks/bitflow.ts          Bitflow SDK singleton + quote (server)
app/api/stacks/link/route.ts        POST link/unlink Stacks address
app/api/stacks/balances/route.ts    GET balances
app/api/stacks/swap/quote/route.ts  GET best route + quote
app/api/stacks/swap/record/route.ts GET/POST/PATCH swap records
prisma: User.stacksAddress/-Network/-LinkedAt + StacksSwap model
```

Swap flow, end to end:

1. Client debounce-fetches `GET /api/stacks/swap/quote?amount=N` — the server
   asks the Bitflow aggregator for the best USDCx → sBTC route and returns the
   quote plus the full route object.
2. User opens the **review panel** (amount in, estimated sats out, minimum
   received at the slippage bound, venue) and clicks **Approve in wallet**.
3. Client calls `BitflowSDK.getSwapParams` for the exact quoted route, then
   submits via `@stacks/connect` `request('stx_callContract')` (the modern
   SIP-030 path — Bitflow's built-in `executeSwap` still uses legacy
   `openContractCall`, which fails on connect v8 with a SessionData error).
   The wallet shows the contract call with post-conditions → the user
   approves or rejects.
4. On broadcast, the tx is recorded (`POST /api/stacks/swap/record`, status
   `pending`) and the client polls the Hiro API until the tx anchors, then
   PATCHes the record to `success`/`failed` and refreshes balances.

## Verifying the acceptance criteria

- *Stacks integration foundation implemented*: connect a wallet at `/stacks`,
  see the linked address on the account (`User.stacksAddress`) and live
  STX/USDCx/sBTC balances.
- *User can initiate and approve a USDCx → sBTC swap*: fund USDCx + a little
  STX, enter an amount, review, approve in the wallet.
- *Demonstrated on testnet or mainnet*: mainnet (see network table above for
  why). Each swap links to Hiro Explorer.
- *Repo / reference, documentation, demo*: this document, the public
  implementation reference (`docs/stacks-pilot-public-reference.md`), and the
  demo video (checklist below).

## Demo video checklist

1. Sign in to PaySats (Google) and open Home → **Stacks pilot · sBTC**.
2. Connect Leather or Xverse; show the linked address and the network badge.
3. Show live USDCx / sBTC / STX balances.
4. Enter a USDCx amount; show the live quote and route.
5. Open the review panel; call out estimated vs minimum received and slippage.
6. Click **Approve in wallet**; show the wallet prompt with post-conditions;
   approve.
7. Show the pending state and the Hiro Explorer link.
8. Wait for (or cut to) confirmation; show the updated sBTC balance and the
   swap in **Recent swaps**.

## Milestone 2 — Recurring DCA (PaySats node keeper)

Automated USDCx → sBTC buys. Bitflow’s own Keepers cannot execute this
multi-hop pair (`actionRetry`, no `execute-action` on chain). PaySats
reuses the working M1 swap (`getQuoteForRoute` + `getSwapParams`) from a
PaySats-owned Stacks address, then SIP-010-transfers the actual sBTC to
the user.

Prepaid USDCx is **custodial** on that address until swapped or refunded.
Cancel refunds `remainingOrders × amountPerOrder` from the order ledger,
not whatever happens to sit on the wallet.

### Flow

1. Connect Stacks wallet at `/stacks` (same as M1).
2. Under **Recurring DCA**, pick amount / frequency / number of buys.
3. Review shows the **prepaid total** (`amount × N`) and the PaySats keeper
   address.
4. Confirm: one SIP-010 `transfer` of USDCx to `NEXT_PUBLIC_STACKS_KEEPER_ADDRESS`.
   After Hiro confirms the funding tx, PaySats stores a `StacksDcaOrder`.
5. Self-hosted worker `npm run dca:cron` POSTs `/api/stacks/dca/execute`
   (Bearer `STACKS_DCA_CRON_SECRET`). Creating an order kicks the first
   slice immediately. Later ticks confirm the swap and payout **actual
   on-chain sats** (not the quote). The worker sleeps until `nextWakeAt`
   (~45s while in flight, else until the next scheduled slice).
6. Cancel refunds leftover prepaid USDCx. An in-flight slice is allowed to
   finish; leftover is refunded immediately.
7. Status / swap + payout explorer links / history are in the DCA card and
   Activity.

### Architecture (M2)

```
hooks/use-stacks-dca.ts              one fund tx + create/cancel
services/stacks/dca-preview.ts       quote + custody note
services/stacks/dca-executor.ts      due slices + nextWakeAt
services/stacks/node-keeper.ts       nonce-locked swap / payout / refund
services/stacks/funding-tx.ts        verify user → keeper USDCx
scripts/dca-cron.mjs                 adaptive POST loop
app/api/stacks/dca/quote|order|execute
prisma: StacksDcaOrder + StacksDcaExecution
```

`services/stacks/bitflow-keeper.ts` remains for leftover Bitflow contracts
(withdraw `withdraw-tokens`, cancel old `groupId` plans). Do **not** mix
that USDCx into the PaySats keeper address.

### Config

```bash
NEXT_PUBLIC_STACKS_NETWORK=mainnet
NEXT_PUBLIC_STACKS_KEEPER_ADDRESS=SP…   # users transfer here
STACKS_KEEPER_PRIVATE_KEY=             # hex, server-only
STACKS_DCA_CRON_SECRET=                # min 16 chars
# DCA_CRON_URL=http://127.0.0.1:3000/api/stacks/dca/execute
HIRO_API_KEY=                          # recommended (avoids 429)
```

Fund the keeper with **STX** for gas. Run the adaptive worker next to
the app — it is not a Vercel Cron and does not tick every minute when
idle:

```bash
# local (Next on :3000)
npm run dca:cron

# one shot (same as the old curl)
npm run dca:execute

# production (Next on :3400, loopback only)
DCA_CRON_URL=http://127.0.0.1:3400/api/stacks/dca/execute \
  pm2 start npm --name paysats-dca-cron -- run dca:cron
```

Wake rules (from `nextWakeAt` on the execute response):

- Swap or payout in flight → ~45s
- Next slice scheduled → sleep until `nextExecutionAt` (cap 5 min)
- No orders → 5 min safety net
- New order POST kicks execute so the first slice does not wait for idle sleep

### Spike notes (Bitflow Keepers — do not reuse for new plans)

- Interactive USDCx → sBTC is multi-hop (`STABLE_XY_4` + XYK). Bitflow
  Keepers never landed `execute-action` txs (`actionRetry` +
  `broadcastErrors.actionCount`).
- Max 2 keeper contracts per wallet; leftover USDCx is still in
  `SP3R9DNH…keeper-4-eahhfqk3u-v-1-1` and `…keeper-4-iy9ogoajj-v-1-1`.
  Withdraw via `withdraw-tokens` in the DCA card.

### DCA demo checklist

1. Set keeper address + key + cron secret; fund keeper with STX.
2. `npx prisma migrate deploy` (adds `lastError`, `payoutTxId`).
3. Sign in → `/stacks` → connect wallet with USDCx + STX.
4. Smoke: **$0.2 × 2 @ 1 min**. Review → approve one USDCx transfer.
5. Show active plan + funding tx on Hiro Explorer.
6. `npm run dca:cron` (or `dca:execute` once). First tick (or the create
   kick) broadcasts swap; a later tick confirms and pays out sBTC.
7. Cancel remaining (refunds 1 slice if the other is in flight).

## Milestone 2 phase 2 — Zest borrow (isolated sBTC → USDCx)

Lock sBTC as isolated collateral on Zest V2, then borrow Circle USDCx.
Position state is on-chain; PaySats records each signed tx (`StacksZestTx`).

### Contracts (mainnet)

| Role | Contract |
| --- | --- |
| Market | `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-8-market` |
| Market vault | `…v0-market-vault` |
| USDCx vault | `…v0-vault-usdc` |
| sBTC token | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` |
| USDCx token | `SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx` |

On-chain sBTC → USDCx LTV (live egroup, 2026-08): **60% borrow / 70% partial liq / 75% full**. The UI caps borrow at **80% of LTV-borrow** (~48%).

Writes (user-signed, `PostConditionMode.Deny`):

1. `collateral-add(sBTC, amount, price-feeds)` — lock isolated sats
2. `borrow(USDCx, amount, none, price-feeds)` — USDCx from `v0-vault-usdc`
3. `repay(USDCx, amount, none)`
4. `collateral-remove(sBTC, amount, none, price-feeds)`

Opening a line is **two wallet prompts back to back**. Stacks applies
them in nonce order, so the lock is executed before borrow without
waiting for confirmation. Hot-path calls attach **one** Pyth Pro (Lazer)
EVM update (`fixed_rate@200ms`, feeds 1/7; STX 45 is optional). Hermes PNAU is rejected
(`err u400022`). Requires `PYTH_API_KEY`.

Writes go to whichever market `v0-market-vault.get-impl` returns — Zest
deauthorizes the previous market on the vaults when it ships a new one, so a
stale `ZEST_CONTRACTS.market` fails every write with `err u803001` (the
vault's `ERR-AUTH`) while reads keep working. Check `get-impl` first when
borrow or repay starts failing; it moved v0-4 → v0-7 → v0-8 (2026-08-31).

### Borrow demo checklist

1. `npx prisma migrate deploy` (adds `StacksZestTx`).
2. Sign in → `/stacks` → connect wallet with sBTC + STX for gas.
3. Enter sats to lock and a USDCx amount under the UI cap. Review LTV / liq price.
4. Approve lock, then borrow. Both txs on Hiro Explorer; USDCx lands in the wallet.
5. Repay (partial or all), then withdraw sBTC. Position returns to empty.

## Known limitations

- Bitflow routing is mainnet-only.
- Prepaid USDCx is custodial on the PaySats keeper until swapped or
  refunded.
- The Stacks wallet is external (Leather/Xverse), not Privy embedded.
- Isolated Zest collateral is not yield-bearing (no zsBTC). Yield mode can
  come later.
- Agent-initiated Stacks flows land in Milestone 3.
