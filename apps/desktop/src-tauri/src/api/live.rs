//! Real HTTP client. One `reqwest::Client` for the process so connections and
//! TLS sessions are pooled across the exam.

use std::time::Duration;

use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::Serialize;

use super::{
    ApiErrorBody, DeviceCodeRequest, DeviceCodeResponse, DeviceTokenError, DeviceTokenRequest,
    DeviceTokenResponse, EventBatchRequest, GetSessionResponse, HeartbeatRequest,
    HeartbeatResponse, PollOutcome, PreviewRequest, PreviewResponse, ProctorEvent,
    SaveAnswerRequest, StartSessionRequest, StartSessionResponse, SubmitRequest, SubmitResponse,
    CLIENT_VERSION, DEVICE_CLIENT_ID, DEVICE_GRANT_TYPE,
};
use crate::error::{AppError, AppResult};
use crate::session::API_ORIGIN;

/// Short enough that a dead network surfaces to the student quickly, long
/// enough to ride out a slow school Wi-Fi hop.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

pub struct ApiClient {
    http: Client,
}

impl ApiClient {
    pub fn new() -> Self {
        let http = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .user_agent(format!("QuizzerExam/{CLIENT_VERSION}"))
            // An exam client should never follow a redirect: the origin is
            // pinned, and a redirect is the one way a response could move us
            // off it.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("failed to build HTTP client");

        Self { http }
    }

    fn url(path: &str) -> String {
        format!("{}{}", API_ORIGIN.trim_end_matches('/'), path)
    }

    async fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        jwt: Option<&str>,
        body: &B,
    ) -> AppResult<T> {
        let mut req = self.http.post(Self::url(path)).json(body);
        if let Some(token) = jwt {
            req = req.bearer_auth(token);
        }
        decode(req.send().await?).await
    }

    pub async fn preview(&self, token: String) -> AppResult<PreviewResponse> {
        self.post("/api/exam/preview", None, &PreviewRequest { token })
            .await
    }

    /// Claim the exam session. `student_token` is the Better Auth session
    /// token from the device flow - the claim is the one exam call that
    /// authenticates as the *student*; everything after it uses the exam JWT
    /// the claim hands back.
    pub async fn start_session(
        &self,
        token: String,
        student_token: &str,
    ) -> AppResult<StartSessionResponse> {
        let body = StartSessionRequest {
            token,
            client_version: CLIENT_VERSION,
            platform: super::platform_tag(),
        };
        self.post("/api/exam/session", Some(student_token), &body)
            .await
    }

    // --- student sign-in (OAuth device flow, RFC 8628) -----------------------

    /// Ask the server to start a device-flow sign-in. Unauthenticated by
    /// nature - this call is how authentication begins.
    pub async fn request_device_code(&self) -> AppResult<DeviceCodeResponse> {
        self.post(
            "/api/auth/device/code",
            None,
            &DeviceCodeRequest {
                client_id: DEVICE_CLIENT_ID,
            },
        )
        .await
    }

    /// One poll of the token endpoint. `Ok` carries the session token; `Err`
    /// says why there isn't one yet (or ever). Handled by hand rather than
    /// through `decode` because this endpoint speaks RFC 8628, where a 400 is
    /// the *normal* answer while the student is still typing their code.
    pub async fn poll_device_token(&self, device_code: &str) -> Result<String, PollOutcome> {
        let body = DeviceTokenRequest {
            grant_type: DEVICE_GRANT_TYPE,
            device_code,
            client_id: DEVICE_CLIENT_ID,
        };

        let res = self
            .http
            .post(Self::url("/api/auth/device/token"))
            .json(&body)
            .send()
            .await
            .map_err(|err| PollOutcome::Other(err.into()))?;

        let status = res.status();
        if status.is_success() {
            return res
                .json::<DeviceTokenResponse>()
                .await
                .map(|token| token.access_token)
                .map_err(|_| PollOutcome::Other(AppError::ServerError));
        }

        if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS {
            return Err(PollOutcome::Other(AppError::NetworkUnavailable));
        }

        match res.json::<DeviceTokenError>().await {
            Ok(body) => Err(PollOutcome::from_oauth_code(&body.error)),
            Err(_) => Err(PollOutcome::Other(AppError::ServerError)),
        }
    }

    /// Who the freshly minted session token belongs to, for the identity chip.
    /// The endpoint answers 200 with `null` for a token it does not recognise,
    /// which is as signed-out as a 401.
    pub async fn get_student_identity(&self, token: &str) -> AppResult<(String, String)> {
        let res = self
            .http
            .get(Self::url("/api/auth/get-session"))
            .bearer_auth(token)
            .send()
            .await?;

        if !res.status().is_success() {
            return Err(AppError::NotSignedIn);
        }

        match res
            .json::<Option<GetSessionResponse>>()
            .await
            .map_err(|_| AppError::ServerError)?
        {
            Some(session) => Ok((session.user.name, session.user.email)),
            None => Err(AppError::NotSignedIn),
        }
    }

    /// Revoke the session server-side. Best-effort by contract: the caller
    /// signs out locally whatever this returns, because a student walking away
    /// from a shared machine must not stay signed in over a network blip.
    pub async fn sign_out(&self, token: &str) -> AppResult<()> {
        let res = self
            .http
            .post(Self::url("/api/auth/sign-out"))
            .bearer_auth(token)
            .json(&serde_json::json!({}))
            .send()
            .await?;

        if res.status().is_success() {
            Ok(())
        } else {
            Err(AppError::ServerError)
        }
    }

    pub async fn save_answer(
        &self,
        jwt: &str,
        question_id: String,
        value: serde_json::Value,
        client_seq: u64,
    ) -> AppResult<()> {
        let body = SaveAnswerRequest {
            question_id,
            value,
            client_seq,
        };
        let _: serde_json::Value = self.post("/api/exam/answer", Some(jwt), &body).await?;
        Ok(())
    }

    pub async fn heartbeat(&self, jwt: &str, elapsed_s: u64) -> AppResult<HeartbeatResponse> {
        self.post("/api/exam/heartbeat", Some(jwt), &HeartbeatRequest { elapsed_s })
            .await
    }

    pub async fn send_events(&self, jwt: &str, events: Vec<ProctorEvent>) -> AppResult<()> {
        let _: serde_json::Value = self
            .post("/api/exam/events", Some(jwt), &EventBatchRequest { events })
            .await?;
        Ok(())
    }

    /// One question image, over the same authenticated channel as everything
    /// else. Returns the content type and the raw bytes; the caller turns them
    /// into a data URI for the network-less webview.
    pub async fn fetch_media(&self, jwt: &str, media_id: &str) -> AppResult<(String, Vec<u8>)> {
        let res = self
            .http
            .get(Self::url(&format!("/api/exam/media/{media_id}")))
            .bearer_auth(jwt)
            .send()
            .await?;

        if !res.status().is_success() {
            // Delegate to the shared error mapping; a failure status never
            // comes back Ok from it.
            return match decode::<serde_json::Value>(res).await {
                Ok(_) => Err(AppError::ServerError),
                Err(err) => Err(err),
            };
        }

        let content_type = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = res.bytes().await?.to_vec();
        Ok((content_type, bytes))
    }

    pub async fn submit(&self, jwt: &str, idempotency_key: String) -> AppResult<SubmitResponse> {
        self.post(
            "/api/exam/submit",
            Some(jwt),
            &SubmitRequest { idempotency_key },
        )
        .await
    }
}

impl Default for ApiClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Turn a response into either a decoded body or one of our typed errors.
async fn decode<T: DeserializeOwned>(res: Response) -> AppResult<T> {
    let status = res.status();

    if status.is_success() {
        return res.json::<T>().await.map_err(|_| AppError::ServerError);
    }

    // 5xx and 429 are transient; everything else is a decision the server made
    // about this session, and the body should say which.
    if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS {
        return Err(AppError::NetworkUnavailable);
    }

    match res.json::<ApiErrorBody>().await {
        Ok(body) => Err(AppError::from_server_code(&body.error.code)),
        Err(_) => Err(match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => AppError::Revoked,
            StatusCode::NOT_FOUND => AppError::InvalidLink,
            StatusCode::GONE => AppError::Expired,
            StatusCode::CONFLICT => AppError::AlreadySubmitted,
            _ => AppError::ServerError,
        }),
    }
}
