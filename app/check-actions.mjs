// Asserts which DepositBack app controls appear per role, deposit state and time, and that GEN amounts are exact
// (run: node app/check-actions.mjs app/index.html).
import { readFileSync } from "node:fs";
const html = readFileSync(process.argv[2], "utf8");
const js = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const body = js.slice(js.indexOf("function actions"), js.indexOf("async function show"));
const gl = readFileSync(new URL("./gl.js", import.meta.url), "utf8");
const pick = (name) => gl.slice(gl.indexOf(`export const ${name} =`), gl.indexOf("\n};\n", gl.indexOf(`export const ${name} =`)) + 3).replace("export ", "");
const { gen, toWei } = new Function(`${pick("gen")}\n${pick("toWei")}\nreturn { gen, toWei };`)();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const line = (name) => js.match(new RegExp(`const ${name} = .*;`))[0];
const make = new Function("esc", "gen", "B", "short", "EXPLORER", "ctx", `let me = ctx.me; const when = (t) => String(t); ${line("addr")} ${body}; return { actions, ruling };`);
const L = "0xLandlord", T = "0xTenant", END = 1000, UNTIL = 2000, P = 10n ** 15n;
const dep = { id: 0, landlord: L, tenant: T, amount: 3n * P, ends_at: END, claim_until: UNTIL, status: "HELD", deducted: 0n, answer: "", damage: "", checkout: "", quote: "", reason: "", claimed: 0n };
const fns = (me) => make(esc, gen, BigInt, (a) => a, "x", { me });
const run = (me, d = {}, now = END + 1, recov = 0) => fns(me).actions({ ...dep, ...d }, recov, now);
const has = (s, f) => s.includes(`data-form="${f}"`);
const check = (name, ok) => { console.log(ok ? "ok  " : "FAIL", name); if (!ok) process.exitCode = 1; };

check("no wallet: prompt only", run(null).includes("Connect a wallet") && !run(null).includes("form"));
check("tenant (case-insensitive) pays an open deposit before the end, exact amount", run("0xtenant", { status: "OPEN" }, 10).includes("Pay 0.003 GEN") && !has(run(T, { status: "OPEN" }, END), "pay") && !has(run(L, { status: "OPEN" }, 10), "pay"));
check("landlord cancels only while open", has(run(L, { status: "OPEN" }, 10), "cancel") && !has(run(L), "cancel") && !has(run(T, { status: "OPEN" }, 10), "cancel"));
check("landlord claims only in the window", !has(run(L, {}, END - 1), "claim") && has(run(L, {}, END), "claim") && has(run(L, {}, UNTIL), "claim") && !has(run(L, {}, UNTIL + 1), "claim") && !has(run(T), "claim"));
check("release while held: landlord any time, others after the window", has(run(L, {}, 10), "release") && !has(run(T), "release") && has(run(T, {}, UNTIL + 1), "release"));
check("anyone releases a decided deposit, the rest only", run("0xX", { status: "DECIDED", deducted: P }).includes("Return 0.002 GEN"));
check("closed or cancelled: nothing to do", ["CLOSED", "CANCELLED"].every((s) => !/data-form="(pay|cancel|claim|release)"/.test(run(L, { status: s }, UNTIL + 1))));
check("recover only with a failed transfer", has(run("0xX", {}, END, 5n), "recover") && !run("0xX", {}, END, 0n).includes("recover"));
const r = fns("0xX").ruling;
check("ruling: none before a claim; valid quotes the report, escaped", r(dep) === "" && r({ ...dep, answer: "valid", quote: "<burn>", damage: "d" }).includes("&lt;burn&gt;"));
check("ruling: invalid shows no quote", !r({ ...dep, answer: "invalid", damage: "d" }).includes("“"));
check("exact amounts", gen(10n ** 14n) === "0.0001" && toWei("0.009007199254740993") === 9007199254740993n);
