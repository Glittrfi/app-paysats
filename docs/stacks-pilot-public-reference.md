# Building a USDCx → sBTC swap flow on Stacks with Bitflow

*Public implementation reference for the PaySats Stacks pilot (Stacks
Endowment grant, Milestone 1). This standalone write-up contains everything
needed to reproduce the integration — publish it as a gist/repo alongside the
demo video and on-chain transaction links.*

PaySats is a consumer Bitcoin savings app (Google login, no seed phrases,
live on Base). This pilot brings its save loop to Stacks: users hold
**USDCx** (Circle's USDC-backed dollar via xReserve) and swap it into
**sBTC** (non-custodial, Bitcoin-settled BTC) through the **Bitflow** DEX
aggregator, approving every transaction in their own wallet.

## Stack

- `@stacks/connect` (v8) — wallet connection + transaction signing UI
  (Leather, Xverse, …)
- `@bitflowlabs/core-sdk` (v4.1+) — route discovery, quotes, swap execution
  (recurring DCA reuses the same aggregator from a PaySats keeper address)
- `@stacks/transactions` / `@stacks/network` — peer deps used by both
- Hiro API — balances and transaction status

## Key addresses (mainnet)

| Asset | Contract |
| --- | --- |
| USDCx | `SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx` |
| sBTC | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` |

Bitflow SDK token ids: `token-USDCx-auto` and `token-sbtc`.

## Gotchas we hit (read this first)

1. **The Bitflow SDK's default API host is retired.** `new BitflowSDK()`
   points at `bitflowsdk-api-test-…` which 404s on `getAllTokensAndPools`.
   Pass the working gateway explicitly:

   ```ts
   const bitflow = new BitflowSDK({
     BITFLOW_API_HOST: "https://bitflow-sdk-api-gateway-7owjsmt8.uc.gateway.dev",
     KEEPER_API_HOST: "https://keeper.bitflowapis.finance",
     READONLY_CALL_API_HOST: "https://api.hiro.so",
   });
   ```

   Bitflow’s old read-only host `node.bitflowapis.finance` no longer
   resolves. Hiro (`https://api.hiro.so`) exposes the same `/v2` RPC the
   SDK uses for contract interfaces and quote simulations.

   The Keeper write API (`createKeeperContract`, `createGroupOrder`, …)
   lives on `keeper.bitflowapis.finance` and requires signed requests
   (`timestamp` in ms + wallet signature + public key).

2. **Bitflow routes on mainnet only.** The SDK context is hardwired to
   `STACKS_MAINNET` and the aggregator indexes mainnet pools. Don't plan a
   testnet swap demo; demo on mainnet with small amounts.

3. **`executeSwap` is browser-only.** It drives `@stacks/connect` internally.
   Server-side, use `getSwapParams` and build the contract call yourself.

4. **Quote and execution must share the route.** `getQuoteForRoute` returns a
   `bestRoute.route` object; feed exactly that into `executeSwap` as
   `SwapExecutionData.route` so the user signs the route they reviewed.

5. **STX gas.** Users need a little STX for fees; surface that in the UI.

## 1. Connect a wallet

```ts
import { connect, disconnect, getLocalStorage } from "@stacks/connect";

// Connect (opens the wallet chooser; persists to localStorage)
const result = await connect({ forceWalletSelect: true });
const stxAddress = result.addresses.find((a) => a.address.startsWith("SP"))?.address;

// Restore on reload
const stored = getLocalStorage()?.addresses.stx?.[0]?.address ?? null;

// Disconnect
disconnect();
```

Mainnet principals start with `SP`/`SM`, testnet with `ST`/`SN` — filter by
prefix if your app is network-aware.

## 2. Read balances (one Hiro call)

`GET https://api.hiro.so/extended/v1/address/{principal}/balances` returns
STX plus every SIP-010 token. Fungible token keys are asset identifiers of
the form `{contract}::{assetName}`:

```ts
const res = await fetch(`https://api.hiro.so/extended/v1/address/${addr}/balances`);
const json = await res.json();
const stx = json.stx.balance;                     // micro-STX
const usdcx = json.fungible_tokens[
  "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx::usdcx-token"
]?.balance ?? "0";                                // 6 decimals (Clarity FT name: usdcx-token)
const sbtc = json.fungible_tokens[
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token"
]?.balance ?? "0";                                // 8 decimals (sats)
```

## 3. Quote the swap (server-side)

```ts
const quote = await bitflow.getQuoteForRoute("token-USDCx-auto", "token-sbtc", 10);
// quote.bestRoute.quote     -> 0.00014679 (sBTC out for 10 USDCx)
// quote.bestRoute.tokenPath -> ["token-USDCx-auto","token-aeusdc","token-stx","token-sbtc"]
// quote.bestRoute.route     -> pass this to executeSwap unchanged
```

We fetch quotes on the server (keeps Bitflow config in one place) and return
`{ amountIn, amountOut, route, tokenXDecimals, tokenYDecimals, tokenPath }`
to the client.

## 4. Review, then execute (browser)

Require an explicit in-app review step *before* the wallet prompt: amount in,
estimated out, and minimum received at the slippage bound. Then:

```ts
await bitflow.executeSwap(
  {
    route: quote.route,           // the exact quoted route
    amount: quote.amountIn,       // human units (e.g. 10 = 10 USDCx)
    tokenXDecimals: quote.tokenXDecimals,
    tokenYDecimals: quote.tokenYDecimals,
  },
  senderAddress,
  0.01,                           // 1% slippage tolerance
  undefined,                      // let @stacks/connect pick the selected wallet
  (data) => onBroadcast(data.txId),
  () => onCancelled(),
);
```

Under the hood the SDK calls `openContractCall` with
`PostConditionMode.Deny` and SDK-built post-conditions, so the swap aborts
on-chain if the output falls below the minimum — the user's wallet displays
these before signing. Nothing is ever broadcast without the user approving in
the wallet.

## 5. Track the transaction

```ts
const res = await fetch(`https://api.hiro.so/extended/v1/tx/${txId}`);
const { tx_status } = await res.json();
// "pending" -> keep polling (Stacks anchors with Bitcoin finality: minutes)
// "success" -> done
// anything else ("abort_by_response", "abort_by_post_condition", ...) -> failed
```

Explorer link: `https://explorer.hiro.so/txid/{txId}?chain=mainnet`.

We also persist each swap (`txId`, address, amounts, status) in Postgres on
broadcast and update it when the transaction anchors — that's the audit trail
for the grant's adoption metrics and the base for recurring DCA history in
Milestone 2.

## Milestone 2 (DCA) — PaySats node keeper

Bitflow Keepers cannot execute the interactive USDCx → sBTC multi-hop
route (plans sit in `actionRetry` with no `execute-action` on chain).
Recurring buys therefore reuse the **same M1 aggregator swap**, broadcast
from a PaySats-owned Stacks address:

1. User SIP-010-transfers `amount × N` USDCx to the PaySats keeper
   address (custodial until swapped or refunded).
2. A cron worker quotes via `getQuoteForRoute`, builds params with
   `getSwapParams`, and broadcasts as that address (`tx-sender`).
3. After Hiro confirms, PaySats reads the **actual sBTC inflow** and
   SIP-010-transfers it to the user’s linked Stacks address.
4. Cancel refunds leftover prepaid USDCx from the order ledger.

See `docs/stacks-pilot.md` for the checklist, env vars, and why Bitflow
Keepers were dropped for this pair.

## What's next

- **Milestone 2 (remaining):** borrow against sBTC on Zest.
- **Milestone 3:** MCP agent tools so AI agents can operate the Stacks
  account with human-approved payments, live on mainnet.
