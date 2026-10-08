# v1.1.1 リリース手順

DB の変更はない。

## 変更

- 「サインアウト」を押した端末だけをログアウトする(`signOut({ scope: 'local' })`)。
  ほかの端末と、同じ iPhone の Safari / ホーム画面のアプリはログインしたまま。
- メールリンクでのログイン、家族共有(グループ)は変更しない。
- Safe Area は v1.0.1 の検収で不具合の報告がないため変更しない。

## 注意

サインアウトしても、他の端末のセッションはサーバーに残る。端末をなくした場合は、
Supabase の Authentication → Users で該当ユーザーのセッションを削除する(運営者の操作)。

## Supabase Auth のメール送信者名を COOKDOOR にする(ダッシュボードでの手動操作)

1. Supabase ダッシュボード → Authentication → Emails → SMTP Settings を開く。
2. 「Sender name」を「お料理ヘルパー」から `COOKDOOR` に変える。ほかの欄は変えない。
3. 「Save changes」を押す。
4. 確認: 確認用のアドレスでログインリンクを送り、受信箱の差出人名が COOKDOOR になっていること。

件名と本文を日本語にする場合(任意): Authentication → Emails → Templates → Magic link or OTP。

```
件名: COOKDOOR ログインリンク
本文: <h2>COOKDOOR にログイン</h2>
<p>下のリンクを開くとログインできます。リンクは一度だけ使えます。</p>
<p><a href="{{ .ConfirmationURL }}">ログインする</a></p>
```

## iPhone での確認(デプロイ後)

1. 更新ダイアログで「更新する」を押し、グループ画面が「バージョン 1.1.1」になる。
2. Safari とホーム画面のアプリの両方でログインした状態で、Safari 側で「サインアウト」を押す。
3. ホーム画面のアプリを開き直し、1時間後もログインしたままであること。
