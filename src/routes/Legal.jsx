import { Link } from 'react-router-dom'
import { APP_NAME } from '@/lib/brand'
import { LEGAL_STATUS, LEGAL_VERSIONS, LEGAL_INFO, legalValue } from '@/lib/legal'
import { TELEMETRY_RETENTION_DAYS } from '@/lib/telemetry/notice'

function Page({ title, version, children }) {
  return (
    <article className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6 pt-safe text-sm leading-relaxed">
      <h1 className="text-lg font-medium">{title}</h1>
      <p className="text-xs text-muted-foreground">
        版: {version}
        {LEGAL_INFO.effectiveDate && `(${LEGAL_INFO.effectiveDate} 施行)`}
        {LEGAL_STATUS === 'draft' && <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-primary-foreground">公開前のドラフト</span>}
      </p>
      {LEGAL_STATUS === 'draft' && (
        <p className="rounded-md border border-primary bg-primary/15 px-3 py-2 text-xs">
          この文面は公開前のドラフトです。正式な規約ではありません。【未確定】の項目は、正式公開までに決めます。
        </p>
      )}
      {children}
      <p className="pt-4 text-xs text-muted-foreground">
        <Link to="/terms" className="underline">
          利用規約
        </Link>
        {' ・ '}
        <Link to="/privacy" className="underline">
          プライバシーポリシー
        </Link>
        {' ・ '}
        <Link to="/" className="underline">
          {APP_NAME} に戻る
        </Link>
      </p>
    </article>
  )
}

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  )
}

export function Terms() {
  return (
    <Page title={`${APP_NAME} 利用規約`} version={LEGAL_VERSIONS.terms}>
      <p>
        この利用規約(以下「本規約」)は、{legalValue('operatorName', '運営者名')}(以下「運営者」)が提供する {APP_NAME}(以下「本サービス」)の利用条件を定めるものです。
        利用者は、本規約に同意したうえで本サービスを利用します。
      </p>
      <Section title="第1条(本サービスの内容)">
        <p>本サービスは、冷蔵庫の在庫とレシピを家族などのグループで共有し、今ある食材で作れる料理を判定する機能を提供します。</p>
      </Section>
      <Section title="第2条(アカウントとグループ)">
        <p>利用者はメールアドレスでログインします。ログイン用のメールは本人が管理してください。</p>
        <p>グループの在庫・レシピ・調理の記録は、同じグループのメンバー全員が閲覧・変更できます。招待リンクは、信頼できる相手にだけ共有してください。</p>
      </Section>
      <Section title="第3条(レシピの取り込みと著作権)">
        <p>
          レシピの URL を登録すると、本サービスは対応サイトのページから料理名・人数・材料だけを取得し、元のページへのリンクとともに保存します。
          調理手順や画像は保存しません。作り方は元のページで確認してください。各レシピの著作権は、それぞれの権利者に帰属します。
        </p>
      </Section>
      <Section title="第4条(禁止事項)">
        <ul className="list-disc pl-5">
          <li>法令または公序良俗に反する行為</li>
          <li>本サービスや他の利用者、第三者の権利・利益を侵害する行為</li>
          <li>本サービスのサーバーやネットワークに過度な負荷をかける行為、不正にアクセスする行為</li>
          <li>レシピ取り込み機能を、対応サイトの利用規約に反する目的で使う行為</li>
          <li>その他、運営者が不適切と判断する行為</li>
        </ul>
      </Section>
      <Section title="第5条(表示内容の扱い)">
        <p>
          「作れる」の判定、代替食材の提案、賞味期限・消費期限の「推定」は目安です。食品の状態や安全性は、利用者ご自身で確認してください。
          入力された期限や在庫の数量の正確さを、運営者は保証しません。
        </p>
      </Section>
      <Section title="第6条(料金)">
        <p>本サービスは現在無料です。有料の機能を始める場合は、事前にお知らせします。</p>
      </Section>
      <Section title="第7条(サービスの変更・停止)">
        <p>運営者は、事前の通知なく本サービスの内容を変更し、または提供を停止・終了することがあります。</p>
      </Section>
      <Section title="第8条(免責)">
        <p>運営者は、本サービスの利用によって利用者に生じた損害について、運営者の故意または重大な過失による場合を除き、責任を負いません。運営者が責任を負う場合も、その額は{legalValue('liabilityCap', '責任の上限')}を上限とします。</p>
      </Section>
      <Section title="第9条(規約の変更)">
        <p>運営者は本規約を変更できます。重要な変更は本サービス内でお知らせし、改めて同意をお願いします。</p>
      </Section>
      <Section title="第10条(準拠法・管轄)">
        <p>本規約は日本法に準拠し、本サービスに関する紛争は{legalValue('court', '合意管轄裁判所')}を第一審の専属的合意管轄裁判所とします。</p>
      </Section>
      <Section title="お問い合わせ先">
        <p>{legalValue('operatorName', '運営者名')}</p>
        <p>連絡先: {legalValue('contactEmail', '連絡先メールアドレス')}(アプリ内の「お問い合わせ」からも受け付けます)</p>
      </Section>
    </Page>
  )
}

export function Privacy() {
  return (
    <Page title={`${APP_NAME} プライバシーポリシー`} version={LEGAL_VERSIONS.privacy}>
      <p>{legalValue('operatorName', '運営者名')}(以下「運営者」)は、{APP_NAME}(以下「本サービス」)での個人情報を、次のとおり取り扱います。</p>
      <Section title="1. 取得する情報">
        <ul className="list-disc pl-5">
          <li>メールアドレス(ログインのため)</li>
          <li>グループ名、グループへの所属</li>
          <li>冷蔵庫の食材・在庫の数量・購入日・期限、レシピ(料理名・人数・材料・元のレシピの URL)、調理の記録</li>
          <li>
            品質改善のための記録: 日時、内部のユーザー ID とグループ ID、アプリのバージョン、表示した画面、エラーの内容(伏せ字にしたもの)。料理の内容や入力した文字は含みません。
          </li>
          <li>レシピ取り込みの結果(対応サイト名と成功・失敗)</li>
          <li>お問い合わせの内容と、任意の返信先メールアドレス</li>
          <li>利用規約・プライバシーポリシーへの同意の記録(版と日時)</li>
        </ul>
        <p>IP アドレス・端末の機種・位置情報は、本サービスとしては記録しません(ホスティング事業者のアクセスログを除く)。</p>
      </Section>
      <Section title="2. 利用目的">
        <ul className="list-disc pl-5">
          <li>本サービスの提供(ログイン、家族での共有、作れる料理の判定)</li>
          <li>不具合の調査と品質改善、利用状況の把握</li>
          <li>お問い合わせへの回答</li>
        </ul>
      </Section>
      <Section title="3. 保存期間">
        <ul className="list-disc pl-5">
          <li>品質改善のための記録: {TELEMETRY_RETENTION_DAYS}日</li>
          <li>お問い合わせの返信先メールアドレス: 受付から90日を過ぎたら削除します(本文は対応記録として残します)</li>
          <li>アカウントとグループのデータ: 利用を続ける間、または削除の依頼まで</li>
        </ul>
      </Section>
      <Section title="4. 第三者への提供と外部サービス">
        <p>法令に基づく場合を除き、本人の同意なく第三者に提供しません。本サービスは次の事業者のサービスを使って運営しており、データはこれらの事業者の設備に保存されます。</p>
        <ul className="list-disc pl-5">
          <li>Supabase(データベース・ログイン)</li>
          <li>Vercel(アプリの配信・レシピ取り込みのサーバー処理)</li>
        </ul>
        <p>レシピ取り込みでは、本サービスのサーバーが対応サイトにページを1回だけ取りに行きます。利用者の個人情報は送りません。外部の解析サービスや広告は使っていません。データの保存地域: {legalValue('dataRegion', 'データの保存地域')}</p>
        <p>お問い合わせの通知に外部の通知サービス(Slack・Discord・メール送信サービスのいずれか)を使う場合は、種類・本文の先頭だけを送り、返信先のメールアドレスは送りません。</p>
      </Section>
      <Section title="5. 端末への保存">
        <p>ログイン状態と、開いた招待リンクを、端末のブラウザ(localStorage)に保存します。広告や追跡のための Cookie は使いません。</p>
      </Section>
      <Section title="6. 開示・訂正・削除のご依頼">
        <p>ご本人からの開示・訂正・削除のご依頼は、アプリ内の「お問い合わせ」から受け付けます。ご本人であることを確認したうえで対応します。</p>
      </Section>
      <Section title="7. 改定">
        <p>本ポリシーを改定する場合は、本サービス内でお知らせします。</p>
      </Section>
      <Section title="お問い合わせ先">
        <p>{legalValue('operatorName', '運営者名')}</p>
        <p>住所: {legalValue('addressPolicy', '住所の扱い')}</p>
        <p>連絡先: {legalValue('contactEmail', '連絡先メールアドレス')}(アプリ内の「お問い合わせ」からも受け付けます)</p>
      </Section>
    </Page>
  )
}
