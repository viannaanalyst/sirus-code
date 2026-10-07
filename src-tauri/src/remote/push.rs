//! Web push for paired devices (ADR-082). The Mac signs each alert with its own
//! VAPID key and posts it, encrypted for the device (RFC 8291), straight to the
//! browser vendor's push service. Only those services are contacted.

use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};
use web_push_native::jwt_simple::algorithms::{ECDSAP256PublicKeyLike, ES256KeyPair};
use web_push_native::WebPushBuilder;

use super::{save, Remote};
use crate::error::{Error, Result};

const CONTACT: &str = "mailto:sirus-code@users.noreply.github.com";
const PUSH_HOSTS: &[&str] = &[
    "web.push.apple.com",
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
];
const SEND_TIMEOUT: Duration = Duration::from_secs(15);
const SUBSCRIPTION_LIMIT: usize = 4096;

/// A browser `PushSubscription` this Mac may post to.
pub fn valid_subscription(value: &Value) -> bool {
    if value.to_string().len() > SUBSCRIPTION_LIMIT {
        return false;
    }
    let Some(endpoint) = value["endpoint"].as_str() else {
        return false;
    };
    let Ok(uri) = endpoint.parse::<axum::http::Uri>() else {
        return false;
    };
    let host = uri.host().unwrap_or_default().to_ascii_lowercase();
    uri.scheme_str() == Some("https")
        && uri.port().is_none()
        && (PUSH_HOSTS.contains(&host.as_str())
            || host.ends_with(".notify.windows.com")
            || host.ends_with(".push.apple.com"))
        && serde_json::from_value::<WebPushBuilder>(value.clone()).is_ok()
}

/// The Mac's VAPID key pair, made once and kept with the remote settings.
pub fn key_pair(remote: &Remote) -> Result<ES256KeyPair> {
    let stored = remote.config.lock().vapid_private.clone();
    if let Some(key) = stored.and_then(|key| {
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(key)
            .ok()
    }) {
        if let Ok(pair) = ES256KeyPair::from_bytes(&key) {
            return Ok(pair);
        }
    }
    let pair = ES256KeyPair::generate();
    remote.config.lock().vapid_private =
        Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(pair.to_bytes()));
    save(remote)?;
    Ok(pair)
}

/// The public key a browser needs to subscribe (`applicationServerKey`).
pub fn public_key(remote: &Remote) -> Result<String> {
    let pair = key_pair(remote)?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(pair.public_key().public_key().to_bytes_uncompressed()))
}

pub fn payload(title: &str, body: &str, session_id: &str) -> String {
    let bounded = |value: &str, limit: usize| {
        value
            .chars()
            .filter(|character| !character.is_control())
            .take(limit)
            .collect::<String>()
    };
    json!({
        "title": bounded(title, 80),
        "body": bounded(body, 200),
        "sessionId": bounded(session_id, 64),
    })
    .to_string()
}

/// Posts one alert to every device that turned alerts on; gone subscriptions are dropped.
pub async fn send_all(remote: &Remote, payload: String) {
    deliver(remote, None, payload).await;
}

/// One device only, for the Mac's "Send a test alert".
pub async fn send_to(remote: &Remote, device_id: &str, payload: String) {
    deliver(remote, Some(device_id), payload).await;
}

async fn deliver(remote: &Remote, only: Option<&str>, payload: String) {
    let targets: Vec<(String, Value)> = remote
        .config
        .lock()
        .devices
        .iter()
        .filter(|device| only.is_none_or(|id| device.id == id))
        .filter_map(|device| device.push.clone().map(|push| (device.id.clone(), push)))
        .collect();
    if targets.is_empty() {
        return;
    }
    let Ok(pair) = key_pair(remote) else {
        return;
    };
    let Ok(client) = reqwest::Client::builder()
        .timeout(SEND_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return;
    };
    for (device_id, subscription) in targets {
        match send(&client, &pair, &subscription, &payload).await {
            Ok(Delivery::Sent) => {}
            Ok(Delivery::Gone) => {
                if let Some(device) = remote
                    .config
                    .lock()
                    .devices
                    .iter_mut()
                    .find(|device| device.id == device_id)
                {
                    device.push = None;
                }
                let _ = save(remote);
            }
            Err(error) => tracing::debug!(%error, "web push not delivered"),
        }
    }
}

enum Delivery {
    Sent,
    Gone,
}

async fn send(
    client: &reqwest::Client,
    pair: &ES256KeyPair,
    subscription: &Value,
    payload: &str,
) -> Result<Delivery> {
    if !valid_subscription(subscription) {
        return Ok(Delivery::Gone);
    }
    let builder: WebPushBuilder = serde_json::from_value(subscription.clone())?;
    let request = builder
        .with_valid_duration(Duration::from_secs(60 * 60))
        .with_vapid(pair, CONTACT)
        .build(payload.as_bytes().to_vec())
        .map_err(|error| Error::new("remote", error.to_string()))?;
    let (parts, body) = request.into_parts();
    let mut outgoing = client.post(parts.uri.to_string()).body(body);
    for (name, value) in &parts.headers {
        outgoing = outgoing.header(name.as_str(), value.as_bytes());
    }
    let response = outgoing
        .send()
        .await
        .map_err(|error| Error::new("remote", error.to_string()))?;
    match response.status().as_u16() {
        200..=299 => Ok(Delivery::Sent),
        404 | 410 => Ok(Delivery::Gone),
        status => Err(Error::new(
            "remote",
            format!("push service answered {status}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn subscription(endpoint: &str) -> Value {
        // A real P-256 point and 16-byte secret, as browsers send them.
        json!({
            "endpoint": endpoint,
            "expirationTime": null,
            "keys": {
                "p256dh": "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
                "auth": "BTBZMqHH6r4Tts7J_aSIgg"
            }
        })
    }

    #[test]
    fn only_vendor_push_services_are_accepted() {
        assert!(valid_subscription(&subscription(
            "https://web.push.apple.com/QAbc123"
        )));
        assert!(valid_subscription(&subscription(
            "https://fcm.googleapis.com/fcm/send/abc"
        )));
        assert!(!valid_subscription(&subscription(
            "http://web.push.apple.com/QAbc123"
        )));
        assert!(!valid_subscription(&subscription("https://127.0.0.1/push")));
        assert!(!valid_subscription(&subscription(
            "https://web.push.apple.com.evil.example/x"
        )));
        assert!(!valid_subscription(&subscription(
            "https://web.push.apple.com:8443/x"
        )));
        assert!(!valid_subscription(
            &json!({ "endpoint": "https://web.push.apple.com/x" })
        ));
    }

    #[test]
    fn payloads_are_bounded_text() {
        let value: Value =
            serde_json::from_str(&payload("Permissão necessária", &"x\n".repeat(300), "s1"))
                .unwrap();
        assert_eq!(value["title"], "Permissão necessária");
        assert_eq!(value["body"].as_str().unwrap().len(), 200);
        assert_eq!(value["sessionId"], "s1");
    }

    #[test]
    fn a_subscription_encrypts_for_the_device() {
        let pair = ES256KeyPair::generate();
        let builder: WebPushBuilder =
            serde_json::from_value(subscription("https://web.push.apple.com/QAbc123")).unwrap();
        let request = builder
            .with_vapid(&pair, CONTACT)
            .build(b"hello".to_vec())
            .unwrap();
        assert_eq!(request.headers()["content-encoding"], "aes128gcm");
        assert!(request.headers()["authorization"]
            .to_str()
            .unwrap()
            .starts_with("vapid t="));
    }
}
