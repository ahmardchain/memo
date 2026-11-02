//! Unit tests for every state transition of the escrow.
//! Run with `cargo test` from `contract/`.

use super::*;
use near_sdk::test_utils::{accounts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

const USDC: u128 = 1_000_000; // 6 decimals
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const T0_MS: u64 = 1_800_000_000_000;

fn token() -> AccountId {
    "usdc.test.near".parse().unwrap()
}
fn contract_id() -> AccountId {
    "memo.test.near".parse().unwrap()
}
fn buyer() -> AccountId {
    accounts(0) // alice
}
fn supplier() -> AccountId {
    accounts(1) // bob
}
fn arbiter() -> AccountId {
    accounts(2) // charlie
}
fn attacker() -> AccountId {
    accounts(3) // danny
}

struct Ctx {
    now_ms: u64,
}

impl Ctx {
    fn new() -> Self {
        let c = Ctx { now_ms: T0_MS };
        c.call(buyer(), 0);
        c
    }
    fn builder(&self, who: AccountId, deposit_yocto: u128) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(contract_id())
            .predecessor_account_id(who.clone())
            .signer_account_id(who)
            .attached_deposit(NearToken::from_yoctonear(deposit_yocto))
            .block_timestamp(self.now_ms * 1_000_000)
            .account_balance(NearToken::from_near(100));
        b
    }
    fn call(&self, who: AccountId, deposit_yocto: u128) {
        testing_env!(self.builder(who, deposit_yocto).build());
    }
    fn call_with_result(&self, who: AccountId, result: PromiseResult) {
        testing_env!(
            self.builder(who, 0).build(),
            near_sdk::test_vm_config(),
            RuntimeFeesConfig::test(),
            Default::default(),
            vec![result]
        );
    }
    fn advance(&mut self, ms: u64) {
        self.now_ms += ms;
    }
}

const STORAGE: u128 = 1_000_000_000_000_000_000_000_000; // 1 NEAR, excess refunded

fn default_milestones() -> Vec<MilestoneInput> {
    vec![
        MilestoneInput { title: "Production proof".into(), basis_points: 3000, deadline_ms: T0_MS + 10 * DAY_MS },
        MilestoneInput { title: "Shipping proof (B/L)".into(), basis_points: 7000, deadline_ms: T0_MS + 30 * DAY_MS },
    ]
}

fn setup() -> (Ctx, Escrow) {
    let ctx = Ctx::new();
    let c = Escrow::new(token());
    (ctx, c)
}

fn create(ctx: &Ctx, c: &mut Escrow, total: u128) -> u64 {
    ctx.call(buyer(), STORAGE);
    c.create_deal(
        "2,000 LED panels".into(),
        "Guangzhou Bright Co.".into(),
        supplier(),
        arbiter(),
        U128(total),
        default_milestones(),
        Some(3 * DAY_MS),
    )
}

fn fund(ctx: &Ctx, c: &mut Escrow, id: u64, amount: u128, from: AccountId) -> u128 {
    ctx.call(token(), 0);
    match c.ft_on_transfer(from, U128(amount), format!("{{\"deal_id\":{id}}}")) {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("expected value"),
    }
}

/// Deal created, accepted and fully funded.
fn active_deal(total: u128) -> (Ctx, Escrow, u64) {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, total);
    ctx.call(supplier(), 0);
    c.accept_deal(id);
    assert_eq!(fund(&ctx, &mut c, id, total, buyer()), 0);
    (ctx, c, id)
}

fn proof(ctx: &Ctx, c: &mut Escrow, id: u64, m: u32) {
    ctx.call(supplier(), STORAGE);
    c.submit_proof(id, m, "a".repeat(64), "Photo of finished goods on line 3".into(), None);
}

fn deal(c: &Escrow, id: u64) -> Deal {
    c.get_deal(id).unwrap()
}

fn assert_invariants(d: &Deal) {
    assert!(d.released.0 + d.refunded.0 <= d.funded.0, "paid out more than funded");
    assert!(d.funded.0 <= d.total.0, "funded more than total");
    let released: u128 = d.milestones.iter().filter(|m| m.status == MilestoneStatus::Released).map(|m| m.amount.0).sum();
    if d.status != DealStatus::Resolved {
        assert_eq!(released, d.released.0, "released mismatch");
    }
}

// ---------------------------------------------------------------- create

#[test]
fn create_splits_milestones_exactly() {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 1_000 * USDC + 1); // odd amount to test rounding
    let d = deal(&c, id);
    assert_eq!(d.status, DealStatus::Proposed);
    assert_eq!(d.milestones[0].amount.0, 300 * USDC);
    assert_eq!(d.milestones[1].amount.0, 700 * USDC + 1);
    assert_eq!(d.milestones.iter().map(|m| m.amount.0).sum::<u128>(), d.total.0);
    assert_eq!(d.supplier, supplier());
    assert_eq!(c.get_deals_for(supplier()).len(), 1);
    assert_eq!(c.get_deals_for(arbiter()).len(), 1);
    assert_eq!(c.get_config().deal_count, 1);
    assert!(get_logs().iter().any(|l| l.contains("deal_created")));
}

#[test]
#[should_panic(expected = "Milestone basis points must sum to 10000")]
fn create_rejects_bad_split() {
    let (ctx, mut c) = setup();
    ctx.call(buyer(), STORAGE);
    let mut ms = default_milestones();
    ms[1].basis_points = 6000;
    c.create_deal("x".into(), "y".into(), supplier(), arbiter(), U128(USDC), ms, None);
}

#[test]
#[should_panic(expected = "Arbiter must be a third party")]
fn create_rejects_buyer_as_arbiter() {
    let (ctx, mut c) = setup();
    ctx.call(buyer(), STORAGE);
    c.create_deal("x".into(), "y".into(), supplier(), buyer(), U128(USDC), default_milestones(), None);
}

#[test]
#[should_panic(expected = "Supplier cannot be the buyer")]
fn create_rejects_self_deal() {
    let (ctx, mut c) = setup();
    ctx.call(buyer(), STORAGE);
    c.create_deal("x".into(), "y".into(), buyer(), arbiter(), U128(USDC), default_milestones(), None);
}

#[test]
#[should_panic(expected = "Milestone deadline must be in the future")]
fn create_rejects_past_deadline() {
    let (ctx, mut c) = setup();
    ctx.call(buyer(), STORAGE);
    let mut ms = default_milestones();
    ms[0].deadline_ms = T0_MS - 1;
    c.create_deal("x".into(), "y".into(), supplier(), arbiter(), U128(USDC), ms, None);
}

#[test]
#[should_panic(expected = "Total must be positive")]
fn create_rejects_zero_total() {
    let (ctx, mut c) = setup();
    ctx.call(buyer(), STORAGE);
    c.create_deal("x".into(), "y".into(), supplier(), arbiter(), U128(0), default_milestones(), None);
}

#[test]
#[should_panic(expected = "for storage")]
fn create_requires_storage_deposit() {
    let (ctx, mut c) = setup();
    ctx.call(buyer(), 0);
    c.create_deal("x".into(), "y".into(), supplier(), arbiter(), U128(USDC), default_milestones(), None);
}

// ---------------------------------------------------------------- accept / decline / cancel

#[test]
fn supplier_accepts_and_payout_account_is_locked() {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 100 * USDC);
    ctx.call(supplier(), 0);
    c.accept_deal(id);
    let d = deal(&c, id);
    assert_eq!(d.status, DealStatus::Accepted);
    assert_eq!(d.supplier, supplier());
    assert!(d.accepted_at_ms.is_some());
}

#[test]
#[should_panic(expected = "Only the supplier can accept")]
fn impostor_cannot_accept() {
    // The "new bank details" scam: someone else tries to step in as supplier.
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 100 * USDC);
    ctx.call(attacker(), 0);
    c.accept_deal(id);
}

#[test]
#[should_panic(expected = "Deal is not awaiting acceptance")]
fn cannot_accept_twice() {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 100 * USDC);
    ctx.call(supplier(), 0);
    c.accept_deal(id);
    c.accept_deal(id);
}

#[test]
fn supplier_can_decline() {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 100 * USDC);
    ctx.call(supplier(), 0);
    c.decline_deal(id);
    assert_eq!(deal(&c, id).status, DealStatus::Cancelled);
}

#[test]
fn buyer_cancel_refunds_partial_funding() {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 100 * USDC);
    ctx.call(supplier(), 0);
    c.accept_deal(id);
    fund(&ctx, &mut c, id, 40 * USDC, buyer());
    ctx.call(buyer(), 0);
    c.cancel_deal(id);
    let d = deal(&c, id);
    assert_eq!(d.status, DealStatus::Cancelled);
    assert_eq!(d.refunded.0, 40 * USDC);
    assert_eq!(d.locked(), 0);
    assert!(get_logs().iter().any(|l| l.contains("cancel_refund")));
}

#[test]
#[should_panic(expected = "Deal can no longer be cancelled")]
fn buyer_cannot_cancel_active_deal() {
    let (ctx, mut c, id) = active_deal(100 * USDC);
    ctx.call(buyer(), 0);
    c.cancel_deal(id);
}

#[test]
#[should_panic(expected = "Only the buyer can cancel")]
fn others_cannot_cancel() {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 100 * USDC);
    ctx.call(supplier(), 0);
    c.cancel_deal(id);
}

// ---------------------------------------------------------------- funding

#[test]
fn funding_in_parts_activates_deal() {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 100 * USDC);
    ctx.call(supplier(), 0);
    c.accept_deal(id);
    assert_eq!(fund(&ctx, &mut c, id, 30 * USDC, buyer()), 0);
    assert_eq!(deal(&c, id).status, DealStatus::Accepted);
    // Second part arrives via NEAR Intents (sender is intents.near, not the buyer).
    assert_eq!(fund(&ctx, &mut c, id, 70 * USDC, "intents.near".parse().unwrap()), 0);
    let d = deal(&c, id);
    assert_eq!(d.status, DealStatus::Active);
    assert_eq!(d.funded.0, 100 * USDC);
}

#[test]
fn overfunding_returns_excess() {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 100 * USDC);
    ctx.call(supplier(), 0);
    c.accept_deal(id);
    assert_eq!(fund(&ctx, &mut c, id, 105 * USDC, buyer()), 5 * USDC);
    assert_eq!(deal(&c, id).funded.0, 100 * USDC);
}

#[test]
fn funding_before_acceptance_is_returned() {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 100 * USDC);
    assert_eq!(fund(&ctx, &mut c, id, 100 * USDC, buyer()), 100 * USDC);
    assert_eq!(deal(&c, id).funded.0, 0);
}

#[test]
fn funding_active_deal_is_returned() {
    let (ctx, mut c, id) = active_deal(100 * USDC);
    assert_eq!(fund(&ctx, &mut c, id, 1 * USDC, buyer()), USDC);
}

#[test]
fn bad_msg_or_unknown_deal_is_returned() {
    let (ctx, mut c) = setup();
    ctx.call(token(), 0);
    match c.ft_on_transfer(buyer(), U128(5), "hello".into()) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, 5),
        _ => panic!(),
    }
    assert_eq!(fund(&ctx, &mut c, 42, 5, buyer()), 5);
}

#[test]
#[should_panic(expected = "Unsupported token")]
fn rejects_other_tokens() {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 100 * USDC);
    ctx.call("fake-usdc.near".parse().unwrap(), 0);
    let _ = c.ft_on_transfer(buyer(), U128(100 * USDC), format!("{{\"deal_id\":{id}}}"));
}

// ---------------------------------------------------------------- proof / approve / release

#[test]
fn happy_path_releases_each_milestone_to_supplier() {
    let (mut ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 0);
    assert_eq!(deal(&c, id).milestones[0].status, MilestoneStatus::Submitted);
    ctx.call(buyer(), 0);
    c.approve_milestone(id, 0);
    let d = deal(&c, id);
    assert_eq!(d.milestones[0].status, MilestoneStatus::Released);
    assert_eq!(d.released.0, 300 * USDC);
    assert_eq!(d.status, DealStatus::Active);
    let logs = get_logs();
    assert!(logs.iter().any(|l| l.contains("milestone_released") && l.contains(supplier().as_str())));
    assert_invariants(&d);

    ctx.advance(DAY_MS);
    proof(&ctx, &mut c, id, 1);
    ctx.call(buyer(), 0);
    c.approve_milestone(id, 1);
    let d = deal(&c, id);
    assert_eq!(d.status, DealStatus::Completed);
    assert_eq!(d.released.0, 1_000 * USDC);
    assert_eq!(d.locked(), 0);
    assert_invariants(&d);
}

#[test]
#[should_panic(expected = "Milestone has no proof awaiting review")]
fn no_double_release() {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 0);
    ctx.call(buyer(), 0);
    c.approve_milestone(id, 0);
    c.approve_milestone(id, 0);
}

#[test]
#[should_panic(expected = "Milestone is not awaiting proof")]
fn cannot_resubmit_released_milestone() {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 0);
    ctx.call(buyer(), 0);
    c.approve_milestone(id, 0);
    proof(&ctx, &mut c, id, 0);
}

#[test]
#[should_panic(expected = "Milestone has no proof awaiting review")]
fn cannot_approve_without_proof() {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    ctx.call(buyer(), 0);
    c.approve_milestone(id, 0);
}

#[test]
#[should_panic(expected = "Only the buyer can approve")]
fn supplier_cannot_self_approve() {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 0);
    ctx.call(supplier(), 0);
    c.approve_milestone(id, 0);
}

#[test]
#[should_panic(expected = "Only the supplier can submit proof")]
fn only_supplier_submits_proof() {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    ctx.call(attacker(), STORAGE);
    c.submit_proof(id, 0, "a".repeat(64), "fake".into(), None);
}

#[test]
#[should_panic(expected = "Deal is not active")]
fn cannot_submit_proof_before_funding() {
    let (ctx, mut c) = setup();
    let id = create(&ctx, &mut c, 100 * USDC);
    ctx.call(supplier(), 0);
    c.accept_deal(id);
    proof(&ctx, &mut c, id, 0);
}

#[test]
#[should_panic(expected = "Proof hash must be 64 lowercase hex chars")]
fn rejects_malformed_hash() {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    ctx.call(supplier(), STORAGE);
    c.submit_proof(id, 0, "not-a-hash".into(), "x".into(), None);
}

#[test]
#[should_panic(expected = "Milestone deadline has passed")]
fn cannot_submit_after_deadline() {
    let (mut ctx, mut c, id) = active_deal(1_000 * USDC);
    ctx.advance(11 * DAY_MS);
    proof(&ctx, &mut c, id, 0);
}

#[test]
#[should_panic(expected = "No such milestone")]
fn rejects_unknown_milestone() {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 7);
}

#[test]
fn buyer_can_reject_and_supplier_resubmits() {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 0);
    ctx.call(buyer(), 0);
    c.reject_proof(id, 0, "Photo shows a different product".into());
    let d = deal(&c, id);
    assert_eq!(d.milestones[0].status, MilestoneStatus::Pending);
    assert_eq!(d.milestones[0].last_rejection.as_deref(), Some("Photo shows a different product"));
    proof(&ctx, &mut c, id, 0);
    ctx.call(buyer(), 0);
    c.approve_milestone(id, 0);
    assert_eq!(deal(&c, id).released.0, 300 * USDC);
}

// ---------------------------------------------------------------- review window

#[test]
fn supplier_can_claim_after_review_window() {
    let (mut ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 0);
    ctx.advance(3 * DAY_MS + 1);
    ctx.call(supplier(), 0);
    c.claim_unreviewed(id, 0);
    let d = deal(&c, id);
    assert_eq!(d.milestones[0].status, MilestoneStatus::Released);
    assert_eq!(d.released.0, 300 * USDC);
}

#[test]
#[should_panic(expected = "Review window has not passed")]
fn supplier_cannot_claim_early() {
    let (mut ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 0);
    ctx.advance(DAY_MS);
    ctx.call(supplier(), 0);
    c.claim_unreviewed(id, 0);
}

#[test]
#[should_panic(expected = "Milestone has no proof awaiting review")]
fn claim_after_rejection_fails() {
    let (mut ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 0);
    ctx.call(buyer(), 0);
    c.reject_proof(id, 0, "wrong".into());
    ctx.advance(4 * DAY_MS);
    ctx.call(supplier(), 0);
    c.claim_unreviewed(id, 0);
}

// ---------------------------------------------------------------- timeout refund

#[test]
fn buyer_reclaims_after_deadline_without_proof() {
    let (mut ctx, mut c, id) = active_deal(1_000 * USDC);
    ctx.advance(11 * DAY_MS);
    ctx.call(buyer(), 0);
    assert_eq!(c.reclaim_expired(id).0, 300 * USDC);
    let d = deal(&c, id);
    assert_eq!(d.milestones[0].status, MilestoneStatus::Refunded);
    assert_eq!(d.milestones[1].status, MilestoneStatus::Pending);
    assert_eq!(d.refunded.0, 300 * USDC);
    assert_eq!(d.status, DealStatus::Active);

    ctx.advance(30 * DAY_MS);
    ctx.call(buyer(), 0);
    assert_eq!(c.reclaim_expired(id).0, 700 * USDC);
    let d = deal(&c, id);
    assert_eq!(d.status, DealStatus::Completed);
    assert_eq!(d.locked(), 0);
    assert_invariants(&d);
}

#[test]
#[should_panic(expected = "No expired milestones to reclaim")]
fn cannot_reclaim_before_deadline() {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    ctx.call(buyer(), 0);
    c.reclaim_expired(id);
}

#[test]
#[should_panic(expected = "No expired milestones to reclaim")]
fn cannot_reclaim_twice() {
    let (mut ctx, mut c, id) = active_deal(1_000 * USDC);
    ctx.advance(11 * DAY_MS);
    ctx.call(buyer(), 0);
    c.reclaim_expired(id);
    c.reclaim_expired(id);
}

#[test]
fn reclaim_skips_milestones_with_proof() {
    let (mut ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 0);
    ctx.advance(31 * DAY_MS);
    ctx.call(buyer(), 0);
    assert_eq!(c.reclaim_expired(id).0, 700 * USDC);
    assert_eq!(deal(&c, id).milestones[0].status, MilestoneStatus::Submitted);
}

#[test]
#[should_panic(expected = "Only the buyer can reclaim")]
fn supplier_cannot_reclaim() {
    let (mut ctx, mut c, id) = active_deal(1_000 * USDC);
    ctx.advance(11 * DAY_MS);
    ctx.call(supplier(), 0);
    c.reclaim_expired(id);
}

#[test]
fn buyer_can_extend_deadline() {
    let (mut ctx, mut c, id) = active_deal(1_000 * USDC);
    ctx.call(buyer(), 0);
    c.extend_deadline(id, 0, T0_MS + 20 * DAY_MS);
    ctx.advance(15 * DAY_MS);
    proof(&ctx, &mut c, id, 0); // would have failed without the extension
    assert_eq!(deal(&c, id).milestones[0].status, MilestoneStatus::Submitted);
}

#[test]
#[should_panic(expected = "New deadline must be later")]
fn cannot_shorten_deadline() {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    ctx.call(buyer(), 0);
    c.extend_deadline(id, 0, T0_MS + DAY_MS);
}

// ---------------------------------------------------------------- disputes

fn disputed() -> (Ctx, Escrow, u64) {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 0);
    ctx.call(buyer(), 0);
    c.approve_milestone(id, 0); // 300 released
    proof(&ctx, &mut c, id, 1);
    ctx.call(buyer(), STORAGE);
    c.open_dispute(id, "Bill of lading number does not exist".into());
    (ctx, c, id)
}

#[test]
fn dispute_freezes_funds() {
    let (ctx, c, id) = disputed();
    let d = deal(&c, id);
    assert_eq!(d.status, DealStatus::Disputed);
    assert_eq!(d.dispute.as_ref().unwrap().opened_by, buyer());
    let _ = ctx;
}

#[test]
#[should_panic(expected = "Deal is not active")]
fn dispute_blocks_approval() {
    let (ctx, mut c, id) = disputed();
    ctx.call(buyer(), 0);
    c.approve_milestone(id, 1);
}

#[test]
#[should_panic(expected = "Deal is not active")]
fn dispute_blocks_supplier_claim() {
    let (mut ctx, mut c, id) = disputed();
    ctx.advance(10 * DAY_MS);
    ctx.call(supplier(), 0);
    c.claim_unreviewed(id, 1);
}

#[test]
#[should_panic(expected = "Deal is not active")]
fn dispute_blocks_reclaim() {
    let (mut ctx, mut c, id) = disputed();
    ctx.advance(40 * DAY_MS);
    ctx.call(buyer(), 0);
    c.reclaim_expired(id);
}

#[test]
#[should_panic(expected = "Only buyer or supplier can dispute")]
fn outsiders_cannot_dispute() {
    let (ctx, mut c, id) = active_deal(1_000 * USDC);
    ctx.call(attacker(), STORAGE);
    c.open_dispute(id, "spam".into());
}

#[test]
fn arbiter_resolves_split() {
    let (ctx, mut c, id) = disputed();
    ctx.call(arbiter(), 0);
    c.resolve_dispute(id, U128(200 * USDC), "Partial shipment verified".into());
    let d = deal(&c, id);
    assert_eq!(d.status, DealStatus::Resolved);
    assert_eq!(d.released.0, 500 * USDC);
    assert_eq!(d.refunded.0, 500 * USDC);
    assert_eq!(d.locked(), 0);
    assert!(d.milestones.iter().all(|m| m.status.is_settled()));
    let r = d.dispute.unwrap().resolution.unwrap();
    assert_eq!(r.to_buyer.0, 500 * USDC);
    let logs = get_logs();
    assert!(logs.iter().any(|l| l.contains("dispute_award")));
    assert!(logs.iter().any(|l| l.contains("dispute_refund")));
}

#[test]
#[should_panic(expected = "Cannot award more than the locked amount")]
fn arbiter_cannot_award_more_than_locked() {
    let (ctx, mut c, id) = disputed();
    ctx.call(arbiter(), 0);
    c.resolve_dispute(id, U128(701 * USDC), "".into());
}

#[test]
#[should_panic(expected = "Only the arbiter can resolve")]
fn only_arbiter_resolves() {
    let (ctx, mut c, id) = disputed();
    ctx.call(supplier(), 0);
    c.resolve_dispute(id, U128(700 * USDC), "".into());
}

#[test]
#[should_panic(expected = "Deal is not disputed")]
fn cannot_resolve_twice() {
    let (ctx, mut c, id) = disputed();
    ctx.call(arbiter(), 0);
    c.resolve_dispute(id, U128(0), "".into());
    c.resolve_dispute(id, U128(0), "".into());
}

#[test]
fn opener_can_withdraw_dispute() {
    let (ctx, mut c, id) = disputed();
    ctx.call(buyer(), 0);
    c.withdraw_dispute(id);
    let d = deal(&c, id);
    assert_eq!(d.status, DealStatus::Active);
    assert!(d.dispute.is_none());
    c.approve_milestone(id, 1);
    assert_eq!(deal(&c, id).status, DealStatus::Completed);
}

#[test]
#[should_panic(expected = "Only the opener can withdraw")]
fn other_party_cannot_withdraw_dispute() {
    let (ctx, mut c, id) = disputed();
    ctx.call(supplier(), 0);
    c.withdraw_dispute(id);
}

// ---------------------------------------------------------------- failed payouts

#[test]
fn failed_payout_is_owed_and_retryable() {
    let (ctx, mut c, _id) = active_deal(1_000 * USDC);
    ctx.call_with_result(contract_id(), PromiseResult::Failed);
    assert!(!c.on_payout(supplier(), U128(300 * USDC), 0));
    assert_eq!(c.get_owed(supplier()).0, 300 * USDC);

    ctx.call(supplier(), 0);
    assert_eq!(c.withdraw_owed().0, 300 * USDC);
    assert_eq!(c.get_owed(supplier()).0, 0);
}

#[test]
fn successful_payout_owes_nothing() {
    let (ctx, mut c, _id) = active_deal(1_000 * USDC);
    ctx.call_with_result(contract_id(), PromiseResult::Successful(vec![]));
    assert!(c.on_payout(supplier(), U128(300 * USDC), 0));
    assert_eq!(c.get_owed(supplier()).0, 0);
}

#[test]
#[should_panic(expected = "Method on_payout is private")]
fn on_payout_is_private() {
    let (ctx, mut c, _id) = active_deal(1_000 * USDC);
    ctx.call_with_result(attacker(), PromiseResult::Failed);
    c.on_payout(attacker(), U128(1_000 * USDC), 0);
}

#[test]
#[should_panic(expected = "Nothing owed")]
fn withdraw_owed_requires_balance() {
    let (ctx, mut c) = setup();
    ctx.call(attacker(), 0);
    c.withdraw_owed();
}

// ---------------------------------------------------------------- payee is immutable

#[test]
fn payee_never_changes_across_full_lifecycle() {
    let (mut ctx, mut c, id) = active_deal(1_000 * USDC);
    proof(&ctx, &mut c, id, 0);
    ctx.call(buyer(), 0);
    c.reject_proof(id, 0, "blurry".into());
    proof(&ctx, &mut c, id, 0);
    ctx.call(buyer(), 0);
    c.approve_milestone(id, 0);
    ctx.advance(DAY_MS);
    proof(&ctx, &mut c, id, 1);
    ctx.advance(4 * DAY_MS);
    ctx.call(supplier(), 0);
    c.claim_unreviewed(id, 1);
    let d = deal(&c, id);
    assert_eq!(d.supplier, supplier());
    assert_eq!(d.status, DealStatus::Completed);
    // Every payout event in the last call went to the locked supplier.
    for l in get_logs().iter().filter(|l| l.contains("\"event\":\"payout\"")) {
        assert!(l.contains(&format!("\"receiver\":\"{}\"", supplier())));
    }
    assert_invariants(&d);
}
