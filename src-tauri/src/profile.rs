//! Local display preferences, separate from vendor accounts and credentials.
use crate::error::{Error, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LocalProfile {
    pub name: String,
    pub handle: String,
    pub avatar_color: String,
    pub avatar_image: Option<String>,
}
impl Default for LocalProfile {
    fn default() -> Self {
        Self {
            name: String::new(),
            handle: String::new(),
            avatar_color: "silver".into(),
            avatar_image: None,
        }
    }
}
pub fn normalize(profile: &mut LocalProfile) {
    profile.name = profile
        .name
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(80)
        .collect::<String>()
        .trim()
        .to_owned();
    profile.handle = profile
        .handle
        .trim()
        .trim_start_matches('@')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .take(32)
        .collect();
    if !["silver", "blue", "green", "rose", "amber"].contains(&profile.avatar_color.as_str()) {
        profile.avatar_color = "silver".into();
    }
    if profile
        .avatar_image
        .as_deref()
        .is_some_and(|image| !valid_avatar(image))
    {
        profile.avatar_image = None;
    }
}
pub fn validate(profile: &LocalProfile) -> Result<()> {
    let mut normalized = profile.clone();
    normalize(&mut normalized);
    if normalized != *profile {
        return Err(Error::new("invalid_settings", "Invalid local profile."));
    }
    Ok(())
}
// Only locally re-encoded square JPEG photos; SVGs, paths and external URLs are not accepted.
fn valid_avatar(image: &str) -> bool {
    if image.len() > 200_000 {
        return false;
    }
    let Some(encoded) = image.strip_prefix("data:image/jpeg;base64,") else {
        return false;
    };
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
        return false;
    };
    if !bytes.starts_with(&[0xff, 0xd8]) || !bytes.ends_with(&[0xff, 0xd9]) {
        return false;
    }
    let mut reader =
        image::ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Jpeg);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(160);
    limits.max_image_height = Some(160);
    limits.max_alloc = Some(1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .is_ok_and(|image| image.width() > 0 && image.width() == image.height())
}

pub fn default_name() -> String {
    let name = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .and_then(|path| {
            std::path::PathBuf::from(path)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "Switchyard".into());
    name.chars().filter(|c| !c.is_control()).take(80).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_profile_is_bounded_and_does_not_admit_remote_or_svg_images() {
        let mut profile = LocalProfile {
            name: "  Gabriel\nVianna  ".into(),
            handle: "@@ga!briel".into(),
            avatar_color: "invalid".into(),
            avatar_image: Some("https://example.com/avatar.svg".into()),
        };
        assert!(validate(&profile).is_err());
        normalize(&mut profile);
        assert_eq!(profile.name, "GabrielVianna");
        assert_eq!(profile.handle, "gabriel");
        assert_eq!(profile.avatar_color, "silver");
        assert!(profile.avatar_image.is_none());
        assert!(validate(&profile).is_ok());
        profile.name = "🌙".repeat(81);
        assert!(validate(&profile).is_err());
        assert!(!valid_avatar("data:image/svg+xml;base64,PHN2Zz4="));
        assert!(!valid_avatar("data:image/jpeg;base64,broken"));
    }
    #[test]
    fn avatar_requires_decodable_square_bounded_jpeg() {
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut bytes)
            .encode(&[128, 128, 128], 1, 1, image::ExtendedColorType::Rgb8)
            .unwrap();
        let avatar = |data: &[u8]| {
            format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(data)
            )
        };
        assert!(valid_avatar(&avatar(&bytes)));
        let mut broken = bytes.clone();
        let scan = broken
            .windows(2)
            .position(|window| window == [0xff, 0xda])
            .unwrap();
        broken.truncate(scan);
        broken.extend_from_slice(&[0xff, 0xd9]);
        assert!(!valid_avatar(&avatar(&broken))); // valid SOF header, no pixel scan
        let mut oversized = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut oversized)
            .encode(
                &vec![128; 161 * 161 * 3],
                161,
                161,
                image::ExtendedColorType::Rgb8,
            )
            .unwrap();
        assert!(!valid_avatar(&avatar(&oversized)));
        let mut rectangular = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut rectangular)
            .encode(&[128; 6], 2, 1, image::ExtendedColorType::Rgb8)
            .unwrap();
        assert!(!valid_avatar(&avatar(&rectangular)));
    }
    #[test]
    fn local_profile_roundtrips_and_legacy_defaults_are_safe() {
        let settings: crate::models::AppSettings =
            serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(settings.profile, LocalProfile::default());
        let profile = LocalProfile {
            name: "Gabriel Vianna".into(),
            handle: "gabrielvianna".into(),
            ..Default::default()
        };
        let encoded = serde_json::to_string(&profile).unwrap();
        assert_eq!(
            serde_json::from_str::<LocalProfile>(&encoded).unwrap(),
            profile
        );
    }
}
