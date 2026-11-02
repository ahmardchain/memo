//! memo — a stablecoin "letter of credit" for small businesses.
//!
//! A buyer locks USDC for a supplier in milestones (e.g. 30% on production
//! proof, 70% on shipping proof). The supplier's payout account is fixed at
//! creation, confirmed by the supplier's own signature, and can never be
//! changed — which defeats the "our bank details have changed" scam.
//!
//! Security invariants (each covered by tests in `tests.rs`):
//! * Only `deal.supplier` can ever receive a milestone payout; no setter exists.
//! * Every milestone pays out or refunds at most once (status moves forward only).
//! * `released + refunded <= funded <= total` at all times.
//! * Only the configured stablecoin contract can fund deals.
//! * The contract has no owner/admin: nobody can move deal funds except
//!   through the deal's own rules (buyer approval, timeouts, arbiter).

mod events;
mod types;

#[cfg(test)]
mod tests;

pub use types::*;

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_ON_PAYOUT: Gas = Gas::from_tgas(10);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// Default time a buyer has to review a submitted proof: 7 days.
pub const DEFAULT_REVIEW_WINDOW_MS: u64 = 7 * 24 * 60 * 60 * 1000;
pub const MIN_REVIEW_WINDOW_MS: u64 = 60 * 1000;

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Deals,
    ByAccount,
    Owed,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Escrow {
    /// The NEP-141 stablecoin accepted by this escrow (USDC).
    token: AccountId,
    deals: LookupMap<u64, Deal>,
    /// Deal ids each account participates in (buyer, supplier or arbiter).
    by_account: LookupMap<AccountId, Vec<u64>>,
    /// Payouts whose `ft_transfer` failed (e.g. receiver not registered with
    /// the token). The receiver can retry with `withdraw_owed`.
    owed: LookupMap<AccountId, u128>,
    deal_count: u64,
}

#[near]
impl Escrow {
    #[init]
    pub fn new(token: AccountId) -> Self {
        Self {
            token,
            deals: LookupMap::new(StorageKey::Deals),
            by_account: LookupMap::new(StorageKey::ByAccount),
            owed: LookupMap::new(StorageKey::Owed),
            deal_count: 0,
        }
    }

    // ------------------------------------------------------------------
    // Deal setup
    // ------------------------------------------------------------------

    /// Buyer creates a deal. Attach a small NEAR deposit to cover storage
    /// (the unused part is refunded).
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn create_deal(
        &mut self,
        title: String,
        supplier_name: String,
        supplier: AccountId,
        arbiter: AccountId,
        total: U128,
        milestones: Vec<MilestoneInput>,
        review_window_ms: Option<u64>,
    ) -> u64 {
        let storage_before = env::storage_usage();
        let buyer = env::predecessor_account_id();
        let now = env::block_timestamp_ms();

        require!(!title.trim().is_empty() && title.len() <= MAX_TITLE_LEN, "Invalid title");
        require!(
            !supplier_name.trim().is_empty() && supplier_name.len() <= MAX_TITLE_LEN,
            "Invalid supplier name"
        );
        require!(supplier != buyer, "Supplier cannot be the buyer");
        require!(arbiter != buyer && arbiter != supplier, "Arbiter must be a third party");
        require!(supplier != env::current_account_id(), "Invalid supplier");
        require!(total.0 > 0, "Total must be positive");
        require!(
            !milestones.is_empty() && milestones.len() <= MAX_MILESTONES,
            "Deal needs 1 to 10 milestones"
        );
        let review_window_ms = review_window_ms.unwrap_or(DEFAULT_REVIEW_WINDOW_MS);
        require!(review_window_ms >= MIN_REVIEW_WINDOW_MS, "Review window too short");

        let bps_sum: u32 = milestones.iter().map(|m| m.basis_points as u32).sum();
        require!(bps_sum == BPS_TOTAL, "Milestone basis points must sum to 10000");

        let mut allocated: u128 = 0;
        let count = milestones.len();
        let mut built = Vec::with_capacity(count);
        for (i, m) in milestones.into_iter().enumerate() {
            require!(m.basis_points > 0, "Each milestone needs a positive share");
            require!(
                !m.title.trim().is_empty() && m.title.len() <= MAX_TITLE_LEN,
                "Invalid milestone title"
            );
            require!(m.deadline_ms > now, "Milestone deadline must be in the future");
            // Last milestone takes the remainder so amounts always sum to total exactly.
            let amount = if i + 1 == count {
                total.0 - allocated
            } else {
                total.0 * m.basis_points as u128 / BPS_TOTAL as u128
            };
            require!(amount > 0, "Milestone amount rounds to zero");
            allocated += amount;
            built.push(Milestone {
                title: m.title,
                basis_points: m.basis_points,
                amount: U128(amount),
                deadline_ms: m.deadline_ms,
                status: MilestoneStatus::Pending,
                proof: None,
                last_rejection: None,
                settled_at_ms: None,
            });
        }
        debug_assert_eq!(allocated, total.0);

        let id = self.deal_count;
        self.deal_count += 1;
        let deal = Deal {
            id,
            title,
            buyer: buyer.clone(),
            supplier_name,
            supplier: supplier.clone(),
            arbiter: arbiter.clone(),
            total,
            funded: U128(0),
            released: U128(0),
            refunded: U128(0),
            review_window_ms,
            milestones: built,
            status: DealStatus::Proposed,
            created_at_ms: now,
            accepted_at_ms: None,
            activated_at_ms: None,
            dispute: None,
        };
        self.deals.insert(id, deal);
        for acc in [&buyer, &supplier, &arbiter] {
            self.index_account(acc, id);
        }

        events::emit(
            "deal_created",
            json!({ "deal_id": id, "buyer": buyer, "supplier": supplier, "arbiter": arbiter, "total": total }),
        );
        self.charge_storage(storage_before);
        id
    }

    /// Supplier accepts the terms. Must be signed by the exact supplier
    /// account named in the deal, which then becomes the locked payout account.
    pub fn accept_deal(&mut self, deal_id: u64) {
        let mut deal = self.deal_or_panic(deal_id);
        require!(env::predecessor_account_id() == deal.supplier, "Only the supplier can accept");
        require!(deal.status == DealStatus::Proposed, "Deal is not awaiting acceptance");
        deal.status = DealStatus::Accepted;
        deal.accepted_at_ms = Some(env::block_timestamp_ms());
        events::emit(
            "deal_accepted",
            json!({ "deal_id": deal_id, "payout_account_locked": deal.supplier }),
        );
        self.deals.insert(deal_id, deal);
    }

    /// Supplier declines a proposed deal.
    pub fn decline_deal(&mut self, deal_id: u64) {
        let mut deal = self.deal_or_panic(deal_id);
        require!(env::predecessor_account_id() == deal.supplier, "Only the supplier can decline");
        require!(deal.status == DealStatus::Proposed, "Deal is not awaiting acceptance");
        deal.status = DealStatus::Cancelled;
        events::emit("deal_cancelled", json!({ "deal_id": deal_id, "by": deal.supplier }));
        self.deals.insert(deal_id, deal);
    }

    /// Buyer cancels before the deal is fully funded. Partial funding returns to the buyer.
    pub fn cancel_deal(&mut self, deal_id: u64) {
        let mut deal = self.deal_or_panic(deal_id);
        require!(env::predecessor_account_id() == deal.buyer, "Only the buyer can cancel");
        require!(
            matches!(deal.status, DealStatus::Proposed | DealStatus::Accepted),
            "Deal can no longer be cancelled"
        );
        let refund = deal.locked();
        deal.refunded = U128(deal.refunded.0 + refund);
        deal.status = DealStatus::Cancelled;
        let buyer = deal.buyer.clone();
        events::emit("deal_cancelled", json!({ "deal_id": deal_id, "by": buyer }));
        self.deals.insert(deal_id, deal);
        self.pay(deal_id, buyer, refund, "cancel_refund");
    }

    // ------------------------------------------------------------------
    // Milestones
    // ------------------------------------------------------------------

    /// Supplier submits proof for a milestone. The document lives off-chain;
    /// its SHA-256 hash and a short description are stored here.
    #[payable]
    pub fn submit_proof(
        &mut self,
        deal_id: u64,
        milestone: u32,
        hash: String,
        description: String,
        uri: Option<String>,
    ) {
        let storage_before = env::storage_usage();
        let mut deal = self.deal_or_panic(deal_id);
        require!(env::predecessor_account_id() == deal.supplier, "Only the supplier can submit proof");
        require!(deal.status == DealStatus::Active, "Deal is not active");
        require!(is_sha256_hex(&hash), "Proof hash must be 64 lowercase hex chars (SHA-256)");
        require!(description.len() <= MAX_TEXT_LEN, "Description too long");
        if let Some(u) = &uri {
            require!(u.len() <= MAX_URI_LEN, "URI too long");
        }
        let now = env::block_timestamp_ms();
        let m = milestone_mut(&mut deal, milestone);
        require!(m.status == MilestoneStatus::Pending, "Milestone is not awaiting proof");
        require!(now <= m.deadline_ms, "Milestone deadline has passed");
        m.status = MilestoneStatus::Submitted;
        m.proof = Some(Proof { hash: hash.clone(), description, uri, submitted_at_ms: now });
        events::emit(
            "proof_submitted",
            json!({ "deal_id": deal_id, "milestone": milestone, "hash": hash }),
        );
        self.deals.insert(deal_id, deal);
        self.charge_storage(storage_before);
    }

    /// Buyer rejects a submitted proof; the supplier may resubmit before the deadline.
    pub fn reject_proof(&mut self, deal_id: u64, milestone: u32, reason: String) {
        let mut deal = self.deal_or_panic(deal_id);
        require!(env::predecessor_account_id() == deal.buyer, "Only the buyer can reject proof");
        require!(deal.status == DealStatus::Active, "Deal is not active");
        require!(reason.len() <= MAX_TEXT_LEN, "Reason too long");
        let m = milestone_mut(&mut deal, milestone);
        require!(m.status == MilestoneStatus::Submitted, "No proof to reject");
        m.status = MilestoneStatus::Pending;
        m.last_rejection = Some(reason.clone());
        events::emit(
            "proof_rejected",
            json!({ "deal_id": deal_id, "milestone": milestone, "reason": reason }),
        );
        self.deals.insert(deal_id, deal);
    }

    /// Buyer approves a submitted proof → that milestone's amount goes to the
    /// locked supplier account.
    pub fn approve_milestone(&mut self, deal_id: u64, milestone: u32) {
        let deal = self.deal_or_panic(deal_id);
        require!(env::predecessor_account_id() == deal.buyer, "Only the buyer can approve");
        self.release(deal, milestone, "milestone_approved");
    }

    /// If the buyer has not reviewed a submitted proof within the review
    /// window, the supplier can release the milestone themselves. Stops a
    /// buyer from stalling forever; a buyer who objects should dispute.
    pub fn claim_unreviewed(&mut self, deal_id: u64, milestone: u32) {
        let deal = self.deal_or_panic(deal_id);
        require!(env::predecessor_account_id() == deal.supplier, "Only the supplier can claim");
        let m = deal.milestones.get(milestone as usize).unwrap_or_else(|| env::panic_str("No such milestone"));
        let submitted_at = m
            .proof
            .as_ref()
            .map(|p| p.submitted_at_ms)
            .unwrap_or_else(|| env::panic_str("No proof submitted"));
        require!(
            env::block_timestamp_ms() > submitted_at + deal.review_window_ms,
            "Review window has not passed"
        );
        self.release(deal, milestone, "review_window_elapsed");
    }

    /// Buyer reclaims every milestone whose deadline passed without proof.
    pub fn reclaim_expired(&mut self, deal_id: u64) -> U128 {
        let mut deal = self.deal_or_panic(deal_id);
        require!(env::predecessor_account_id() == deal.buyer, "Only the buyer can reclaim");
        require!(deal.status == DealStatus::Active, "Deal is not active");
        let now = env::block_timestamp_ms();
        let mut total: u128 = 0;
        let mut indexes = vec![];
        for (i, m) in deal.milestones.iter_mut().enumerate() {
            if m.status == MilestoneStatus::Pending && now > m.deadline_ms {
                m.status = MilestoneStatus::Refunded;
                m.settled_at_ms = Some(now);
                total += m.amount.0;
                indexes.push(i);
            }
        }
        require!(total > 0, "No expired milestones to reclaim");
        require!(total <= deal.locked(), "Insufficient locked funds");
        deal.refunded = U128(deal.refunded.0 + total);
        if deal.all_settled() {
            deal.status = DealStatus::Completed;
        }
        let buyer = deal.buyer.clone();
        events::emit(
            "milestones_reclaimed",
            json!({ "deal_id": deal_id, "milestones": indexes, "amount": U128(total) }),
        );
        self.deals.insert(deal_id, deal);
        self.pay(deal_id, buyer, total, "deadline_refund");
        U128(total)
    }

    /// Buyer gives the supplier more time on a milestone (can only move later).
    pub fn extend_deadline(&mut self, deal_id: u64, milestone: u32, new_deadline_ms: u64) {
        let mut deal = self.deal_or_panic(deal_id);
        require!(env::predecessor_account_id() == deal.buyer, "Only the buyer can extend");
        require!(
            matches!(deal.status, DealStatus::Proposed | DealStatus::Accepted | DealStatus::Active),
            "Deal is not open"
        );
        let m = milestone_mut(&mut deal, milestone);
        require!(
            matches!(m.status, MilestoneStatus::Pending | MilestoneStatus::Submitted),
            "Milestone already settled"
        );
        require!(new_deadline_ms > m.deadline_ms, "New deadline must be later");
        m.deadline_ms = new_deadline_ms;
        events::emit(
            "deadline_extended",
            json!({ "deal_id": deal_id, "milestone": milestone, "deadline_ms": new_deadline_ms }),
        );
        self.deals.insert(deal_id, deal);
    }

    // ------------------------------------------------------------------
    // Disputes
    // ------------------------------------------------------------------

    /// Buyer or supplier freezes the deal. Nothing can be released or
    /// reclaimed until the arbiter resolves (or the opener withdraws).
    #[payable]
    pub fn open_dispute(&mut self, deal_id: u64, reason: String) {
        let storage_before = env::storage_usage();
        let mut deal = self.deal_or_panic(deal_id);
        let caller = env::predecessor_account_id();
        require!(caller == deal.buyer || caller == deal.supplier, "Only buyer or supplier can dispute");
        require!(deal.status == DealStatus::Active, "Deal is not active");
        require!(!reason.trim().is_empty() && reason.len() <= MAX_TEXT_LEN, "Invalid reason");
        deal.status = DealStatus::Disputed;
        deal.dispute = Some(Dispute {
            opened_by: caller.clone(),
            reason: reason.clone(),
            opened_at_ms: env::block_timestamp_ms(),
            resolution: None,
        });
        events::emit("dispute_opened", json!({ "deal_id": deal_id, "by": caller, "reason": reason }));
        self.deals.insert(deal_id, deal);
        self.charge_storage(storage_before);
    }

    /// The party that opened the dispute can withdraw it and unfreeze the deal.
    pub fn withdraw_dispute(&mut self, deal_id: u64) {
        let mut deal = self.deal_or_panic(deal_id);
        require!(deal.status == DealStatus::Disputed, "Deal is not disputed");
        let opener = deal.dispute.as_ref().map(|d| d.opened_by.clone()).unwrap();
        require!(env::predecessor_account_id() == opener, "Only the opener can withdraw");
        deal.status = DealStatus::Active;
        deal.dispute = None;
        events::emit("dispute_withdrawn", json!({ "deal_id": deal_id }));
        self.deals.insert(deal_id, deal);
    }

    /// Arbiter splits everything still locked: `to_supplier` goes to the
    /// locked supplier account, the rest back to the buyer.
    pub fn resolve_dispute(&mut self, deal_id: u64, to_supplier: U128, note: String) {
        let mut deal = self.deal_or_panic(deal_id);
        require!(env::predecessor_account_id() == deal.arbiter, "Only the arbiter can resolve");
        require!(deal.status == DealStatus::Disputed, "Deal is not disputed");
        require!(note.len() <= MAX_TEXT_LEN, "Note too long");
        let locked = deal.locked();
        require!(to_supplier.0 <= locked, "Cannot award more than the locked amount");
        let to_buyer = locked - to_supplier.0;
        let now = env::block_timestamp_ms();
        for m in deal.milestones.iter_mut() {
            if !m.status.is_settled() {
                m.status = MilestoneStatus::Resolved;
                m.settled_at_ms = Some(now);
            }
        }
        deal.released = U128(deal.released.0 + to_supplier.0);
        deal.refunded = U128(deal.refunded.0 + to_buyer);
        deal.status = DealStatus::Resolved;
        if let Some(d) = deal.dispute.as_mut() {
            d.resolution = Some(Resolution {
                to_supplier,
                to_buyer: U128(to_buyer),
                note,
                resolved_at_ms: now,
            });
        }
        let (buyer, supplier) = (deal.buyer.clone(), deal.supplier.clone());
        events::emit(
            "dispute_resolved",
            json!({ "deal_id": deal_id, "to_supplier": to_supplier, "to_buyer": U128(to_buyer) }),
        );
        self.deals.insert(deal_id, deal);
        self.pay(deal_id, supplier, to_supplier.0, "dispute_award");
        self.pay(deal_id, buyer, to_buyer, "dispute_refund");
    }

    // ------------------------------------------------------------------
    // Failed-payout recovery
    // ------------------------------------------------------------------

    /// Retry any payout to the caller that previously failed (e.g. because the
    /// caller was not yet registered with the token contract).
    pub fn withdraw_owed(&mut self) -> U128 {
        let caller = env::predecessor_account_id();
        let amount = self.owed.remove(&caller).unwrap_or(0);
        require!(amount > 0, "Nothing owed");
        self.pay(u64::MAX, caller, amount, "owed_retry");
        U128(amount)
    }

    #[private]
    pub fn on_payout(&mut self, receiver: AccountId, amount: U128, deal_id: u64) -> bool {
        // `#[private]` already enforces this on-chain; repeated so unit tests cover it too.
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Method on_payout is private"
        );
        if near_sdk::is_promise_success() {
            true
        } else {
            let owed = self.owed.get(&receiver).copied().unwrap_or(0);
            self.owed.insert(receiver.clone(), owed + amount.0);
            events::emit(
                "payout_failed",
                json!({ "deal_id": deal_id, "receiver": receiver, "amount": amount }),
            );
            false
        }
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    pub fn get_deal(&self, deal_id: u64) -> Option<Deal> {
        self.deals.get(&deal_id).cloned()
    }

    pub fn get_deals_for(&self, account_id: AccountId) -> Vec<Deal> {
        self.by_account
            .get(&account_id)
            .map(|ids| ids.iter().filter_map(|id| self.deals.get(id).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn get_owed(&self, account_id: AccountId) -> U128 {
        U128(self.owed.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_config(&self) -> Config {
        Config { token: self.token.clone(), deal_count: self.deal_count }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    fn release(&mut self, mut deal: Deal, milestone: u32, reason: &str) {
        require!(deal.status == DealStatus::Active, "Deal is not active");
        let deal_id = deal.id;
        let now = env::block_timestamp_ms();
        let amount = {
            let m = milestone_mut(&mut deal, milestone);
            require!(m.status == MilestoneStatus::Submitted, "Milestone has no proof awaiting review");
            m.status = MilestoneStatus::Released;
            m.settled_at_ms = Some(now);
            m.amount.0
        };
        require!(amount <= deal.locked(), "Insufficient locked funds");
        deal.released = U128(deal.released.0 + amount);
        if deal.all_settled() {
            deal.status = DealStatus::Completed;
        }
        // Payout destination is always the immutable `deal.supplier`.
        let supplier = deal.supplier.clone();
        events::emit(
            "milestone_released",
            json!({ "deal_id": deal_id, "milestone": milestone, "amount": U128(amount), "to": supplier, "reason": reason }),
        );
        self.deals.insert(deal_id, deal);
        self.pay(deal_id, supplier, amount, reason);
    }

    fn pay(&mut self, deal_id: u64, receiver: AccountId, amount: u128, reason: &str) {
        if amount == 0 {
            return;
        }
        events::payout(deal_id, &receiver, amount, reason);
        let args = json!({ "receiver_id": receiver, "amount": U128(amount), "memo": format!("memo deal {deal_id}: {reason}") });
        Promise::new(self.token.clone())
            .function_call(
                "ft_transfer".to_string(),
                serde_json::to_vec(&args).unwrap(),
                ONE_YOCTO,
                GAS_FT_TRANSFER,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_PAYOUT)
                    .on_payout(receiver, U128(amount), deal_id),
            )
            .detach();
    }

    fn deal_or_panic(&self, deal_id: u64) -> Deal {
        self.deals.get(&deal_id).cloned().unwrap_or_else(|| env::panic_str("Deal not found"))
    }

    fn index_account(&mut self, account: &AccountId, deal_id: u64) {
        let mut ids = self.by_account.get(account).cloned().unwrap_or_default();
        if !ids.contains(&deal_id) {
            ids.push(deal_id);
            self.by_account.insert(account.clone(), ids);
        }
    }

    /// Require the caller to pay for the storage this call added; refund the rest.
    fn charge_storage(&mut self, storage_before: u64) {
        self.deals.flush();
        self.by_account.flush();
        let used = env::storage_usage().saturating_sub(storage_before);
        let cost = env::storage_byte_cost().saturating_mul(used as u128);
        let attached = env::attached_deposit();
        require!(
            attached >= cost,
            format!("Attach at least {} yoctoNEAR for storage", cost.as_yoctonear())
        );
        let refund = attached.saturating_sub(cost);
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id()).transfer(refund).detach();
        }
    }
}

#[near]
impl FungibleTokenReceiver for Escrow {
    /// Funding entry point. `msg` must be `{"deal_id": <id>}`.
    ///
    /// Anyone may fund a deal (the buyer directly, or a NEAR Intents / 1-Click
    /// withdrawal on the buyer's behalf); refunds always go to `deal.buyer`.
    /// Invalid or excess funding is returned to the sender instead of being kept.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, "Unsupported token");
        let parsed: Result<FundMsg, _> = serde_json::from_str(&msg);
        let Ok(FundMsg { deal_id }) = parsed else {
            env::log_str("memo: invalid msg, expected {\"deal_id\": <id>}; returning funds");
            return PromiseOrValue::Value(amount);
        };
        let Some(mut deal) = self.deals.get(&deal_id).cloned() else {
            env::log_str("memo: unknown deal; returning funds");
            return PromiseOrValue::Value(amount);
        };
        if deal.status != DealStatus::Accepted {
            env::log_str("memo: deal is not accepting funds; returning funds");
            return PromiseOrValue::Value(amount);
        }
        let needed = deal.total.0 - deal.funded.0;
        let accepted = amount.0.min(needed);
        deal.funded = U128(deal.funded.0 + accepted);
        if deal.funded == deal.total {
            deal.status = DealStatus::Active;
            deal.activated_at_ms = Some(env::block_timestamp_ms());
        }
        events::emit(
            "deal_funded",
            json!({ "deal_id": deal_id, "from": sender_id, "amount": U128(accepted), "funded": deal.funded, "total": deal.total }),
        );
        self.deals.insert(deal_id, deal);
        PromiseOrValue::Value(U128(amount.0 - accepted))
    }
}

fn milestone_mut(deal: &mut Deal, index: u32) -> &mut Milestone {
    deal.milestones
        .get_mut(index as usize)
        .unwrap_or_else(|| env::panic_str("No such milestone"))
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
