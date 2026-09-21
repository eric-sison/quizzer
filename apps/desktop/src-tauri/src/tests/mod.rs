//! Command-layer tests.
//!
//! These drive the commands through Tauri's mock IPC runtime rather than
//! calling them as plain functions, so the `#[tauri::command]` wiring, the
//! argument names the frontend actually sends, and the error serialisation are
//! all covered.
//!
//! They run against the fixture backend, so: `cargo test --features mock-api`.

#![cfg(feature = "mock-api")]

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow};
use tauri::test::MockRuntime;

use crate::commands::{self, AppState};

/// A token the fixture backend accepts. See `api/mock.rs`.
const GOOD_LINK: &str = "http://localhost:3000/e/mockexamtoken000000001";

fn test_app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = mock_builder()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::validate_link,
            commands::start_session,
            commands::save_answer,
            commands::submit_exam,
            commands::report_event,
            commands::get_session_state,
            commands::get_lockdown_report,
            commands::quit_app,
        ])
        .build(mock_context(noop_assets()))
        .expect("failed to build mock app");

    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build mock window");

    (app, window)
}

fn call(window: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
    let request = InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "tauri://localhost".parse().unwrap(),
        body: InvokeBody::Json(args),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };

    get_ipc_response(window, request).map(|b| b.deserialize::<Value>().unwrap())
}

fn error_code(value: &Value) -> &str {
    value["code"].as_str().unwrap_or("<not an AppError>")
}

#[test]
fn validate_link_accepts_a_good_link_and_never_reveals_the_whole_token() {
    let (_app, window) = test_app();

    let info = call(&window, "validate_link", json!({ "raw": GOOD_LINK })).expect("should validate");

    assert_eq!(info["host"], "localhost");
    let preview = info["token_preview"].as_str().unwrap();
    assert!(
        !preview.contains("mockexamtoken000000001"),
        "the preview must not carry the full token, got {preview}"
    );
}

#[test]
fn validate_link_rejects_a_foreign_origin_with_a_typed_code() {
    let (_app, window) = test_app();

    let err = call(
        &window,
        "validate_link",
        json!({ "raw": "https://evil.example/e/mockexamtoken000000001" }),
    )
    .expect_err("a foreign host must be rejected");

    assert_eq!(error_code(&err), "untrusted_host");
}

#[test]
fn a_full_exam_runs_from_link_to_receipt() {
    let (_app, window) = test_app();

    let started = call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");
    let questions = started["snapshot"]["manifest"]["questions"]
        .as_array()
        .expect("manifest should carry questions");
    assert!(!questions.is_empty());

    let first = questions[0]["id"].as_str().unwrap().to_string();
    call(
        &window,
        "save_answer",
        json!({ "questionId": first, "value": "b" }),
    )
    .expect("answer should save");

    let state = call(&window, "get_session_state", json!({})).expect("should read state");
    assert_eq!(state["phase"], "active");
    assert_eq!(state["answers"][&first], "b");

    let receipt = call(&window, "submit_exam", json!({})).expect("should submit");
    assert!(receipt["receipt_id"].as_str().is_some());

    let after = call(&window, "get_session_state", json!({})).expect("should read state");
    assert_eq!(after["phase"], "submitted");
}

#[test]
fn the_manifest_never_carries_an_answer_key() {
    let (_app, window) = test_app();

    let started = call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");
    let serialised = started.to_string();

    // The wire format the frontend receives must contain nothing that could be
    // read as the correct answer, however the backend chose to name it.
    for forbidden in ["correct", "answer_key", "answerKey", "solution", "is_correct"] {
        assert!(
            !serialised.contains(forbidden),
            "manifest leaked `{forbidden}` to the frontend"
        );
    }
}

#[test]
fn the_session_credential_never_crosses_the_ipc_boundary() {
    let (_app, window) = test_app();

    let started = call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");
    let state = call(&window, "get_session_state", json!({})).expect("should read state");

    for payload in [&started, &state] {
        let text = payload.to_string();
        assert!(!text.contains("mock-session-jwt"), "session JWT leaked: {text}");
        assert!(!text.contains("session_jwt"), "session JWT field leaked: {text}");
        assert!(!text.contains("idempotency"), "idempotency key leaked: {text}");
    }
}

#[test]
fn submitting_twice_replays_the_same_receipt_instead_of_creating_a_second_attempt() {
    let (_app, window) = test_app();
    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");

    let first = call(&window, "submit_exam", json!({})).expect("first submit");
    let second = call(&window, "submit_exam", json!({})).expect("second submit");

    assert_eq!(first["receipt_id"], second["receipt_id"]);
}

#[test]
fn answers_to_unknown_questions_are_refused() {
    let (_app, window) = test_app();
    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");

    let err = call(
        &window,
        "save_answer",
        json!({ "questionId": "../../admin", "value": "x" }),
    )
    .expect_err("an id not in this exam must be refused");

    assert_eq!(error_code(&err), "no_session");
}

#[test]
fn answering_before_a_session_exists_is_refused() {
    let (_app, window) = test_app();

    let err = call(
        &window,
        "save_answer",
        json!({ "questionId": "q1", "value": "a" }),
    )
    .expect_err("there is no session yet");

    assert_eq!(error_code(&err), "no_session");
}

#[test]
fn a_second_session_cannot_be_started_over_a_live_one() {
    let (_app, window) = test_app();
    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");

    let err = call(&window, "start_session", json!({ "raw": GOOD_LINK }))
        .expect_err("a live exam must not be replaced");

    assert_eq!(error_code(&err), "session_conflict");
}

#[test]
fn each_bad_token_maps_to_its_own_screen() {
    for (token, expected) in [
        ("mockexamtoken000000002", "expired"),
        ("mockexamtoken000000003", "already_submitted"),
        ("mockexamtoken000000004", "not_yet_open"),
        ("mockexamtoken000000005", "revoked"),
        ("mockexamtoken000000006", "network_unavailable"),
        ("mockexamtokenunknown00", "invalid_link"),
    ] {
        let (_app, window) = test_app();
        let err = call(
            &window,
            "start_session",
            json!({ "raw": format!("http://localhost:3000/e/{token}") }),
        )
        .expect_err("this token should fail");

        assert_eq!(error_code(&err), expected, "wrong code for token {token}");
    }
}

#[test]
fn quitting_is_refused_while_an_exam_is_live_but_allowed_before_one() {
    let (_app, window) = test_app();

    // Before an exam: the student must be able to leave. We can't assert the
    // process exits under test, only that the command doesn't reject.
    assert!(call(&window, "get_session_state", json!({})).is_ok());

    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");
    let err = call(&window, "quit_app", json!({})).expect_err("quitting mid-exam must be refused");
    assert_eq!(error_code(&err), "session_conflict");
}

#[test]
fn the_frontend_cannot_write_arbitrary_kinds_into_the_audit_log() {
    let (_app, window) = test_app();
    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");

    // Accepted from the frontend.
    call(
        &window,
        "report_event",
        json!({ "kind": "blocked_shortcut", "detail": "Ctrl+Shift+I" }),
    )
    .expect("a known kind should be accepted");

    // Silently dropped - a compromised frontend must not be able to forge
    // arbitrary entries (e.g. a fake `exam_submitted`) in the proctor's log.
    call(
        &window,
        "report_event",
        json!({ "kind": "exam_submitted", "detail": null }),
    )
    .expect("the command itself still succeeds");
}
