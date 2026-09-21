//! Real HTTP client. One `reqwest::Client` for the process so connections and
//! TLS sessions are pooled across the exam.

use std::time::Duration;

use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::Serialize;

use super::{
    ApiErrorBody, EventBatchRequest, HeartbeatRequest, HeartbeatResponse, ProctorEvent,
    SaveAnswerRequest, StartSessionRequest, StartSessionResponse, SubmitRequest, SubmitResponse,
    CLIENT_VERSION,
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

    pub async fn start_session(&self, token: String) -> AppResult<StartSessionResponse> {
        let body = StartSessionRequest {
            token,
            client_version: CLIENT_VERSION,
            platform: super::platform_tag(),
        };
        self.post("/api/exam/session", None, &body).await
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
