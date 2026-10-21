# PWA更新機能 回帰テスト基準

BASKETBALL STATS の同名ドキュメント(2026-09-08)を COOKDOOR 向けに移植したもの。
BASKETBALL STATS では `registerType: 'autoUpdate'` と `clientsClaim` 未設定のため、更新通知が
本番で一度も動いていなかった。COOKDOOR も v0.0.0 までは同じ `autoUpdate` 構成だった。

## 対象となる変更

次のいずれかを変更したら、リリース前に下の5項目を本番相当ビルドで再検証する。

- `vite.config.js` の `VitePWA` 設定(`registerType`、`injectRegister`、`workbox.*`)
- `vite-plugin-pwa` のバージョン
- `src/main.jsx` の `registerSW` 呼び出し、`src/lib/swUpdate.js`
- `src/components/UpdatePrompt.jsx`(入力中の判定 `isInputRoute` と `setBusy` を含む)
- `public/version.json`、`src/lib/appVersion.js`

## 検証環境

`vite dev` は本物の Service Worker を登録しないので代わりにならない。

```bash
npm run build
npx vite preview --port 4173 --strictPort
```

見た目だけでなく、ブラウザのコンソールで内部状態も確かめる。

```js
const reg = await navigator.serviceWorker.getRegistration();
reg.waiting;                         // 新しい SW が待機中か
reg.active;                          // 現在アクティブな SW
navigator.serviceWorker.controller;  // このページを制御している SW
```

新バージョンの検知は1時間待たずに `reg.update()` を手動で実行してよい。新旧のビルドを区別するには、
動作に影響しない差分(例: `console.info` の文言)を加えて再ビルドする。

## 回帰テスト項目(5項目)

1. **通常画面でのブロッキング表示**: 新バージョン検知時に `/fridge` などにいると、閉じられない
   「新しいバージョンがあります」ダイアログが出る。
2. **入力中は非ブロッキング**: `/recipes/new` にいるとき、または調理の確定ダイアログを開いているときは、
   画面下に「入力が終わったら更新できます」のバナーだけが出て、入力を続けられる。
3. **入力終了で自動的に切り替わる**: 2 の状態から画面を離れる、またはダイアログを閉じると、
   追加の操作なしにブロッキングのダイアログに変わる。
4. **「更新する」で実際にリロードされる**: v1.33.1 から新しい SW はインストールされるとすぐ有効になる
   (`skipWaiting: true`)。新バージョン検知時に `controllerchange` が発火してダイアログが出て、`reg.waiting` は残らない。
   「更新する」で `document.querySelectorAll('script[src*="index-"]')` の JS ファイル名のハッシュが変わる。
   2分以内にもう一度押すと、SW の登録とキャッシュ(Cache Storage)を消して読み直す(ログイン状態は残る)。
5. **minSupportedVersion による強制更新**: `public/version.json` の `minSupportedVersion` を
   `package.json` の `version` より大きくすると、入力中でも「重要な更新が必要です」が出る。
   検証後は必ず元の値に戻す。

## iPhone(ホーム画面に追加した PWA)で追加で確かめること

- バックグラウンドから戻ったときに更新の検知が走る(`visibilitychange`)。
- 「更新する」の後もログイン状態と在庫が残る。

## v0.0.0 から v1.0.0 への移行時の注意

v0.0.0 の端末は自動注入の `registerSW.js` で古い Service Worker を使っている。v1.0.0 の
Service Worker は「待機」状態で止まり、古いページには「更新する」ボタンがない。
そのため v1.0.0 が有効になるのは、アプリを完全に閉じて開き直したとき。
v1.0.1 以降は、通常どおり更新通知から切り替わる。

## 検証の記録

### 2026-10-08 v1.0.0 から v1.0.1 への更新(ローカル、Chrome、`VERCEL_ENV=preview` のビルド)

v1.0.0 のビルドを配信して SW を有効にした後、同じ URL の配信内容を v1.0.1 のビルドに差し替えた。

| 確認 | 結果 |
| --- | --- |
| `reg.update()` で `reg.waiting` が installed になり、v1.0.0 の画面に「新しいバージョンがあります」 | 合格 |
| 「更新する」でリロードされ、JS のハッシュが変わり、`reg.waiting` とダイアログが消える | 合格 |
| 更新後のタイトルとログイン画面が COOKDOOR、manifest の name も COOKDOOR | 合格 |
| プリキャッシュに新アイコン(`icons/cookdoor-*`、favicon、apple-touch-icon)があり、旧 `icons/icon-*.png` と `favicon.svg` が消えている | 合格 |

### 2026-10-08 v1.0.0(ローカル、Chrome、`VERCEL_ENV=preview` のビルド)

| 項目 | 結果 | 確認方法 |
| --- | --- | --- |
| 1. ブロッキング表示 | 合格 | `reg.update()` 後に `reg.waiting` あり、「新しいバージョンがあります」 |
| 2・3. 入力中の非ブロッキングと切り替え | 単体テストのみ | ログインが必要な画面のため、Preview ビルドでは開けない。`UpdatePrompt.test.jsx` で確認 |
| 4. 「更新する」でリロード | 合格(修正後) | 初回訪問と再訪問の両方で、`reg.waiting` が消え、JS のハッシュが変わり、ダイアログが消えた |
| 5. minSupportedVersion | 合格 | ビルド成果物の `version.json` だけを 9.9.9 にして再読み込みし、「重要な更新が必要です」 |

**見つかった問題と修正**: workbox-window は「登録した時点で既に SW に制御されていたページ」でしか
自動リロードしない。初回訪問のセッション中に更新が来ると、「更新する」で新しい SW は有効になるが
ページが再読み込みされず、ダイアログが出たままになった。`swUpdate.applyUpdate` で
`controllerchange` を自分でも待ち受けてリロードするよう修正した。BASKETBALL STATS にも同じ構造がある。

**検証時の注意**:

- Chrome のウィンドウが背面にあるとタブが `hidden` になり、`visibilitychange` による検知や
  拡張機能経由のクリックが働かない。前面に出すか、ページの再読み込みで起動時のチェックを使う。
- `vite preview` の既定ポート 4173 は BASKETBALL STATS の検証と共有され、別アプリの SW が
  残っていることがある。COOKDOOR の検証では別のポート(例: 4391)を使う。

## v1.33.1: 更新の画面が繰り返し出て開けなくなる不具合

`registerType: 'prompt'` だけでは、新しい SW が「待機中」のまま有効にならない端末(iPhone のホーム画面アプリなど)で、
起動のたびに「新しいバージョンがあります」が出て、「更新する」を押しても抜け出せなかった。
- `workbox.skipWaiting: true`: インストールしたらすぐ有効にする。待機中の SW が残っている古い端末も、次の版の sw.js が
  インストールされた時点で有効になり、次の起動で新しい版が開く(ローカルで「待機中のまま」を再現して確認)
- `src/main.jsx`: 制御が新しい SW に移ったら(更新時だけ)ダイアログを出す。古い画面が消えたファイルを読み込めなかったとき
  (`vite:preloadError`)もダイアログを出す
- `src/lib/swUpdate.js` の `applyUpdate`: 待機中の SW に直接 SKIP_WAITING を送り、切り替わらなくても4秒後に必ず読み直す。
  2分以内の2回目は `hardReload`(SW の登録とキャッシュを消して読み直す)
