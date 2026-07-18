import { getSettings, updateAccount, upsertAccount } from "./storage";
import { Account } from "./types";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
];
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly needsReauth = false,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function getRedirectUri(): string {
  return chrome.identity.getRedirectURL();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body.error === "invalid_grant") {
      throw new AuthError("認証が失効しています。再認証してください。", true);
    }
    throw new AuthError(
      `トークン取得に失敗しました: ${body.error_description ?? body.error ?? res.status}`,
    );
  }
  return body as TokenResponse;
}

async function fetchEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new AuthError(`ユーザー情報の取得に失敗しました (HTTP ${res.status})`);
  const info = await res.json();
  if (!info.email) throw new AuthError("メールアドレスを取得できませんでした");
  return info.email as string;
}

/**
 * Googleのアカウント選択→同意画面を開き、選ばれたアカウントを登録する。
 * 既存アカウントを選んだ場合はトークンを更新(=再認証)する。
 */
export async function addAccountInteractive(): Promise<Account> {
  const { clientId, clientSecret } = await getSettings();
  if (!clientId || !clientSecret) {
    throw new AuthError("クライアントIDとクライアントシークレットを先に設定してください。");
  }

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", getRedirectUri());
  url.searchParams.set("scope", SCOPES.join(" "));
  // access_type=offline + prompt=consent でリフレッシュトークンを必ず取得する
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");

  const redirect = await chrome.identity.launchWebAuthFlow({
    url: url.toString(),
    interactive: true,
  });
  if (!redirect) throw new AuthError("認証がキャンセルされました");

  const params = new URL(redirect).searchParams;
  const error = params.get("error");
  if (error) throw new AuthError(`認証エラー: ${error}`);
  const code = params.get("code");
  if (!code) throw new AuthError("認証コードを取得できませんでした");

  const token = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (!token.refresh_token) {
    throw new AuthError("リフレッシュトークンを取得できませんでした。もう一度お試しください。");
  }

  const email = await fetchEmail(token.access_token);
  const account: Account = {
    email,
    refreshToken: token.refresh_token,
    accessToken: token.access_token,
    accessTokenExpiry: Date.now() + token.expires_in * 1000 - 60_000,
    needsReauth: false,
    addedAt: Date.now(),
  };
  await upsertAccount(account);
  return account;
}

/**
 * 有効なアクセストークンを返す。失効していればリフレッシュトークンで再取得。
 * リフレッシュトークン自体が失効していたらアカウントに needsReauth を立てて投げる。
 */
export async function getAccessToken(account: Account, force = false): Promise<string> {
  if (!force && account.accessToken && Date.now() < account.accessTokenExpiry) {
    return account.accessToken;
  }
  const { clientId, clientSecret } = await getSettings();
  try {
    const token = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    account.accessToken = token.access_token;
    account.accessTokenExpiry = Date.now() + token.expires_in * 1000 - 60_000;
    await updateAccount(account.email, {
      accessToken: account.accessToken,
      accessTokenExpiry: account.accessTokenExpiry,
      needsReauth: false,
    });
    return token.access_token;
  } catch (e) {
    if (e instanceof AuthError && e.needsReauth) {
      await updateAccount(account.email, { needsReauth: true });
    }
    throw e;
  }
}
