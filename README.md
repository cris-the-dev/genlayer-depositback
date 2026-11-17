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
Testnet Bradbury Phase 2 (chainId 4221, GenVM v0.3): `__ADDR__`

## Bradbury evidence

Run by [`tests/integration/bradbury.mjs`](tests/integration/bradbury.mjs) once deployed; the table of transactions goes here.

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
