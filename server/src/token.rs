//! Access tokens for the public form: random secret for the family, only
//! its SHA-256 hash is stored in SharePoint.

use sha2::{Digest, Sha256};

pub fn generate() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("random: {e}"))?;
    Ok(hex(&bytes))
}

pub fn hash(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

/// Compares a token with a stored hash in constant time.
pub fn verify(token: &str, stored_hash: &str) -> bool {
    let computed = hash(token);
    computed.len() == stored_hash.len()
        && computed
            .bytes()
            .zip(stored_hash.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_and_verifiable() {
        let a = generate().unwrap();
        let b = generate().unwrap();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert!(verify(&a, &hash(&a)));
        assert!(!verify(&b, &hash(&a)));
        assert!(!verify(&a, ""));
    }
}
