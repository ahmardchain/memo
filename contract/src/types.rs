use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

/// Basis points that make up 100% of a deal.
pub const BPS_TOTAL: u32 = 10_000;
pub const MAX_MILESTONES: usize = 10;
pub const MAX_TITLE_LEN: usize = 120;
pub const MAX_TEXT_LEN: usize = 500;
pub const MAX_URI_LEN: usize = 300;

/// Lifecycle of a deal.
///
/// ```text
/// Proposed --accept--> Accepted --fund (full)--> Active --all milestones settled--> Completed
///    |                    |                        |  ^
///  decline/cancel       cancel                 dispute |withdraw
///    v                    v                        v  |
/// Cancelled           Cancelled                 Disputed --arbiter resolves--> Resolved
/// ```
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DealStatus {
    /// Created by the buyer, waiting for the supplier to accept the terms.
    Proposed,
    /// Supplier accepted; payout account is locked. Waiting for full funding.
    Accepted,
    /// Fully funded; milestones are in progress.
    Active,
    /// Funds frozen until the arbiter resolves.
    Disputed,
    /// Every milestone has been released or refunded.
    Completed,
    /// Cancelled before it became active; any partial funding was returned to the buyer.
    Cancelled,
    /// Arbiter split the remaining funds.
    Resolved,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MilestoneStatus {
    /// Waiting for the supplier's proof.
    Pending,
    /// Supplier submitted proof; waiting for buyer review.
    Submitted,
    /// Paid out to the supplier's locked payout account.
    Released,
    /// Returned to the buyer (deadline passed without proof).
    Refunded,
    /// Settled by the arbiter as part of a dispute resolution.
    Resolved,
}

impl MilestoneStatus {
    pub fn is_settled(&self) -> bool {
        matches!(
            self,
            MilestoneStatus::Released | MilestoneStatus::Refunded | MilestoneStatus::Resolved
        )
    }
}

/// Evidence submitted by the supplier. The file itself lives off-chain;
/// only its SHA-256 hash is stored so anyone can verify the file later.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proof {
    /// Lowercase hex SHA-256 of the uploaded file (64 chars).
    pub hash: String,
    pub description: String,
    /// Optional pointer to the file (IPFS / https).
    pub uri: Option<String>,
    pub submitted_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Milestone {
    pub title: String,
    pub basis_points: u16,
    pub amount: U128,
    pub deadline_ms: u64,
    pub status: MilestoneStatus,
    pub proof: Option<Proof>,
    /// Reason given the last time the buyer rejected a proof.
    pub last_rejection: Option<String>,
    pub settled_at_ms: Option<u64>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MilestoneInput {
    pub title: String,
    pub basis_points: u16,
    /// Unix time in milliseconds by which proof must be submitted.
    pub deadline_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolution {
    pub to_supplier: U128,
    pub to_buyer: U128,
    pub note: String,
    pub resolved_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dispute {
    pub opened_by: AccountId,
    pub reason: String,
    pub opened_at_ms: u64,
    pub resolution: Option<Resolution>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Deal {
    pub id: u64,
    pub title: String,
    pub buyer: AccountId,
    /// Human-readable supplier name shown in the UI.
    pub supplier_name: String,
    /// The supplier's NEAR account. This is the ONLY account that can ever
    /// receive milestone payouts. It is fixed when the deal is created, must
    /// itself sign `accept_deal`, and no method exists to change it.
    pub supplier: AccountId,
    pub arbiter: AccountId,
    /// Total deal value in the stablecoin's smallest unit (USDC: 6 decimals).
    pub total: U128,
    pub funded: U128,
    pub released: U128,
    pub refunded: U128,
    /// How long the buyer has to review a submitted proof before the
    /// supplier may claim the milestone themselves.
    pub review_window_ms: u64,
    pub milestones: Vec<Milestone>,
    pub status: DealStatus,
    pub created_at_ms: u64,
    pub accepted_at_ms: Option<u64>,
    pub activated_at_ms: Option<u64>,
    pub dispute: Option<Dispute>,
}

impl Deal {
    /// Funds held by the contract for this deal that are neither released nor refunded.
    pub fn locked(&self) -> u128 {
        self.funded.0 - self.released.0 - self.refunded.0
    }

    pub fn all_settled(&self) -> bool {
        self.milestones.iter().all(|m| m.status.is_settled())
    }
}

/// Message format for `ft_transfer_call` into the escrow: `{"deal_id": 7}`.
#[near(serializers = [json])]
pub struct FundMsg {
    pub deal_id: u64,
}

#[near(serializers = [json])]
pub struct Config {
    pub token: AccountId,
    pub deal_count: u64,
}
