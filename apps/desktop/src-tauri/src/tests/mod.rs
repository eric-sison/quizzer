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

use std::sync::atomic::Ordering;

use crate::commands::{self, AppState};

/// A token the fixture backend accepts. See `api/mock.rs`.
const GOOD_LINK: &str = "http://localhost:3000/e/mockexamtoken000000001";

fn test_app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = mock_builder()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::validate_link,
            commands::preview_link,
            commands::start_session,
            commands::save_answer,
            commands::submit_exam,
            commands::report_event,
            commands::get_session_state,
            commands::get_lockdown_report,
            commands::toggle_proctor_unlock,
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
fn previewing_a_link_shows_the_configuration_but_claims_nothing_and_leaks_nothing() {
    let (app, window) = test_app();

    let preview = call(&window, "preview_link", json!({ "raw": GOOD_LINK })).expect("should preview");

    assert_eq!(preview["host"], "localhost");
    assert!(preview["exam"]["title"].as_str().is_some());
    assert!(preview["exam"]["duration_s"].as_u64().unwrap_or(0) > 0);
    assert!(preview["exam"]["question_count"].as_u64().unwrap_or(0) > 0);
    assert!(preview["exam"]["allow_backtracking"].is_boolean());
    assert!(preview["exam"]["shuffle_questions"].is_boolean());

    // No questions, no credential, no answers - this is configuration only,
    // pinned as a closed key set so a leaky field cannot ride along unnoticed.
    let mut keys: Vec<&str> = preview["exam"]
        .as_object()
        .expect("exam should be an object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "allow_backtracking",
            "description",
            "duration_s",
            "question_count",
            "shuffle_questions",
            "title"
        ]
    );

    // And nothing was claimed: the student is still idle.
    assert!(!app.state::<AppState>().session.is_active());
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
fn question_images_reach_the_webview_as_data_uris_never_urls() {
    let (_app, window) = test_app();
    let started = call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");

    // The image is a node inside the prompt document, holding only a media id.
    let image_node = &started["snapshot"]["manifest"]["questions"][0]["prompt_doc"]["content"][1];
    assert_eq!(image_node["type"], "image");
    assert_eq!(image_node["attrs"]["alt"], "A plant cell under a microscope");
    let media_id = image_node["attrs"]["mediaId"]
        .as_str()
        .expect("the fixture's first prompt should carry an image node");

    // The webview has no network access, so the only usable form is inline.
    let uri = started["snapshot"]["images"][media_id]
        .as_str()
        .expect("the image should be inlined into the snapshot");
    assert!(
        uri.starts_with("data:image/png;base64,"),
        "expected a data URI, got {uri}"
    );
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
fn a_mid_exam_revocation_ends_the_session_so_the_student_is_not_typing_into_a_dead_exam() {
    let (app, window) = test_app();
    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");

    // What the heartbeat loop does when the server says the link is revoked.
    let state = app.state::<AppState>();
    commands::end_revoked_session(&state, &window);

    // The session is gone: answering is refused and state reads as idle, which
    // is also what lets the close/quit guards release the student.
    let snapshot = call(&window, "get_session_state", json!({})).expect("should read state");
    assert_eq!(snapshot["phase"], "idle");

    let err = call(
        &window,
        "save_answer",
        json!({ "questionId": "q1", "value": "a" }),
    )
    .expect_err("a revoked session must not accept answers");
    assert_eq!(error_code(&err), "no_session");

    assert!(
        !app.state::<AppState>().session.is_active(),
        "the quit and close guards key off is_active, which must now be false"
    );
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

/// The invigilator's override.
///
/// The bug this pins: the release held only until the student clicked back
/// into the window, because the focus-gain handler re-asserted lockdown
/// without asking whether anyone had deliberately turned it off. The student
/// was left looking at a banner saying exam mode was off while the kiosk was
/// quietly back on.
#[test]
fn a_proctor_release_survives_leaving_the_window_and_coming_back() {
    let (app, window) = test_app();
    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");
    let state = app.state::<AppState>();

    let released = call(&window, "toggle_proctor_unlock", json!({}))
        .expect("an invigilator may release a live sitting");
    assert_eq!(released, json!(true));
    assert!(state.proctor_unlocked.load(Ordering::SeqCst));

    // The trip away and back, which is the whole point of releasing.
    let before = crate::lockdown::REASSERT_CALLS.load(Ordering::SeqCst);
    commands::on_focus_lost(app.handle(), &window);
    commands::on_focus_gained(app.handle(), &window);

    assert_eq!(
        crate::lockdown::REASSERT_CALLS.load(Ordering::SeqCst),
        before,
        "coming back to the window must not re-engage lockdown behind the invigilator"
    );
    assert!(state.proctor_unlocked.load(Ordering::SeqCst));

    // The same trip without a release still re-engages, so the check above is
    // measuring the override and not a handler that stopped working.
    state.proctor_unlocked.store(false, Ordering::SeqCst);
    commands::on_focus_gained(app.handle(), &window);
    assert_eq!(
        crate::lockdown::REASSERT_CALLS.load(Ordering::SeqCst),
        before + 1,
        "an ordinary focus gain must still re-assert"
    );
    state.proctor_unlocked.store(true, Ordering::SeqCst);

    // And it toggles back, so the sitting can be resumed under invigilation.
    let released_again = call(&window, "toggle_proctor_unlock", json!({}))
        .expect("the same chord restores lockdown");
    assert_eq!(released_again, json!(false));
    assert!(!state.proctor_unlocked.load(Ordering::SeqCst));
}

#[test]
fn a_release_is_recorded_and_never_silent() {
    let (app, window) = test_app();
    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");
    let state = app.state::<AppState>();

    call(&window, "toggle_proctor_unlock", json!({})).expect("should release");

    // The audit trail is what makes a client-side override acceptable at all:
    // anyone who learns the chord can use it, so using it must leave a mark.
    let kinds: Vec<String> = state
        .events
        .take_batch()
        .into_iter()
        .map(|event| event.kind)
        .collect();
    assert!(
        kinds.iter().any(|kind| kind == "lockdown_released"),
        "expected a lockdown_released event, got {kinds:?}"
    );
}

#[test]
fn the_override_does_nothing_outside_a_sitting() {
    let (_app, window) = test_app();

    // Someone trying keystrokes on the link-entry screen learns nothing.
    let err = call(&window, "toggle_proctor_unlock", json!({}))
        .expect_err("there is no exam to release");
    assert_eq!(error_code(&err), "no_session");
}

/// A focus loss during a release is logged but not counted: the student was
/// told to leave the window, and striking them for it would be nonsense.
#[test]
fn a_sanctioned_absence_does_not_cost_the_student_a_strike() {
    let (app, window) = test_app();
    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");
    let state = app.state::<AppState>();

    commands::on_focus_lost(app.handle(), &window);
    let struck = state.session.with(|s| s.strikes).unwrap_or(0);
    assert_eq!(struck, 1, "an unsanctioned absence still counts");

    call(&window, "toggle_proctor_unlock", json!({})).expect("should release");
    commands::on_focus_lost(app.handle(), &window);

    assert_eq!(
        state.session.with(|s| s.strikes).unwrap_or(0),
        struck,
        "leaving the window during a release must not be struck"
    );
}
