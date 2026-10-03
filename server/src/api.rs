//! Public API (backlog F2-F4). Only public data leaves this module: public
//! config entries, active procedures, their forms, free slots (time only).
//! Personal data is written to SharePoint and never stored or logged here.

use crate::sharepoint::{APPOINTMENTS, CONFIG, FORMS, Item, PROCEDURES, Site, Update};
use chrono::{Local, SecondsFormat, Utc};
use serde_json::{Map, Value, json};

pub struct Reply {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}

impl Reply {
    fn json(status: u16, value: Value) -> Reply {
        Reply {
            status,
            content_type: "application/json; charset=utf-8".into(),
            body: value.to_string().into_bytes(),
        }
    }

    fn error(status: u16, code: &str, message: &str) -> Reply {
        Reply::json(status, json!({ "error": code, "message": message }))
    }

    fn not_found() -> Reply {
        Reply::error(404, "not_found", "Nicht gefunden")
    }
}

/// Logo key in the Assets library; further public assets come from optionsSource.
const LOGO_KEY: &str = "logo";

pub struct Api {
    site: Site,
}

struct Procedure {
    id: String,
    form_id: String,
    info: Value,
    start_date: String,
    end_date: String,
}

impl Api {
    pub fn new(site: Site) -> Api {
        Api { site }
    }

    pub fn handle(&self, method: &str, path: &str, body: &[u8]) -> Reply {
        let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
        let result = match (method, parts.as_slice()) {
            ("GET", ["api", "health"]) => Ok(Reply::json(200, json!({ "status": "ok" }))),
            ("GET", ["api", "config"]) => self.config(),
            ("GET", ["api", "procedures", id, "form"]) if is_item_id(id) => self.form(id),
            ("GET", ["api", "procedures", id, "appointments"]) if is_item_id(id) => {
                self.appointments(id)
            }
            ("POST", ["api", "appointments", id, "booking"]) if is_item_id(id) => {
                self.book(id, body)
            }
            ("GET", ["api", "assets", key]) if is_asset_key(key) => self.asset(key),
            _ => Ok(Reply::not_found()),
        };
        result.unwrap_or_else(|e| {
            eprintln!("upstream error on {method} {path}: {e}");
            Reply::error(
                502,
                "upstream",
                "Der Dienst ist vorübergehend nicht erreichbar",
            )
        })
    }

    /// F2: public config entries and the currently active procedures.
    fn config(&self) -> Result<Reply, String> {
        let config: Map<String, Value> = self
            .site
            .list_items(CONFIG, None)?
            .iter()
            .filter(|i| i.bool("IsPublic"))
            .filter_map(|i| {
                Some((
                    i.text("Title")?.to_string(),
                    json!(i.text("Value").unwrap_or("")),
                ))
            })
            .collect();
        let procedures: Vec<Value> = self
            .active_procedures()?
            .into_iter()
            .map(|p| {
                json!({
                    "id": p.id,
                    "title": p.info["title"],
                    "description": p.info["description"],
                    "startDate": p.start_date,
                    "endDate": p.end_date,
                })
            })
            .collect();
        Ok(Reply::json(
            200,
            json!({ "config": config, "procedures": procedures }),
        ))
    }

    fn form(&self, procedure_id: &str) -> Result<Reply, String> {
        let Some(p) = self.active_procedure(procedure_id)? else {
            return Ok(Reply::not_found());
        };
        let Some(form) = self.form_json(&p.form_id)? else {
            return Ok(Reply::not_found());
        };
        Ok(Reply::json(200, json!({ "id": p.form_id, "form": form })))
    }

    /// F3: free slots of an active procedure; only id and time.
    fn appointments(&self, procedure_id: &str) -> Result<Reply, String> {
        if self.active_procedure(procedure_id)?.is_none() {
            return Ok(Reply::not_found());
        }
        let filter =
            format!("fields/ProcedureId eq '{procedure_id}' and fields/State eq 'available'");
        let items = self.site.list_items(APPOINTMENTS, Some(&filter))?;
        Ok(Reply::json(
            200,
            Value::Array(public_slots(&items, &now_local())),
        ))
    }

    /// F4: books a slot. The eTag check makes concurrent bookings of the
    /// same slot fail for all but one request.
    fn book(&self, appointment_id: &str, body: &[u8]) -> Result<Reply, String> {
        let input: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
        let (name, email) = match validate_booking(input["name"].as_str(), input["email"].as_str())
        {
            Ok(v) => v,
            Err(message) => return Ok(Reply::error(400, "invalid_input", &message)),
        };
        let Some(item) = self.site.get_item(APPOINTMENTS, appointment_id)? else {
            return Ok(Reply::not_found());
        };
        let procedure_id = item.text("ProcedureId").unwrap_or_default().to_string();
        let datetime = item.text("SlotDatetime").unwrap_or_default().to_string();
        if self.active_procedure(&procedure_id)?.is_none() {
            return Ok(Reply::not_found());
        }
        if item.text("State") != Some("available") || datetime.as_str() <= now_local().as_str() {
            return Ok(taken());
        }
        let fields = json!({
            "State": "booked",
            "NameCustomer": name,
            "EmailCustomer": email,
            "RequestTime": Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        });
        match self
            .site
            .update_fields(APPOINTMENTS, appointment_id, &fields, &item.etag)?
        {
            Update::Done => Ok(Reply::json(
                200,
                json!({ "id": appointment_id, "procedureId": procedure_id, "datetime": datetime }),
            )),
            Update::Conflict => Ok(taken()),
            Update::NotFound => Ok(Reply::not_found()),
        }
    }

    /// Public assets: the logo and option lists referenced by active forms.
    fn asset(&self, key: &str) -> Result<Reply, String> {
        if key != LOGO_KEY {
            let mut sources = Vec::new();
            for p in self.active_procedures()? {
                if let Some(form) = self.form_json(&p.form_id)? {
                    collect_option_sources(&form, &mut sources);
                }
            }
            if !sources.iter().any(|s| s == key) {
                return Ok(Reply::not_found());
            }
        }
        Ok(match self.site.get_asset(key)? {
            Some((content_type, body)) => {
                let content_type = sniff_image(&body)
                    .map(str::to_string)
                    .unwrap_or(content_type);
                Reply {
                    status: 200,
                    content_type,
                    body,
                }
            }
            None => Reply::not_found(),
        })
    }

    fn active_procedures(&self) -> Result<Vec<Procedure>, String> {
        let today = Local::now().format("%Y-%m-%d").to_string();
        let mut list: Vec<Procedure> = self
            .site
            .list_items(PROCEDURES, None)?
            .iter()
            .filter_map(to_procedure)
            .filter(|p| is_active(&p.start_date, &p.end_date, &today))
            .collect();
        list.sort_by(|a, b| a.start_date.cmp(&b.start_date));
        Ok(list)
    }

    fn active_procedure(&self, id: &str) -> Result<Option<Procedure>, String> {
        Ok(self.active_procedures()?.into_iter().find(|p| p.id == id))
    }

    fn form_json(&self, form_id: &str) -> Result<Option<Value>, String> {
        Ok(self.site.get_item(FORMS, form_id)?.and_then(|f| {
            f.text("FormJson")
                .and_then(|j| serde_json::from_str(j).ok())
        }))
    }
}

fn taken() -> Reply {
    Reply::error(409, "taken", "Der Termin ist nicht mehr verfügbar")
}

fn to_procedure(item: &Item) -> Option<Procedure> {
    Some(Procedure {
        id: item.id.clone(),
        form_id: item.text("FormId")?.to_string(),
        info: item
            .text("Info")
            .and_then(|i| serde_json::from_str(i).ok())
            .unwrap_or(Value::Null),
        start_date: item.text("StartDate")?.to_string(),
        end_date: item.text("EndDate")?.to_string(),
    })
}

fn now_local() -> String {
    Local::now().format("%Y-%m-%dT%H:%M").to_string()
}

pub fn is_active(start: &str, end: &str, today: &str) -> bool {
    start <= today && today <= end
}

pub fn is_item_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 12 && s.bytes().all(|b| b.is_ascii_digit())
}

pub fn is_asset_key(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('.')
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

/// Future available slots, sorted by time; only id and time are exposed.
pub fn public_slots(items: &[Item], now: &str) -> Vec<Value> {
    let mut slots: Vec<(&str, &str)> = items
        .iter()
        .filter(|i| i.text("State") == Some("available"))
        .filter_map(|i| Some((i.text("SlotDatetime")?, i.id.as_str())))
        .filter(|(dt, _)| *dt > now)
        .collect();
    slots.sort();
    slots
        .into_iter()
        .map(|(dt, id)| json!({ "id": id, "datetime": dt }))
        .collect()
}

pub fn validate_booking(
    name: Option<&str>,
    email: Option<&str>,
) -> Result<(String, String), String> {
    let name = name.unwrap_or("").trim();
    let email = email.unwrap_or("").trim();
    if name.chars().count() < 2 || name.chars().count() > 100 || name.chars().any(char::is_control)
    {
        return Err("Bitte einen Namen mit 2 bis 100 Zeichen angeben".into());
    }
    let valid_email = email.len() <= 254
        && !email.chars().any(|c| c.is_whitespace() || c.is_control())
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
        });
    if !valid_email {
        return Err("Bitte eine gültige E-Mail-Adresse angeben".into());
    }
    Ok((name.to_string(), email.to_string()))
}

/// Image type by content; SharePoint stores extension-less keys (e.g. "logo")
/// as application/octet-stream.
pub fn sniff_image(body: &[u8]) -> Option<&'static str> {
    let text = String::from_utf8_lossy(&body[..body.len().min(200)]);
    match body {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xff, 0xd8, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => Some("image/webp"),
        _ if text.trim_start().starts_with("<svg")
            || text.trim_start().starts_with("<?xml") && text.contains("<svg") =>
        {
            Some("image/svg+xml")
        }
        _ => None,
    }
}

/// Collects all `optionsSource` values of a form definition.
pub fn collect_option_sources(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(map) => {
            if let Some(Value::String(s)) = map.get("optionsSource") {
                out.push(s.clone());
            }
            map.values().for_each(|c| collect_option_sources(c, out));
        }
        Value::Array(list) => list.iter().for_each(|c| collect_option_sources(c, out)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, state: &str, dt: &str) -> Item {
        let fields = json!({ "State": state, "SlotDatetime": dt, "NameCustomer": "secret" });
        Item {
            id: id.into(),
            etag: String::new(),
            fields: fields.as_object().unwrap().clone(),
        }
    }

    #[test]
    fn active_window_is_inclusive() {
        assert!(is_active("2030-03-01", "2030-03-20", "2030-03-01"));
        assert!(is_active("2030-03-01", "2030-03-20", "2030-03-20"));
        assert!(!is_active("2030-03-01", "2030-03-20", "2030-03-21"));
    }

    #[test]
    fn public_slots_hide_booked_past_and_personal_data() {
        let items = vec![
            item("3", "available", "2030-03-04T08:20"),
            item("1", "available", "2030-03-04T08:00"),
            item("2", "booked", "2030-03-04T08:10"),
            item("4", "available", "2020-01-01T08:00"),
        ];
        let slots = public_slots(&items, "2026-10-03T12:00");
        assert_eq!(
            Value::Array(slots.clone()),
            json!([{ "id": "1", "datetime": "2030-03-04T08:00" }, { "id": "3", "datetime": "2030-03-04T08:20" }])
        );
        assert!(!Value::Array(slots).to_string().contains("secret"));
    }

    #[test]
    fn validates_booking_input() {
        assert_eq!(
            validate_booking(Some("  Eva Muster "), Some("eva@example.org")),
            Ok(("Eva Muster".into(), "eva@example.org".into()))
        );
        assert!(validate_booking(Some("E"), Some("eva@example.org")).is_err());
        assert!(validate_booking(None, Some("eva@example.org")).is_err());
        assert!(validate_booking(Some("Eva"), Some("eva@example")).is_err());
        assert!(validate_booking(Some("Eva"), Some("eva @example.org")).is_err());
        assert!(validate_booking(Some("Eva\u{0}"), Some("eva@example.org")).is_err());
    }

    #[test]
    fn ids_and_keys_are_strict() {
        assert!(is_item_id("42"));
        assert!(!is_item_id("1 or 1"));
        assert!(!is_item_id("1'"));
        assert!(is_asset_key("logo"));
        assert!(!is_asset_key("../x"));
        assert!(!is_asset_key(".env"));
    }

    #[test]
    fn sniffs_images() {
        assert_eq!(
            sniff_image(&[0x89, b'P', b'N', b'G', 13, 10]),
            Some("image/png")
        );
        assert_eq!(sniff_image(&[0xff, 0xd8, 0xff]), Some("image/jpeg"));
        assert_eq!(
            sniff_image(b"  <svg xmlns='http://www.w3.org/2000/svg'/>"),
            Some("image/svg+xml")
        );
        assert_eq!(sniff_image(b"[1,2,3]"), None);
    }

    #[test]
    fn finds_option_sources() {
        let form = json!({ "sections": [{ "items": [{ "optionsSource": "schulen.json" }, { "kind": "group" }] }],
                           "groups": { "g": { "items": [{ "optionsSource": "laender.json" }] } } });
        let mut out = Vec::new();
        collect_option_sources(&form, &mut out);
        out.sort();
        assert_eq!(out, vec!["laender.json", "schulen.json"]);
    }
}
