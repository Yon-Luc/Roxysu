//! Match policy for foreign-toplevel windows (C-compatible default).
//!
//! C: case-insensitive substring of `--match-app-id` against `app_id`;
//! `title` is consulted only when `app_id` is empty.

use std::str::FromStr;

use anyhow::bail;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MatchMode {
    /// Case-insensitive substring (C default).
    #[default]
    Contains,
    /// Case-insensitive full-string equality.
    Exact,
}

impl MatchMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Contains => "contains",
            Self::Exact => "exact",
        }
    }
}

impl FromStr for MatchMode {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "contains" => Ok(Self::Contains),
            "exact" => Ok(Self::Exact),
            other => bail!("unknown --match-mode '{other}' (expected contains|exact)"),
        }
    }
}

impl std::fmt::Display for MatchMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchPolicy {
    needle: String,
    mode: MatchMode,
}

impl MatchPolicy {
    pub fn new(needle: impl Into<String>, mode: MatchMode) -> Self {
        Self {
            needle: needle.into(),
            mode,
        }
    }

    pub fn needle(&self) -> &str {
        &self.needle
    }

    pub fn mode(&self) -> MatchMode {
        self.mode
    }

    /// C rule: prefer `app_id`; fall back to `title` only when `app_id` is empty.
    pub fn matches(&self, app_id: &str, title: &str) -> bool {
        if !app_id.is_empty() {
            return self.match_str(app_id);
        }
        if !title.is_empty() {
            return self.match_str(title);
        }
        false
    }

    fn match_str(&self, haystack: &str) -> bool {
        match self.mode {
            MatchMode::Contains => contains_ci(haystack, &self.needle),
            MatchMode::Exact => eq_ci(haystack, &self.needle),
        }
    }
}

fn contains_ci(haystack: &str, needle: &str) -> bool {
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

fn eq_ci(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contains_app_id_preferred_over_title() {
        let p = MatchPolicy::new("osu", MatchMode::Contains);
        assert!(p.matches("osu!", "Firefox"));
        // Non-empty app_id that does not match → false even if title matches.
        assert!(!p.matches("firefox", "osu!lazer"));
    }

    #[test]
    fn title_only_when_app_id_empty() {
        let p = MatchPolicy::new("osu", MatchMode::Contains);
        assert!(p.matches("", "osu!lazer"));
        assert!(!p.matches("", "Firefox"));
    }

    #[test]
    fn empty_fields_never_match() {
        let p = MatchPolicy::new("osu", MatchMode::Contains);
        assert!(!p.matches("", ""));
    }

    #[test]
    fn exact_mode_rejects_substring() {
        let p = MatchPolicy::new("osu", MatchMode::Exact);
        assert!(!p.matches("osu!", ""));
        assert!(p.matches("osu", ""));
        assert!(p.matches("OSU", ""));
    }

    #[test]
    fn short_needle_can_false_positive_under_contains() {
        // Documented risk of default `osu` against unrelated app_ids
        // that merely contain the substring (use `--match-mode exact` to tighten).
        let p = MatchPolicy::new("osu", MatchMode::Contains);
        assert!(p.matches("bosun", ""));
    }
}
