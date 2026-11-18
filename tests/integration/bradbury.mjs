// End-to-end on Testnet Bradbury (Phase 2), on the packed code that is deployed:
//
//   python deploy/shrink.py contracts/deposit_back.py build/deposit_back.py --pack
//   npm i genlayer-js@2.0.0-rc.2   # plus the estimateTransactionFees patch in app/README.md
//   GL_PK0=0x... GL_PK1=0x... GL_PK2=0x... node tests/integration/bradbury.mjs build/deposit_back.py [contract]
//
// GL_PK0 deploys with one approved inspection host, the one serving evidence/ (EVIDENCE), and is the
// landlord; GL_PK1 is the tenant; GL_PK2 is anyone. Rentals end minutes after opening. Deposit 1:
// after the end the landlord claims for the worktop burn the check-out report shows and the check-in
// did not: validators agree it is valid, the landlord is paid the claim, then anyone returns the rest
// to the tenant. Deposit 2 is cancelled unpaid. Deposit 3: the landlord claims for the sofa stain the
// check-in report already listed: invalid, and the whole deposit goes back. Unapproved hosts, the
// landlord as tenant, wrong payers and amounts, early claims and releases and second claims are refused.
// Every payout settles from its own transfer.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAccount, createClient, MessageType, encodeExternalMessageFeeParams } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const PRICE = 10n ** 14n;
const EVIDENCE = process.env.EVIDENCE ?? "https://depositback.cristhedev.com/evidence/";
const HOST = new URL(EVIDENCE).host, ARGS = [new Map([[HOST, "Independent Inventory Co (evidence pages)"]])];
const IN = EVIDENCE + "flat2-checkin.html", OUT = EVIDENCE + "flat2-checkout.html", ITEM = "Flat 2, 14 Mill Lane";
const CONSENSUS_MAIN = "0x2e2766cbc3e5e61ce93bbcdcbb3eacb82082a019";
const T_FINALIZED = "0x24196ec40f90671b7144e716978686b4f3c7d6b00b23da3971ef2b52af27d87f";
const PAYOUT_GAS = 100000n, PAYOUT_GAS_PRICE = 1000000000n;
// rpc.testnet-chain.genlayer.com (the chain default) does not serve gen_call; this one serves the same chain.
const endpoint = "https://rpc-bradbury.genlayer.com";
const a0 = createAccount(process.env.GL_PK0);
const a1 = createAccount(process.env.GL_PK1);
const a2 = createAccount(process.env.GL_PK2);
const c0 = createClient({ chain: testnetBradbury, endpoint, account: a0 });
const c1 = createClient({ chain: testnetBradbury, endpoint, account: a1 });
const c2 = createClient({ chain: testnetBradbury, endpoint, account: a2 });
const sha = (t) => createHash("sha256").update(t).digest("hex");
const page = async (url) => sha(Buffer.from(await (await fetch(url)).arrayBuffer()));
const fees = async (c, payee) => {
  const messageAllocations = payee && [{
    messageType: MessageType.External, onAcceptance: false, recipient: payee, budget: PAYOUT_GAS * PAYOUT_GAS_PRICE,
    callKey: "0x" + "00".repeat(32), feeParams: encodeExternalMessageFeeParams({ gasLimit: PAYOUT_GAS, maxGasPrice: PAYOUT_GAS_PRICE }),
  }];
  // A read, so retrying a dropped connection is safe.
  let e;
  for (let i = 0; !e; i++) {
    try { e = await c.estimateTransactionFees(payee ? { messageAllocations } : {}); }
    catch (err) { if (i >= 5 || !/fetch failed|ECONNRESET|timed out|socket/i.test(String(err?.details ?? err?.message))) throw err; await new Promise((r) => setTimeout(r, 10000)); }
  }
  return { distribution: e.distribution, feeValue: e.feeValue, ...(payee && { messageAllocations: e.messageAllocations }) };
};
// The public RPC drops connections now and then; retry the wait, never the write.
async function wait(c, hash, waitUntil = "decided") {
  for (let i = 0; ; i++) {
    try {
      return await c.waitForTransactionReceipt({ hash, waitUntil, interval: 10000, retries: 360 });
    } catch (e) {
      if (i >= 5 || !/fetch failed|ECONNRESET|timed out|socket/i.test(String(e?.details ?? e?.message))) throw e;
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}
const check = (ok, what) => {
  console.log(ok ? "  ok  " : "  FAIL", what);
  if (!ok) process.exit(1);
};
// A finalized leader timeout (NOT_VOTED) or vote without a majority (NO_MAJORITY) applied nothing, so sending the call again is safe. Bradbury still
// moves the value of such a transaction, and of a reverted one, into the contract, where
// get_accounting shows it as unaccounted.
// A dropped connection while sending: send again only if the account's nonce did not move (nothing went out).
async function send(c, req) {
  for (let i = 0; ; i++) {
    const n = await rpc("eth_getTransactionCount", [c.account.address, "pending"]);
    try { return await c.writeContract(req); }
    catch (e) {
      if (i >= 5 || !/fetch failed|ECONNRESET|timed out|socket/i.test(String(e?.details ?? e?.message))) throw e;
      await new Promise((r) => setTimeout(r, 15000));
      if ((await rpc("eth_getTransactionCount", [c.account.address, "pending"])) !== n) throw e;
    }
  }
}
let stray = 0n;
const NONE = new Set(["NO_MAJORITY", "MAJORITY_DISAGREE"]);
async function tx(c, label, functionName, args, { value = 0n, payee } = {}) {
  for (let i = 0; ; i++) {
    const hash = await send(c, { address, functionName, args, value, fees: await fees(c, payee) });
    let r = await wait(c, hash);
    // NOT_VOTED / NO_MAJORITY can be an intermediate round (one such buy later finalized and ran on
    // Bradbury): wait for finality and retry only if it still applied nothing.
    if (r.txExecutionResultName === "NOT_VOTED" || NONE.has(r.resultName)) r = await wait(c, hash, "finalized");
    // NO_MAJORITY / MAJORITY_DISAGREE (e.g. the leader's LLM quoted text not on the page, which no
    // validator accepts): nothing was applied, whatever the leader returned.
    const res = NONE.has(r.resultName) ? r.resultName : r.txExecutionResultName;
    console.log(`${label}: ${hash} ${res}`);
    if (res !== "FINISHED_WITH_RETURN") stray += value;
    if ((res !== "NOT_VOTED" && !NONE.has(res)) || i >= 5) return { ...r, txExecutionResultName: res, hash };
  }
}
const ok = async (...a) => { const r = await tx(...a); check(r.txExecutionResultName === "FINISHED_WITH_RETURN", `${a[1]} succeeds`); return r; };
// A rejection is a transaction that ran and reverted, never one that was not voted on.
const fails = async (what, ...a) => check((await tx(...a)).txExecutionResultName === "FINISHED_WITH_ERROR", what);
const read = async (functionName, args = []) => {
  let v;
  for (let i = 0; ; i++) {
    try { v = await c0.readContract({ address, functionName, args }); break; }
    catch (e) { if (i >= 5 || !/fetch failed|ECONNRESET|timed out|socket/i.test(String(e?.details ?? e?.message))) throw e; await new Promise((r) => setTimeout(r, 10000)); }
  }
  const plain = (x) => (x instanceof Map ? Object.fromEntries([...x].map(([k, y]) => [k, plain(y)])) : Array.isArray(x) ? x.map(plain) : x);
  return plain(v);
};
// RPC nodes behind the edge can lag the one that reported the receipt: re-read until `ok` holds (or give up).
async function settled(fn, args, ok) {
  for (let i = 0; ; i++) {
    const v = await read(fn, args);
    if (ok(v) || i >= 12) return v;
    await new Promise((r) => setTimeout(r, 10000));
  }
}
// Reads only, so retrying a dropped connection is safe.
const rpc = async (method, params) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "user-agent": "depositback-e2e" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return (await r.json()).result;
    } catch (e) { if (i >= 5) throw e; await new Promise((r) => setTimeout(r, 10000)); }
  }
};
// The consensus-layer transaction that finalized `hash`: it emits TransactionFinalized(txId).
async function finalizeTx(hash, fromBlock) {
  for (;;) {
    const to = BigInt(await rpc("eth_blockNumber", []));
    for (let b = fromBlock; b <= to; b += 1000n) {
      const end = b + 999n > to ? to : b + 999n;
      const logs = await rpc("eth_getLogs", [{ address: CONSENSUS_MAIN, topics: [T_FINALIZED, hash], fromBlock: "0x" + b.toString(16), toBlock: "0x" + end.toString(16) }]);
      if (logs?.length) return logs[0].transactionHash;
    }
    await new Promise((r) => setTimeout(r, 30000));
  }
}
async function settle(id, paid, fromBlock) {
  await wait(c0, paid.hash, "finalized");
  const fin = await finalizeTx(paid.hash, fromBlock);
  console.log(`finalized by ${fin}`);
  await ok(c2, `settle payout ${id}`, "settle_payout", [id, paid.hash, fin]);
  check((await settled("get_payout", [id], (x) => x.status === "DELIVERED")).status === "DELIVERED", `payout ${id} DELIVERED`);
  await fails("a payout settles once", c2, "settle again", "settle_payout", [id, paid.hash, fin]);
}

let address = process.argv[3];
if (!address) {
  const hash = await c0.deployContract({ code: readFileSync(process.argv[2], "utf8"), args: ARGS, fees: await fees(c0) });
  const r = await wait(c0, hash);
  address = r.txDataDecoded?.contractAddress;
  console.log(`deploy: ${hash} ${r.txExecutionResultName} -> ${address}`);
  check(r.txExecutionResultName === "FINISHED_WITH_RETURN", "deployed");
}
const fromBlock = BigInt(await rpc("eth_blockNumber", []));
stray = BigInt((await read("get_accounting")).unaccounted);
const pid = Number((await read("get_accounting")).payout_count), low = (x) => x?.toLowerCase();
const now = () => Math.floor(Date.now() / 1000), sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const ll = a0.address, ten = a1.address;
const did = Number((await read("get_deposits", [0, 1])).total);
const flat = async (url) => (await (await fetch(url, { cache: "no-store" })).text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();

check(JSON.stringify(await read("get_sources")).includes(HOST), `${HOST} is the approved inspection host`);
await fails("only the owner approves hosts", c1, "approve a host as the tenant", "set_source", ["tenant.cristhedev.com", "Tenant"]);
await fails("a landlord-controlled report is refused", c0, "open on the landlord's own site", "open_deposit", [ten, ITEM, 3n * PRICE, now() + 600, IN.replace(HOST, "landlord.cristhedev.com")]);
await fails("the landlord cannot be the tenant", c0, "open with oneself as tenant", "open_deposit", [ll, ITEM, 3n * PRICE, now() + 600, IN]);
const end = now() + 12 * 60;
await ok(c0, "open deposit 1 (3x, check-in pinned)", "open_deposit", [ten, ITEM, 3n * PRICE, end, IN]);
let d = await settled("get_deposit", [did], (x) => !!x?.checkin_hash);
check(d.status === "OPEN" && d.checkin_hash.length === 64, `OPEN, check-in pinned: ${d.checkin_hash.slice(0, 16)}…`);
await fails("only the tenant pays", c2, "pay as someone else", "pay", [did], { value: 3n * PRICE });
await fails("the exact deposit must be sent", c1, "pay 2x", "pay", [did], { value: 2n * PRICE });
await ok(c1, "the tenant pays deposit 1", "pay", [did], { value: 3n * PRICE });
await fails("no claim before the rental ends", c0, "claim early", "claim", [did, PRICE, "Burn mark on the kitchen worktop next to the hob", OUT], { payee: ll });
await fails("anyone else releases only after the claim window", c2, "release while held", "release", [did], { payee: ten });

await ok(c0, "open deposit 2", "open_deposit", [ten, ITEM, PRICE, end, IN]);
await fails("only the landlord cancels", c1, "cancel deposit 2 as the tenant", "cancel", [did + 1]);
await ok(c0, "the landlord cancels deposit 2 unpaid", "cancel", [did + 1]);
await ok(c0, "open deposit 3 (2x)", "open_deposit", [ten, ITEM, 2n * PRICE, end, IN]);
await ok(c1, "the tenant pays deposit 3", "pay", [did + 2], { value: 2n * PRICE });

const left = end - now() + 60;
if (left > 0) { console.log(`waiting ${Math.ceil(left / 60)} min for the rentals to end…`); await sleep(left); }
await fails("a claim above the deposit is refused", c0, "claim 4x", "claim", [did, 4n * PRICE, "Burn mark on the kitchen worktop next to the hob", OUT], { payee: ll });
const p1 = await ok(c0, "claim the worktop burn on deposit 1", "claim", [did, PRICE, "Burn mark on the kitchen worktop next to the hob", OUT], { payee: ll });
d = await settled("get_deposit", [did], (x) => x.status !== "HELD");
check(d.status === "DECIDED" && d.answer === "valid" && BigInt(d.deducted) === PRICE && (await flat(OUT)).includes(d.quote.toLowerCase()), `valid, 1x to the landlord, quoted: “${d.quote}”`);
await fails("one claim per deposit", c0, "claim again", "claim", [did, PRICE, "Burn mark on the kitchen worktop next to the hob", OUT], { payee: ll });
const p2 = await ok(c2, "anyone returns the rest of deposit 1", "release", [did], { payee: ten });
check((await settled("get_deposit", [did], (x) => x.status === "CLOSED")).returned == 2n * PRICE, "2x back to the tenant; CLOSED");

await ok(c0, "claim the sofa stain on deposit 3", "claim", [did + 2, PRICE, "Stain on the left sofa cushion in the living room", OUT], { payee: ll });
d = await settled("get_deposit", [did + 2], (x) => x.status !== "HELD");
check(d.status === "DECIDED" && d.answer === "invalid" && BigInt(d.deducted) === 0n, `invalid (already at check-in): ${d.reason}`);
const p3 = await ok(c2, "anyone returns deposit 3", "release", [did + 2], { payee: ten });
check((await settled("get_deposit", [did + 2], (x) => x.status === "CLOSED")).returned == 2n * PRICE, "the whole deposit back to the tenant");

const ps = [];
for (let i = 0; i < 3; i++) ps.push(await settled("get_payout", [pid + i], (x) => !!x?.kind));
const pays = [["deduction", PRICE, ll], ["return", 2n * PRICE, ten], ["return", 2n * PRICE, ten]];
pays.forEach(([kind, amount, to], i) => check(ps[i].kind === kind && BigInt(ps[i].amount) === amount && low(ps[i].to) === low(to), `payout ${pid + i}: ${kind} ${amount} to ${to.slice(0, 8)}`));
for (const [i, t] of [p1, p2, p3].entries()) await settle(pid + i, t, fromBlock);
check(BigInt((await read("get_accounting")).unaccounted) === stray, `balance matches what the contract expects to hold (+${stray} from unexecuted or reverted txs)`);
console.log("contract", address, "deposits", did, did + 1, did + 2);
