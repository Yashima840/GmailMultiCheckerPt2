import {
  archive,
  getBody,
  getInboxUnreadCount,
  listUnread,
  listUnreadIds,
  markRead,
  reportSpam,
  sendMail,
  setStar,
  trash,
} from "../lib/gmailApi";
import archiveSvg from "../../icons/000.svg?raw";
import spamSvg from "../../icons/001.svg?raw";
import trashSvg from "../../icons/002.svg?raw";
import readSvg from "../../icons/003.svg?raw";
import openSvg from "../../icons/004.svg?raw";
import {
  MailCacheEntry,
  getAccounts,
  getMailCache,
  getSettings,
  saveMailCacheFor,
  updateAccount,
} from "../lib/storage";
import { Account, MailItem } from "../lib/types";

const accountsEl = document.getElementById("accounts") as HTMLElement;
const launcherEl = document.getElementById("launcher") as HTMLElement;
const toastEl = document.getElementById("toast") as HTMLElement;
const fabEl = document.getElementById("fab") as HTMLButtonElement;
const fabMenuEl = document.getElementById("fab-menu") as HTMLElement;

document.getElementById("btn-options")!.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});
document.getElementById("btn-refresh")!.addEventListener("click", () => {
  void render();
});
document.getElementById("btn-retention")!.addEventListener("click", (e) => {
  void sendRetentionMail(e.currentTarget as HTMLButtonElement);
});

// フロート作成ボタン。アカウントが1件なら直接、複数ならメニューで選んでGmail作成画面を開く
fabEl.addEventListener("click", async (e) => {
  e.stopPropagation();
  const sendable = (await getAccounts()).filter((a) => !a.needsReauth);
  if (sendable.length === 0) {
    showToast("送信可能なアカウントがありません");
    return;
  }
  if (sendable.length === 1) {
    openCompose(sendable[0]);
    return;
  }
  if (!fabMenuEl.hidden) {
    fabMenuEl.hidden = true;
    return;
  }
  fabMenuEl.textContent = "";
  for (const acc of sendable) {
    const item = el(
      "button",
      "fab-menu-item",
      acc.name ? `${acc.name} (${acc.email})` : acc.email,
    );
    item.addEventListener("click", () => {
      fabMenuEl.hidden = true;
      openCompose(acc);
    });
    fabMenuEl.appendChild(item);
  }
  fabMenuEl.hidden = false;
});
// メニュー外クリックで閉じる
document.addEventListener("click", () => {
  fabMenuEl.hidden = true;
});

function openCompose(account: Account): void {
  void chrome.tabs.create({
    url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.email)}&view=cm&fs=1&tf=1`,
  });
  window.close();
}

void render();

/**
 * Googleアカウントの無操作削除対策。登録済みの各アカウントが、
 * それぞれ自分宛に件名「アカウント保持」のメールを送信する。
 * 各アカウントが「送信」と「受信」の両方の活動を得るため保持効果が最も高い。
 */
async function sendRetentionMail(btn: HTMLButtonElement): Promise<void> {
  const accounts = await getAccounts();
  const sendable = accounts.filter((a) => !a.needsReauth);
  if (sendable.length === 0) {
    showToast(
      accounts.length === 0
        ? "アカウントが登録されていません"
        : "送信可能なアカウントがありません(全て要再認証)",
    );
    return;
  }
  const skipped = accounts.length - sendable.length;
  const ok = confirm(
    `各アカウントから保持メールを送信します。\n\n` +
      `送信アカウント数: ${sendable.length}件\n` +
      (skipped > 0 ? `(要再認証のため除外: ${skipped}件)\n` : "") +
      `\n各アカウントが自分宛にメールを送信します。よろしいですか?`,
  );
  if (!ok) return;

  btn.disabled = true;
  try {
    const now = new Date().toLocaleString("ja-JP");
    let success = 0;
    const failures: string[] = [];
    // storageのトークン更新競合を避けるため逐次送信する
    for (const acc of sendable) {
      try {
        await sendMail(acc, {
          to: [acc.email],
          bcc: [],
          subject: "アカウント保持",
          body:
            "このメールは、Googleアカウントの無操作による削除を防ぐために\n" +
            "Gmail Multi Checker から自動送信されました。\n\n" +
            `アカウント: ${acc.email}\n` +
            `送信日時: ${now}`,
        });
        success++;
      } catch {
        failures.push(acc.email);
      }
    }
    if (failures.length === 0) {
      showToast(`${success}件のアカウントから保持メールを送信しました`);
    } else {
      showToast(`送信成功 ${success}件 / 失敗 ${failures.length}件: ${failures.join(", ")}`);
    }
  } finally {
    btn.disabled = false;
  }
}

async function render(): Promise<void> {
  const accounts = await getAccounts();
  accountsEl.textContent = "";
  launcherEl.textContent = "";
  // ランチャーは2件以上のときだけ出すので、余白もそのときだけ空ける
  document.body.classList.toggle("has-launcher", accounts.length >= 2);
  if (accounts.length === 0) {
    renderEmptyState();
    return;
  }
  const { maxResults } = await getSettings();
  const cache = await getMailCache();
  for (const account of accounts) {
    const { section, count } = createAccountSection(account, maxResults, cache[account.email]);
    accountsEl.appendChild(section);
    // アカウントが2件以上のときだけ、左ランチャーに切替アバターを出す
    if (accounts.length >= 2) {
      linkMirror(count, addLauncherItem(account, section));
    }
  }
  // 開いたタイミングでツールバーのバッジも最新に更新する
  notifyBadge();
}

/** 左ランチャーに円形アバターを追加し、クリックでそのアカウントへスクロールさせる */
function addLauncherItem(account: Account, section: HTMLElement): HTMLElement {
  const item = el("button", "launcher-item");
  item.title = account.name || account.email;
  const avatar = el("span", "launcher-avatar", avatarInitial(account.name || account.email));
  avatar.style.background = avatarColor(account.email);
  const badge = el("span", "launcher-badge zero", "…");
  item.append(avatar, badge);
  item.addEventListener("click", () => {
    section.querySelector(".mail-list")?.classList.remove("collapsed");
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  launcherEl.appendChild(item);
  return badge;
}

function renderEmptyState(): void {
  const box = el("div", "empty-state");
  box.appendChild(el("div", "", "アカウントが登録されていません。"));
  box.appendChild(el("div", "", "設定画面からGoogleアカウントを追加してください。"));
  const btn = document.createElement("button");
  btn.textContent = "設定を開く";
  btn.addEventListener("click", () => void chrome.runtime.openOptionsPage());
  box.appendChild(btn);
  accountsEl.appendChild(box);
}

function createAccountSection(
  account: Account,
  maxResults: number,
  cached?: MailCacheEntry,
): { section: HTMLElement; count: HTMLElement } {
  const section = el("section", "account");

  const header = el("div", "account-header");
  // 名前(未設定ならメールアドレス)を主表示にする。クリックで名前を編集
  const label = el("span", "account-label", account.name || account.email);
  label.title = "クリックで表示名を付ける";
  const count = el("span", "account-count zero", "…");
  count.title = "クリックでこのアカウントだけ更新";
  // 名前が付いているときだけ、メールアドレスをバッジ右横に小さく薄く表示
  const emailSub = el("span", "account-email-sub", account.name ? account.email : "");
  emailSub.hidden = !account.name;
  emailSub.title = "クリックで表示名を変更";
  const spacer = el("span", "spacer");
  header.append(label, count, emailSub, spacer);

  const list = el("div", "mail-list");
  section.append(header, list);

  const openRename = async (e: Event) => {
    e.stopPropagation();
    const input = await renameDialog(account.email, account.name ?? "");
    if (input === null) return; // キャンセル
    const name = input.trim();
    account.name = name || undefined;
    void updateAccount(account.email, { name: account.name });
    label.textContent = account.name || account.email;
    emailSub.textContent = account.name ? account.email : "";
    emailSub.hidden = !account.name;
  };
  label.addEventListener("click", openRename);
  emailSub.addEventListener("click", openRename);

  // ヘッダクリックで折りたたみ。ボタン・カウント・名前・アドレスのクリックは対象外
  header.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "BUTTON" || target === count || target === label || target === emailSub)
      return;
    list.classList.toggle("collapsed");
  });

  if (account.needsReauth) {
    count.textContent = "!";
    syncMirror(count);
    const warn = el(
      "div",
      "status-line warn",
      "認証が失効しています。設定画面の「アカウント追加」から再ログインしてください。",
    );
    const btn = textButton("設定を開く", () => void chrome.runtime.openOptionsPage());
    warn.appendChild(document.createElement("br"));
    warn.appendChild(btn);
    list.appendChild(warn);
    return { section, count };
  }

  const markAllBtn = textButton("全て既読", async () => {
    markAllBtn.disabled = true;
    try {
      const ids = await listUnreadIds(account);
      await markRead(account, ids);
      list.textContent = "";
      list.appendChild(el("div", "status-line", "未読メールはありません"));
      setCount(count, 0);
      notifyBadge();
    } catch (e) {
      showToast(errorMessage(e));
    } finally {
      markAllBtn.disabled = false;
    }
  });
  header.insertBefore(markAllBtn, spacer.nextSibling);

  // カウントバッジのクリックでこのアカウントだけ再読み込み。
  // silent=true のときは既存の表示を残したまま裏で更新し「読み込み中」を出さない
  let loading = false;
  const reload = async (silent = false) => {
    if (loading) return;
    loading = true;
    count.classList.add("loading");
    if (!silent) {
      list.textContent = "";
      list.appendChild(el("div", "status-line", "読み込み中…"));
    }
    try {
      await loadAccount(account, maxResults, list, count);
    } finally {
      loading = false;
      count.classList.remove("loading");
    }
  };
  count.addEventListener("click", (e) => {
    e.stopPropagation();
    list.classList.remove("collapsed");
    void reload();
  });

  // 前回のキャッシュがあれば即表示し、更新は裏で静かに行う(毎回の「読み込み中」を回避)
  if (cached) {
    renderMailList(account, list, count, cached.mails, cached.unreadCount);
    void reload(true);
  } else {
    void reload();
  }
  return { section, count };
}

async function loadAccount(
  account: Account,
  maxResults: number,
  list: HTMLElement,
  count: HTMLElement,
): Promise<void> {
  try {
    const [mails, unreadCount] = await Promise.all([
      listUnread(account, maxResults),
      getInboxUnreadCount(account),
    ]);
    renderMailList(account, list, count, mails, unreadCount);
    // 次回ポップアップを開いた瞬間に即表示できるようキャッシュしておく
    void saveMailCacheFor(account.email, { mails, unreadCount, fetchedAt: Date.now() });
  } catch (e) {
    list.textContent = "";
    const isReauth = /再認証/.test(errorMessage(e));
    list.appendChild(el("div", "status-line warn", errorMessage(e)));
    count.textContent = isReauth ? "!" : "×";
    syncMirror(count);
  }
}

/** メール一覧(件数バッジ・行・「他 N 件」)を描画する。キャッシュ表示と取得後で共用 */
function renderMailList(
  account: Account,
  list: HTMLElement,
  count: HTMLElement,
  mails: MailItem[],
  unreadCount: number,
): void {
  setCount(count, unreadCount);
  list.textContent = "";
  if (mails.length === 0) {
    list.appendChild(el("div", "status-line", "未読メールはありません"));
    return;
  }
  for (const mail of mails) {
    list.appendChild(createMailRow(account, mail, count));
  }
  if (unreadCount > mails.length) {
    list.appendChild(
      el("div", "status-line", `他 ${unreadCount - mails.length} 件の未読があります`),
    );
  }
}

function createMailRow(account: Account, mail: MailItem, count: HTMLElement): HTMLElement {
  const row = el("div", "mail-row");
  const main = el("div", "mail-main");

  // 送信者頭文字の円形アバター(送信者ごとに色分け)
  const fromName = parseFromName(mail.from);
  const avatar = el("div", "mail-avatar", avatarInitial(fromName));
  avatar.style.background = avatarColor(mail.from);

  const body = el("div", "mail-body");
  const line1 = el("div", "mail-line1");
  line1.append(
    el("span", "mail-from", fromName),
    el("span", "mail-date", formatDate(mail.date)),
  );
  body.append(
    line1,
    el("div", "mail-subject", mail.subject || "(件名なし)"),
    el("div", "mail-snippet", decodeEntities(mail.snippet)),
  );

  main.append(avatar, body, createStar(account, mail));

  const actions = el("div", "mail-actions");
  actions.append(
    svgIconButton(archiveSvg, "アーカイブ", () => runAction(() => archive(account, mail.id))),
    svgIconButton(spamSvg, "スパム報告", () => runAction(() => reportSpam(account, mail.id))),
    svgIconButton(trashSvg, "削除(ゴミ箱へ)", () => runAction(() => trash(account, mail.id))),
    svgIconButton(readSvg, "既読にする", () => runAction(() => markRead(account, [mail.id]))),
    svgIconButton(openSvg, "Gmailで開く", () => {
      void chrome.tabs.create({
        url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.email)}#all/${mail.threadId}`,
      });
      window.close();
    }),
  );
  main.appendChild(actions);
  row.appendChild(main);

  // 楽観的更新: 行を消してから API 実行、失敗したら戻す
  function runAction(fn: () => Promise<void>): void {
    const next = row.nextSibling;
    const parent = row.parentElement!;
    row.remove();
    adjustCount(count, -1);
    if (!parent.querySelector(".mail-row")) {
      parent.appendChild(el("div", "status-line", "未読メールはありません"));
    }
    fn()
      .then(() => notifyBadge())
      .catch((e) => {
        parent.querySelector(".status-line")?.remove();
        parent.insertBefore(row, next);
        adjustCount(count, +1);
        showToast(errorMessage(e));
      });
  }

  // 行クリックで本文プレビューを開閉(初回のみ取得)
  let preview: HTMLElement | null = null;
  main.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".mail-actions")) return;
    if (preview) {
      preview.hidden = !preview.hidden;
      return;
    }
    preview = el("div", "mail-preview loading", "本文を読み込み中…");
    row.appendChild(preview);
    getBody(account, mail.id)
      .then((body) => {
        preview!.classList.remove("loading");
        preview!.textContent = body.isHtml ? htmlToText(body.text) : body.text.trim();
      })
      .catch((err) => {
        preview!.classList.remove("loading");
        preview!.textContent = errorMessage(err);
      });
  });

  return row;
}

// ---- ヘルパー ----

function el(tag: string, className = "", text = ""): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function textButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "btn-text";
  b.textContent = label;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** SVGアイコンを埋め込んだアクションボタン。色はcurrentColorでテーマに追従させる */
function svgIconButton(svg: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.innerHTML = recolorSvg(svg);
  b.title = title;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** SVG内のハードコード色(#292D32 / black)をcurrentColorに置換し、テーマ・ホバー色に追従させる */
function recolorSvg(svg: string): string {
  return svg
    .replace(/#292[dD]32/g, "currentColor")
    .replace(/(fill|stroke)="black"/g, '$1="currentColor"');
}

function setCount(count: HTMLElement, n: number): void {
  count.textContent = String(n);
  count.classList.toggle("zero", n === 0);
  syncMirror(count);
}

function adjustCount(count: HTMLElement, delta: number): void {
  const n = parseInt(count.textContent ?? "0", 10);
  if (!Number.isNaN(n)) setCount(count, Math.max(0, n + delta));
}

/** ヘッダの件数バッジと左ランチャーのバッジを連動させる */
function linkMirror(count: HTMLElement, badge: HTMLElement): void {
  (count as unknown as { _mirror?: HTMLElement })._mirror = badge;
  syncMirror(count);
}

function syncMirror(count: HTMLElement): void {
  const badge = (count as unknown as { _mirror?: HTMLElement })._mirror;
  if (!badge) return;
  const text = count.textContent ?? "";
  badge.textContent = text;
  const n = parseInt(text, 10);
  badge.classList.toggle("zero", n === 0);
  badge.classList.toggle("warn", text === "!" || text === "×");
}

/** 文字列を安定した色(HSL)に変換してアバター背景色にする */
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}deg 45% 45%)`;
}

/** 表示名から最初の英数字1文字(大文字)を取り出す。無ければ「?」 */
function avatarInitial(s: string): string {
  const m = s.match(/[\p{L}\p{N}]/u);
  return (m ? m[0] : "?").toUpperCase();
}

/** スターボタン。クリックで楽観的に表示を切り替え、失敗したら戻す */
function createStar(account: Account, mail: MailItem): HTMLButtonElement {
  const star = el("button", "mail-star") as HTMLButtonElement;
  const paint = () => {
    star.classList.toggle("on", mail.starred);
    star.textContent = mail.starred ? "★" : "☆";
    star.title = mail.starred ? "スターを外す" : "スターを付ける";
  };
  paint();
  star.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = !mail.starred;
    mail.starred = next;
    paint();
    setStar(account, mail.id, next).catch((err) => {
      mail.starred = !next;
      paint();
      showToast(errorMessage(err));
    });
  });
  return star;
}

function notifyBadge(): void {
  void chrome.runtime.sendMessage({ type: "refreshBadge" }).catch(() => {});
}

/** "表示名 <addr@example.com>" から表示名部分を取り出す */
function parseFromName(from: string): string {
  const m = from.match(/^\s*"?([^"<]*)"?\s*<.+>\s*$/);
  const name = m?.[1]?.trim();
  if (name) return name;
  return from.replace(/[<>]/g, "").trim() || "(差出人不明)";
}

function formatDate(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}/${d.getDate()}`
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** snippetはHTMLエンティティでエンコードされているためデコードする(スクリプトは実行されない) */
function decodeEntities(s: string): string {
  const doc = new DOMParser().parseFromString(s, "text/html");
  return doc.body.textContent ?? s;
}

/** HTML本文をプレーンテキスト化して安全に表示する */
function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style, script, head").forEach((n) => n.remove());
  const text = doc.body.textContent ?? "";
  return text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 表示名を編集するカスタムモーダル。OK時は入力文字列、キャンセル時はnullを返す。
 * OKボタンのある行には「このメールアドレスをコピー」ボタンを左詰めで配置する。
 */
function renameDialog(email: string, current: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = el("div", "modal-overlay");
    const dialog = el("div", "modal");

    const title = el("div", "modal-title", `「${email}」の表示名`);
    const desc = el(
      "div",
      "modal-desc",
      "空欄にするとメールアドレス表示に戻ります。",
    );

    const input = document.createElement("input");
    input.type = "text";
    input.className = "modal-input";
    input.value = current;

    const actions = el("div", "modal-actions");
    const copyBtn = textButton("このメールアドレスをコピー", () => {
      void navigator.clipboard
        .writeText(email)
        .then(() => showToast("メールアドレスをコピーしました"))
        .catch(() => showToast("コピーに失敗しました"));
    });
    const spacer = el("span", "spacer");
    const cancelBtn = textButton("キャンセル", () => close(null));
    const okBtn = textButton("OK", () => close(input.value));
    okBtn.classList.add("btn-primary");
    actions.append(copyBtn, spacer, cancelBtn, okBtn);

    dialog.append(title, desc, input, actions);
    overlay.appendChild(dialog);

    const close = (value: string | null) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close(null);
      else if (ev.key === "Enter") close(input.value);
    };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) close(null);
    });

    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

let toastTimer: number | undefined;
function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 4000);
}
