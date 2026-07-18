import { getAccessToken } from "./oauth";
import { Account, MailBody, MailItem } from "./types";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

async function apiFetch(account: Account, path: string, init: RequestInit = {}): Promise<any> {
  let token = await getAccessToken(account);
  let res = await request(path, init, token);
  if (res.status === 401) {
    // アクセストークン失効: 強制リフレッシュして1回だけリトライ
    token = await getAccessToken(account, true);
    res = await request(path, init, token);
  }
  // 429: ユーザー毎の同時リクエスト/流量制限。指数バックオフでリトライ
  for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
    await sleep(500 * 2 ** attempt + Math.random() * 300);
    res = await request(path, init, token);
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function request(path: string, init: RequestInit, token: string): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${token}`,
  };
  if (init.body) headers["Content-Type"] = "application/json";
  return fetch(`${BASE}/${path}`, { ...init, headers });
}

/** 受信トレイの未読件数(バッジ用・1リクエストで取れる) */
export async function getInboxUnreadCount(account: Account): Promise<number> {
  const label = await apiFetch(account, "labels/INBOX");
  return label.messagesUnread ?? 0;
}

/** 受信トレイの未読メール一覧(新しい順) */
export async function listUnread(account: Account, maxResults: number): Promise<MailItem[]> {
  const q = encodeURIComponent("is:unread in:inbox");
  const list = await apiFetch(account, `messages?q=${q}&maxResults=${maxResults}`);
  const ids: { id: string }[] = list.messages ?? [];
  return mapLimit(ids, 5, async ({ id }) => {
      const msg = await apiFetch(
        account,
        `messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
      const h = (name: string) =>
        headers.find((x) => x.name.toLowerCase() === name)?.value ?? "";
      return {
        id: msg.id,
        threadId: msg.threadId,
        from: h("from"),
        subject: h("subject"),
        date: Number(msg.internalDate) || Date.parse(h("date")) || 0,
        snippet: msg.snippet ?? "",
        starred: (msg.labelIds ?? []).includes("STARRED"),
      };
  });
}

/** 「全て既読」用: 表示件数を超えた分も含めて未読IDを取得(最大500件) */
export async function listUnreadIds(account: Account, max = 500): Promise<string[]> {
  const q = encodeURIComponent("is:unread in:inbox");
  const list = await apiFetch(account, `messages?q=${q}&maxResults=${max}`);
  return (list.messages ?? []).map((m: { id: string }) => m.id);
}

export async function markRead(account: Account, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await apiFetch(account, "messages/batchModify", {
    method: "POST",
    body: JSON.stringify({ ids, removeLabelIds: ["UNREAD"] }),
  });
}

/** スターの付け外し(STARREDラベルの追加/削除) */
export async function setStar(account: Account, id: string, starred: boolean): Promise<void> {
  await apiFetch(account, `messages/${id}/modify`, {
    method: "POST",
    body: JSON.stringify(
      starred ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] },
    ),
  });
}

/** アーカイブ(受信トレイから外す)。未読ラベルも同時に外す */
export async function archive(account: Account, id: string): Promise<void> {
  await apiFetch(account, `messages/${id}/modify`, {
    method: "POST",
    body: JSON.stringify({ removeLabelIds: ["UNREAD", "INBOX"] }),
  });
}

/** ゴミ箱へ移動(完全削除はしない) */
export async function trash(account: Account, id: string): Promise<void> {
  await apiFetch(account, `messages/${id}/trash`, { method: "POST" });
}

/** スパム報告(SPAMラベルを付け、受信トレイから外す) */
export async function reportSpam(account: Account, id: string): Promise<void> {
  await apiFetch(account, `messages/${id}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] }),
  });
}

/** メールを送信する。fromはaccount.email、宛先は toと bcc(いずれもメールアドレス) */
export async function sendMail(
  account: Account,
  opts: { to: string[]; bcc: string[]; subject: string; body: string },
): Promise<void> {
  const headers = [
    `From: ${account.email}`,
    opts.to.length ? `To: ${opts.to.join(", ")}` : "",
    opts.bcc.length ? `Bcc: ${opts.bcc.join(", ")}` : "",
    `Subject: ${encodeHeaderWord(opts.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const mime = headers.join("\r\n") + "\r\n\r\n" + wrap76(encodeUtf8Base64(opts.body));
  // RFC2822メッセージ全体はASCIIなのでbtoaで安全にbase64url化できる
  const raw = toBase64Url(btoa(mime));
  await apiFetch(account, "messages/send", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
}

/** UTF-8文字列を標準base64に変換 */
function encodeUtf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** 非ASCIIヘッダをRFC2047のencoded-wordにする(件名用) */
function encodeHeaderWord(s: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(s) ? s : `=?UTF-8?B?${encodeUtf8Base64(s)}?=`;
}

function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64本文をRFC2045に従い76文字ごとに改行 */
function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

/** 本文取得。text/plain優先、無ければtext/html */
export async function getBody(account: Account, id: string): Promise<MailBody> {
  const msg = await apiFetch(account, `messages/${id}?format=full`);
  const part = findBestPart(msg.payload);
  if (!part?.body?.data) return { text: "(本文がありません)", isHtml: false };
  return { text: decodeBase64Url(part.body.data), isHtml: part.mimeType === "text/html" };
}

function findBestPart(payload: any): any {
  if (!payload) return null;
  const queue = [payload];
  let html: any = null;
  while (queue.length > 0) {
    const p = queue.shift();
    if (p.mimeType === "text/plain" && p.body?.data) return p;
    if (p.mimeType === "text/html" && p.body?.data && !html) html = p;
    if (p.parts) queue.push(...p.parts);
  }
  return html;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gmail APIはユーザー毎の同時リクエスト数に制限があるため、並列数を絞って実行する */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}
