use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{message}")]
    App { code: &'static str, message: String },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl Error {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self::App {
            code,
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }

    pub fn invalid_path(message: impl Into<String>) -> Self {
        Self::new("invalid_path", message)
    }

    pub fn confirmation_required(message: impl Into<String>) -> Self {
        Self::new("confirmation_required", message)
    }

    pub fn git(message: impl Into<String>) -> Self {
        Self::new("git", message)
    }

    pub fn agent(message: impl Into<String>) -> Self {
        Self::new("agent", message)
    }
}

#[derive(Serialize)]
struct ErrorPayload {
    code: String,
    message: String,
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        let payload = match self {
            Error::App { code, message } => ErrorPayload {
                code: code.to_string(),
                message: message.clone(),
            },
            other => ErrorPayload {
                code: "internal".into(),
                message: other.to_string(),
            },
        };
        payload.serialize(serializer)
    }
}

pub type Result<T> = std::result::Result<T, Error>;
