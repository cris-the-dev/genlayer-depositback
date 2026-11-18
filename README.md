# DepositBack — a rental deposit kept only for damage the reports show is new

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Deposits sit in the landlord's account, and getting them back means arguing over
a scratch that was there on day one. **DepositBack** holds the deposit in escrow.
After the rental, the landlord has 14 days for one claim. GenLayer validators
compare the independent inspector's check-in report, pinned by hash at the start,
with the check-out report: damage that is in the check-out report and not in the
check-in report is paid to the landlord, quoted. Everything else goes back to the
tenant.

```
owner    ── deploy(sources) / set_source(host, name)       approved inspection services
landlord ── open_deposit(tenant, item, amount, ends_at, checkin_url) ─▶ DepositBack
            url on an approved host; validators agree on the report's SHA-256: pinned
tenant   ── pay(deposit) + amount ─▶ HELD                   (until then the landlord may cancel)
landlord ── claim(deposit, amount, damage, checkout_url)    once, ends_at … ends_at + 14 days
            validators re-read check-in (hash checked) and check-out; valid | invalid (+ quote)
            valid ─▶ amount to the landlord                 invalid ─▶ nothing deducted
anyone   ── release(deposit) after the claim or the 14 days (landlord: any time) ─▶ rest to the tenant
anyone   ── settle_payout(payout, tx, finalize_tx) / payee ── recover(to)
```

## Live deployment

App: https://depositback.cristhedev.com (deposits, reports, the ruling with its quote and every role's actions; source in [`app/`](app/))  
Testnet Bradbury Phase 2 (chainId 4221, GenVM v0.3): [`0x1124E52ab0dB63e9d1735c8Da1FaD28Dfd45d0eC`](https://explorer-bradbury.genlayer.com/address/0x1124E52ab0dB63e9d1735c8Da1FaD28Dfd45d0eC)

## Bradbury evidence

Run by [`tests/integration/bradbury.mjs`](tests/integration/bradbury.mjs) on Bradbury Phase 2 (all checks passed). Contract `0x1124E52ab0dB63e9d1735c8Da1FaD28Dfd45d0eC` (deploy [`0x45a8d995…`](https://explorer-bradbury.genlayer.com/tx/0x45a8d9953d40f6462b8f8724ec3cd8a670465d15fa1fe924f8eab4f0ef2047ce)), code `build/deposit_back.py` (sha256 `7b153d47…`), deployed with one approved inspection host: `depositback.cristhedev.com`. Landlord and tenant are separate accounts; a third sends releases. Deposit #0 (Flat 2, 14 Mill Lane, 3 × 0.0001 GEN) and #2 (2 × 0.0001 GEN) are checked against [`flat2-checkin.html`](evidence/flat2-checkin.html) and [`flat2-checkout.html`](evidence/flat2-checkout.html); #1 is cancelled before payment.

| Step | Transaction | Outcome |
|---|---|---|
| approve a host as the tenant | [`0x69a2dcee…`](https://explorer-bradbury.genlayer.com/tx/0x69a2dcee3e8b573d8c8dc6ba53a981f40de4e4e33680e4dfbb15c2352b70c7a5) | rejected: only the owner approves hosts |
| open on the landlord's own site | [`0x12991bf3…`](https://explorer-bradbury.genlayer.com/tx/0x12991bf38f85ee36ddc3d7554cd3765dbda117dd65c1b4510e058b7c7e5e125c) | rejected: a landlord-controlled report is refused |
| open with oneself as tenant | [`0x0dcdfbba…`](https://explorer-bradbury.genlayer.com/tx/0x0dcdfbbae1ff6e525728aec7dcccad02a1ba2413d1eeff8844bc447c7b9f6863) | rejected: the landlord cannot be the tenant |
| open deposit #0 (3x, check-in pinned) | [`0x8b6c0eee…`](https://explorer-bradbury.genlayer.com/tx/0x8b6c0eee72ef02eeb9fd326204ae5d93608f3f35a84bb6496af5ed1e454fb163) | ok: OPEN, check-in pinned: 8cedd2c20df507b2… |
| pay as someone else | [`0xfd65530c…`](https://explorer-bradbury.genlayer.com/tx/0xfd65530ca80b08f22e98506f2536dd1f4d3cf5536b4281e097207bb08dec4bcf) | rejected: only the tenant pays |
| pay 2x | [`0x4f73ec94…`](https://explorer-bradbury.genlayer.com/tx/0x4f73ec94e360c51edcafba2552235f90098c8ddc7d35ec9c51532669803f3e1f) | rejected: the exact deposit must be sent |
| the tenant pays deposit #0 | [`0xbe725847…`](https://explorer-bradbury.genlayer.com/tx/0xbe72584724363c9284a9b159ebdbab1aba06af29a82c6613bc2d37e9e1055b64) | ok |
| claim early | [`0x006815ba…`](https://explorer-bradbury.genlayer.com/tx/0x006815baf7622a95dd1f9209eddbe65a3550950c61b99a1ec416824b37ea08ea) | rejected: no claim before the rental ends |
| release while held | [`0xc1faf227…`](https://explorer-bradbury.genlayer.com/tx/0xc1faf227d84457fbb3dde99132b6fa5086b719f924c8a0a03a93003a11883164) | rejected: anyone else releases only after the claim window |
| open deposit #1 | [`0xcddb2399…`](https://explorer-bradbury.genlayer.com/tx/0xcddb23991d31a3ea324c69a24e79379888b14b31580c7e4e4ff3c6ef390806b1) | ok |
| cancel deposit #1 as the tenant | [`0x98aea180…`](https://explorer-bradbury.genlayer.com/tx/0x98aea1806136bba828e1f7a1388f1343b6c6ec139b1e9c9b112b30bb8ecb5396) | rejected: only the landlord cancels |
| the landlord cancels deposit #1 unpaid | [`0xc36e05cc…`](https://explorer-bradbury.genlayer.com/tx/0xc36e05cc3b73bdf26fc0776feabb953d5196280c9df2e6522d901e86b366cc3a) | ok |
| open deposit #2 (2x) | [`0xdc3647d3…`](https://explorer-bradbury.genlayer.com/tx/0xdc3647d396292ac82c58d332dc8fdc1c2fd06feca344af68ce237b17fc311116) | ok |
| the tenant pays deposit #2 | [`0x1654883a…`](https://explorer-bradbury.genlayer.com/tx/0x1654883aa587f65cc4a4bf70cf85b67069e2be570dd2b2100caa86d867c529f0) | ok |
| claim 4x | [`0x82eccb1f…`](https://explorer-bradbury.genlayer.com/tx/0x82eccb1f9cafb379134940b3ed9b1fce8f185614824b0db944210055ff9f5658) | rejected: a claim above the deposit is refused |
| claim the worktop burn on deposit #0 | [`0x9554649d…`](https://explorer-bradbury.genlayer.com/tx/0x9554649d4d4ba3affb76b614247a816f3cf33e4a84f9b760807c7854cf4c42f1) | **`valid`**, 1x to the landlord, quoted: “The worktop has a burn mark 10 cm across next to the hob.” |
| claim again | [`0x39cfa991…`](https://explorer-bradbury.genlayer.com/tx/0x39cfa99120c12627005f5a7ad3d5168e7e43b703cad1cf697cfefcf2eb59f0ac) | rejected: one claim per deposit |
| anyone returns the rest of deposit #0 | [`0x66172b9c…`](https://explorer-bradbury.genlayer.com/tx/0x66172b9c61a3dc7de79935ec6bfedd410eabcdbe61fd2c126724f48c679851b1) | ok: 2x back to the tenant; CLOSED |
| claim the sofa stain on deposit #2 | [`0x89267989…`](https://explorer-bradbury.genlayer.com/tx/0x892679899d3c8f810381544c4f9c3719d9286acc81c1af8b7dea1963271ea220) | **`invalid`** (already at check-in): The stain on the left sofa cushion was already recorded in the check-in report, so it cannot be claimed as new damage caused by the tenant. |
| anyone returns deposit #2 | [`0x9a11ce7d…`](https://explorer-bradbury.genlayer.com/tx/0x9a11ce7d3a87b0d67aeaebe58cb7fd006b1f24f1b2d121d0d93de4b17c9d709c) | ok: the whole deposit back to the tenant|

Every payout was settled from its own transfer once the paying transaction finalized:

| Payout | Kind | Finalized by | `settle_payout` | Result |
|---|---|---|---|---|
| 0 | deposit #0 worktop burn → landlord (0.0001 GEN) | [`0x8c4ff845…`](https://explorer-bradbury.genlayer.com/tx/0x8c4ff845856c79a861afaf6160f8200681a9fbb88167c817765c08381f48156d) | [`0x12a1c738…`](https://explorer-bradbury.genlayer.com/tx/0x12a1c738a4b51f43e798b353bc8911ddb39968f5515d8cc138c6d5afb5a690d2) | DELIVERED |
| 1 | deposit #0 rest → tenant (0.0002 GEN) | [`0x24d04d0e…`](https://explorer-bradbury.genlayer.com/tx/0x24d04d0e7010fe383dbfec700c89ecdc1c7303891b28c28dc69af3163434bd73) | [`0x63c3aa4e…`](https://explorer-bradbury.genlayer.com/tx/0x63c3aa4e16f3e0c298891e0da4ba16ab303e5cb00bb166bcf379f3679b0c4b75) | DELIVERED |
| 2 | deposit #2 whole → tenant (0.0002 GEN) | [`0x65e4e5c0…`](https://explorer-bradbury.genlayer.com/tx/0x65e4e5c01bf4627ddadf75bd2946efd277e890caf2d7100643975c0525c20008) | [`0xd45d515c…`](https://explorer-bradbury.genlayer.com/tx/0xd45d515c21782f4f00ddbc977bc6f537255293d42636b643dc734982add43e35) | DELIVERED |

Settling the same payout again is rejected ([`0x04f8a170…`](https://explorer-bradbury.genlayer.com/tx/0x04f8a170b9436652570ba18556e6d1f28944b4ead7cf2e1b4d173926af54db28), [`0xcc6073a1…`](https://explorer-bradbury.genlayer.com/tx/0xcc6073a1bb4eda8171429e1fa3f3b0e3da07d1bd554e4ea2904facb56bc99ae5), [`0x5e16a638…`](https://explorer-bradbury.genlayer.com/tx/0x5e16a638991044a8c554350ff536e9f782674d84ded392ded755285350391d6c)). On Bradbury a reverted payable transaction leaves its value in the contract; the contract never recorded it, so no one can withdraw it. The E2E checks the balance equals what the contract expects to hold plus exactly that value (0.0005 GEN).

## How a claim is judged

1. **Independent reports.** Both reports must be `https://` on a host the
   owner approved as an inspection service (or its subdomain); a page the
   landlord controls is refused before it is read.
2. **Pinned check-in.** Its SHA-256 is agreed at opening; at the claim a
   different hash reverts ("check-in report changed").
3. **One narrow question.** The LLM sees the item, the claimed damage and both
   reports, fenced as data: does the check-out report state this damage, and
   does the check-in report not already record it? Text over 20,000 characters
   is refused, never cut.
4. **Quoted, then checked by text.** `valid` must copy the check-out report's
   sentence; the contract checks it is there.
5. **Consensus on the answer and the check-out hash.** Each validator reads
   both reports itself; the check-out hash is recorded with the ruling.

## Where the money goes

- The tenant pays the exact deposit, before the rental ends. It leaves as:
  - **deduction** to the landlord: the claimed amount (≤ the deposit) of a valid claim;
  - **return** to the tenant: the rest, by anyone once the claim is judged or
    the 14 days pass without one, or by the landlord at any time.
- One claim per deposit. A valid claim for the whole deposit closes it.

## Payments and settlement

Every transfer is a recorded payout (sender and creation time). `settle_payout(payout_id, tx_hash, finalize_tx)`
has validators read the paying transaction (this contract's paying method for that deposit, by the recorded
sender at the recorded time, finalized with a successful result) and its finalization, and check the
transfer was executed: `DELIVERED`, or `FAILED` and recoverable by the payee with `recover(to)`.
`get_accounting` is informational only.

## Limits

- Validators judge whether the damage is reported and new, not what it costs:
  the amount is the landlord's, capped at the deposit and on record.
- The owner decides which inspection services count.

## The app

https://depositback.cristhedev.com ([`app/`](app/)) reads finalized state and treats a write as done only when it is `FINALIZED` with `FINISHED_WITH_RETURN`
and reading the contract back shows the change. GEN amounts use BigInt only. Pay appears only for the tenant before the end; claim only for the landlord inside the
window; return when the contract would accept it. `node app/check-actions.mjs app/index.html` (CI) asserts the controls per role, deposit state and time.

## API

| Method | Who | Notes |
|---|---|---|
| `set_source(host, name)` | owner | approve an inspection host; empty name withdraws it |
| `open_deposit(tenant, item, amount, ends_at, checkin)` | landlord | end within two years; pins the check-in report |
| `pay(deposit_id)` payable | tenant | exactly the deposit, before the end |
| `cancel(deposit_id)` | landlord | OPEN only |
| `claim(deposit_id, amount, damage, checkout)` | landlord | once, in the 14-day window; damage 10–300 chars |
| `release(deposit_id)` | anyone / landlord | returns the rest to the tenant |
| `settle_payout(payout_id, tx_hash, finalize_tx)` / `recover(to)` | anyone / payee | |
| `get_deposit`, `get_deposits`, `get_sources`, `get_payout`, `get_payouts`, `get_accounting`, `get_recoverable` | view | |

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
genvm-lint check contracts/deposit_back.py
pytest tests/direct -v                         # 38 tests
python deploy/shrink.py contracts/deposit_back.py build/deposit_back.py --pack
node tests/integration/bradbury.mjs build/deposit_back.py
```

Bradbury rejects deploys above ~20 KB; deploy the packed build (31.0 KB → 8.8 KB). CI re-runs the direct tests on it. The E2E reports are in [`evidence/`](evidence/).

## Tests (38 direct)

- **Opening** — the check-in report is pinned; only the owner approves sources; field validation; the tenant cannot be the landlord; an unreachable report is agreed and reverts.
- **Paying and cancelling** — exact amount, tenant only, before the end; the landlord cancels only an unpaid deposit.
- **Claims** — only the landlord, only in the window, validation; valid pays the landlord and the rest goes to the tenant; a full claim closes; invalid leaves it all to the tenant; a changed check-in or unreachable check-out reverts; a quote not in the report is an LLM error; agreement on the answer and the check-out hash.
- **Release** — held until the window closes; the landlord releases at any time.
- **Settlement** — delivered and failed payouts, recovery by the tenant, a transaction that is not this payout is rejected.

## License

MIT
