# ログインの仕組みと設定(v1.11.1)

## ログイン状態の保存と復元

- supabase-js の既定のまま: セッションを端末(ブラウザごとの localStorage)に保存し、起動時・再読み込み・PWA の更新の後に復元する。
  アクセストークンは自動で更新し、画面に戻ったとき(visibilitychange)にも確かめ直す。複数のタブは同じセッションを共有する。
- ログインの方式は implicit(リンクにトークンが付く)。ログインのリンクを別のブラウザで開いても、そのブラウザでログインできる
  (PKCE だと、送信したブラウザでしかログインできない)。
- アプリが自分でログアウトさせるのは「この端末でサインアウト」だけ(scope: local)。それ以外で切れた場合は、ログイン画面で
  「ログインの有効期限が切れました」と知らせる。
- 再ログインが必要になる条件(仕様):
  1. Safari・Chrome・ホーム画面に追加したアプリは、保存領域が別。同じメールアドレスでログインすれば同じ家とデータになる。
     トークンを別の環境にコピーする仕組みは作らない(盗まれると乗っ取りにつながるため)。
  2. iPhone の Safari(ホーム画面に追加していない場合)は、7日間開かないサイトの保存データを消す(ITP)。ホーム画面に追加したアプリは対象外。
  3. 他の端末で「すべての端末からログアウト」された場合(管理画面などからセッションを消した場合)。

## メールに数字のコードを出す(Supabase の設定、承認後に運営者が行う)

1. Supabase ダッシュボード → Authentication → Emails → Templates →「Magic link or OTP」を開く。
2. Subject を `COOKDOOR にログイン` にし、Body を `supabase/templates/magic_link.html` の全文に置き換えて「Save changes」。
   リンクのボタンとコードの両方が入ったデザイン済みのメールになる(既存のリンクでのログインはそのまま)。
   「Confirm sign up」も同様に、Subject を `COOKDOOR へようこそ`、Body を `supabase/templates/confirm_signup.html` にする。
3. Authentication → Sign In / Providers → Email の「Email OTP Length」(コードの桁数、6〜10)と「Email OTP Expiration」(有効期限)を確認する。
   アプリは6〜10桁を受け付ける。有効期限は既定の3600秒(1時間)で十分。
4. 確かめる: ログイン画面でメールアドレスを送り、届いたメールにリンクとコードがあること、コードを入力してログインできること。

新規登録の確認メール(Confirm sign up)も、初めてログインする人に送られる。同じく `{{ .Token }}` を加えると、初回もコードでログインできる
(アプリは `verifyOtp({ type: 'email' })` で、ログインと初回登録の両方のコードを受け付ける)。

## パスキー(Face ID など)の評価 — 本番導入は承認後

| 項目 | 内容 |
| --- | --- |
| Supabase の対応 | supabase-js 2.112.3 に `signInWithPasskey` / `registerPasskey` があるが、`auth: { experimental: { passkey: true } }` が必要な実験的機能。ダッシュボードの Authentication に「Passkeys(BETA)」がある |
| 解決できること | パスキーは端末の鍵(iCloud キーチェーン / Google パスワードマネージャー)に保存され、cookdoor.app に結び付く。同じ端末の Safari・Chrome・ホーム画面のアプリのどれでも Face ID だけでログインでき、メールを開く必要がなくなる。同じ Apple ID の別の iPhone・Mac にも同期される |
| 対応環境 | iPhone の Safari・ホーム画面のアプリ(iOS 16 以降)、iPhone の Chrome(iCloud キーチェーン)、Android の Chrome、Mac の Safari・Chrome |
| 使えない環境 | LINE などのアプリ内ブラウザでは使えないことが多い。メールのリンク・コードでのログインを必ず残す |
| 流れ | 初回はメールでログイン → 設定で「パスキーを登録」→ 以後はログイン画面の「パスキーでログイン」 |
| リスク | 実験的機能なので API や挙動が予告なく変わりうる(supabase-js の版を固定し、更新時に確認する)。BETA のため障害時はメールでのログインに戻れるようにする。パスキーを失った場合の復旧もメールで行う。家族で端末を共有している場合、端末の持ち主のパスキーで入れてしまう |
| 必要な作業 | ダッシュボードで Passkeys を有効化(RP ID = cookdoor.app、許可するオリジン = https://cookdoor.app)、ログイン画面と設定画面にボタンを追加、`experimental.passkey` を有効化。DB の変更は不要の見込み |

おすすめ: まずメールのコード(上の設定)で、別のブラウザに移る問題を解消する。パスキーは、Supabase の BETA が外れるか、
試験的に運営者のアカウントだけで有効にして挙動を確かめてから、全員に広げる。
