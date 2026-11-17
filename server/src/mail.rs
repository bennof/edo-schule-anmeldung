//! Booking confirmation mail (backlog H1), sent via Microsoft Graph as the
//! configured sender mailbox (Exchange RBAC for Applications). Plain text
//! only, so user input cannot inject markup.

use chrono::{Datelike, NaiveDate, Weekday};
use serde_json::{Value, json};

pub struct Confirmation<'a> {
    pub name: &'a str,
    pub procedure: &'a str,
    /// YYYY-MM-DDTHH:mm
    pub datetime: &'a str,
    /// resume link; empty when no public URL is configured
    pub link: &'a str,
}

/// Fills `{name}`, `{verfahren}`, `{datum}`, `{uhrzeit}`, `{link}`.
/// A line consisting only of an empty `{link}` is dropped.
pub fn render(template: &str, c: &Confirmation) -> String {
    let date = c.datetime.get(..10).map(german_date).unwrap_or_default();
    let time = c.datetime.get(11..16).unwrap_or_default();
    template
        .lines()
        .filter(|line| !(c.link.is_empty() && line.trim() == "{link}"))
        .collect::<Vec<_>>()
        .join("\n")
        .replace("{name}", c.name)
        .replace("{verfahren}", c.procedure)
        .replace("{datum}", &date)
        .replace("{uhrzeit}", time)
        .replace("{link}", c.link)
}

/// "Mittwoch, 7. Oktober 2026"
pub fn german_date(iso: &str) -> String {
    let Ok(d) = NaiveDate::parse_from_str(iso, "%Y-%m-%d") else {
        return iso.to_string();
    };
    let weekday = match d.weekday() {
        Weekday::Mon => "Montag",
        Weekday::Tue => "Dienstag",
        Weekday::Wed => "Mittwoch",
        Weekday::Thu => "Donnerstag",
        Weekday::Fri => "Freitag",
        Weekday::Sat => "Samstag",
        Weekday::Sun => "Sonntag",
    };
    const MONTHS: [&str; 12] = [
        "Januar",
        "Februar",
        "März",
        "April",
        "Mai",
        "Juni",
        "Juli",
        "August",
        "September",
        "Oktober",
        "November",
        "Dezember",
    ];
    format!("{weekday}, {}. {} {}", d.day(), MONTHS[d.month0() as usize], d.year())
}

/// Graph sendMail request body.
pub fn message(to: &str, subject: &str, text: &str) -> Value {
    json!({
        "message": {
            "subject": subject,
            "body": { "contentType": "Text", "content": text },
            "toRecipients": [{ "emailAddress": { "address": to } }],
        },
        "saveToSentItems": true,
    })
}

/// Largest PDF the server accepts for mailing. Graph's sendMail takes about
/// 4 MB of JSON; base64 makes the attachment a third larger.
pub const MAX_PDF: usize = 2_500_000;

/// Fills `{name}` and `{verfahren}` of the mail with the filled-in form.
pub fn render_pdf_text(template: &str, name: &str, procedure: &str) -> String {
    template.replace("{name}", name).replace("{verfahren}", procedure)
}

pub const DEFAULT_PDF_SUBJECT: &str = "Ihre Anmeldung: das ausgefüllte Formular";
pub const DEFAULT_PDF_TEXT: &str = "Guten Tag {name},\n\nvielen Dank für Ihre Anmeldung ({verfahren}). Im Anhang finden Sie das ausgefüllte Formular als PDF.\n\nBitte bewahren Sie es für Ihre Unterlagen auf.\n\nMit freundlichen Grüßen\nIhr Sekretariat";

/// Graph sendMail request body with the PDF as attachment.
pub fn message_with_pdf(to: &str, subject: &str, text: &str, file_name: &str, pdf: &[u8]) -> Value {
    let mut m = message(to, subject, text);
    m["message"]["attachments"] = json!([{
        "@odata.type": "#microsoft.graph.fileAttachment",
        "name": file_name,
        "contentType": "application/pdf",
        "contentBytes": base64(pdf),
    }]);
    m
}

/// "Anmeldung_Sahin_Lukasz.pdf": ASCII only, from the child's name.
pub fn pdf_file_name(child_name: &str) -> String {
    let mut ascii = String::new();
    for c in child_name.chars() {
        match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' => ascii.push(c),
            'ä' => ascii.push_str("ae"),
            'ö' => ascii.push_str("oe"),
            'ü' => ascii.push_str("ue"),
            'Ä' => ascii.push_str("Ae"),
            'Ö' => ascii.push_str("Oe"),
            'Ü' => ascii.push_str("Ue"),
            'ß' => ascii.push_str("ss"),
            _ if !ascii.ends_with('_') && !ascii.is_empty() => ascii.push('_'),
            _ => {}
        }
    }
    let ascii = ascii.trim_end_matches('_');
    if ascii.is_empty() {
        "Anmeldung.pdf".to_string()
    } else {
        format!("Anmeldung_{ascii}.pdf")
    }
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n =
            (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn confirmation(link: &str) -> Confirmation<'_> {
        Confirmation {
            name: "Eva Muster",
            procedure: "Anmeldung Klasse 5",
            datetime: "2026-10-07T09:20",
            link,
        }
    }

    #[test]
    fn formats_german_dates() {
        assert_eq!(german_date("2026-10-07"), "Mittwoch, 7. Oktober 2026");
        assert_eq!(german_date("2027-03-01"), "Montag, 1. März 2027");
        assert_eq!(german_date("kaputt"), "kaputt");
    }

    #[test]
    fn renders_template() {
        let text = render(
            "Hallo {name}\n{verfahren}: {datum}, {uhrzeit} Uhr\n{link}\nEnde",
            &confirmation("https://x/#f"),
        );
        assert_eq!(
            text,
            "Hallo Eva Muster\nAnmeldung Klasse 5: Mittwoch, 7. Oktober 2026, 09:20 Uhr\nhttps://x/#f\nEnde"
        );
    }

    #[test]
    fn drops_empty_link_line() {
        assert_eq!(render("A\n{link}\nB", &confirmation("")), "A\nB");
    }

    #[test]
    fn encodes_base64() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn names_the_pdf_after_the_child() {
        assert_eq!(pdf_file_name("Şahin Łukasz"), "Anmeldung_ahin_ukasz.pdf");
        assert_eq!(pdf_file_name("Müller, Jörg"), "Anmeldung_Mueller_Joerg.pdf");
        assert_eq!(pdf_file_name("../x\\"), "Anmeldung_x.pdf");
        assert_eq!(pdf_file_name(""), "Anmeldung.pdf");
    }

    #[test]
    fn attaches_the_pdf() {
        let m = message_with_pdf("a@b.de", "S", "T", "Anmeldung.pdf", b"%PDF-1.7");
        let a = &m["message"]["attachments"][0];
        assert_eq!(a["name"], "Anmeldung.pdf");
        assert_eq!(a["contentType"], "application/pdf");
        assert_eq!(a["contentBytes"], "JVBERi0xLjc=");
        assert_eq!(render_pdf_text("{name}/{verfahren}", "Eva", "Klasse 5"), "Eva/Klasse 5");
    }

    #[test]
    fn builds_plain_text_message() {
        let m = message("a@b.de", "Betreff", "<b>kein html</b>");
        assert_eq!(m["message"]["body"]["contentType"], "Text");
        assert_eq!(m["message"]["toRecipients"][0]["emailAddress"]["address"], "a@b.de");
    }
}
