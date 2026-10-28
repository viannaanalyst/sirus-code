//! Token budgets for text that crosses from one conversation or provider to another
//! (ADR-181). Sirus has no tokenizer, so bytes stand in for tokens: one token per byte
//! overestimates English text by three to four times, which is the safe direction for a cap.

/// The most history a provider that lacks the native thread is sent, in tokens.
pub const HANDOFF_HISTORY_TOKENS: u64 = 16_000;
/// Always left free for the model's own work, or a quarter of the window, whichever is larger.
const RESERVED_MIN_TOKENS: u64 = 16_000;
/// What one attachment weighs against the budget.
pub const IMAGE_TOKENS: u64 = 8_192;
pub const FILE_TOKENS: u64 = 4_096;

/// Pessimistic token estimate for a piece of text.
pub fn estimate(text: &str) -> u64 {
    text.len() as u64
}

/// The tokens of the attachments on the message being sent.
pub fn attachments(images: u64, files: u64) -> u64 {
    images * IMAGE_TOKENS + files * FILE_TOKENS
}

/// How many tokens of earlier conversation may travel with the next message:
/// `min(16k, window - used - current - max(16k, window / 4))`. Without a known window the
/// 16k cap alone applies.
pub fn handoff_history(window: Option<u64>, used: u64, current: u64) -> u64 {
    let Some(window) = window.filter(|window| *window > 0) else {
        return HANDOFF_HISTORY_TOKENS;
    };
    let reserved = RESERVED_MIN_TOKENS.max(window / 4);
    window
        .saturating_sub(used)
        .saturating_sub(current)
        .saturating_sub(reserved)
        .min(HANDOFF_HISTORY_TOKENS)
}

/// Cuts text to `max` characters for a result that returns to another conversation, and says
/// whether it was cut.
pub fn cap_chars(text: &str, max: usize) -> (String, bool) {
    if text.chars().count() <= max {
        return (text.to_string(), false);
    }
    (text.chars().take(max).collect(), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_history_budget_is_capped_and_leaves_room_for_the_model() {
        assert_eq!(handoff_history(None, 0, 0), 16_000);
        // A big window leaves the cap alone.
        assert_eq!(handoff_history(Some(1_000_000), 100_000, 1_000), 16_000);
        // 200k window: reserve max(16k, 50k) = 50k; 200k - 100k - 10k - 50k = 40k, capped.
        assert_eq!(handoff_history(Some(200_000), 100_000, 10_000), 16_000);
        // 200k - 140k - 10k - 50k = 0.
        assert_eq!(handoff_history(Some(200_000), 140_000, 10_000), 0);
        // 200k - 120k - 10k - 50k = 20k, capped at 16k; with 125k used it is 15k.
        assert_eq!(handoff_history(Some(200_000), 125_000, 10_000), 15_000);
        // A small window reserves 16k.
        assert_eq!(handoff_history(Some(40_000), 5_000, 1_000), 16_000);
        assert_eq!(handoff_history(Some(40_000), 30_000, 0), 0);
        // Never underflows.
        assert_eq!(handoff_history(Some(10_000), 50_000, 50_000), 0);
    }

    #[test]
    fn attachments_weigh_a_fixed_amount_and_text_is_counted_by_bytes() {
        assert_eq!(attachments(2, 3), 2 * 8_192 + 3 * 4_096);
        assert_eq!(estimate("héllo"), 6);
        assert_eq!(
            handoff_history(Some(200_000), 135_000, attachments(1, 0) + 100),
            6_708
        );
    }

    #[test]
    fn capped_results_say_so() {
        assert_eq!(cap_chars("abc", 3), ("abc".to_string(), false));
        assert_eq!(cap_chars("abcd", 3), ("abc".to_string(), true));
        assert_eq!(cap_chars("ééé", 2), ("éé".to_string(), true));
    }
}
