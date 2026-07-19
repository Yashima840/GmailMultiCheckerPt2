import { getInboxUnreadCount } from "./lib/gmailApi";
import {
  getAccounts,
  getSettings,
  getUnreadCounts,
  saveUnreadCounts,
} from "./lib/storage";

const ALARM_NAME = "poll";

chrome.runtime.onInstalled.addListener(() => {
  void setupAlarm();
  void updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  void setupAlarm();
  void updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void updateBadge();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "refreshBadge") {
    void updateBadge().finally(() => sendResponse(true));
    scheduleRecheck();
    return true;
  }
  if (msg?.type === "settingsChanged") {
    void setupAlarm().finally(() => sendResponse(true));
    return true;
  }
});

async function setupAlarm(): Promise<void> {
  const { pollMinutes } = await getSettings();
  const period = Math.max(1, pollMinutes || 1);
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: period,
    delayInMinutes: period,
  });
}

let updating = false;
// 実行中に届いた更新要求。捨てると最後のメール操作が反映されないため、完了後にもう一度実行する
let pending = false;
let recheckTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * メール操作直後はGmail側のラベルカウンタ(messagesUnread)の反映が遅れることが
 * あるため、少し置いてからもう一度バッジを更新して取りこぼしを吸収する。
 */
function scheduleRecheck(): void {
  if (recheckTimer !== undefined) clearTimeout(recheckTimer);
  recheckTimer = setTimeout(() => {
    recheckTimer = undefined;
    void updateBadge();
  }, 8000);
}

async function updateBadge(): Promise<void> {
  // 多重実行を防ぐ(alarmとpopupからのrefreshBadgeが重なる場合など)。
  // 実行中の要求はpendingに記録し、現在の実行が終わったら回し直す
  if (updating) {
    pending = true;
    return;
  }
  updating = true;
  try {
    do {
      pending = false;
      await fetchAndSetBadge();
    } while (pending);
  } finally {
    updating = false;
  }
}

async function fetchAndSetBadge(): Promise<void> {
  const accounts = await getAccounts();
  const counts = await getUnreadCounts();
  let hasError = false;
  // 逐次実行。同時実行だとトークン更新でstorage(accounts)の書き込みが競合し
  // 一部アカウントの取得が失敗して合計が実際より少なくなる
  for (const a of accounts) {
    if (a.needsReauth) {
      delete counts[a.email];
      continue;
    }
    try {
      counts[a.email] = await getInboxUnreadCount(a);
    } catch {
      hasError = true; // 取得失敗時は前回の値を維持する
    }
  }
  // 削除済みアカウントのキャッシュを掃除
  for (const email of Object.keys(counts)) {
    if (!accounts.some((a) => a.email === email)) delete counts[email];
  }
  await saveUnreadCounts(counts);

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const needsReauth = accounts.some((a) => a.needsReauth);
  const warn = needsReauth || hasError;
  await chrome.action.setBadgeBackgroundColor({ color: warn ? "#f9ab00" : "#d93025" });
  await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  const text = total > 0 ? String(total) : needsReauth ? "!" : "";
  await chrome.action.setBadgeText({ text });
}
