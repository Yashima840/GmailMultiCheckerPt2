import { addAccountInteractive, getRedirectUri } from "../lib/oauth";
import { getAccounts, getSettings, removeAccount, saveSettings } from "../lib/storage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const redirectUriEl = $<HTMLInputElement>("redirect-uri");
const clientIdEl = $<HTMLInputElement>("client-id");
const clientSecretEl = $<HTMLInputElement>("client-secret");
const pollMinutesEl = $<HTMLInputElement>("poll-minutes");
const maxResultsEl = $<HTMLInputElement>("max-results");
const saveStatusEl = $<HTMLElement>("save-status");
const addStatusEl = $<HTMLElement>("add-status");
const accountListEl = $<HTMLElement>("account-list");

void init();

async function init(): Promise<void> {
  redirectUriEl.value = getRedirectUri();
  const s = await getSettings();
  clientIdEl.value = s.clientId;
  clientSecretEl.value = s.clientSecret;
  pollMinutesEl.value = String(s.pollMinutes);
  maxResultsEl.value = String(s.maxResults);
  await renderAccounts();
}

$<HTMLButtonElement>("copy-redirect").addEventListener("click", () => {
  void navigator.clipboard.writeText(redirectUriEl.value);
  setStatus(saveStatusEl, "コピーしました", true);
});

$<HTMLButtonElement>("btn-save").addEventListener("click", () => {
  void (async () => {
    await saveSettings({
      clientId: clientIdEl.value.trim(),
      clientSecret: clientSecretEl.value.trim(),
      pollMinutes: clamp(parseInt(pollMinutesEl.value, 10) || 1, 1, 60),
      maxResults: clamp(parseInt(maxResultsEl.value, 10) || 25, 5, 100),
    });
    await chrome.runtime.sendMessage({ type: "settingsChanged" }).catch(() => {});
    setStatus(saveStatusEl, "保存しました", true);
  })();
});

$<HTMLButtonElement>("btn-add-account").addEventListener("click", (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  setStatus(addStatusEl, "Googleのログイン画面を開いています…", true);
  addAccountInteractive()
    .then(async (account) => {
      setStatus(addStatusEl, `${account.email} を追加しました`, true);
      await renderAccounts();
      await chrome.runtime.sendMessage({ type: "refreshBadge" }).catch(() => {});
    })
    .catch((err) => {
      setStatus(addStatusEl, err instanceof Error ? err.message : String(err), false);
    })
    .finally(() => {
      btn.disabled = false;
    });
});

async function renderAccounts(): Promise<void> {
  const accounts = await getAccounts();
  accountListEl.textContent = "";
  if (accounts.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "登録済みアカウントはありません。";
    accountListEl.appendChild(p);
    return;
  }
  for (const account of accounts) {
    const item = document.createElement("div");
    item.className = "account-item";

    const email = document.createElement("span");
    email.className = "email";
    email.textContent = account.email;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `追加日: ${new Date(account.addedAt).toLocaleDateString("ja-JP")}`;

    item.append(email, meta);

    if (account.needsReauth) {
      const warn = document.createElement("span");
      warn.className = "reauth";
      warn.textContent = "要再認証";
      item.appendChild(warn);
    }

    const del = document.createElement("button");
    del.className = "btn";
    del.textContent = "削除";
    del.addEventListener("click", () => {
      if (!confirm(`${account.email} を削除しますか?(メール自体は削除されません)`)) return;
      void removeAccount(account.email).then(async () => {
        await renderAccounts();
        await chrome.runtime.sendMessage({ type: "refreshBadge" }).catch(() => {});
      });
    });
    item.appendChild(del);

    accountListEl.appendChild(item);
  }
}

function setStatus(el: HTMLElement, message: string, ok: boolean): void {
  el.textContent = message;
  el.className = `status ${ok ? "ok" : "error"}`;
  if (ok) {
    setTimeout(() => {
      if (el.textContent === message) el.textContent = "";
    }, 4000);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
