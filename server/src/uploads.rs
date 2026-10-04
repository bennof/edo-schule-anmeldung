//! Uploads of the public form (photo, documents): allowed types, content
//! check, file names. Files go to the Uploads library, one folder per
//! application; the form data only hold references.

/// Graph simple upload limit; the browser scales photos well below this.
pub const MAX_SIZE: usize = 4 * 1024 * 1024;
/// Files per application folder (abuse protection).
pub const MAX_FILES: usize = 25;
pub const ALLOWED: [&str; 3] = ["application/pdf", "image/jpeg", "image/png"];

/// The declared content type must match the file signature.
pub fn content_matches(content_type: &str, bytes: &[u8]) -> bool {
    match content_type {
        "application/pdf" => bytes.starts_with(b"%PDF-"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        _ => false,
    }
}

pub fn extension(content_type: &str) -> &'static str {
    match content_type {
        "application/pdf" => "pdf",
        "image/png" => "png",
        _ => "jpg",
    }
}

/// Display name: no path, no control characters, at most 100 characters.
pub fn display_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String = base.chars().filter(|c| !c.is_control()).take(100).collect();
    let clean = clean.trim();
    if clean.is_empty() {
        "Datei".to_string()
    } else {
        clean.to_string()
    }
}

/// Valid stored file name (`<hex>.<ext>`) of an upload id's last segment.
pub fn is_file_name(name: &str) -> bool {
    let mut parts = name.splitn(2, '.');
    let (stem, ext) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    stem.len() == 32 && stem.bytes().all(|b| b.is_ascii_hexdigit()) && ["pdf", "jpg", "png"].contains(&ext)
}

/// Decodes `%XX` and `+` of a query value.
pub fn url_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_signatures() {
        assert!(content_matches("application/pdf", b"%PDF-1.7 ..."));
        assert!(content_matches("image/jpeg", &[0xff, 0xd8, 0xff, 0xe0]));
        assert!(!content_matches("image/png", b"%PDF-1.7"));
        assert!(!content_matches("text/html", b"<html>"));
    }

    #[test]
    fn cleans_names() {
        assert_eq!(
            display_name("C:\\Users\\x\\Zeugnis Klasse 4.pdf"),
            "Zeugnis Klasse 4.pdf"
        );
        assert_eq!(display_name("../../etc/passwd"), "passwd");
        assert_eq!(display_name("\u{0}\u{1}"), "Datei");
        assert_eq!(display_name(&"a".repeat(300)).len(), 100);
    }

    #[test]
    fn validates_stored_names() {
        assert!(is_file_name(&format!("{}.jpg", "a".repeat(32))));
        assert!(!is_file_name("abc.jpg"));
        assert!(!is_file_name(&format!("{}.exe", "a".repeat(32))));
    }

    #[test]
    fn decodes_query_values() {
        assert_eq!(url_decode("Zeugnis%20Kl.%204%C3%A4.pdf"), "Zeugnis Kl. 4ä.pdf");
        assert_eq!(url_decode("a+b%2"), "a b%2");
    }
}
