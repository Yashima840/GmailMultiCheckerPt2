# Gmail Multi Checker

アカウント数**無制限**のGmail未読チェッカーChrome拡張機能。
ツールバーアイコンをクリックすると、登録した全Googleアカウントの未読メールをアカウント毎に一覧表示し、その場で既読・アーカイブ・削除ができます(Checker Plus for Gmailの無料3アカウント制限の代替)。

## 機能

- アカウント毎の未読メール一覧(差出人・件名・スニペット・日時)
- その場で 既読 / 全て既読 / アーカイブ / 削除(ゴミ箱へ) / Gmailで開く
- クリックで本文プレビュー表示
- ツールバーアイコンに合計未読数バッジ(既定1分間隔でポーリング)
- アカウント追加はGoogleログインするだけ。登録数の上限なし

## セットアップ

初回のみGoogle Cloud側の設定(無料)が必要です。**[SETUP.md](./SETUP.md) を参照。**

## 開発

```bash
npm install
npm run icons      # アイコンPNG再生成(public/icons/)
npm run build      # dist/ にビルド → chrome://extensions で読み込み
npm run watch      # 変更監視ビルド
npm run typecheck  # 型チェック
```

## 構成

- `src/background.ts` — Service Worker(ポーリング・バッジ更新)
- `src/popup/` — ポップアップUI(未読一覧・操作)
- `src/options/` — 設定画面(クライアントID設定・アカウント管理)
- `src/lib/oauth.ts` — `chrome.identity.launchWebAuthFlow` による複数アカウントOAuth
- `src/lib/gmailApi.ts` — Gmail REST API クライアント
- `public/manifest.json` — Manifest V3

## 注意

- 個人利用前提です。クライアントシークレットとリフレッシュトークンは `chrome.storage.local` に保存されます
- Gmailのデータはこの拡張機能とGoogleのAPI以外へは一切送信されません
