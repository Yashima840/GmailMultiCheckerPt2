export interface Settings {
  clientId: string;
  clientSecret: string;
  /** ポーリング間隔(分) */
  pollMinutes: number;
  /** アカウント毎に一覧表示する最大件数 */
  maxResults: number;
}

export const DEFAULT_SETTINGS: Settings = {
  clientId: "",
  clientSecret: "",
  pollMinutes: 1,
  maxResults: 25,
};

export interface Account {
  email: string;
  /** 表示名(ニックネーム)。未設定ならメールアドレスを表示 */
  name?: string;
  refreshToken: string;
  accessToken: string;
  /** アクセストークンの失効時刻 (epoch ms) */
  accessTokenExpiry: number;
  /** リフレッシュトークンが失効し再認証が必要 */
  needsReauth: boolean;
  addedAt: number;
}

export interface MailItem {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  /** epoch ms */
  date: number;
  snippet: string;
  /** スター(STARREDラベル)が付いているか */
  starred: boolean;
}

export interface MailBody {
  text: string;
  isHtml: boolean;
}
