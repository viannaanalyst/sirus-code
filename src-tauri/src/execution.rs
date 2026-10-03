//! Bounded per-turn preferences, never arbitrary protocol/config passthrough.
use crate::{
    error::{Error, Result},
    models::{AgentProviderId, ApprovalMode, ExecutionOptions},
    provider_models::ProviderModelList,
};
use serde_json::{json, Value};
pub const EFFORTS: &[&str] = &[
    "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
];

/// A queued request cannot silently adopt a different account/model/workspace
/// or follow a different turn. These values restrict admission, never grant it.
pub fn validate_queued_context(
    session: &crate::models::Session,
    expected: Option<&crate::models::QueuedPromptContext>,
) -> Result<()> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let message_id = session
        .messages
        .iter()
        .rev()
        .find(|message| message.role == crate::models::MessageRole::Agent)
        .map(|message| message.id.as_str());
    if expected.agent != session.agent
        || expected.model != session.model
        || expected.provider_account_id != session.provider_account_id
        || expected.worktree_path != session.worktree.path
        || expected.message_id.as_deref() != message_id
        || session.status.is_active()
    {
        return Err(Error::new(
            "stale",
            "Queued request context changed. Review the queue before sending again.",
        ));
    }
    Ok(())
}

pub fn debug_prompt(debugging: bool, request: String) -> String {
    if !debugging {
        return request;
    }
    format!("{request}\n\nSwitchyard Debug mode: Observe the real state, reproduce the defect, investigate testable hypotheses, fix the smallest root cause and verify the original symptom. Collect relevant logs/errors when accessible. Add a regression test when practical and run appropriate checks before claiming success. Keep the current permission policy. When reproduction requires the user or evidence is inaccessible, give precise steps and ask for that evidence; never claim to observe external actions you cannot access.")
}

pub fn validate(
    provider: &AgentProviderId,
    model: Option<&str>,
    options: &ExecutionOptions,
    catalog: Option<&ProviderModelList>,
) -> Result<()> {
    if options.approval.is_some()
        && (matches!(
            provider,
            AgentProviderId::Grok | AgentProviderId::Antigravity
        ) || (matches!(
            provider,
            AgentProviderId::Droid | AgentProviderId::Pi | AgentProviderId::Devin
        ) && options.approval != Some(ApprovalMode::Auto))
            || (*provider == AgentProviderId::Cursor
                && options.approval == Some(ApprovalMode::Ask)))
    {
        return Err(Error::agent(
            "This approval mode is not supported by this adapter.",
        ));
    }
    if options.planning && options.approval == Some(ApprovalMode::Full) {
        return Err(Error::agent(
            "Full access cannot be combined with planning mode.",
        ));
    }
    if options.planning
        && !matches!(
            provider,
            AgentProviderId::Codex
                | AgentProviderId::Claude
                | AgentProviderId::Cursor
                | AgentProviderId::OpenCode
                | AgentProviderId::Droid
                | AgentProviderId::Pi
        )
    {
        return Err(Error::agent(
            "Planning mode is not supported by this adapter.",
        ));
    }
    if options.planning && *provider == AgentProviderId::Codex && model.is_none() {
        return Err(Error::agent(
            "Select a model before enabling planning mode.",
        ));
    }
    if options.effort.is_none() && !options.fast {
        return Ok(());
    }
    let entry = catalog
        .filter(|list| &list.provider == provider)
        .and_then(|list| {
            list.models.iter().find(|row| {
                Some(row.id.as_str()) == model
                    && row.availability == crate::provider_models::ModelAvailability::Available
            })
        })
        .ok_or_else(|| {
            Error::agent("Refresh the model catalog before changing execution options.")
        })?;
    if let Some(effort) = &options.effort {
        if !EFFORTS.contains(&effort.as_str())
            || !entry.effort_levels.contains(effort)
            || !matches!(
                provider,
                AgentProviderId::Codex
                    | AgentProviderId::Claude
                    | AgentProviderId::OpenCode
                    | AgentProviderId::Grok
                    | AgentProviderId::Cursor
            )
            || (*provider == AgentProviderId::Cursor && !entry.parameterized)
        {
            return Err(Error::agent(
                "This model does not support the selected effort.",
            ));
        }
    }
    if options.fast
        && (!matches!(
            provider,
            AgentProviderId::Codex | AgentProviderId::Claude | AgentProviderId::Cursor
        ) || !entry.fast_mode
            || (*provider == AgentProviderId::Cursor && !entry.parameterized))
    {
        return Err(Error::agent(
            "Fast mode is not supported by this adapter/model.",
        ));
    }
    Ok(())
}

/// Build only known Cursor bracket parameters from native catalog-retained IDs/values.
pub fn cursor_model(
    model: Option<&str>,
    options: &ExecutionOptions,
    catalog: Option<&ProviderModelList>,
) -> Result<Option<String>> {
    let Some(model) = model else {
        return Ok(None);
    };
    // The renderer supplies a catalog ID, never bracket parameters or option-like values.
    if model.is_empty()
        || model.len() > 200
        || !model
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        || !model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    {
        return Err(Error::agent("Invalid Cursor model ID"));
    }
    let entry = catalog
        .filter(|list| list.provider == AgentProviderId::Cursor)
        .and_then(|list| list.models.iter().find(|row| row.id == model));
    let Some(entry) = entry.filter(|row| row.parameterized) else {
        return Ok(Some(model.into()));
    };
    let mut parameters = Vec::new();
    if let Some(effort) = options.effort.as_ref() {
        let key = entry
            .effort_parameter
            .as_deref()
            .filter(|id| ["effort", "reasoning", "reasoning_effort"].contains(id))
            .ok_or_else(|| Error::agent("Cursor effort parameter is unavailable"))?;
        let value = entry
            .effort_values
            .get(effort)
            .filter(|value| EFFORTS.contains(&value.as_str()) || value.as_str() == "extra-high")
            .ok_or_else(|| Error::agent("Cursor effort value is unavailable"))?;
        parameters.push(format!("{key}={value}"));
    }
    if entry.fast_mode {
        parameters.push(format!("fast={}", options.fast));
    }
    Ok(Some(if parameters.is_empty() {
        model.into()
    } else {
        format!("{model}[{}]", parameters.join(","))
    }))
}

pub fn codex_policy(options: &ExecutionOptions) -> (&'static str, &'static str, &'static str) {
    match options.approval {
        Some(ApprovalMode::Full) => ("danger-full-access", "never", "user"),
        Some(ApprovalMode::Auto) => ("workspace-write", "on-request", "auto_review"),
        _ => ("workspace-write", "on-request", "user"),
    }
}

pub fn claude_permission_mode(options: &ExecutionOptions) -> &'static str {
    if options.planning {
        return "plan";
    }
    match options.approval {
        Some(ApprovalMode::Full) => "bypassPermissions",
        Some(ApprovalMode::Auto) => "auto",
        _ => "manual",
    }
}

pub fn codex_turn(
    params: &mut Value,
    options: &ExecutionOptions,
    model: Option<&str>,
) -> Result<()> {
    let (_, approval, reviewer) = codex_policy(options);
    params["approvalPolicy"] = json!(approval);
    params["approvalsReviewer"] = json!(reviewer);
    params["sandboxPolicy"] = if options.approval == Some(ApprovalMode::Full) {
        json!({"type":"dangerFullAccess"})
    } else {
        json!({"type":"workspaceWrite","writableRoots":params["cwd"].as_str().into_iter().collect::<Vec<_>>(),"networkAccess":false,"excludeTmpdirEnvVar":true,"excludeSlashTmp":true})
    };
    // Explicit default tier clears Fast on an exact resumed native thread.
    params["serviceTier"] = json!(if options.fast { "priority" } else { "default" });
    params["effort"] = json!(options.effort);
    if options.planning {
        let model = model.ok_or_else(|| Error::agent("Planning requires a selected model."))?;
        params["collaborationMode"] = json!({"mode":"plan","settings":{"model":model,"reasoning_effort":options.effort,"developer_instructions":null}});
        params["sandboxPolicy"] = json!({"type":"readOnly"});
    } else if let Some(model) = model {
        // Clear a previous plan preset; never leave resumed turns in a hidden mode.
        params["collaborationMode"] = json!({"mode":"default","settings":{"model":model,"reasoning_effort":options.effort,"developer_instructions":null}});
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queued_context_rejects_changed_identity_history_and_active_turns() {
        let session: crate::models::Session = serde_json::from_value(json!({
            "id":"s", "projectId":"p", "title":"Task", "agent":"codex", "model":"model",
            "providerAccountId":"profile", "status":"completed", "createdAt":"time", "lastActivityAt":"time",
            "worktree":{"path":"/fixture", "branch":"main", "isolated":true}, "lastError":null,
            "messages":[{"id":"answer", "sessionId":"s", "role":"agent", "content":"Done", "createdAt":"time", "streaming":false}]
        })).unwrap();
        let expected: crate::models::QueuedPromptContext = serde_json::from_value(json!({
            "messageId":"answer", "agent":"codex", "model":"model", "providerAccountId":"profile", "worktreePath":"/fixture"
        })).unwrap();
        assert!(validate_queued_context(&session, Some(&expected)).is_ok());
        assert!(validate_queued_context(&session, None).is_ok());
        for field in [
            "messageId",
            "model",
            "providerAccountId",
            "worktreePath",
            "agent",
        ] {
            let mut value = serde_json::to_value(&expected).unwrap();
            value[field] = json!(if field == "agent" {
                "claude"
            } else {
                "changed"
            });
            let changed = serde_json::from_value(value).unwrap();
            assert!(
                validate_queued_context(&session, Some(&changed)).is_err(),
                "{field}"
            );
        }
        let mut active = session.clone();
        active.status = crate::models::SessionStatus::Running;
        assert!(validate_queued_context(&active, Some(&expected)).is_err());
        // Resume after failure is explicit in the queue; native admission still
        // enforces the same binding and settled history.
        active.status = crate::models::SessionStatus::Failed;
        assert!(validate_queued_context(&active, Some(&expected)).is_ok());
        let legacy: crate::models::SendPromptRequest =
            serde_json::from_value(json!({"sessionId":"s", "prompt":"Next"})).unwrap();
        assert!(legacy.queued_after.is_none());
    }
    #[test]
    fn debug_is_native_prompt_guidance_and_legacy_requests_default_off() {
        let request: crate::models::SendPromptRequest = serde_json::from_value(json!({
            "sessionId":"session", "prompt":"Reproduce the error"
        }))
        .unwrap();
        assert!(!request.debugging);
        assert_eq!(debug_prompt(false, request.prompt.clone()), request.prompt);
        let output = debug_prompt(true, request.prompt.clone());
        assert!(output.starts_with(&request.prompt));
        assert!(output.contains("reproduce the defect"));
        assert!(output.contains("current permission policy"));
        assert!(output.contains("never claim to observe external actions"));
        assert_eq!(request.prompt, "Reproduce the error");
    }
    #[test]
    fn additional_adapters_reject_unimplemented_permission_profiles() {
        for provider in [
            AgentProviderId::Antigravity,
            AgentProviderId::Droid,
            AgentProviderId::Pi,
            AgentProviderId::Devin,
        ] {
            for mode in [ApprovalMode::Ask, ApprovalMode::Full] {
                assert!(validate(
                    &provider,
                    None,
                    &ExecutionOptions {
                        approval: Some(mode),
                        ..Default::default()
                    },
                    None
                )
                .is_err());
            }
            let auto = ExecutionOptions {
                approval: Some(ApprovalMode::Auto),
                ..Default::default()
            };
            assert_eq!(
                validate(&provider, None, &auto, None).is_ok(),
                provider != AgentProviderId::Antigravity
            );
        }
        for provider in [AgentProviderId::Droid, AgentProviderId::Pi] {
            assert!(validate(
                &provider,
                None,
                &ExecutionOptions {
                    planning: true,
                    ..Default::default()
                },
                None
            )
            .is_ok());
        }
    }
    #[test]
    fn approval_profiles_reach_codex_and_clear_full_access_on_the_next_turn() {
        let auto: ExecutionOptions = serde_json::from_value(json!({"approval":"auto"})).unwrap();
        let full: ExecutionOptions = serde_json::from_value(json!({"approval":"full"})).unwrap();
        let ask: ExecutionOptions = serde_json::from_value(json!({"approval":"ask"})).unwrap();
        let mut params = json!({"cwd":"/fixture"});
        codex_turn(&mut params, &auto, None).unwrap();
        assert_eq!(params["approvalsReviewer"], "auto_review");
        assert_eq!(params["approvalPolicy"], "on-request");
        assert_eq!(params["sandboxPolicy"]["type"], "workspaceWrite");
        codex_turn(&mut params, &full, None).unwrap();
        assert_eq!(params["approvalPolicy"], "never");
        assert_eq!(params["sandboxPolicy"]["type"], "dangerFullAccess");
        codex_turn(&mut params, &ask, None).unwrap();
        assert_eq!(params["approvalsReviewer"], "user");
        assert_eq!(params["sandboxPolicy"]["type"], "workspaceWrite");
        assert_eq!(params["sandboxPolicy"]["networkAccess"], false);
    }

    #[test]
    fn unsupported_approval_modes_and_full_access_planning_are_rejected() {
        for mode in ["ask", "auto", "full"] {
            let options: ExecutionOptions =
                serde_json::from_value(json!({"approval":mode})).unwrap();
            assert!(validate(&AgentProviderId::Grok, None, &options, None).is_err());
            assert_eq!(
                validate(&AgentProviderId::Cursor, None, &options, None).is_ok(),
                mode != "ask"
            );
        }
        let options: ExecutionOptions =
            serde_json::from_value(json!({"approval":"full","planning":true})).unwrap();
        assert!(validate(&AgentProviderId::Claude, None, &options, None).is_err());
        assert!(serde_json::from_value::<ExecutionOptions>(json!({"approval":"--force"})).is_err());
    }
    #[test]
    fn cursor_arguments_use_native_parameter_values_and_clear_fast_without_generic_overrides() {
        let mut catalog:ProviderModelList=serde_json::from_value(json!({"provider":"cursor","source":"cli","note":"","models":[{"id":"composer-2.5","displayName":"Composer","availability":"available","parameterized":true,"fastMode":true},{"id":"gpt-5.5","displayName":"GPT","availability":"available","parameterized":true,"effortLevels":["xhigh"],"effortParameter":"reasoning","effortValues":{"xhigh":"extra-high"}}]})).unwrap();
        let fast = ExecutionOptions {
            fast: true,
            ..Default::default()
        };
        assert!(validate(
            &AgentProviderId::Cursor,
            Some("composer-2.5"),
            &fast,
            Some(&catalog)
        )
        .is_ok());
        assert_eq!(
            cursor_model(Some("composer-2.5"), &fast, Some(&catalog))
                .unwrap()
                .as_deref(),
            Some("composer-2.5[fast=true]")
        );
        assert_eq!(
            cursor_model(
                Some("composer-2.5"),
                &ExecutionOptions::default(),
                Some(&catalog)
            )
            .unwrap()
            .as_deref(),
            Some("composer-2.5[fast=false]")
        );
        let effort = ExecutionOptions {
            effort: Some("xhigh".into()),
            ..Default::default()
        };
        assert_eq!(
            cursor_model(Some("gpt-5.5"), &effort, Some(&catalog))
                .unwrap()
                .as_deref(),
            Some("gpt-5.5[reasoning=extra-high]")
        );
        catalog.models[1]
            .effort_values
            .insert("xhigh".into(), "xhigh,fast=true".into());
        assert!(cursor_model(Some("gpt-5.5"), &effort, Some(&catalog)).is_err());
        assert!(validate(
            &AgentProviderId::Cursor,
            Some("composer-2.5"),
            &effort,
            Some(&catalog)
        )
        .is_err());
        for model in [
            "composer-2.5[fast=true]",
            "--force",
            "model\n",
            "",
            "m,fast=true",
        ] {
            assert!(cursor_model(Some(model), &ExecutionOptions::default(), None).is_err());
        }
    }
    #[test]
    fn unsupported_options_fail_closed_and_default_requires_no_catalog() {
        let default = ExecutionOptions::default();
        assert!(validate(&AgentProviderId::Grok, None, &default, None).is_ok());
        assert!(validate(
            &AgentProviderId::Grok,
            None,
            &ExecutionOptions {
                planning: true,
                ..default.clone()
            },
            None
        )
        .is_err());
        assert!(validate(
            &AgentProviderId::Claude,
            Some("opus"),
            &ExecutionOptions {
                fast: true,
                ..default.clone()
            },
            None
        )
        .is_err());
        let catalog:ProviderModelList = serde_json::from_value(json!({"provider":"codex","source":"cli","note":"","models":[{"id":"m","displayName":"M","availability":"available","effortLevels":["low","high"],"fastMode":true}]})).unwrap();
        for effort in ["ultra", "--dangerously", "high\n"] {
            assert!(validate(
                &AgentProviderId::Codex,
                Some("m"),
                &ExecutionOptions {
                    effort: Some(effort.into()),
                    ..default.clone()
                },
                Some(&catalog)
            )
            .is_err());
        }
        assert!(validate(
            &AgentProviderId::Codex,
            Some("m"),
            &ExecutionOptions {
                effort: Some("high".into()),
                fast: true,
                planning: false,
                ..Default::default()
            },
            Some(&catalog)
        )
        .is_ok());
        assert!(validate(
            &AgentProviderId::Codex,
            Some("foreign"),
            &ExecutionOptions {
                fast: true,
                ..default
            },
            Some(&catalog)
        )
        .is_err());
    }
    #[test]
    fn codex_options_clear_fast_and_planning_without_broadening_permissions() {
        let mut params = json!({"approvalPolicy":"on-request","sandboxPolicy":{"type":"workspaceWrite","networkAccess":false}});
        codex_turn(
            &mut params,
            &ExecutionOptions {
                effort: Some("high".into()),
                fast: true,
                planning: true,
                ..Default::default()
            },
            Some("m"),
        )
        .unwrap();
        assert_eq!(params["serviceTier"], "priority");
        assert_eq!(params["sandboxPolicy"]["type"], "readOnly");
        assert_eq!(params["collaborationMode"]["mode"], "plan");
        assert_eq!(params["approvalPolicy"], "on-request");
        codex_turn(&mut params, &ExecutionOptions::default(), Some("m")).unwrap();
        assert_eq!(params["serviceTier"], "default");
        assert_eq!(params["collaborationMode"]["mode"], "default");
    }
}
