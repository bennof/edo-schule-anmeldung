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
    fn builds_plain_text_message() {
        let m = message("a@b.de", "Betreff", "<b>kein html</b>");
        assert_eq!(m["message"]["body"]["contentType"], "Text");
        assert_eq!(m["message"]["toRecipients"][0]["emailAddress"]["address"], "a@b.de");
    }
}
