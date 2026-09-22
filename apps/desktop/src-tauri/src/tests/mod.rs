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

use crate::api::MOCK_STUDENT_TOKEN;
use crate::commands::{self, AppState};
use crate::session::now_epoch_secs;

/// A token the fixture backend accepts. See `api/mock.rs`.
const GOOD_LINK: &str = "http://localhost:3000/e/mockexamtoken000000001";

fn test_app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = mock_builder()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::validate_link,
            commands::preview_link,
            commands::begin_sign_in,
            commands::cancel_sign_in,
            commands::get_auth_state,
            commands::sign_out,
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

/// Put a signed-in student into the auth store directly, with the token the
/// fixture backend honours. Claiming a session now requires this; the tests
/// that exercise the device flow itself go through `begin_sign_in` instead.
fn sign_in(app: &App<MockRuntime>) {
    let state = app.state::<AppState>();
    let generation = state.auth.begin_pending(
        "test-device-code".to_string(),
        "TEST-CODE".to_string(),
        format!("{}/device", crate::auth::WEB_ORIGIN),
        now_epoch_secs() + 300,
    );
    assert!(state.auth.set_signed_in_if_current(
        generation,
        MOCK_STUDENT_TOKEN.to_string(),
        "Alex Student".to_string(),
        "alex.student@school.edu".to_string(),
    ));
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
            "server_time",
            "shuffle_questions",
            "title"
        ]
    );

    // `opens_at` is absent, not null, on a link that is open. Its absence is
    // what the frontend reads as "you may start", so it must not appear here.
    assert!(preview["exam"].get("opens_at").is_none());

    // And nothing was claimed: the student is still idle.
    assert!(!app.state::<AppState>().session.is_active());
}

#[test]
fn a_link_that_has_not_opened_yet_is_described_rather_than_refused() {
    let (app, window) = test_app();

    let preview = call(
        &window,
        "preview_link",
        json!({ "raw": "http://localhost:3000/e/mockexamtoken000000004" }),
    )
    .expect("an early link should still describe itself");

    // The configuration a student needs in order to know they have the right
    // link, plus the one fact that was missing before: when it opens.
    assert!(preview["exam"]["title"].as_str().is_some());
    assert!(preview["exam"]["question_count"].as_u64().unwrap_or(0) > 0);

    let opens_at = preview["exam"]["opens_at"]
        .as_u64()
        .expect("an early link must say when it opens");
    let server_time = preview["exam"]["server_time"]
        .as_u64()
        .expect("and against which clock to measure the wait");
    assert!(
        opens_at > server_time,
        "opens_at {opens_at} should still be ahead of server_time {server_time}"
    );

    assert!(!app.state::<AppState>().session.is_active());
}

#[test]
fn describing_an_early_link_does_not_let_one_be_started() {
    let (app, window) = test_app();
    sign_in(&app);

    // The gate that matters is the claim, and it did not move. Preview and
    // claim share a resolver here exactly as they do on the real backend, so
    // this is the assertion that the one exception stayed an exception.
    let err = call(
        &window,
        "start_session",
        json!({ "raw": "http://localhost:3000/e/mockexamtoken000000004" }),
    )
    .expect_err("an early link must not start");

    assert_eq!(error_code(&err), "not_yet_open");
    assert!(!app.state::<AppState>().session.is_active());
}

#[test]
fn a_full_exam_runs_from_link_to_receipt() {
    let (app, window) = test_app();
    sign_in(&app);

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
    let (app, window) = test_app();
    sign_in(&app);

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
    let (app, window) = test_app();
    sign_in(&app);
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
    let (app, window) = test_app();
    sign_in(&app);

    let started = call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");
    let state = call(&window, "get_session_state", json!({})).expect("should read state");
    let auth = call(&window, "get_auth_state", json!({})).expect("should read auth state");

    for payload in [&started, &state, &auth] {
        let text = payload.to_string();
        assert!(!text.contains("mock-session-jwt"), "session JWT leaked: {text}");
        assert!(!text.contains("session_jwt"), "session JWT field leaked: {text}");
        assert!(!text.contains("idempotency"), "idempotency key leaked: {text}");
        // The student's Better Auth session token and the device flow's
        // polling credential live under the same rule as the exam JWT.
        assert!(
            !text.contains(MOCK_STUDENT_TOKEN),
            "student session token leaked: {text}"
        );
        assert!(!text.contains("device-code"), "device code leaked: {text}");
        assert!(!text.contains("device_code"), "device code field leaked: {text}");
    }
}

#[test]
fn submitting_twice_replays_the_same_receipt_instead_of_creating_a_second_attempt() {
    let (app, window) = test_app();
    sign_in(&app);
    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");

    let first = call(&window, "submit_exam", json!({})).expect("first submit");
    let second = call(&window, "submit_exam", json!({})).expect("second submit");

    assert_eq!(first["receipt_id"], second["receipt_id"]);
}

#[test]
fn answers_to_unknown_questions_are_refused() {
    let (app, window) = test_app();
    sign_in(&app);
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
    let (app, window) = test_app();
    sign_in(&app);
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
        let (app, window) = test_app();
        sign_in(&app);
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
    sign_in(&app);
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
    let (app, window) = test_app();
    sign_in(&app);

    // Before an exam: the student must be able to leave. We can't assert the
    // process exits under test, only that the command doesn't reject.
    assert!(call(&window, "get_session_state", json!({})).is_ok());

    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");
    let err = call(&window, "quit_app", json!({})).expect_err("quitting mid-exam must be refused");
    assert_eq!(error_code(&err), "session_conflict");
}

#[test]
fn the_frontend_cannot_write_arbitrary_kinds_into_the_audit_log() {
    let (app, window) = test_app();
    sign_in(&app);
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
    sign_in(&app);
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
    sign_in(&app);
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
    sign_in(&app);
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

// ---------------------------------------------------------------------------
// Student sign-in
// ---------------------------------------------------------------------------

#[test]
fn an_exam_cannot_be_claimed_without_a_signed_in_student() {
    let (app, window) = test_app();

    let err = call(&window, "start_session", json!({ "raw": GOOD_LINK }))
        .expect_err("the claim now requires an identity");

    assert_eq!(error_code(&err), "not_signed_in");
    assert!(!app.state::<AppState>().session.is_active());
}

#[test]
fn beginning_a_sign_in_shows_the_code_but_never_the_device_credential() {
    let (_app, window) = test_app();

    let pending = call(&window, "begin_sign_in", json!({})).expect("should begin");

    assert_eq!(pending["status"], "pending");
    assert!(pending["user_code"].as_str().is_some());
    let uri = pending["verification_uri"].as_str().expect("where to type it");
    assert!(uri.starts_with(crate::auth::WEB_ORIGIN));
    assert!(pending["expires_in_s"].as_u64().unwrap_or(0) > 0);

    let text = pending.to_string();
    assert!(!text.contains("device-code"), "device code leaked: {text}");
    assert!(!text.contains("device_code"), "device code field leaked: {text}");
    assert!(
        !text.contains(MOCK_STUDENT_TOKEN),
        "a token leaked before one even exists: {text}"
    );
}

#[test]
fn a_cancelled_sign_in_goes_back_to_signed_out() {
    let (_app, window) = test_app();

    call(&window, "begin_sign_in", json!({})).expect("should begin");
    let after = call(&window, "cancel_sign_in", json!({})).expect("should cancel");

    assert_eq!(after["status"], "signed_out");
    let state = call(&window, "get_auth_state", json!({})).expect("should read");
    assert_eq!(state["status"], "signed_out");
}

/// The full flow against the fixture: begin, wait for the poll task to be told
/// "approved", and end up signed in with a name on screen and no token in any
/// payload. This is the one test that exercises the spawned task's lifecycle
/// end to end, which is why it tolerates real seconds passing.
#[test]
fn the_device_flow_ends_signed_in_and_the_token_stays_in_rust() {
    let (app, window) = test_app();

    let pending = call(&window, "begin_sign_in", json!({})).expect("should begin");
    assert_eq!(pending["status"], "pending");

    // Fixture timing: two pending polls at ~1s each plus latency. Give it a
    // generous ceiling so a slow CI machine does not flake.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let signed_in = loop {
        let snapshot = call(&window, "get_auth_state", json!({})).expect("should read");
        if snapshot["status"] == "signed_in" {
            break snapshot;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "sign-in never resolved; last snapshot: {snapshot}"
        );
        std::thread::sleep(std::time::Duration::from_millis(200));
    };

    assert_eq!(signed_in["name"], "Alex Student");
    assert_eq!(signed_in["email"], "alex.student@school.edu");
    let text = signed_in.to_string();
    assert!(
        !text.contains(MOCK_STUDENT_TOKEN),
        "the session token crossed the IPC boundary: {text}"
    );

    // And the token it holds is real enough to claim an exam with.
    call(&window, "start_session", json!({ "raw": GOOD_LINK }))
        .expect("a signed-in student can start");
    assert!(app.state::<AppState>().session.is_active());
}

#[test]
fn beginning_a_sign_in_twice_or_mid_exam_is_refused() {
    let (app, window) = test_app();
    sign_in(&app);

    // Already signed in: nothing to begin.
    let err = call(&window, "begin_sign_in", json!({})).expect_err("already signed in");
    assert_eq!(error_code(&err), "already_signed_in");

    // Mid-exam: the identity is settled on the claim the server holds.
    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");
    let state = app.state::<AppState>();
    state.auth.take_signed_out();
    let err = call(&window, "begin_sign_in", json!({})).expect_err("no sign-in mid-exam");
    assert_eq!(error_code(&err), "session_conflict");
}

#[test]
fn signing_out_is_refused_while_an_exam_is_live() {
    let (app, window) = test_app();
    sign_in(&app);
    call(&window, "start_session", json!({ "raw": GOOD_LINK })).expect("should start");

    let err = call(&window, "sign_out", json!({})).expect_err("the sitting is bound to them");
    assert_eq!(error_code(&err), "session_conflict");
    assert!(app.state::<AppState>().auth.is_signed_in());
}

#[test]
fn signing_out_clears_the_identity_and_the_next_claim_is_refused() {
    let (app, window) = test_app();
    sign_in(&app);

    let after = call(&window, "sign_out", json!({})).expect("should sign out");
    assert_eq!(after["status"], "signed_out");
    assert!(!app.state::<AppState>().auth.is_signed_in());

    let err = call(&window, "start_session", json!({ "raw": GOOD_LINK }))
        .expect_err("no identity, no exam");
    assert_eq!(error_code(&err), "not_signed_in");
}
