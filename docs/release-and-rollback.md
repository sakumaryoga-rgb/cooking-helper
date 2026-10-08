# リリースとロールバックの手順

## タグの付け方

- リリースごとに `v<package.json の version>` の注釈付きタグを付ける。
- タグは main にマージした後のコミット(マージコミット)に付ける。ブランチ上のコミットには付けない。
- v1.0.0 以前の本番(88f53b5、package.json は 0.0.0)には `v0.0.0` を付けてある。
- 戻り先は「1つ前のタグ」。v1.0.1 なら `v1.0.0`(74da011)、v1.0.0 なら `v0.0.0`(88f53b5)。

```bash
git switch main && git pull
git tag -a v1.0.0 -m "COOKDOOR v1.0.0"
git push origin v1.0.0
```

## 本番を前の版に戻す(実施前に必ずユーザーの承認を得る)

戻す条件と端末側の復旧は `docs/pwa-acceptance-iphone.md` の 8 を参照。

### 方法A: Vercel の Instant Rollback(最短)

1. Vercel の Deployments で、Environment が Production の直前のデプロイを開く
   (v1.0.1 なら 74da011、v1.0.0 なら 88f53b5)。
2. メニューから「Instant Rollback」を選ぶ。ビルドは行われず、数秒で切り替わる。
3. Instant Rollback の後は、main に push しても本番ドメインが自動では切り替わらない。
   修正版を出すときは、そのデプロイを「Promote to Production」で本番に戻す。

注意: 本番デプロイの保持期間は30日。88f53b5 は 2026-08-25 のデプロイなので、v1.0.0 で本番ドメインから
外れた後、保持期間の削除対象になりうる。一覧にない、または Rollback を選べない場合は方法B を使う。

### 方法B: main で revert して再デプロイ

各版はマージコミット1つで main に入る前提。`<merge>` は戻したい版のマージコミットの SHA
(v1.0.1 は ca87aaa、v1.0.0 は 74da011)。
スカッシュマージした場合は `-m 1` を付けずに `git revert <squash のコミット>` とする。

```bash
git switch main && git pull
git revert -m 1 <merge>
npm run lint && npm test && npm run build
git push origin main        # Vercel が production として再ビルドする
```

- revert 後の main の内容が戻り先のタグと一致することを確かめる(例: `git diff v1.0.0 main --stat` が空)。
- Preview から古い版を「Promote」しない。v0.0.0 のコードには Preview で本番DBに接続しない仕組みがないため、
  古いコードの Preview ビルドは本番DBにつながる。戻すときは方法A か方法B だけを使う。

### DB について

v1.0.0 は本番DBのスキーマもデータも変更しない(migrations と schema.sql に差分なし)。
そのため、コードを戻すだけでよく、DB の復元は不要。

### 戻した後の端末

v0.0.0 の Service Worker は待機せずにすぐ有効になる。アプリを完全に終了して開き直すと古い版に戻る。
グループ画面のバージョン表示が消えていれば v0.0.0 に戻っている(v0.0.0 にはバージョン表示がない)。
