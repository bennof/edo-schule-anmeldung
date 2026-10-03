//! Server settings from environment variables, falling back to the
//! repository `.env` during development. Secrets are never logged.

use std::collections::HashMap;
use std::{env, fs};

pub struct Settings {
    pub bind_addr: String,
    pub workers: usize,
    pub tenant_id: String,
    pub client_id: String,
    pub client_secret: String,
    pub site_id: String,
    /// take the client IP from X-Forwarded-For (only behind a trusted reverse proxy)
    pub trust_proxy: bool,
}

impl Settings {
    pub fn load() -> Result<Settings, String> {
        let file = read_env_file();
        let get = |key: &str| -> Option<String> {
            env::var(key)
                .ok()
                .or_else(|| file.get(key).cloned())
                .filter(|v| !v.is_empty())
        };
        let require = |key: &str| get(key).ok_or_else(|| format!("missing setting {key}"));
        Ok(Settings {
            bind_addr: get("BIND_ADDR").unwrap_or_else(|| "127.0.0.1:8080".to_string()),
            workers: get("WORKERS").and_then(|w| w.parse().ok()).unwrap_or(8),
            tenant_id: require("TENANT_ID")?,
            client_id: require("DAEMON_CLIENT_ID")?,
            client_secret: require("DAEMON_CLIENT_SECRET")?,
            site_id: require("SHAREPOINT_ID")?,
            trust_proxy: get("TRUST_PROXY").is_some_and(|v| v == "1" || v == "true"),
        })
    }
}

/// Reads `ENV_FILE`, `.env` or `../.env` (first that exists).
fn read_env_file() -> HashMap<String, String> {
    let candidates = env::var("ENV_FILE")
        .map(|f| vec![f])
        .unwrap_or_else(|_| vec![".env".into(), "../.env".into()]);
    for path in candidates {
        if let Ok(content) = fs::read_to_string(&path) {
            return parse_env(&content);
        }
    }
    HashMap::new()
}

fn parse_env(content: &str) -> HashMap<String, String> {
    content
        .lines()
        .filter(|l| !l.trim_start().starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_env_lines() {
        let env = parse_env("# comment\nA=1\n B = x=y \n\nNOVALUE\n");
        assert_eq!(env.get("A").map(String::as_str), Some("1"));
        assert_eq!(env.get("B").map(String::as_str), Some("x=y"));
        assert_eq!(env.len(), 2);
    }
}
