use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

/// Emits a NEP-297 event: `EVENT_JSON:{"standard":"memo","version":"1.0.0","event":..,"data":[..]}`.
pub fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "memo",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

pub fn payout(deal_id: u64, receiver: &AccountId, amount: u128, reason: &str) {
    emit(
        "payout",
        json!({ "deal_id": deal_id, "receiver": receiver, "amount": U128(amount), "reason": reason }),
    );
}
