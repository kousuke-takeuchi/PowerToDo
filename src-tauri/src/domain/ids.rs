/// Next task number: max + 1 (saturating at `u32::MAX`), or 1 when there are no tasks.
/// Numbers are never reused because callers pass every No. ever present in the file.
pub fn next_no(existing: impl Iterator<Item = u32>) -> u32 {
    existing.max().map_or(1, |m| m.saturating_add(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_starts_at_one() {
        assert_eq!(next_no([].into_iter()), 1);
    }

    #[test]
    fn max_plus_one() {
        assert_eq!(next_no([3, 1, 7].into_iter()), 8);
    }

    #[test]
    fn saturates_at_max() {
        assert_eq!(next_no([u32::MAX].into_iter()), u32::MAX);
    }
}
