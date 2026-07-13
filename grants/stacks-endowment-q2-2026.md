# Stacks Endowment Q2 2026 Grant Application (PaySats)

> Copy-paste-ready draft for the Stacks Endowment "Getting Started" application ($10,000).
> Track: Getting Started. Cycle themes: DeFi & Perps, Real-World Assets, Agentic Applications, Privacy.
>
> Items marked **[CONFIRM]** need your input before submitting. Everything else is ready to paste.

---

## Open items to confirm before submitting

- **[CONFIRM] Legal name (entity):** exact registered legal entity name (the "arka" entity). The form currently shows "Vibhav Sharma" in the Legal name field, but the Applicant type is **Entity**. These should match the entity's registered name, with Vibhav Sharma as the primary contact / UBO.
- **[CONFIRM] Primary contact role:** suggested "Founder" (optional field).
- **[CONFIRM] Referral source (Step 4):** write "None" if there was no referral, otherwise name the person/channel.
- **[CONFIRM] Prior grants (Step 4):** assumed "None" below. Change if PaySats has received prior grants.
- **[CONFIRM] Milestone target dates (Step 8):** proposed below assuming a ~mid-July start (decisions announced by July 1). Adjust to your real start date.

---

## Step 1: Applicant identity

- **Applicant type:** Entity
- **Jurisdiction:** US
- **Legal name:** **[CONFIRM: registered entity legal name]**
- **Primary contact name:** Vibhav Sharma
- **Primary contact email:** btcvibhav@gmail.com
- **Primary contact role (optional):** Founder

---

## Step 2: Project

- **Project name:** PaySats
- **Website or repo:** https://paysats.exchange
- **Primary category:** DeFi
- **Secondary category:** DeFi - Lending

### Project Description

PaySats is a live agentic Bitcoin savings account: users sign in with Google, auto-save into Bitcoin via recurring buys (DCA), borrow stablecoins against their BTC instead of selling, and cash out to a bank or e-wallet. The whole account can also be operated by an AI agent through a native MCP server, with the user approving every payment. The product is shipped and working on Base mainnet today (Privy smart wallets, automated DCA, Morpho-based credit, fiat on/off-ramp, and a working MCP server exposing tools like `get_account`, `create_idr_deposit`, `setup_dca`, and `cancel_dca`).

This grant funds a **Stacks-native pilot** that ports PaySats' core loop onto trust-minimized Bitcoin. On Stacks, "save in Bitcoin" becomes **sBTC** (non-custodial, Bitcoin-settled BTC) rather than a custodial wrapper. We will: DCA **USDCx → sBTC** on **Bitflow**, enable **borrow USDCx against sBTC** on **Zest**, and extend our **MCP agent layer** so AI agents can operate sBTC savings and credit on Stacks with human-approved payments.

What reviewers should understand first: this is not a whitepaper. It is a working consumer product with a real agent interface, looking to bring its proven save/borrow/agent loop to the strongest Bitcoin-native rails in the ecosystem. We have no prior Stacks code. This is a genuine first Stacks build, which is exactly what the Getting Started track is for, de-risked by a team that has already shipped the equivalent product elsewhere.

---

## Step 3: Audience and ecosystem fit

### Primary audience

Bitcoin holders who want to keep accumulating BTC and still access cash without selling, plus the emerging set of AI-agent users who want an agent to manage routine savings actions safely. Concretely: long-term savers ("stackers"), people who need liquidity against their BTC, and developers/users connecting agents (e.g. Claude) to real on-chain accounts.

### Audience segmentation

- **Retail BTC savers / DCA users:** want automated, low-friction recurring buys into Bitcoin.
- **Borrow-don't-sell users:** hold BTC, need stablecoin liquidity for expenses without a taxable sale.
- **Agent / MCP users and builders:** want a safe, standard way for AI agents to read balances and execute savings/credit actions with human approval.
- **Stacks DeFi participants:** sBTC holders looking for a consumer-grade front end over Bitflow and Zest.
- **(Roadmap) Southeast Asia savers:** rupiah-first users reachable via USDCx's Circle interoperability and PaySats' existing IDRX rails.

### Why Stacks?

Stacks gives PaySats the one thing other chains can't: **trust-minimized Bitcoin**. sBTC is a non-custodial, 1:1 Bitcoin-backed asset secured by Stacks signers and settled on Bitcoin via Proof-of-Transfer, not a custodial wrapper like the cbBTC we use on Base. For a product whose entire thesis is "save in real Bitcoin, don't sell it," sBTC is a materially better savings asset.

The rest of the stack is now in place to build a full consumer loop natively on Stacks:
- **USDCx:** a Circle-backed, CCTP-interoperable dollar (via xReserve) for the stable leg of DCA and credit.
- **Bitflow:** DEX liquidity for USDCx ⇄ sBTC swaps that power DCA.
- **Zest:** borrow USDCx against sBTC, so users get liquidity without selling their stack.

Finally, the Stacks Foundation has stated it is going "AI agent first," investing in hooks and docs so agents can use Stacks as easily as humans. PaySats already ships a working MCP agent interface, making it a natural flagship for the cycle's **Agentic Applications** theme. And because USDCx is natively interoperable through Circle CCTP/Gateway, Stacks users can reach real-world fiat off-ramps (via our existing IDRX rails) without Stacks needing its own local-currency stablecoin, turning interoperability into a user-facing feature.

### Maintenance plan

PaySats is an actively developed product, not a one-off deliverable. After the grant we will: ship monthly releases, keep the Stacks pilot's source public with open issue triage, and name a maintainer committed for at least six months post-completion. Users get in-app support and a public changelog; integrators (Bitflow/Zest/MCP) get documented, versioned tooling. Because the Stacks work lives inside our existing production codebase and team, ongoing maintenance is funded by the company, not dependent on further grants.

### Ecosystem fit

This squarely advances two of the cycle's themes: **Agentic Applications** (a live MCP agent operating real sBTC savings and credit with human approval) and **DeFi** (consumer-grade sBTC savings + borrowing over Bitflow and Zest). It brings a polished, Google-login, no-seed-phrase consumer UX to Stacks DeFi, and produces reusable, open agent rails (MCP tools for sBTC) that other Stacks teams can learn from or build on. It directly exercises sBTC (satisfying the program's technical requirement) and channels new savings demand into Stacks-native liquidity venues.

---

## Step 4: Risk and prior history

### Referral source

**[CONFIRM: write "None" if no referral, otherwise name the person/channel]**

### Risk disclosure

- **Liquidity / slippage:** USDCx ⇄ sBTC depth on Stacks DEXs can move pricing on larger DCA buys. Mitigation: route via Bitflow's deepest pools, set slippage bounds, and batch small recurring buys rather than executing micro-swaps.
- **Smart-contract risk:** reliance on third-party protocols (Bitflow, Zest) and the USDCx bridge. Mitigation: read-only integration first, conservative LTVs for credit, start on testnet, and limit pilot position sizes.
- **Agent / custody risk:** agents acting on a user's account. Mitigation: self-custodial wallets, OAuth scoped per user, and human approval required for every payment, the same model already running in production on Base.
- **Cross-chain / bridge dependency (stretch only):** the rupiah on/off-ramp loop depends on Circle's Bridge Kit SDK and the USDCx↔Base route being live, plus IDRX/USDC liquidity. Mitigation: this is scoped as a clearly-marked stretch; the funded core (USDCx → sBTC DCA + Zest borrow + MCP) does not depend on it.
- **Regulatory:** as a US entity operating a consumer financial app, we maintain KYC/KYB readiness and avoid US-restricted venues (e.g. we use Zest rather than Granite, which excludes US users).

### Prior grants

**[CONFIRM]** None. This is our first grant.

### Prior Stacks work

None. PaySats has shipped a comparable product on Base (agentic Bitcoin savings with DCA, credit, fiat ramps, and a live MCP server), but has not previously built on Stacks. This grant funds our first Stacks integration, with the shipped product serving as proof of execution.

---

## Step 5: Track and qualification

- **Track:** Getting Started
- **Requested amount, USD:** 10000

---

## Step 6: Track-specific context (Getting Started)

**What are you proposing to explore or build?**
A Stacks-native version of PaySats' core loop: automated DCA from USDCx into **sBTC** on Bitflow, **borrow USDCx against sBTC** on Zest, and an **MCP agent interface** so AI agents can run these actions with human-approved payments. The pilot proves that our agentic Bitcoin-savings product works on trust-minimized Bitcoin.

**What user or ecosystem problem motivates the project?**
Most apps treat Bitcoin savings like trading chips and the only "cash out" is to sell, forcing users to give up their stack and trigger a taxable event. PaySats lets people save in Bitcoin and borrow against it instead of selling. On Stacks specifically, there is strong sBTC liquidity and lending, but limited consumer-grade, agent-operable front ends that make "save and borrow in Bitcoin" simple for ordinary users.

**Why is Stacks the right environment for this work?**
Because sBTC is trust-minimized, Bitcoin-settled BTC, the ideal savings asset for a "don't sell your Bitcoin" product, paired with native USDCx, Bitflow liquidity, and Zest lending. Stacks' "AI agent first" direction also aligns directly with PaySats' MCP agent layer, making this a natural fit for the Agentic Applications theme.

**What have you already validated, prototyped, or learned?**
We have a live product on Base: Google-login smart wallets (Privy), automated DCA into BTC via our on-chain DCA contract, Morpho-based borrowing against BTC, fiat on/off-ramp, and a working MCP server with tools agents use today (`get_account`, `create_idr_deposit`, `setup_dca`, `get_dca_status`, `cancel_dca`, `get_dca_history`). We've learned what a safe agent-payment UX requires (per-user OAuth + human approval) and how to abstract wallets away from end users.

**Who will do the work and what experience do they bring?**
The PaySats team that built and shipped the existing product: full-stack web3 product engineering (Next.js, viem, account abstraction), DeFi integrations (DCA contracts, Morpho lending), fiat-ramp integrations, and a production MCP/OAuth agent stack. Primary contact: Vibhav Sharma (Founder). **[CONFIRM: add 1-2 lines of specific team background / links if desired]**

**What is the smallest useful outcome this grant should produce?**
A working prototype where a user funds USDCx on Stacks and DCAs into sBTC on Bitflow, with a public repo and demo video. That is the minimum that proves the Stacks save loop works end to end.

**What evidence will show the concept is worth continuing?**
Real usage: a measurable number of users running sBTC DCA and/or opening Zest credit lines through PaySats, plus sBTC accumulated/volume routed via the app during the pilot (see Milestones 2 and 3 adoption metrics).

**What dependencies or risks could affect delivery?**
sBTC/USDCx liquidity and slippage on Bitflow; third-party protocol risk (Bitflow, Zest); and that Stacks is non-EVM, so we must add Stacks-native signing rather than reuse our Base/Privy path. The fiat-ramp loop additionally depends on Circle's bridge rollout and is therefore scoped as a stretch, not a funded requirement.

**What support from the Stacks ecosystem would help?**
Intros and integration support from Bitflow and Zest; guidance/docs on the recommended Stacks wallet + agent-signing approach (the "AI agent first" hooks); and access to the USDCx / Circle Bridge Kit developer resources.

**How will you share progress or learnings publicly?**
Public repo with open issues, a demo video per milestone, and short written updates (including a write-up of building an MCP agent over sBTC that other Stacks teams can reuse). Monthly check-ins with the program manager.

**What happens after the grant if the work succeeds?**
We graduate the pilot into the main PaySats product as a first-class Stacks option, expand the agent toolset, and pursue the real-world fiat loop (USDCx ↔ IDRX) so Southeast Asia users can buy sBTC with rupiah and cash out to bank/e-wallet, positioning PaySats to apply for a Builder grant with live traction.

**Any other context reviewers should consider?**
PaySats is unusual in already having a working agent interface on real money in production. Bringing that to sBTC gives the Stacks ecosystem a concrete, consumer-facing Agentic Application, exactly the direction the Foundation has signaled, rather than a from-scratch experiment.

---

## Step 7: Compliance readiness

**Applicant type:** Entity (KYB), to be completed via Provenance if selected.

- [x] We have our incorporation documents ready and will be able to complete the required KYB through Provenance if selected.
- [x] We have our ultimate beneficial owner (UBO) list ready to provide if selected.
- [x] We have proof of address for the entity ready to provide if selected.
- [x] We can provide identity documents for each UBO through the Provenance flow if selected.

---

## Step 8: Milestones

Structure for a $10,000 Getting Started request: three milestones, **20% / 30% / 50%**, ~8-12 weeks total. Milestones 2 and 3 include adoption metrics. Grant disbursed in STX.

> Dates below assume a ~mid-July start (decisions announced by July 1). **[CONFIRM target dates.]**

### Milestone 1: Stacks foundation (USDCx → sBTC swap)

- **Target date:** [CONFIRM: ~4 weeks from start, e.g. 11/08/2026]
- **Description:** Stand up PaySats on Stacks: Stacks wallet/auth and signing, on-chain reads for sBTC and USDCx balances, and a working USDCx → sBTC swap via Bitflow from within the app.
- **Success criteria:** A user can connect, view sBTC + USDCx balances, and execute a USDCx → sBTC swap on mainnet. Public repo and a demo video are published.
- **Payment percent:** 20
- **Amount, USD:** 2000

### Milestone 2: Core loop live (DCA into sBTC + borrow on Zest)

- **Target date:** [CONFIRM: ~8 weeks from start, e.g. 08/09/2026]
- **Description:** Ship the savings + credit loop: automated recurring DCA (USDCx → sBTC) on a schedule, plus borrow USDCx against sBTC via Zest, all in-app on mainnet.
- **Success criteria:** A user can set up a recurring DCA into sBTC and open a USDCx loan against sBTC collateral on Zest, both verifiable on-chain. Public demo published.
- **Payment percent:** 30
- **Amount, USD:** 3000
- **Adoption metric:** ≥5 unique users complete at least one on-chain sBTC action through PaySats (USDCx → sBTC swap, DCA execution, or Zest borrow), with ≥3 active recurring sBTC DCA orders and ≥1 Zest borrow position opened via the app, all verifiable on mainnet.

### Milestone 3: Agentic layer on Stacks (live, with adoption)

- **Target date:** [CONFIRM: ~12 weeks from start, e.g. 06/10/2026]
- **Description:** Extend the MCP agent layer to Stacks so AI agents can operate sBTC savings and Zest credit with human-approved payments: MCP tools for `get_account`, `setup_dca`, `borrow`, and status/history, live on mainnet.
- **Success criteria:** An agent (e.g. Claude) can read a user's Stacks account and set up/cancel sBTC DCA and a Zest borrow, with the user approving each payment, demonstrated publicly on mainnet.
- **Payment percent:** 50
- **Amount, USD:** 5000
- **Final adoption metric:** ≥25 unique users with at least one on-chain sBTC action through PaySats, ≥50 cumulative sBTC DCA executions routed via the app, and ≥10 agent-initiated MCP tool calls that result in a user-approved on-chain transaction (setup_dca, borrow, or cancel), all verifiable on mainnet during the pilot.
- **Stretch (bridge-dependent, not required for payout): bidirectional fiat on/off-ramp loop (IDRX ↔ USDCx).** Using the same Circle CCTP V2 + Gateway infrastructure:
  - *Rupiah on-ramp (buy sBTC with rupiah):* IDR → mint IDRX on Base → swap IDRX → USDC on Base → USDC (Base) → USDCx (Stacks) → swap USDCx → sBTC on Bitflow.
  - *Cash-out:* USDCx (Stacks) → USDC (Base) → PaySats' existing IDRX redeem flow → GoPay e-wallet / Indonesian bank payout.
  - Kept as a separate funding/cash-out layer from the DCA engine (which stays pure USDCx → sBTC on Stacks), so the funded core never depends on it. Contingent on Circle Bridge Kit SDK + USDCx↔Base route being live, sufficient IDRX/USDC liquidity, and Stacks-side signing.
