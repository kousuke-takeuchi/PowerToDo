//! Google OAuth for the Drive backend (spec section 5): PKCE (S256) with a loopback redirect
//! for the login, plus token refresh and revocation.
//!
//! Nothing secret ever reaches a log, a `Display` or a `Debug`: the access token, the refresh
//! token, the client secret, the authorization code, the PKCE verifier, the `state` and the
//! id_token. Errors are fixed Japanese texts without URLs (a reqwest error would quote the
//! URL, so it is never formatted).
//!
//! The base URLs are parameters ([`Endpoints`], production defaults) so tests can stand in for
//! Google with a mock server.

use std::future::Future;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::Instant;
use url::Url;

use super::backend::BackendError;
use super::tls::install_crypto_provider;

#[cfg(test)]
#[path = "../../build_oauth.rs"]
mod build_oauth;

/// What the app asks Google for: files it created itself (`drive.file`), plus the account's
/// e-mail address for the settings screen.
pub const SCOPE: &str = "https://www.googleapis.com/auth/drive.file openid email";

/// The one scope the sync cannot work without. The consent screen lets the user untick scopes
/// (Google's "granular permissions"), so a login can succeed without it.
pub const DRIVE_FILE_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";

/// How long the login waits for the browser (spec section 5).
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
/// A token this close to its end is already renewed.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);
/// A connection to the loopback port must send its request head within this time.
const REQUEST_HEAD_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REQUEST_HEAD: usize = 16 * 1024;
// The same limits as the WebDAV client.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(600);

const SUCCESS_HTML: &str = "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>PowerToDo</title></head><body><p>ログインしました。このタブを閉じてください。</p></body></html>";
const CANCELLED_HTML: &str = "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>PowerToDo</title></head><body><p>ログインはキャンセルされました。このタブを閉じてください。</p></body></html>";

/// The OAuth client embedded at build time (`build.rs`), or `None` for a build made without
/// `google-oauth.json`: Google Drive is then unavailable.
#[cfg(not(target_os = "ios"))]
pub fn client() -> Option<(&'static str, &'static str)> {
    Some((
        option_env!("POWERTODO_GOOGLE_CLIENT_ID")?,
        option_env!("POWERTODO_GOOGLE_CLIENT_SECRET")?,
    ))
}

/// The iOS client id embedded at build time (no secret: an installed-app client of type iOS), or
/// `None` for a build made without `google-oauth-ios.plist`.
pub fn ios_client_id() -> Option<&'static str> {
    option_env!("POWERTODO_GOOGLE_IOS_CLIENT_ID")
}

/// `com.googleusercontent.apps.<prefix>:/oauthredirect` for `<prefix>.apps.googleusercontent.com`
/// (Google's redirect for an iOS client: the reversed client id as the scheme).
pub fn ios_redirect_uri(client_id: &str) -> Option<String> {
    let prefix = client_id.strip_suffix(".apps.googleusercontent.com")?;
    if prefix.is_empty() {
        return None;
    }
    Some(format!(
        "com.googleusercontent.apps.{prefix}:/oauthredirect"
    ))
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OAuthError {
    #[error("Google でのログインがキャンセルされました")]
    Denied,
    /// The caller's cancel future finished first (the 「キャンセル」 button).
    #[error("ログインを中止しました")]
    Cancelled,
    #[error("ログインがタイムアウトしました。もう一度お試しください")]
    Timeout,
    /// Google rejects the refresh token (revoked, expired, password changed): log in again.
    #[error("Google のログインが無効になりました。もう一度ログインしてください")]
    InvalidGrant,
    #[error("{0}")]
    Offline(String),
    #[error("{0}")]
    Other(String),
}

impl From<OAuthError> for BackendError {
    fn from(e: OAuthError) -> Self {
        match e {
            OAuthError::InvalidGrant => BackendError::Auth,
            OAuthError::Offline(m) => BackendError::Offline(m),
            other => BackendError::Other(other.to_string()),
        }
    }
}

/// Where Google's endpoints are. [`Default`] is production.
#[derive(Debug, Clone)]
pub struct Endpoints {
    pub auth_url: String,
    pub token_url: String,
    pub revoke_url: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Endpoints {
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_url: "https://oauth2.googleapis.com/token".into(),
            revoke_url: "https://oauth2.googleapis.com/revoke".into(),
        }
    }
}

/// The access token of a refresh, valid for `expires_in`.
pub struct AccessToken {
    pub access_token: String,
    pub expires_in: Duration,
}

impl std::fmt::Debug for AccessToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AccessToken")
            .field("access_token", &"<redacted>")
            .field("expires_in", &self.expires_in)
            .finish()
    }
}

/// The result of a login.
pub struct Tokens {
    pub access_token: String,
    pub expires_in: Duration,
    /// For the keychain.
    pub refresh_token: String,
    /// From the id_token, for display only (the signature is not checked).
    pub email: Option<String>,
    /// The `scope` of the token response: the scopes the user actually granted, one string
    /// separated by spaces (Google's native-app guide: "always returned"). `None` when absent.
    pub scope: Option<String>,
}

impl Tokens {
    /// The user let the app use Drive files (`drive.file`).
    pub fn grants_drive(&self) -> bool {
        self.scope
            .as_deref()
            .is_some_and(|s| s.split_whitespace().any(|g| g == DRIVE_FILE_SCOPE))
    }
}

impl std::fmt::Debug for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Tokens")
            .field("access_token", &"<redacted>")
            .field("expires_in", &self.expires_in)
            .field("refresh_token", &"<redacted>")
            .field("email", &self.email.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

/// The HTTP client of every Google request: no redirects (a redirect would resend the bearer
/// token somewhere we did not choose), the same timeouts as the WebDAV client.
pub(crate) fn http_client() -> Result<reqwest::Client, OAuthError> {
    install_crypto_provider();
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .build()
        .map_err(|_| OAuthError::Other("HTTP クライアントを作れません".into()))
}

/// A transport failure, without the URL a reqwest error would quote.
pub(crate) fn transport(e: &reqwest::Error) -> OAuthError {
    if e.is_builder() {
        OAuthError::Other("リクエストを作れません".into())
    } else if e.is_timeout() {
        OAuthError::Offline("Google への接続がタイムアウトしました".into())
    } else if e.is_connect() {
        OAuthError::Offline("Google に接続できません".into())
    } else {
        OAuthError::Offline("Google との通信が途中で切れました".into())
    }
}

#[derive(Clone)]
pub struct GoogleOAuth {
    http: reqwest::Client,
    client_id: String,
    /// `None` for an iOS client, which has no secret.
    client_secret: Option<String>,
    endpoints: Endpoints,
}

impl std::fmt::Debug for GoogleOAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GoogleOAuth")
            .field("client_id", &self.client_id)
            .field("client_secret", &"<redacted>")
            .field("endpoints", &self.endpoints)
            .finish()
    }
}

impl GoogleOAuth {
    pub fn new(
        client_id: impl Into<String>,
        client_secret: impl Into<String>,
        endpoints: Endpoints,
    ) -> Result<Self, OAuthError> {
        Ok(GoogleOAuth {
            http: http_client()?,
            client_id: client_id.into(),
            client_secret: Some(client_secret.into()),
            endpoints,
        })
    }

    /// A client without a secret (iOS). Token requests then leave `client_secret` out.
    pub fn public_client(
        client_id: impl Into<String>,
        endpoints: Endpoints,
    ) -> Result<Self, OAuthError> {
        Ok(GoogleOAuth {
            http: http_client()?,
            client_id: client_id.into(),
            client_secret: None,
            endpoints,
        })
    }

    /// The embedded client against Google's real endpoints; `None` in a build without
    /// `google-oauth.json`.
    pub fn production() -> Option<Result<Self, OAuthError>> {
        #[cfg(target_os = "ios")]
        {
            let id = ios_client_id()?;
            Some(Self::public_client(id, Endpoints::default()))
        }
        #[cfg(not(target_os = "ios"))]
        {
            let (id, secret) = client()?;
            Some(Self::new(id, secret, Endpoints::default()))
        }
    }

    fn authorization_url(
        &self,
        redirect_uri: &str,
        state: &str,
        challenge: &str,
    ) -> Result<Url, OAuthError> {
        let mut url = Url::parse(&self.endpoints.auth_url)
            .map_err(|_| OAuthError::Other("Google の認証 URL が正しくありません".into()))?;
        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", SCOPE)
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
        Ok(url)
    }

    /// Logs in: binds a loopback port, hands the authorization URL to `open_url` (the caller
    /// opens the browser), waits up to 300 s for Google to redirect back and trades the code
    /// for tokens. Ends early with [`OAuthError::Cancelled`] when `cancel` completes.
    pub async fn login(
        &self,
        open_url: impl Fn(&str) + Send,
        cancel: impl Future<Output = ()> + Send,
    ) -> Result<Tokens, OAuthError> {
        self.login_within(open_url, cancel, LOGIN_TIMEOUT).await
    }

    async fn login_within(
        &self,
        open_url: impl Fn(&str) + Send,
        cancel: impl Future<Output = ()> + Send,
        timeout: Duration,
    ) -> Result<Tokens, OAuthError> {
        // 127.0.0.1 only: never reachable from the network.
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| OAuthError::Other("ログイン用のポートを開けません".into()))?;
        let port = listener
            .local_addr()
            .map_err(|_| OAuthError::Other("ログイン用のポートを開けません".into()))?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{port}");
        let verifier = new_verifier();
        let state = random_token(32);
        let url = self.authorization_url(&redirect_uri, &state, &pkce_challenge(&verifier))?;
        open_url(url.as_str());
        drop(url);

        let flow = async {
            match wait_for_callback(&listener, &state, timeout).await? {
                Callback::Code(code) => self.exchange(&code, &verifier, &redirect_uri).await,
                Callback::Denied => Err(OAuthError::Denied),
                Callback::Failed => {
                    Err(OAuthError::Other("Google のログインに失敗しました".into()))
                }
            }
        };
        tokio::pin!(flow);
        tokio::pin!(cancel);
        tokio::select! {
            result = &mut flow => result,
            () = &mut cancel => Err(OAuthError::Cancelled),
        }
    }

    /// Login through a custom-scheme redirect (iOS): `open` shows the authorization URL (the
    /// system login sheet) and returns the URL Google redirected to. Ends early with
    /// [`OAuthError::Cancelled`] when `cancel` completes (`open` may return it too, for the
    /// user closing the sheet) and with [`OAuthError::Timeout`] after 300 s.
    pub async fn login_with_redirect<F, Fut>(
        &self,
        redirect_uri: &str,
        open: F,
        cancel: impl Future<Output = ()> + Send,
    ) -> Result<Tokens, OAuthError>
    where
        F: FnOnce(String) -> Fut + Send,
        Fut: Future<Output = Result<String, OAuthError>> + Send,
    {
        let verifier = new_verifier();
        let state = random_token(32);
        let url = self.authorization_url(redirect_uri, &state, &pkce_challenge(&verifier))?;
        let flow = async {
            let callback = open(url.to_string()).await?;
            drop(url);
            match parse_redirect(&callback, redirect_uri, &state)? {
                Callback::Code(code) => self.exchange(&code, &verifier, redirect_uri).await,
                Callback::Denied => Err(OAuthError::Denied),
                Callback::Failed => {
                    Err(OAuthError::Other("Google のログインに失敗しました".into()))
                }
            }
        };
        tokio::pin!(flow);
        tokio::pin!(cancel);
        tokio::select! {
            result = &mut flow => result,
            () = &mut cancel => Err(OAuthError::Cancelled),
            () = tokio::time::sleep(LOGIN_TIMEOUT) => Err(OAuthError::Timeout),
        }
    }

    async fn exchange(
        &self,
        code: &str,
        verifier: &str,
        redirect_uri: &str,
    ) -> Result<Tokens, OAuthError> {
        let mut fields = vec![
            ("grant_type", "authorization_code"),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", redirect_uri),
            ("client_id", self.client_id.as_str()),
        ];
        if let Some(secret) = &self.client_secret {
            fields.push(("client_secret", secret));
        }
        let json = self.token_request(&fields).await?;
        let access_token = string_field(&json, "access_token")?;
        let refresh_token = json
            .get("refresh_token")
            .and_then(serde_json::Value::as_str)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| {
                OAuthError::Other(
                    "Google から更新用のトークンが返りませんでした。もう一度ログインしてください"
                        .into(),
                )
            })?
            .to_string();
        let email = json
            .get("id_token")
            .and_then(serde_json::Value::as_str)
            .and_then(email_from_id_token);
        let scope = json
            .get("scope")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        Ok(Tokens {
            access_token,
            expires_in: expires_in(&json),
            refresh_token,
            email,
            scope,
        })
    }

    /// A new access token for `refresh_token`. [`OAuthError::InvalidGrant`] when Google no
    /// longer accepts it.
    pub async fn refresh(&self, refresh_token: &str) -> Result<AccessToken, OAuthError> {
        let mut fields = vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", self.client_id.as_str()),
        ];
        if let Some(secret) = &self.client_secret {
            fields.push(("client_secret", secret));
        }
        let json = self.token_request(&fields).await?;
        Ok(AccessToken {
            access_token: string_field(&json, "access_token")?,
            expires_in: expires_in(&json),
        })
    }

    /// Tells Google to forget a token (the refresh token on logout). A token Google already
    /// calls invalid counts as revoked.
    pub async fn revoke(&self, token: &str) -> Result<(), OAuthError> {
        let (status, json) = self
            .post_form(&self.endpoints.revoke_url, &[("token", token)])
            .await?;
        if (200..300).contains(&status) || error_code(&json) == Some("invalid_token") {
            Ok(())
        } else {
            Err(grant_error(status, &json))
        }
    }

    async fn token_request(
        &self,
        fields: &[(&str, &str)],
    ) -> Result<serde_json::Value, OAuthError> {
        let (status, json) = self.post_form(&self.endpoints.token_url, fields).await?;
        if (200..300).contains(&status) {
            Ok(json)
        } else {
            Err(grant_error(status, &json))
        }
    }

    async fn post_form(
        &self,
        url: &str,
        fields: &[(&str, &str)],
    ) -> Result<(u16, serde_json::Value), OAuthError> {
        let body = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(fields)
            .finish();
        let resp = self
            .http
            .post(url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|e| transport(&e))?;
        let status = resp.status().as_u16();
        let bytes = resp.bytes().await.map_err(|e| transport(&e))?;
        let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        Ok((status, json))
    }
}

fn error_code(json: &serde_json::Value) -> Option<&str> {
    json.get("error").and_then(serde_json::Value::as_str)
}

/// The error for an unsuccessful token / revoke answer. Google's own texts are not shown.
fn grant_error(status: u16, json: &serde_json::Value) -> OAuthError {
    match (status, error_code(json)) {
        (_, Some("invalid_grant")) => OAuthError::InvalidGrant,
        (408 | 429 | 500..=599, _) => {
            OAuthError::Offline(format!("Google が応答しません (HTTP {status})"))
        }
        _ => OAuthError::Other(format!("Google のログインに失敗しました (HTTP {status})")),
    }
}

fn string_field(json: &serde_json::Value, name: &str) -> Result<String, OAuthError> {
    json.get(name)
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| OAuthError::Other("Google の応答を読めません".into()))
}

/// A missing lifetime counts as none, so the token is renewed at once.
fn expires_in(json: &serde_json::Value) -> Duration {
    Duration::from_secs(
        json.get("expires_in")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0),
    )
}

/// The `email` claim of an id_token. The signature is not verified: the value is shown to the
/// user and used for nothing else.
fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims
        .get("email")?
        .as_str()
        .filter(|e| !e.is_empty())
        .map(str::to_string)
}

// ---------------------------------------------------------------------------------------------
// PKCE

/// `bytes` random bytes as URL-safe base64 (no padding).
fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::fill(&mut buf[..]);
    URL_SAFE_NO_PAD.encode(buf)
}

/// 64 characters of the unreserved alphabet (RFC 7636 asks for 43 to 128).
fn new_verifier() -> String {
    random_token(48)
}

/// `BASE64URL(SHA256(verifier))`, the S256 code challenge.
fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

// ---------------------------------------------------------------------------------------------
// The loopback receiver

enum Callback {
    Code(String),
    Denied,
    Failed,
}

/// What a request to the loopback port is.
enum Incoming {
    /// The redirect from Google with our `state`.
    Callback(Callback),
    NotFound,
    BadRequest,
}

/// Accepts connections until one is the redirect with a matching `state` (and a `code` or an
/// `error`). Anything else (favicon, probes, a wrong `state`) is answered with 404 / 400 and
/// does not end the wait. Each connection is handled on its own task, so one that stays silent
/// does not hold up the real redirect.
async fn wait_for_callback(
    listener: &TcpListener,
    state: &str,
    timeout: Duration,
) -> Result<Callback, OAuthError> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let state: Arc<str> = state.into();
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            () = &mut deadline => return Err(OAuthError::Timeout),
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    tokio::spawn(handle_connection(stream, Arc::clone(&state), tx.clone()));
                }
                // Out of descriptors and the like: do not spin.
                Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
            },
            Some(callback) = rx.recv() => return Ok(callback),
        }
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    state: Arc<str>,
    tx: tokio::sync::mpsc::UnboundedSender<Callback>,
) {
    let Ok(Some(line)) =
        tokio::time::timeout(REQUEST_HEAD_TIMEOUT, read_request_line(&mut stream)).await
    else {
        return;
    };
    match classify(&line, &state) {
        Incoming::Callback(callback) => {
            let html = match callback {
                Callback::Code(_) => SUCCESS_HTML,
                Callback::Denied | Callback::Failed => CANCELLED_HTML,
            };
            respond(&mut stream, "200 OK", html).await;
            // After the browser has its page.
            let _ = tx.send(callback);
        }
        Incoming::NotFound => respond(&mut stream, "404 Not Found", "").await,
        Incoming::BadRequest => respond(&mut stream, "400 Bad Request", "").await,
    }
}

/// The request line, once the whole head has arrived (unread request bytes at close can turn
/// the close into a reset that eats our answer). `None` for a connection that ends or sends
/// too much first.
async fn read_request_line(stream: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 || buf.len() + n > MAX_REQUEST_HEAD {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let head = String::from_utf8_lossy(&buf);
    head.lines().next().map(str::to_string)
}

/// Reads the URL the login sheet ended on: our scheme and path, our `state`, and a `code` or an
/// `error` (the same rules as [`classify`], but anything else is an error here: there is no
/// socket to keep waiting on). No value of the URL is put into the error.
fn parse_redirect(callback: &str, redirect_uri: &str, state: &str) -> Result<Callback, OAuthError> {
    let wrong = || OAuthError::Other("Google からの戻り先が正しくありません".into());
    let (Ok(url), Ok(expected)) = (Url::parse(callback), Url::parse(redirect_uri)) else {
        return Err(wrong());
    };
    if url.scheme() != expected.scheme() || url.path() != expected.path() {
        return Err(wrong());
    }
    let mut code = None;
    let mut error = None;
    let mut state_ok = false;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "state" => state_ok = v == state,
            "code" => code = Some(v.into_owned()),
            "error" => error = Some(v.into_owned()),
            _ => {}
        }
    }
    if !state_ok {
        return Err(wrong());
    }
    match (code, error) {
        (Some(code), _) if !code.is_empty() => Ok(Callback::Code(code)),
        (_, Some(e)) if e == "access_denied" => Ok(Callback::Denied),
        (_, Some(_)) => Ok(Callback::Failed),
        _ => Err(wrong()),
    }
}

fn classify(request_line: &str, state: &str) -> Incoming {
    let mut parts = request_line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return Incoming::BadRequest;
    };
    if !target.starts_with('/') {
        return Incoming::BadRequest;
    }
    let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
        return Incoming::BadRequest;
    };
    if url.path() != "/" {
        return Incoming::NotFound;
    }
    let mut code = None;
    let mut error = None;
    let mut state_ok = false;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "state" => state_ok = v == state,
            "code" => code = Some(v.into_owned()),
            "error" => error = Some(v.into_owned()),
            _ => {}
        }
    }
    if !state_ok {
        return Incoming::BadRequest;
    }
    match (code, error) {
        (Some(code), _) if !code.is_empty() => Incoming::Callback(Callback::Code(code)),
        (_, Some(e)) if e == "access_denied" => Incoming::Callback(Callback::Denied),
        (_, Some(_)) => Incoming::Callback(Callback::Failed),
        _ => Incoming::BadRequest,
    }
}

/// The body is always one of the static pages: no query value is ever echoed.
async fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.shutdown().await;
}

// ---------------------------------------------------------------------------------------------
// Token source

struct Cached {
    token: String,
    expires_at: Instant,
}

/// A refresh that failed, remembered so the callers queued behind it fail at once instead of
/// each trying (and waiting out the timeouts) again.
struct Failed {
    error: OAuthError,
    /// `None`: for good (see [`TokenSource`]).
    until: Option<Instant>,
}

#[derive(Default)]
struct SourceState {
    token: Option<Cached>,
    failed: Option<Failed>,
}

/// How long an `Offline` refresh failure is remembered.
const FAILURE_MEMORY: Duration = Duration::from_secs(5);

/// The access token for the Drive backend: kept in memory, renewed shortly before it expires,
/// and renewed once more when Google answers 401. Renewals are single-flight: concurrent
/// callers wait for the one in progress and share its token, or its failure: an `Offline`
/// failure is remembered for 5 seconds, an `InvalidGrant` for the life of this value (the
/// refresh token is dead; logging in again makes a new `TokenSource`).
///
/// The refresh token is handed in by the caller (which reads it from the keychain, off the
/// async threads); nothing here touches the keychain.
pub struct TokenSource {
    oauth: GoogleOAuth,
    refresh_token: String,
    state: tokio::sync::Mutex<SourceState>,
    failure_memory: Duration,
}

impl std::fmt::Debug for TokenSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenSource")
            .field("oauth", &self.oauth)
            .field("refresh_token", &"<redacted>")
            .finish_non_exhaustive()
    }
}

impl TokenSource {
    pub fn new(oauth: GoogleOAuth, refresh_token: impl Into<String>) -> Self {
        TokenSource {
            oauth,
            refresh_token: refresh_token.into(),
            state: tokio::sync::Mutex::new(SourceState::default()),
            failure_memory: FAILURE_MEMORY,
        }
    }

    /// A token that is valid for at least a minute more, renewing when needed.
    pub async fn access_token(&self) -> Result<String, OAuthError> {
        let mut state = self.state.lock().await;
        if let Some(c) = state
            .token
            .as_ref()
            .filter(|c| Instant::now() < c.expires_at)
        {
            return Ok(c.token.clone());
        }
        self.renew_locked(&mut state).await
    }

    /// After Google rejected `rejected` with 401: a different token. When another caller has
    /// already renewed since, that token is returned without asking Google again.
    pub async fn renew(&self, rejected: &str) -> Result<String, OAuthError> {
        let mut state = self.state.lock().await;
        if let Some(c) = state
            .token
            .as_ref()
            .filter(|c| c.token != rejected && Instant::now() < c.expires_at)
        {
            return Ok(c.token.clone());
        }
        let renewed = self.renew_locked(&mut state).await;
        // A refresh that failed leaves no token Google has already refused in the cache.
        if renewed.is_err() && state.token.as_ref().is_some_and(|c| c.token == rejected) {
            state.token = None;
        }
        renewed
    }

    async fn renew_locked(&self, state: &mut SourceState) -> Result<String, OAuthError> {
        if let Some(f) = &state.failed {
            if f.until.is_none_or(|until| Instant::now() < until) {
                return Err(f.error.clone());
            }
            state.failed = None;
        }
        match self.oauth.refresh(&self.refresh_token).await {
            Ok(fresh) => {
                let expires_at = Instant::now() + fresh.expires_in.saturating_sub(EXPIRY_MARGIN);
                state.token = Some(Cached {
                    token: fresh.access_token.clone(),
                    expires_at,
                });
                Ok(fresh.access_token)
            }
            Err(e) => {
                match &e {
                    OAuthError::InvalidGrant => {
                        state.token = None;
                        state.failed = Some(Failed {
                            error: e.clone(),
                            until: None,
                        });
                    }
                    OAuthError::Offline(_) => {
                        state.failed = Some(Failed {
                            error: e.clone(),
                            until: Some(Instant::now() + self.failure_memory),
                        });
                    }
                    _ => {}
                }
                Err(e)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{body_string_contains, method, path};
    use wiremock::{Mock, MockServer, Request as MockRequest, ResponseTemplate};

    const RFC7636_VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const RFC7636_CHALLENGE: &str = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    const SECRET: &str = "client-secret-xyz";
    const REFRESH: &str = "refresh-token-abc";

    fn endpoints(server: &MockServer) -> Endpoints {
        Endpoints {
            auth_url: format!("{}/auth", server.uri()),
            token_url: format!("{}/token", server.uri()),
            revoke_url: format!("{}/revoke", server.uri()),
        }
    }

    fn oauth(server: &MockServer) -> GoogleOAuth {
        GoogleOAuth::new("client-id-123", SECRET, endpoints(server)).unwrap()
    }

    fn id_token(email: &str) -> String {
        let payload = URL_SAFE_NO_PAD.encode(json!({"email": email, "sub": "1"}).to_string());
        format!("header.{payload}.signature")
    }

    async fn mount_token(server: &MockServer, status: u16, body: serde_json::Value) {
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(server)
            .await;
    }

    /// A raw HTTP request to the loopback port: `(status, body)`.
    async fn http_get(port: u16, target: &str) -> (u16, String) {
        let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, port))
            .await
            .unwrap();
        s.write_all(
            format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await
        .unwrap();
        let mut raw = Vec::new();
        s.read_to_end(&mut raw).await.unwrap();
        let text = String::from_utf8_lossy(&raw).into_owned();
        let status = text.split(' ').nth(1).unwrap().parse().unwrap();
        let body = text
            .split_once("\r\n\r\n")
            .map(|x| x.1)
            .unwrap_or("")
            .to_string();
        (status, body)
    }

    struct Started {
        task: tokio::task::JoinHandle<Result<Tokens, OAuthError>>,
        url: Url,
        cancel: Option<tokio::sync::oneshot::Sender<()>>,
    }

    impl Started {
        fn query(&self, key: &str) -> String {
            self.url
                .query_pairs()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v.into_owned())
                .unwrap()
        }
        fn port(&self) -> u16 {
            Url::parse(&self.query("redirect_uri"))
                .unwrap()
                .port()
                .unwrap()
        }
    }

    /// Starts a login and waits for the authorization URL it hands out.
    async fn start_login(g: GoogleOAuth, timeout: Duration) -> Started {
        let (url_tx, url_rx) = tokio::sync::oneshot::channel();
        let url_tx = std::sync::Mutex::new(Some(url_tx));
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
        let task = tokio::spawn(async move {
            g.login_within(
                move |u| {
                    if let Some(tx) = url_tx.lock().unwrap().take() {
                        let _ = tx.send(u.to_string());
                    }
                },
                async move {
                    // Only a real cancel ends it; a dropped sender never completes.
                    if cancel_rx.await.is_err() {
                        std::future::pending::<()>().await;
                    }
                },
                timeout,
            )
            .await
        });
        let url = Url::parse(&url_rx.await.unwrap()).unwrap();
        Started {
            task,
            url,
            cancel: Some(cancel_tx),
        }
    }

    #[test]
    fn pkce_challenge_matches_rfc7636_appendix_b() {
        assert_eq!(pkce_challenge(RFC7636_VERIFIER), RFC7636_CHALLENGE);
    }

    #[test]
    fn verifier_and_state_are_long_random_and_url_safe() {
        let v = new_verifier();
        assert_eq!(v.len(), 64);
        assert!(
            v.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
        assert_ne!(v, new_verifier());
        assert_ne!(random_token(32), random_token(32));
    }

    #[test]
    fn the_authorization_url_carries_everything_google_needs() {
        let g = GoogleOAuth::new("cid", "csecret", Endpoints::default()).unwrap();
        let url = g
            .authorization_url("http://127.0.0.1:4242", "st", "ch")
            .unwrap();
        assert_eq!(
            url.as_str().split('?').next().unwrap(),
            "https://accounts.google.com/o/oauth2/v2/auth"
        );
        let q: std::collections::BTreeMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], "cid");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:4242");
        assert_eq!(q["response_type"], "code");
        assert_eq!(
            q["scope"],
            "https://www.googleapis.com/auth/drive.file openid email"
        );
        assert_eq!(q["state"], "st");
        assert_eq!(q["code_challenge"], "ch");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["access_type"], "offline");
        assert_eq!(q["prompt"], "consent");
        // The client secret never goes through the browser.
        assert!(!url.as_str().contains("csecret"));
    }

    #[test]
    fn the_granted_scopes_decide_whether_drive_may_be_used() {
        let with = |scope: Option<&str>| Tokens {
            access_token: String::new(),
            expires_in: Duration::from_secs(1),
            refresh_token: String::new(),
            email: None,
            scope: scope.map(str::to_string),
        };
        assert!(
            with(Some(
                "openid https://www.googleapis.com/auth/drive.file email"
            ))
            .grants_drive()
        );
        assert!(with(Some("https://www.googleapis.com/auth/drive.file")).grants_drive());
        // Unticked on the consent screen, or not reported at all.
        assert!(!with(Some("openid email")).grants_drive());
        assert!(!with(None).grants_drive());
        // A scope that merely starts like it is not it.
        assert!(!with(Some("https://www.googleapis.com/auth/drive.file.other")).grants_drive());
        assert!(!with(Some("https://www.googleapis.com/auth/drive")).grants_drive());
    }

    #[test]
    fn the_email_comes_from_the_id_token_payload() {
        assert_eq!(
            email_from_id_token(&id_token("user@example.com")).as_deref(),
            Some("user@example.com")
        );
        assert_eq!(email_from_id_token("garbage"), None);
        assert_eq!(email_from_id_token("a.!!!.c"), None);
        assert_eq!(
            email_from_id_token(&format!("a.{}.c", URL_SAFE_NO_PAD.encode("{}"))),
            None
        );
    }

    #[test]
    fn build_script_parsing_reads_the_installed_format() {
        use build_oauth::parse_google_oauth as parse;
        let ok = r#"{"installed":{"client_id":"id-1","client_secret":" sec-1 ","redirect_uris":["http://localhost"]}}"#;
        assert_eq!(parse(ok), Ok(("id-1".into(), "sec-1".into())));
        assert!(parse("not json").is_err());
        assert!(parse(r#"{"web":{"client_id":"a","client_secret":"b"}}"#).is_err());
        assert!(parse(r#"{"installed":{"client_id":"a"}}"#).is_err());
        assert!(parse(r#"{"installed":{"client_id":"","client_secret":"b"}}"#).is_err());
        assert!(parse(r#"{"installed":{"client_id":1,"client_secret":"b"}}"#).is_err());
        // A value that would break the `cargo:` line.
        assert!(parse(r#"{"installed":{"client_id":"a\nb","client_secret":"b"}}"#).is_err());
        // The messages are fixed texts: no value of the file in them.
        let err = parse(r#"{"installed":{"client_id":"LEAK-ID","client_secret":3}}"#).unwrap_err();
        assert!(!err.contains("LEAK"));
        let err = parse(r#"{"installed":{"client_id":"LEAK-ID""#).unwrap_err();
        assert!(!err.contains("LEAK"));
    }

    const IOS_PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CLIENT_ID</key>
	<string> 123-abc.apps.googleusercontent.com </string>
	<key>REVERSED_CLIENT_ID</key>
	<string>com.googleusercontent.apps.123-abc</string>
</dict>
</plist>"#;

    #[test]
    fn parse_google_ios_plist_reads_client_id() {
        assert_eq!(
            build_oauth::parse_google_ios_plist(IOS_PLIST),
            Ok("123-abc.apps.googleusercontent.com".to_string())
        );
    }

    #[test]
    fn parse_google_ios_plist_rejects_missing_or_empty() {
        use build_oauth::parse_google_ios_plist as parse;
        assert!(parse("not a plist").is_err());
        assert!(parse("<plist><dict><key>OTHER</key><string>x</string></dict></plist>").is_err());
        assert!(
            parse("<plist><dict><key>CLIENT_ID</key><string> </string></dict></plist>").is_err()
        );
        assert!(
            parse("<plist><dict><key>CLIENT_ID</key><integer>1</integer></dict></plist>").is_err()
        );
        // The messages are fixed texts: no value of the file in them.
        let err = parse("<key>CLIENT_ID</key><string>LEAK").unwrap_err();
        assert!(!err.contains("LEAK"));
    }

    #[test]
    fn parse_google_ios_plist_rejects_control_characters() {
        let text = "<key>CLIENT_ID</key><string>a\nb</string>";
        assert!(build_oauth::parse_google_ios_plist(text).is_err());
    }

    #[test]
    fn ios_redirect_uri_reverses_the_client_id() {
        assert_eq!(
            ios_redirect_uri("123-abc.apps.googleusercontent.com").as_deref(),
            Some("com.googleusercontent.apps.123-abc:/oauthredirect")
        );
        assert_eq!(ios_redirect_uri("123-abc.example.com"), None);
        assert_eq!(ios_redirect_uri(".apps.googleusercontent.com"), None);
        assert_eq!(ios_redirect_uri(""), None);
    }

    const REDIRECT: &str = "com.example.app:/oauthredirect";

    #[test]
    fn parse_redirect_rejects_a_wrong_state() {
        let url = format!("{REDIRECT}?code=c&state=other");
        assert!(parse_redirect(&url, REDIRECT, "mine").is_err());
        assert!(parse_redirect(&format!("{REDIRECT}?code=c"), REDIRECT, "mine").is_err());
    }

    #[test]
    fn parse_redirect_reads_code() {
        let url = format!("{REDIRECT}?code=the-code&state=mine&scope=x");
        assert!(matches!(
            parse_redirect(&url, REDIRECT, "mine"),
            Ok(Callback::Code(c)) if c == "the-code"
        ));
        // Neither a code nor an error.
        assert!(parse_redirect(&format!("{REDIRECT}?state=mine"), REDIRECT, "mine").is_err());
    }

    #[test]
    fn parse_redirect_reads_access_denied() {
        let url = format!("{REDIRECT}?error=access_denied&state=mine");
        assert!(matches!(
            parse_redirect(&url, REDIRECT, "mine"),
            Ok(Callback::Denied)
        ));
        let url = format!("{REDIRECT}?error=server_error&state=mine");
        assert!(matches!(
            parse_redirect(&url, REDIRECT, "mine"),
            Ok(Callback::Failed)
        ));
    }

    #[test]
    fn parse_redirect_rejects_another_scheme_or_path() {
        let q = "?code=c&state=mine";
        let bad = |u: String| parse_redirect(&u, REDIRECT, "mine").is_err();
        assert!(bad(format!("com.other.app:/oauthredirect{q}")));
        assert!(bad(format!("com.example.app:/elsewhere{q}")));
        assert!(bad(format!("https://example.com/oauthredirect{q}")));
        assert!(bad("not a url".to_string()));
    }

    fn public_oauth(server: &MockServer) -> GoogleOAuth {
        GoogleOAuth::public_client("client-id-123", endpoints(server)).unwrap()
    }

    async fn token_form(server: &MockServer) -> std::collections::BTreeMap<String, String> {
        let sent = server.received_requests().await.unwrap();
        let sent = sent.iter().find(|r| r.url.path() == "/token").unwrap();
        url::form_urlencoded::parse(&sent.body)
            .into_owned()
            .collect()
    }

    #[tokio::test]
    async fn public_client_exchange_sends_no_secret() {
        let server = MockServer::start().await;
        mount_token(
            &server,
            200,
            json!({"access_token": "at-2", "expires_in": 3599}),
        )
        .await;
        public_oauth(&server).refresh(REFRESH).await.unwrap();
        let form = token_form(&server).await;
        assert_eq!(form["client_id"], "client-id-123");
        assert!(!form.contains_key("client_secret"));

        let server = MockServer::start().await;
        mount_token(
            &server,
            200,
            json!({"access_token": "at", "expires_in": 3599, "refresh_token": "rt"}),
        )
        .await;
        public_oauth(&server)
            .exchange("c", "v", REDIRECT)
            .await
            .unwrap();
        assert!(!token_form(&server).await.contains_key("client_secret"));
    }

    #[tokio::test]
    async fn login_with_redirect_trades_the_code() {
        let server = MockServer::start().await;
        mount_token(
            &server,
            200,
            json!({
                "access_token": "at-1", "expires_in": 3599, "refresh_token": "rt-1",
                "id_token": id_token("user@example.com"), "token_type": "Bearer"
            }),
        )
        .await;
        let g = public_oauth(&server);
        let seen = std::sync::Arc::new(std::sync::Mutex::new(None));
        let seen2 = std::sync::Arc::clone(&seen);
        let tokens = g
            .login_with_redirect(
                REDIRECT,
                move |auth_url: String| async move {
                    let url = Url::parse(&auth_url).unwrap();
                    let q: std::collections::BTreeMap<_, _> =
                        url.query_pairs().into_owned().collect();
                    *seen2.lock().unwrap() = Some(q.clone());
                    Ok(format!("{REDIRECT}?code=the-code&state={}", q["state"]))
                },
                std::future::pending(),
            )
            .await
            .unwrap();
        assert_eq!(tokens.refresh_token, "rt-1");
        assert_eq!(tokens.email.as_deref(), Some("user@example.com"));
        let q = seen.lock().unwrap().clone().unwrap();
        assert_eq!(q["redirect_uri"], REDIRECT);
        assert_eq!(q["code_challenge_method"], "S256");
        let form = token_form(&server).await;
        assert_eq!(form["code"], "the-code");
        assert_eq!(form["redirect_uri"], REDIRECT);
        assert!(!form.contains_key("client_secret"));
        assert_eq!(pkce_challenge(&form["code_verifier"]), q["code_challenge"]);
    }

    #[tokio::test]
    async fn login_with_redirect_cancel_is_cancelled() {
        let server = MockServer::start().await;
        let g = public_oauth(&server);
        let r = g
            .login_with_redirect(
                REDIRECT,
                |_url: String| std::future::pending::<Result<String, OAuthError>>(),
                async {},
            )
            .await;
        assert_eq!(r.unwrap_err(), OAuthError::Cancelled);
        // The user closing the sheet is the opener's Cancelled, passed through.
        let r = g
            .login_with_redirect(
                REDIRECT,
                |_url: String| async { Err(OAuthError::Cancelled) },
                std::future::pending(),
            )
            .await;
        assert_eq!(r.unwrap_err(), OAuthError::Cancelled);
    }

    #[test]
    #[ignore = "needs a build with POWERTODO_GOOGLE_OAUTH_JSON (see the Task 8 brief)"]
    fn the_oauth_client_is_embedded_by_the_build() {
        assert!(client().is_some());
    }

    #[test]
    fn debug_output_hides_secrets() {
        let t = Tokens {
            access_token: "AT-secret".into(),
            expires_in: Duration::from_secs(5),
            refresh_token: "RT-secret".into(),
            email: Some("user@example.com".into()),
            scope: None,
        };
        let a = AccessToken {
            access_token: "AT-secret".into(),
            expires_in: Duration::from_secs(5),
        };
        let g = GoogleOAuth::new("cid", SECRET, Endpoints::default()).unwrap();
        let s = TokenSource::new(g.clone(), REFRESH);
        let all = format!("{t:?} {a:?} {g:?} {s:?}");
        for secret in [
            "AT-secret",
            "RT-secret",
            SECRET,
            REFRESH,
            "user@example.com",
        ] {
            assert!(!all.contains(secret), "{secret} leaked");
        }
    }

    #[tokio::test]
    async fn a_login_trades_the_redirected_code_for_tokens() {
        let server = MockServer::start().await;
        mount_token(
            &server,
            200,
            json!({
                "access_token": "at-1", "expires_in": 3599, "refresh_token": "rt-1",
                "id_token": id_token("user@example.com"), "token_type": "Bearer"
            }),
        )
        .await;
        let started = start_login(oauth(&server), Duration::from_secs(30)).await;
        let state = started.query("state");
        let (status, body) =
            http_get(started.port(), &format!("/?code=the-code&state={state}")).await;
        assert_eq!(status, 200);
        assert!(body.contains("ログインしました。このタブを閉じてください"));
        // Nothing of the query is echoed.
        assert!(!body.contains("the-code") && !body.contains(&state));

        let (redirect, challenge) = (
            started.query("redirect_uri"),
            started.query("code_challenge"),
        );
        let tokens = started.task.await.unwrap().unwrap();
        assert_eq!(tokens.access_token, "at-1");
        assert_eq!(tokens.refresh_token, "rt-1");
        assert_eq!(tokens.expires_in, Duration::from_secs(3599));
        assert_eq!(tokens.email.as_deref(), Some("user@example.com"));

        // The exchange: form body with the code, our verifier (whose S256 is the challenge we
        // sent), the redirect and the client secret.
        let sent = server.received_requests().await.unwrap();
        let sent = sent.iter().find(|r| r.url.path() == "/token").unwrap();
        let form: std::collections::BTreeMap<String, String> =
            url::form_urlencoded::parse(&sent.body)
                .into_owned()
                .collect();
        assert_eq!(form["grant_type"], "authorization_code");
        assert_eq!(form["code"], "the-code");
        assert_eq!(form["client_secret"], SECRET);
        assert_eq!(form["client_id"], "client-id-123");
        assert_eq!(form["redirect_uri"], redirect);
        assert_eq!(pkce_challenge(&form["code_verifier"]), challenge);
        assert_eq!(form["code_verifier"].len(), 64);
    }

    #[tokio::test]
    async fn a_wrong_state_never_completes_the_login() {
        let server = MockServer::start().await;
        mount_token(
            &server,
            200,
            json!({"access_token": "at", "expires_in": 3600, "refresh_token": "rt"}),
        )
        .await;
        let mut started = start_login(oauth(&server), Duration::from_secs(30)).await;
        let port = started.port();
        let state = started.query("state");

        assert_eq!(http_get(port, "/?code=evil&state=wrong").await.0, 400);
        assert_eq!(http_get(port, "/?code=evil").await.0, 400);
        assert_eq!(
            http_get(port, "/?error=access_denied&state=wrong").await.0,
            400
        );
        assert_eq!(http_get(port, "/favicon.ico").await.0, 404);
        // Neither is a code-less redirect with the right state.
        assert_eq!(http_get(port, &format!("/?state={state}")).await.0, 400);
        // Still waiting, and Google was never asked.
        assert!(
            tokio::time::timeout(Duration::from_millis(150), &mut started.task)
                .await
                .is_err()
        );
        assert!(server.received_requests().await.unwrap().is_empty());

        assert_eq!(
            http_get(port, &format!("/?code=good&state={state}"))
                .await
                .0,
            200
        );
        assert!(started.task.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn a_silent_connection_does_not_block_the_redirect() {
        let server = MockServer::start().await;
        mount_token(
            &server,
            200,
            json!({"access_token": "at", "expires_in": 3600, "refresh_token": "rt"}),
        )
        .await;
        let started = start_login(oauth(&server), Duration::from_secs(30)).await;
        // A browser's speculative connection: open, nothing sent.
        let _idle = TcpStream::connect((Ipv4Addr::LOCALHOST, started.port()))
            .await
            .unwrap();
        let state = started.query("state");
        assert_eq!(
            http_get(started.port(), &format!("/?code=c&state={state}"))
                .await
                .0,
            200
        );
        assert!(started.task.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn access_denied_is_its_own_error() {
        let server = MockServer::start().await;
        let started = start_login(oauth(&server), Duration::from_secs(30)).await;
        let state = started.query("state");
        let (status, body) = http_get(
            started.port(),
            &format!("/?error=access_denied&state={state}"),
        )
        .await;
        assert_eq!(status, 200);
        assert!(body.contains("キャンセル"));
        let err = started.task.await.unwrap().unwrap_err();
        assert_eq!(err, OAuthError::Denied);
        assert_eq!(err.to_string(), "Google でのログインがキャンセルされました");
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn another_google_error_fails_the_login() {
        let server = MockServer::start().await;
        let started = start_login(oauth(&server), Duration::from_secs(30)).await;
        let state = started.query("state");
        http_get(
            started.port(),
            &format!("/?error=invalid_scope&state={state}"),
        )
        .await;
        let err = started.task.await.unwrap().unwrap_err();
        assert!(matches!(err, OAuthError::Other(_)));
        assert!(!err.to_string().contains("invalid_scope"));
    }

    #[tokio::test]
    async fn the_login_times_out() {
        let server = MockServer::start().await;
        let started = start_login(oauth(&server), Duration::from_millis(200)).await;
        assert_eq!(
            started.task.await.unwrap().unwrap_err(),
            OAuthError::Timeout
        );
    }

    #[tokio::test]
    async fn the_login_can_be_cancelled() {
        let server = MockServer::start().await;
        let mut started = start_login(oauth(&server), Duration::from_secs(30)).await;
        started.cancel.take().unwrap().send(()).unwrap();
        assert_eq!(
            started.task.await.unwrap().unwrap_err(),
            OAuthError::Cancelled
        );
    }

    #[tokio::test]
    async fn a_login_without_a_refresh_token_is_an_error() {
        let server = MockServer::start().await;
        mount_token(
            &server,
            200,
            json!({"access_token": "at", "expires_in": 3600}),
        )
        .await;
        let started = start_login(oauth(&server), Duration::from_secs(30)).await;
        let state = started.query("state");
        http_get(started.port(), &format!("/?code=c&state={state}")).await;
        assert!(matches!(
            started.task.await.unwrap().unwrap_err(),
            OAuthError::Other(_)
        ));
    }

    #[tokio::test]
    async fn the_code_exchange_failing_is_reported_without_google_texts() {
        let server = MockServer::start().await;
        mount_token(
            &server,
            400,
            json!({"error": "invalid_grant", "error_description": "Bad code LEAK"}),
        )
        .await;
        let started = start_login(oauth(&server), Duration::from_secs(30)).await;
        let state = started.query("state");
        http_get(started.port(), &format!("/?code=c&state={state}")).await;
        let err = started.task.await.unwrap().unwrap_err();
        assert_eq!(err, OAuthError::InvalidGrant);
        assert!(!err.to_string().contains("LEAK"));
    }

    #[tokio::test]
    async fn refresh_returns_a_new_access_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .and(body_string_contains("grant_type=refresh_token"))
            .and(body_string_contains("refresh_token=refresh-token-abc"))
            .and(body_string_contains("client_secret=client-secret-xyz"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"access_token": "at-new", "expires_in": 3599})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let fresh = oauth(&server).refresh(REFRESH).await.unwrap();
        assert_eq!(fresh.access_token, "at-new");
        assert_eq!(fresh.expires_in, Duration::from_secs(3599));
    }

    #[tokio::test]
    async fn refresh_error_mapping() {
        let server = MockServer::start().await;
        mount_token(&server, 400, json!({"error": "invalid_grant"})).await;
        assert_eq!(
            oauth(&server).refresh(REFRESH).await.unwrap_err(),
            OAuthError::InvalidGrant
        );
        assert!(matches!(
            BackendError::from(OAuthError::InvalidGrant),
            BackendError::Auth
        ));

        let server = MockServer::start().await;
        mount_token(&server, 503, json!({})).await;
        let err = oauth(&server).refresh(REFRESH).await.unwrap_err();
        assert!(matches!(err, OAuthError::Offline(_)));
        assert!(matches!(BackendError::from(err), BackendError::Offline(_)));

        let server = MockServer::start().await;
        mount_token(&server, 401, json!({"error": "invalid_client"})).await;
        assert!(matches!(
            oauth(&server).refresh(REFRESH).await.unwrap_err(),
            OAuthError::Other(_)
        ));

        // Nobody listening: offline, and the text does not quote the URL.
        let dead = GoogleOAuth::new(
            "id",
            "secret",
            Endpoints {
                token_url: "http://127.0.0.1:9/token".into(),
                ..Endpoints::default()
            },
        )
        .unwrap();
        let err = dead.refresh(REFRESH).await.unwrap_err();
        assert!(matches!(err, OAuthError::Offline(_)));
        assert!(!err.to_string().contains("127.0.0.1"));
    }

    #[tokio::test]
    async fn revoke_posts_the_token_and_forgives_an_invalid_one() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/revoke"))
            .and(body_string_contains("token=refresh-token-abc"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        oauth(&server).revoke(REFRESH).await.unwrap();

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/revoke"))
            .respond_with(
                ResponseTemplate::new(400).set_body_json(json!({"error": "invalid_token"})),
            )
            .mount(&server)
            .await;
        oauth(&server).revoke(REFRESH).await.unwrap();

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/revoke"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        assert!(oauth(&server).revoke(REFRESH).await.is_err());
    }

    fn token_requests(requests: &[MockRequest]) -> usize {
        requests.iter().filter(|r| r.url.path() == "/token").count()
    }

    #[tokio::test]
    async fn the_token_is_cached_until_a_minute_before_it_expires() {
        let server = MockServer::start().await;
        mount_token(
            &server,
            200,
            json!({"access_token": "at-1", "expires_in": 3600}),
        )
        .await;
        let source = TokenSource::new(oauth(&server), REFRESH);
        assert_eq!(source.access_token().await.unwrap(), "at-1");
        assert_eq!(source.access_token().await.unwrap(), "at-1");
        assert_eq!(
            token_requests(&server.received_requests().await.unwrap()),
            1
        );

        // 30 s of life is inside the 60 s margin: renewed on every use.
        let server = MockServer::start().await;
        mount_token(
            &server,
            200,
            json!({"access_token": "short", "expires_in": 30}),
        )
        .await;
        let source = TokenSource::new(oauth(&server), REFRESH);
        source.access_token().await.unwrap();
        source.access_token().await.unwrap();
        assert_eq!(
            token_requests(&server.received_requests().await.unwrap()),
            2
        );
    }

    #[tokio::test]
    async fn concurrent_renewals_share_one_refresh() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"access_token": "at-1", "expires_in": 3600}))
                    .set_delay(Duration::from_millis(200)),
            )
            .mount(&server)
            .await;
        let source = Arc::new(TokenSource::new(oauth(&server), REFRESH));
        let calls: Vec<_> = (0..6)
            .map(|_| {
                let s = Arc::clone(&source);
                tokio::spawn(async move { s.access_token().await })
            })
            .collect();
        for c in calls {
            assert_eq!(c.await.unwrap().unwrap(), "at-1");
        }
        assert_eq!(
            token_requests(&server.received_requests().await.unwrap()),
            1
        );
    }

    #[tokio::test]
    async fn renew_after_a_401_asks_google_once_per_rejected_token() {
        let server = MockServer::start().await;
        let counter = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let c = Arc::clone(&counter);
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(move |_: &MockRequest| {
                let n = c.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                ResponseTemplate::new(200)
                    .set_body_json(json!({"access_token": format!("at-{n}"), "expires_in": 3600}))
            })
            .mount(&server)
            .await;
        let source = TokenSource::new(oauth(&server), REFRESH);
        assert_eq!(source.access_token().await.unwrap(), "at-1");
        // The first caller to see the 401 renews ...
        assert_eq!(source.renew("at-1").await.unwrap(), "at-2");
        // ... the second one, holding the same rejected token, shares that renewal.
        assert_eq!(source.renew("at-1").await.unwrap(), "at-2");
        assert_eq!(
            token_requests(&server.received_requests().await.unwrap()),
            2
        );
    }

    #[tokio::test]
    async fn an_invalid_grant_clears_the_cache() {
        let server = MockServer::start().await;
        let source = TokenSource::new(oauth(&server), REFRESH);
        let ok = Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"access_token": "at-1", "expires_in": 3600})),
            )
            .mount_as_scoped(&server)
            .await;
        assert_eq!(source.access_token().await.unwrap(), "at-1");
        drop(ok);
        mount_token(&server, 400, json!({"error": "invalid_grant"})).await;
        assert_eq!(
            source.renew("at-1").await.unwrap_err(),
            OAuthError::InvalidGrant
        );
        assert_eq!(
            source.access_token().await.unwrap_err(),
            OAuthError::InvalidGrant
        );
    }

    /// Sends raw bytes to the loopback port and reads until it closes; whatever the other side
    /// does (answer, hang up, reset) is fine.
    async fn raw_send(port: u16, bytes: &[u8]) {
        if let Ok(mut s) = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await {
            let _ = s.write_all(bytes).await;
            let mut sink = Vec::new();
            let _ = s.read_to_end(&mut sink).await;
        }
    }

    #[tokio::test]
    async fn garbage_and_oversized_requests_do_not_end_the_login() {
        let server = MockServer::start().await;
        mount_token(
            &server,
            200,
            json!({"access_token": "at", "expires_in": 3600, "refresh_token": "rt"}),
        )
        .await;
        let mut started = start_login(oauth(&server), Duration::from_secs(30)).await;
        let port = started.port();
        let state = started.query("state");
        let began = std::time::Instant::now();

        // A head that never ends, on a connection that stays open throughout: the others
        // are served while it hangs (each connection has its own task), so the whole test
        // takes milliseconds and not the 10 s the receiver waits for a head.
        let mut _hanging = TcpStream::connect((Ipv4Addr::LOCALHOST, port))
            .await
            .unwrap();
        _hanging
            .write_all(b"GET / HTTP/1.1\r\nHost: x")
            .await
            .unwrap();

        raw_send(port, b"\x00\x01\xff not http at all\r\n\r\n").await;
        raw_send(port, b"POST / HTTP/1.1\r\nHost: x\r\n\r\n").await;
        raw_send(port, b"GET\r\n\r\n").await;
        // A head over 16 KB: dropped without an answer.
        let mut big = b"GET /?x=".to_vec();
        big.extend(std::iter::repeat_n(b'a', 20_000));
        big.extend_from_slice(b" HTTP/1.1\r\n\r\n");
        raw_send(port, &big).await;
        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut started.task)
                .await
                .is_err()
        );
        assert!(server.received_requests().await.unwrap().is_empty());

        let (status, _) = http_get(port, &format!("/?code=good&state={state}")).await;
        assert_eq!(status, 200);
        assert!(started.task.await.unwrap().is_ok());
        assert!(began.elapsed() < Duration::from_secs(3));
    }

    async fn failing_source(server: &MockServer, delay: Duration) -> TokenSource {
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(503).set_delay(delay))
            .mount(server)
            .await;
        TokenSource::new(oauth(server), REFRESH)
    }

    #[tokio::test]
    async fn waiting_callers_share_an_offline_failure_instead_of_retrying() {
        let server = MockServer::start().await;
        let source = Arc::new(failing_source(&server, Duration::from_millis(150)).await);
        let calls: Vec<_> = (0..5)
            .map(|_| {
                let s = Arc::clone(&source);
                tokio::spawn(async move { s.access_token().await })
            })
            .collect();
        for c in calls {
            assert!(matches!(c.await.unwrap(), Err(OAuthError::Offline(_))));
        }
        // And a 401 renewal right after fails at once too.
        assert!(matches!(
            source.renew("x").await,
            Err(OAuthError::Offline(_))
        ));
        assert_eq!(
            token_requests(&server.received_requests().await.unwrap()),
            1
        );
    }

    #[tokio::test]
    async fn an_offline_failure_is_forgotten_after_a_while() {
        let server = MockServer::start().await;
        let mut source = failing_source(&server, Duration::ZERO).await;
        source.failure_memory = Duration::from_millis(100);
        assert!(source.access_token().await.is_err());
        assert!(source.access_token().await.is_err());
        assert_eq!(
            token_requests(&server.received_requests().await.unwrap()),
            1
        );
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(source.access_token().await.is_err());
        assert_eq!(
            token_requests(&server.received_requests().await.unwrap()),
            2
        );
    }

    #[tokio::test]
    async fn a_failed_renewal_drops_the_token_google_rejected() {
        let server = MockServer::start().await;
        let source = TokenSource::new(oauth(&server), REFRESH);
        let ok = Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"access_token": "at-1", "expires_in": 3600})),
            )
            .mount_as_scoped(&server)
            .await;
        assert_eq!(source.access_token().await.unwrap(), "at-1");
        drop(ok);
        mount_token(&server, 503, json!({})).await;
        assert!(source.renew("at-1").await.is_err());
        // at-1 was refused: it is not handed out again as if it were fine.
        assert!(source.access_token().await.is_err());
    }

    #[tokio::test]
    async fn an_invalid_grant_is_remembered_for_good() {
        let server = MockServer::start().await;
        mount_token(&server, 400, json!({"error": "invalid_grant"})).await;
        let mut source = TokenSource::new(oauth(&server), REFRESH);
        source.failure_memory = Duration::from_millis(10);
        assert_eq!(
            source.access_token().await.unwrap_err(),
            OAuthError::InvalidGrant
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(
            source.renew("x").await.unwrap_err(),
            OAuthError::InvalidGrant
        );
        assert_eq!(
            token_requests(&server.received_requests().await.unwrap()),
            1
        );
    }
}
