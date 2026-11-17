"""Opening with a pinned check-in report, the landlord's one claim judged against the check-out report, release and payout settlement."""

import hashlib

import pytest

from tests.direct.conftest import AFTER, BEFORE, CHECKIN, CHECKOUT, DAMAGE, DAY, DEP, QUOTE, chain_balance, open_deposit, page, pay, tick, to_hex

def claim(vm, c, who, amount=DEP // 2, damage=DAMAGE, url=CHECKOUT, did=0, **kw):
    page(vm, **kw)
    vm.sender = who
    tick(vm)
    return c.claim(did, amount, damage, url)

def after_end(vm, days=31):
    tick(vm, days * DAY)

def test_open_pins_the_check_in_report(held, direct_bob):
    d = held.get_deposit(0)
    assert d["checkin_hash"] == hashlib.sha256(BEFORE.encode()).hexdigest() and d["source"] == "inspect.example"
    assert (d["status"], d["tenant"].lower()) == ("HELD", to_hex(direct_bob).lower()) and held.get_accounting()["expected_balance"] == DEP

def test_only_the_owner_approves_sources(held, direct_vm, direct_alice, direct_bob):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("not authorised"):
        held.set_source("mine.example", "Mine")
    direct_vm.sender = direct_alice
    held.set_source("other.example", "Other inspector")
    assert held.get_sources()["other.example"] == "Other inspector"

@pytest.mark.parametrize(
    "kw, msg",
    [
        ({"item": "x"}, "3-120"),
        ({"amount": 0}, "amount above 0"),
        ({"days": 800}, "within two years"),
        ({"url": "https://landlord.example/r/1"}, "not an approved source"),
        ({"url": "https://inspect.example.evil/r/1"}, "not an approved source"),
        ({"url": "http://inspect.example/r/1"}, "https url"),
    ],
)
def test_open_validation(held, direct_vm, direct_alice, direct_charlie, kw, msg):
    with direct_vm.expect_revert(msg):
        open_deposit(direct_vm, held, direct_alice, direct_charlie, **kw)
    assert held.get_deposits(0, 10)["total"] == 1

def test_the_tenant_cannot_be_the_landlord(held, direct_vm, direct_alice):
    with direct_vm.expect_revert("cannot be the landlord"):
        open_deposit(direct_vm, held, direct_alice, direct_alice)

def test_an_unreachable_check_in_report_is_agreed_and_reverts(held, direct_vm, direct_alice, direct_charlie):
    with direct_vm.expect_revert("HTTP 404"):
        open_deposit(direct_vm, held, direct_alice, direct_charlie, status=404)
    assert direct_vm.run_validator(leader_error="[EXTERNAL] page unavailable (HTTP 404)") is True
    assert direct_vm.run_validator(leader_error="[EXTERNAL] page unavailable (HTTP 503)") is False

def test_validators_agree_on_the_pinned_hash(held, direct_vm, direct_alice, direct_charlie):
    open_deposit(direct_vm, held, direct_alice, direct_charlie)
    assert direct_vm.run_validator() is True
    assert direct_vm.run_validator(leader_result="00" * 32) is False

def test_pay_rules(held, direct_vm, direct_alice, direct_bob, direct_charlie):
    open_deposit(direct_vm, held, direct_alice, direct_charlie)
    with direct_vm.expect_revert("only the tenant"):
        pay(direct_vm, held, direct_bob, did=1)
    with direct_vm.expect_revert("exactly the deposit"):
        pay(direct_vm, held, direct_charlie, value=DEP - 1, did=1)
    with direct_vm.expect_revert("deposit is HELD"):
        pay(direct_vm, held, direct_bob)

def test_the_landlord_cancels_only_an_unpaid_deposit(held, direct_vm, direct_alice, direct_bob, direct_charlie):
    open_deposit(direct_vm, held, direct_alice, direct_charlie)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the landlord"):
        held.cancel(1)
    direct_vm.sender = direct_alice
    assert held.cancel(1) == "CANCELLED"
    with direct_vm.expect_revert("deposit is HELD"):
        held.cancel(0)
    with direct_vm.expect_revert("deposit is CANCELLED"):
        pay(direct_vm, held, direct_charlie, did=1)

def test_no_claim_before_the_end_or_after_the_window(held, direct_vm, direct_alice):
    with direct_vm.expect_revert("the rental ends"):
        claim(direct_vm, held, direct_alice)
    after_end(direct_vm, 45)
    with direct_vm.expect_revert("claims closed"):
        claim(direct_vm, held, direct_alice)

@pytest.mark.parametrize("kw, msg", [({"amount": DEP + 1}, "at most the deposit"), ({"amount": 0}, "above 0"), ({"damage": "dirty"}, "10-300"), ({"url": "https://landlord.example/r/out"}, "not an approved source")])
def test_claim_validation(held, direct_vm, direct_alice, kw, msg):
    after_end(direct_vm)
    with direct_vm.expect_revert(msg):
        claim(direct_vm, held, direct_alice, **kw)

def test_only_the_landlord_claims(held, direct_vm, direct_bob):
    after_end(direct_vm)
    with direct_vm.expect_revert("only the landlord"):
        claim(direct_vm, held, direct_bob)

def test_a_valid_claim_pays_the_landlord_and_the_rest_goes_to_the_tenant(held, direct_vm, direct_alice, direct_bob, direct_charlie, ledger):
    after_end(direct_vm)
    assert claim(direct_vm, held, direct_alice) == "valid"
    d = held.get_deposit(0)
    assert (d["status"], d["deducted"], d["quote"], d["checkout_hash"]) == ("DECIDED", DEP // 2, QUOTE, hashlib.sha256(AFTER.encode()).hexdigest())
    assert ledger.paid_to(direct_alice) == DEP // 2
    with direct_vm.expect_revert("deposit is DECIDED"):
        claim(direct_vm, held, direct_alice)
    direct_vm.sender = direct_charlie  # anyone
    tick(direct_vm)
    assert held.release(0) == DEP - DEP // 2 and ledger.paid_to(direct_bob) == DEP - DEP // 2
    assert held.get_deposit(0)["status"] == "CLOSED"
    with direct_vm.expect_revert("deposit is CLOSED"):
        held.release(0)

def test_a_valid_claim_for_all_of_it_closes(held, direct_vm, direct_alice, ledger):
    after_end(direct_vm)
    claim(direct_vm, held, direct_alice, amount=DEP)
    assert held.get_deposit(0)["status"] == "CLOSED" and ledger.paid_to(direct_alice) == DEP

def test_an_invalid_claim_leaves_it_all_to_the_tenant(held, direct_vm, direct_alice, direct_bob, ledger):
    after_end(direct_vm)
    assert claim(direct_vm, held, direct_alice, answer="invalid", damage="Stain on the sofa's left cushion.", reason="Already in the check-in report.") == "invalid"
    d = held.get_deposit(0)
    assert (d["status"], d["deducted"], d["quote"], d["reason"]) == ("DECIDED", 0, "", "Already in the check-in report.") and ledger.paid_to(direct_alice) == 0
    direct_vm.sender = direct_bob
    tick(direct_vm)
    assert held.release(0) == DEP and ledger.paid_to(direct_bob) == DEP

def test_a_changed_check_in_report_reverts_and_changes_nothing(held, direct_vm, direct_alice):
    after_end(direct_vm)
    with direct_vm.expect_revert("check-in report changed"):
        claim(direct_vm, held, direct_alice, before=BEFORE.replace("worktop intact", "worktop burnt"))
    assert held.get_deposit(0)["status"] == "HELD"

def test_an_unreachable_check_out_report_reverts(held, direct_vm, direct_alice):
    after_end(direct_vm)
    with direct_vm.expect_revert("HTTP 404"):
        claim(direct_vm, held, direct_alice, out_status=404)
    assert held.get_deposit(0)["status"] == "HELD"

def test_a_quote_not_in_the_check_out_report_is_an_llm_error(held, direct_vm, direct_alice):
    after_end(direct_vm)
    with direct_vm.expect_revert("quote is not in the check-out report"):
        claim(direct_vm, held, direct_alice, quote="The oven door is broken.")

def test_validators_agree_on_the_answer_and_the_check_out_hash(held, direct_vm, direct_alice):
    after_end(direct_vm)
    claim(direct_vm, held, direct_alice)
    h = hashlib.sha256(AFTER.encode()).hexdigest()
    assert direct_vm.run_validator() is True
    assert direct_vm.run_validator(leader_result={"answer": "invalid", "quote": "", "reason": "x", "hash": h}) is False
    assert direct_vm.run_validator(leader_result={"answer": "valid", "quote": QUOTE, "reason": "x", "hash": "00" * 32}) is False
    assert direct_vm.run_validator(leader_result={"answer": "valid", "quote": "The oven door is broken.", "reason": "x", "hash": h}) is False

def test_release_while_held(held, direct_vm, direct_alice, direct_bob, direct_charlie, ledger):
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("held until the claim window closes"):
        held.release(0)
    after_end(direct_vm, 45)  # no claim in the window: anyone releases
    assert held.release(0) == DEP and ledger.paid_to(direct_bob) == DEP

def test_the_landlord_releases_at_any_time(held, direct_vm, direct_alice, direct_bob, ledger):
    direct_vm.sender = direct_alice
    assert held.release(0) == DEP and ledger.paid_to(direct_bob) == DEP

def test_a_payout_needs_the_balance(held, direct_vm, direct_alice):
    after_end(direct_vm)
    chain_balance(direct_vm, 0)
    with direct_vm.expect_revert("balance below payout"):
        claim(direct_vm, held, direct_alice)
    assert held.get_deposit(0)["status"] == "HELD"

def test_delivered_deduction_settles(held, direct_vm, direct_alice, chain):
    after_end(direct_vm)
    claim(direct_vm, held, direct_alice)
    tx, fin = chain.pay(held, 0, "claim", [0, DEP // 2, DAMAGE, CHECKOUT])
    assert held.settle_payout(0, tx, fin) == "DELIVERED"
    with direct_vm.expect_revert("already settled"):
        held.settle_payout(0, tx, fin)

def test_failed_return_is_recoverable_by_the_tenant(held, direct_vm, direct_alice, direct_bob, direct_charlie, chain, ledger):
    direct_vm.sender = direct_alice
    held.release(0)
    tx, fin = chain.pay(held, 0, "release", [0], delivered=False)
    assert held.settle_payout(0, tx, fin) == "FAILED" and held.get_recoverable(to_hex(direct_bob)) == DEP
    direct_vm.sender = direct_bob
    tick(direct_vm)
    assert held.recover(to_hex(direct_charlie)) == DEP and ledger.paid_to(direct_charlie) == DEP
    with direct_vm.expect_revert("nothing to recover"):
        held.recover(to_hex(direct_charlie))

@pytest.mark.parametrize("kw", [{"sender": "0x" + "66" * 20}, {"at": 1}, {"status": 5}, {"result": 2}, {"delivered": None}, {"method": "claim"}, {"args": [1]}])
def test_settle_rejects_a_transaction_that_is_not_this_payout(kw, held, direct_vm, direct_alice, chain):
    direct_vm.sender = direct_alice
    held.release(0)
    method, a = kw.pop("method", "release"), kw.pop("args", [0])
    tx, fin = chain.pay(held, 0, method, a, **{"delivered": False, **kw})
    with direct_vm.expect_revert():
        held.settle_payout(0, tx, fin)
