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

## Known limitations (Milestone 1)

- Swaps are one-shot (recurring DCA lands in Milestone 2).
- Bitflow routing is mainnet-only, so the swap flow is disabled on testnet.
- The Stacks wallet is external (Leather/Xverse) rather than the embedded
  Privy wallet used on Base — Stacks is not an EVM chain, so the Base signing
  path can't be reused. Agent-initiated flows (Milestone 3) will prepare
  transactions server-side with the human approving in their wallet.
