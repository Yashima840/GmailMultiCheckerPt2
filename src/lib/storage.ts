import { Account, DEFAULT_SETTINGS, MailItem, Settings } from "./types";

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

/** アカウント毎の未読数キャッシュ(バッジ用)。トークンとは別キーで持ち書き込み競合を避ける */
export async function getUnreadCounts(): Promise<Record<string, number>> {
  const { unreadCounts } = await chrome.storage.local.get("unreadCounts");
  return unreadCounts ?? {};
}

export async function saveUnreadCounts(counts: Record<string, number>): Promise<void> {
  await chrome.storage.local.set({ unreadCounts: counts });
}

/**
 * アカウント毎の未読メール一覧キャッシュ。ポップアップを開いた瞬間に前回の内容を
 * すぐ表示し、裏で最新化するために使う(毎回「読み込み中」を出さないため)
 */
export interface MailCacheEntry {
  mails: MailItem[];
  unreadCount: number;
  fetchedAt: number;
}

export async function getMailCache(): Promise<Record<string, MailCacheEntry>> {
  const { mailCache } = await chrome.storage.local.get("mailCache");
  return mailCache ?? {};
}

export async function saveMailCacheFor(email: string, entry: MailCacheEntry): Promise<void> {
  const cache = await getMailCache();
  cache[email] = entry;
  await chrome.storage.local.set({ mailCache: cache });
}

export async function getAccounts(): Promise<Account[]> {
  const { accounts } = await chrome.storage.local.get("accounts");
  return accounts ?? [];
}

export async function saveAccounts(accounts: Account[]): Promise<void> {
  await chrome.storage.local.set({ accounts });
}

/** 同じメールアドレスがあれば置き換え(addedAtは維持)、無ければ末尾に追加 */
export async function upsertAccount(account: Account): Promise<void> {
  const accounts = await getAccounts();
  const i = accounts.findIndex((a) => a.email === account.email);
  if (i >= 0) {
    // 再認証時は既存の表示名と追加日時を維持する
    accounts[i] = { ...account, addedAt: accounts[i].addedAt, name: accounts[i].name };
  } else {
    accounts.push(account);
  }
  await saveAccounts(accounts);
}

export async function updateAccount(email: string, patch: Partial<Account>): Promise<void> {
  const accounts = await getAccounts();
  const i = accounts.findIndex((a) => a.email === email);
  if (i >= 0) {
    accounts[i] = { ...accounts[i], ...patch };
    await saveAccounts(accounts);
  }
}

export async function removeAccount(email: string): Promise<void> {
  const accounts = await getAccounts();
  await saveAccounts(accounts.filter((a) => a.email !== email));
  // 削除アカウントのメール一覧キャッシュも掃除する
  const cache = await getMailCache();
  if (email in cache) {
    delete cache[email];
    await chrome.storage.local.set({ mailCache: cache });
  }
}
