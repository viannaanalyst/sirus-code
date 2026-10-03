//! Provider output normalization. Metadata and tool arguments never become assistant prose.
use serde_json::Value;

#[derive(Default)]
pub struct OutputParser {
    saw_assistant: bool,
    saw_delta: bool,
    failed: bool,
    pi_failed: bool,
    plain_text: bool,
    strict_json: bool,
}

impl OutputParser {
    pub fn failed(&self) -> bool {
        self.failed || self.pi_failed
    }

    pub fn for_provider(provider: &crate::models::AgentProviderId) -> Self {
        Self {
            plain_text: *provider == crate::models::AgentProviderId::Devin,
            strict_json: matches!(
                provider,
                crate::models::AgentProviderId::Antigravity
                    | crate::models::AgentProviderId::Pi
                    | crate::models::AgentProviderId::Droid
            ),
            ..Self::default()
        }
    }

    pub fn parse(&mut self, line: &str) -> String {
        if self.plain_text {
            return format!("{line}\n");
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            if self.strict_json {
                self.failed = true;
                return String::new();
            }
            return format!("{line}\n");
        };
        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if let Some(event) = value.get("event").and_then(Value::as_str) {
            // Antigravity's headless stream uses `event`, not `type`.
            if event == "step_update"
                && value
                    .pointer("/step_update/step_type")
                    .and_then(Value::as_str)
                    == Some("agent_response")
            {
                if let Some(text) = value
                    .pointer("/step_update/text_delta")
                    .and_then(Value::as_str)
                {
                    self.saw_assistant = true;
                    return text.into();
                }
            }
            if event == "result" {
                let result = &value["result"];
                if result["status"].as_str() != Some("SUCCESS") {
                    self.failed = true;
                    return format!(
                        "{}\n",
                        result["error"]
                            .as_str()
                            .unwrap_or("Antigravity did not complete successfully")
                    );
                }
                if !self.saw_assistant {
                    self.saw_assistant = true;
                    return result["response"].as_str().unwrap_or_default().into();
                }
            }
            return String::new();
        }
        if kind == "message_start"
            && value.pointer("/message/role").and_then(Value::as_str) == Some("assistant")
        {
            self.saw_delta = false;
            self.pi_failed = false;
        }
        if kind == "message_update"
            && value
                .pointer("/assistantMessageEvent/type")
                .and_then(Value::as_str)
                == Some("text_delta")
        {
            if let Some(text) = value
                .pointer("/assistantMessageEvent/delta")
                .and_then(Value::as_str)
            {
                self.saw_delta = true;
                self.saw_assistant = true;
                return text.into();
            }
        }
        if kind == "message_end"
            && value.pointer("/message/role").and_then(Value::as_str) == Some("assistant")
        {
            if matches!(
                value.pointer("/message/stopReason").and_then(Value::as_str),
                Some("error" | "aborted")
            ) {
                self.pi_failed = true;
                return format!(
                    "{}\n",
                    value
                        .pointer("/message/errorMessage")
                        .and_then(Value::as_str)
                        .unwrap_or("Pi did not complete successfully")
                );
            }
            if !self.saw_delta {
                self.saw_assistant = true;
                return value
                    .pointer("/message/content")
                    .map(content_text)
                    .unwrap_or_default();
            }
            return String::new();
        }
        if kind == "error"
            || kind == "turn.failed"
            || kind == "max_turns_reached"
            || (kind == "result" && value.get("is_error").and_then(Value::as_bool) == Some(true))
        {
            self.failed = true;
        }
        // Grok 1.0.46's streaming-json reducer uses `text.data`, already a delta.
        // Tool inputs, reasoning and usage envelopes must never become assistant text.
        if kind == "text" {
            if let Some(text) = value.get("data").and_then(Value::as_str) {
                self.saw_delta = true;
                self.saw_assistant = true;
                return text.to_string();
            }
        }
        if kind == "result" && value.get("is_error").and_then(Value::as_bool) == Some(true) {
            let text = value
                .get("errors")
                .and_then(Value::as_array)
                .map(|errors| {
                    errors
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_else(|| {
                    value
                        .get("result")
                        .and_then(Value::as_str)
                        .unwrap_or("Agent reported an error")
                        .to_string()
                });
            return format!("{text}\n");
        }
        if kind == "stream_event" {
            if let Some(text) = value.pointer("/event/delta/text").and_then(Value::as_str) {
                self.saw_delta = true;
                self.saw_assistant = true;
                return text.to_string();
            }
            return String::new();
        }
        if kind == "content_block_delta" {
            if let Some(text) = value.pointer("/delta/text").and_then(Value::as_str) {
                self.saw_delta = true;
                self.saw_assistant = true;
                return text.to_string();
            }
        }
        if kind == "assistant" && value.get("timestamp_ms").is_some() {
            if value.get("model_call_id").is_some() {
                return String::new();
            }
            let text = value
                .pointer("/message/content")
                .map(content_text)
                .unwrap_or_default();
            self.saw_delta = true;
            self.saw_assistant = true;
            return text;
        }
        let text = match kind {
            "item.completed"
                if value.pointer("/item/type").and_then(Value::as_str) == Some("agent_message") =>
            {
                value
                    .pointer("/item/text")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            }
            "assistant" if !self.saw_delta => value.pointer("/message/content").map(content_text),
            "text" => value
                .pointer("/part/text")
                .and_then(Value::as_str)
                .map(str::to_string),
            "result" if !self.saw_assistant => value
                .get("result")
                .and_then(Value::as_str)
                .map(str::to_string),
            "error" | "turn.failed" => value
                .pointer("/error/data/message")
                .or_else(|| value.pointer("/error/message"))
                .or_else(|| value.get("message"))
                .or_else(|| value.pointer("/error/name"))
                .and_then(Value::as_str)
                .map(str::to_string),
            _ => None,
        }
        .unwrap_or_default();
        if text.is_empty() {
            return text;
        }
        self.saw_assistant = true;
        format!("{text}\n")
    }
}

fn content_text(value: &Value) -> String {
    value
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plain_devin_answers_preserve_json_while_structured_streams_fail_closed() {
        let mut text = OutputParser::for_provider(&crate::models::AgentProviderId::Devin);
        assert_eq!(text.parse(r#"{"example":1}"#), "{\"example\":1}\n");
        let mut structured = OutputParser::for_provider(&crate::models::AgentProviderId::Droid);
        assert_eq!(structured.parse("malformed private tool metadata"), "");
        assert!(structured.failed());
    }
    #[test]
    fn antigravity_deltas_hide_tool_payloads_and_skip_terminal_snapshot() {
        let mut parser = OutputParser::default();
        assert_eq!(
            parser.parse(r#"{"event":"init","init":{"cwd":"private"}}"#),
            ""
        );
        assert_eq!(parser.parse(r#"{"event":"step_update","step_update":{"step_type":"agent_response","state":"ACTIVE","text_delta":"Hel"}}"#), "Hel");
        assert_eq!(parser.parse(r#"{"event":"step_update","step_update":{"step_type":"tool","text_delta":"hidden","tool_info":{"parameters":{"token":"private"}}}}"#), "");
        assert_eq!(parser.parse(r#"{"event":"step_update","step_update":{"step_type":"agent_response","state":"DONE","text_delta":"lo"}}"#), "lo");
        assert_eq!(
            parser.parse(r#"{"event":"result","result":{"status":"SUCCESS","response":"Hello"}}"#),
            ""
        );
        parser.parse(r#"{"event":"result","result":{"status":"ERROR","error":"Request failed"}}"#);
        assert!(parser.failed());
    }
    #[test]
    fn pi_message_lifecycle_does_not_echo_reasoning_tools_or_final_snapshot() {
        let mut parser = OutputParser::default();
        parser.parse(r#"{"type":"message_start","message":{"role":"assistant"}}"#);
        assert_eq!(parser.parse(r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello"}}"#), "Hello");
        assert_eq!(parser.parse(r#"{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"private"}}"#), "");
        assert_eq!(
            parser.parse(r#"{"type":"tool_execution_start","args":{"token":"private"}}"#),
            ""
        );
        assert_eq!(parser.parse(r#"{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Hello"}]}}"#), "");
        parser.parse(r#"{"type":"message_start","message":{"role":"assistant"}}"#);
        assert_eq!(parser.parse(r#"{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Final answer"}]}}"#), "Final answer");
        parser.parse(r#"{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"Provider error"}}"#);
        assert!(parser.failed());
        parser.parse(r#"{"type":"message_start","message":{"role":"assistant"}}"#);
        parser.parse(r#"{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Recovered"}]}}"#);
        assert!(!parser.failed());
    }
    #[test]
    fn grok_streaming_json_preserves_text_deltas_and_hides_tools() {
        let mut parser = OutputParser::default();
        assert_eq!(parser.parse(r#"{"type":"text","data":"Hel"}"#), "Hel");
        assert_eq!(parser.parse(r#"{"type":"thought","data":"hidden"}"#), "");
        assert_eq!(
            parser.parse(r#"{"type":"tool_call","rawInput":{"secret":"hidden"}}"#),
            ""
        );
        assert_eq!(parser.parse(r#"{"type":"text","data":"lo"}"#), "lo");
        assert_eq!(
            parser.parse(r#"{"type":"end","stopReason":"end_turn"}"#),
            ""
        );
        parser.parse(r#"{"type":"max_turns_reached"}"#);
        assert!(parser.failed());
    }
    #[test]
    fn codex_item_text_is_visible_but_metadata_is_not() {
        let mut parser = OutputParser::default();
        assert_eq!(
            parser.parse(r#"{"type":"thread.started","thread_id":"secret"}"#),
            ""
        );
        assert_eq!(
            parser.parse(
                r#"{"type":"item.completed","item":{"type":"agent_message","text":"Hello"}}"#
            ),
            "Hello\n"
        );
    }
    #[test]
    fn claude_result_does_not_duplicate_assistant() {
        let mut parser = OutputParser::default();
        assert_eq!(
            parser.parse(
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}"#
            ),
            "Hello\n"
        );
        assert_eq!(parser.parse(r#"{"type":"result","result":"Hello"}"#), "");
    }
    #[test]
    fn deltas_are_not_separated_by_newlines() {
        let mut parser = OutputParser::default();
        assert_eq!(
            parser.parse(r#"{"type":"stream_event","event":{"delta":{"text":"Hel"}}}"#),
            "Hel"
        );
        assert_eq!(
            parser.parse(r#"{"type":"stream_event","event":{"delta":{"text":"lo"}}}"#),
            "lo"
        );
        assert_eq!(
            parser.parse(
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}"#
            ),
            ""
        );
    }
    #[test]
    fn cursor_partial_chunks_skip_buffered_and_final_duplicates() {
        let mut parser = OutputParser::default();
        assert_eq!(parser.parse(r#"{"type":"assistant","timestamp_ms":1,"message":{"content":[{"type":"text","text":"Hel"}]}}"#), "Hel");
        assert_eq!(parser.parse(r#"{"type":"assistant","timestamp_ms":2,"message":{"content":[{"type":"text","text":"lo"}]}}"#), "lo");
        assert_eq!(parser.parse(r#"{"type":"assistant","timestamp_ms":3,"model_call_id":"call","message":{"content":[{"type":"text","text":"Hello"}]}}"#), "");
        assert_eq!(
            parser.parse(
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}"#
            ),
            ""
        );
    }
    #[test]
    fn structured_opencode_error_is_visible() {
        let mut parser = OutputParser::default();
        assert_eq!(parser.parse(r#"{"type":"error","error":{"name":"APIError","data":{"message":"Provider access denied"}}}"#), "Provider access denied\n");
    }
    #[test]
    fn protocol_failure_is_not_success_when_process_exits_zero() {
        let mut parser = OutputParser::default();
        parser.parse(r#"{"type":"result","is_error":true,"errors":["Request failed"]}"#);
        assert!(parser.failed());
    }
    #[test]
    fn opencode_parts_and_plain_errors_are_visible() {
        let mut parser = OutputParser::default();
        assert_eq!(
            parser.parse(r#"{"type":"text","part":{"text":"Ready"}}"#),
            "Ready\n"
        );
        assert_eq!(parser.parse("not JSON"), "not JSON\n");
    }
}
