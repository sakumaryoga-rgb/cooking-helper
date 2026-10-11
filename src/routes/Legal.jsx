import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { APP_NAME } from '@/lib/brand'
import { LEGAL_VERSIONS, LEGAL_INFO } from '@/lib/legal'
import { TELEMETRY_RETENTION_DAYS } from '@/lib/telemetry/notice'

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}年${m}月${d}日`
}

function Page({ title, children }) {
  return (
    <article className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-6 pt-safe pb-safe text-sm leading-relaxed">
      <Link to="/" className="flex items-center gap-1 self-start text-xs text-muted-foreground">
        <ChevronLeft className="size-4" />
        {APP_NAME} に戻る
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-xs text-muted-foreground">
          制定日・施行日: {formatDate(LEGAL_INFO.effectiveDate)}(版 {LEGAL_VERSIONS.terms})
        </p>
      </header>
      {children}
      <p className="border-t pt-4 text-xs text-muted-foreground">
        <Link to="/terms" className="underline">
          利用規約
        </Link>
        {' ・ '}
        <Link to="/privacy" className="underline">
          プライバシーポリシー
        </Link>
      </p>
    </article>
  )
}

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function List({ children }) {
  return <ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>
}

function Contact() {
  return (
    <Section title="お問い合わせ先">
      <p>運営者: {LEGAL_INFO.operatorName}</p>
      <p>住所: {LEGAL_INFO.addressPolicy}</p>
      <p>窓口: {LEGAL_INFO.contact}(ログインしたあと、設定の画面の下にあります)</p>
    </Section>
  )
}

export function Terms() {
  return (
    <Page title={`${APP_NAME} 利用規約`}>
      <p>
        この利用規約(以下「本規約」)は、{LEGAL_INFO.operatorName}(以下「運営者」)が提供する {APP_NAME}(以下「本サービス」)の利用条件を定めるものです。
        利用者は、本規約とプライバシーポリシーに同意したうえで本サービスを利用するものとします。
      </p>
      <Section title="第1条(適用)">
        <List>
          <li>本規約は、利用者と運営者との間の、本サービスの利用に関する一切の関係に適用されます。</li>
          <li>運営者が本サービス内で示す注意書きや案内は、本規約の一部を構成します。</li>
        </List>
      </Section>
      <Section title="第2条(本サービスの内容)">
        <p>
          本サービスは、冷蔵庫の食材とレシピを家族などのグループ(以下「家」)で共有し、今ある食材で作れる料理、買い足せば作れる料理、期限の近い食材を使う料理などを表示する機能を提供します。
        </p>
      </Section>
      <Section title="第3条(アカウントと家)">
        <List>
          <li>利用者はメールアドレスでログインします。ログイン用のメールとコードは、利用者本人が管理してください。</li>
          <li>家の食材・レシピ・調理の記録などは、同じ家のメンバー全員が閲覧・変更できます。</li>
          <li>招待リンクを知っている人は、その家に参加できます。招待リンクは信頼できる相手にだけ共有してください。招待リンクの管理が不十分なことで生じた損害について、運営者は責任を負いません。</li>
        </List>
      </Section>
      <Section title="第4条(レシピの取り込みと著作権)">
        <List>
          <li>
            レシピの URL を登録すると、本サービスは対応サイトのページから料理名・人数・材料だけを取得し、元のページへのリンクとともに保存します。
            作り方の文章や画像は保存しません。作り方は元のページで確認してください。
          </li>
          <li>各レシピの著作権は、それぞれの権利者に帰属します。本サービスは対応サイトと提携しているものではありません。</li>
          <li>利用者が自分で書いたレシピ(作り方・メモを含む)の内容は、利用者が責任を負うものとします。</li>
        </List>
      </Section>
      <Section title="第5条(禁止事項)">
        <p>利用者は、次の行為をしてはなりません。</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>法令または公序良俗に反する行為</li>
          <li>運営者、他の利用者または第三者の権利・利益を侵害する行為</li>
          <li>本サービスのサーバーやネットワークに過度な負荷をかける行為、不正にアクセスする行為</li>
          <li>レシピ取り込み機能を、対応サイトの利用規約に反する目的や、大量の自動取得に使う行為</li>
          <li>他人のメールアドレスでログインする行為、他人になりすます行為</li>
          <li>その他、運営者が本サービスの運営上不適切と合理的に判断する行為</li>
        </ul>
      </Section>
      <Section title="第6条(表示内容の扱い)">
        <List>
          <li>
            「作れる」の判定、代替食材の提案、分量の換算の目安、賞味期限・消費期限の「推定」は目安です。食品の状態や安全性、アレルギーの有無は、利用者ご自身で確認してください。
          </li>
          <li>分量の換算の目安は公開資料に基づく一般的な値で、商品や大きさによって異なります。</li>
          <li>利用者が入力した食材・数量・期限・レシピの内容と正確さは、利用者が責任を負うものとします。</li>
        </List>
      </Section>
      <Section title="第7条(データの取扱い)">
        <List>
          <li>運営者は、本サービスの提供、保存、表示、バックアップ、保守、障害対応その他運営に必要な範囲で、利用者が登録したデータを取り扱います。</li>
          <li>システムや通信の障害、外部サービスの障害、端末の故障、不可抗力などにより、データが消えたり使えなくなったりすることがあります。</li>
        </List>
      </Section>
      <Section title="第8条(料金)">
        <p>本サービスは現在無料です。有料の機能を始める場合は、内容と料金を事前に本サービス内でお知らせします。</p>
      </Section>
      <Section title="第9条(サービスの変更・停止・終了)">
        <p>
          運営者は、保守・点検、障害対応、セキュリティ上の必要、天災その他の不可抗力、外部サービスの停止、その他運営上または技術上の理由により、本サービスの全部または一部を変更、停止または終了することがあります。
          終了する場合は、可能な限り事前に本サービス内でお知らせします。
        </p>
      </Section>
      <Section title="第10条(保証の否認と責任の制限)">
        <List>
          <li>
            本サービスは現状のまま提供されます。運営者は、本サービスの完全性、正確性、継続性、特定の目的への適合性、不具合がないことなどを保証しません。
          </li>
          <li>運営者は、運営者の責めに帰すことのできない事由によって利用者に生じた損害について、責任を負いません。</li>
          <li>
            運営者の軽過失により利用者に損害が生じた場合、法令上許される範囲で、運営者が負う責任は通常かつ直接の損害に限り、特別損害、間接損害、逸失利益について責任を負いません。
          </li>
          <li>前項の制限は、運営者の故意または重大な過失による損害には適用しません。</li>
          <li>本条は、消費者契約法その他の法令により制限または無効とされる範囲を超えて、運営者の責任を免除または制限するものではありません。</li>
        </List>
      </Section>
      <Section title="第11条(利用の停止)">
        <p>運営者は、利用者が本規約に違反した場合、事前の通知なく、本サービスの利用の全部または一部を停止できるものとします。</p>
      </Section>
      <Section title="第12条(規約の変更)">
        <List>
          <li>運営者は、法令の変更、本サービスの内容の変更その他合理的な理由がある場合、本規約を変更することがあります。</li>
          <li>重要な変更を行う場合は、変更の内容と効力の発生日を本サービス内で事前にお知らせし、改めて同意をお願いします。</li>
        </List>
      </Section>
      <Section title="第13条(準拠法・裁判管轄)">
        <List>
          <li>本規約は日本法に準拠します。</li>
          <li>本サービスまたは本規約に関して紛争が生じた場合、法令に別段の定めがある場合を除き、{LEGAL_INFO.court}を第一審の専属的合意管轄裁判所とします。</li>
        </List>
      </Section>
      <Contact />
    </Page>
  )
}

export function Privacy() {
  return (
    <Page title={`${APP_NAME} プライバシーポリシー`}>
      <p>
        {LEGAL_INFO.operatorName}(以下「運営者」)は、{APP_NAME}(以下「本サービス」)での利用者の情報を、個人情報の保護に関する法律その他の法令に従い、次のとおり取り扱います。
      </p>
      <Section title="1. 取得する情報">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>メールアドレス(ログインのため)</li>
          <li>家の名前、家への所属、招待リンクの記録</li>
          <li>冷蔵庫の食材・数量・購入日・期限・常備品の設定、レシピ(料理名・人数・材料・分量・作り方・メモ・元のレシピの URL)、調理の記録、家庭で覚えた分量の換算と食材の別名</li>
          <li>
            品質改善のための記録: 日時、内部のユーザー ID と家の ID、アプリのバージョン、表示した画面、エラーの内容(伏せ字にしたもの)。料理の内容や入力した文字は含みません。
          </li>
          <li>レシピ取り込みの結果(対応サイト名と成功・失敗)</li>
          <li>お問い合わせの内容と、任意の返信先メールアドレス</li>
          <li>利用規約・プライバシーポリシーへの同意の記録(版と日時)</li>
        </ul>
        <p>位置情報、連絡先、写真は取得しません。IP アドレス・端末の情報は、配信事業者のアクセスログに残る場合を除き、本サービスとしては記録しません。</p>
      </Section>
      <Section title="2. 利用目的">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>本サービスの提供(ログイン、家族での共有、作れる料理の判定、レシピの取り込み)</li>
          <li>不具合の調査、品質の改善、利用状況の把握</li>
          <li>お問い合わせへの回答と、重要なお知らせ</li>
          <li>不正な利用の防止</li>
        </ul>
      </Section>
      <Section title="3. 保存期間">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>品質改善のための記録: {TELEMETRY_RETENTION_DAYS}日</li>
          <li>お問い合わせの返信先メールアドレス: 受付から90日を過ぎたら削除します(本文は対応の記録として残します)</li>
          <li>アカウントと家のデータ: 利用を続ける間、または削除のご依頼まで</li>
        </ul>
      </Section>
      <Section title="4. 外部サービスとデータの保存場所">
        <p>本サービスは次の事業者のサービスを使って運営しており、データはこれらの事業者の設備に保存・処理されます。</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>Supabase(データベース・ログイン。保存地域: {LEGAL_INFO.dataRegion})</li>
          <li>Vercel(アプリの配信、レシピ取り込みとお問い合わせのサーバー処理)</li>
          <li>Notion(お問い合わせの対応管理。種類・本文・受付日時を保存します。返信先のメールアドレスは送りません)</li>
        </ul>
        <p>
          レシピ取り込みでは、本サービスのサーバーが対応サイトにページを1回だけ取りに行きます。利用者の個人情報は送りません。外部の解析サービスや広告は使っていません。
          各事業者の情報の取扱いには、それぞれの規約・プライバシーポリシーが適用されます。
        </p>
      </Section>
      <Section title="5. 第三者への提供">
        <p>運営者は、利用者の情報を販売しません。次の場合を除き、本人の同意なく第三者に提供しません。</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>法令に基づく場合</li>
          <li>人の生命、身体または財産の保護のために必要で、本人の同意を得ることが難しい場合</li>
          <li>前項の外部サービスに、本サービスの運営に必要な範囲で取扱いを委託する場合</li>
        </ul>
        <p>家の食材・レシピなどは、同じ家のメンバーに表示されます。</p>
      </Section>
      <Section title="6. 安全管理">
        <p>
          運営者は、アクセスの制限(家ごとの分離)、通信の暗号化などにより、情報の漏えい、滅失、毀損の防止に努めます。ただし、インターネット上の通信や保存について、完全な安全性を保証するものではありません。
        </p>
      </Section>
      <Section title="7. 端末への保存">
        <p>
          ログイン状態、選んでいる家、開いた招待リンク、案内を閉じたことなどを、端末のブラウザ(localStorage・sessionStorage)に保存します。広告や追跡のための Cookie は使いません。
        </p>
      </Section>
      <Section title="8. 開示・訂正・削除のご依頼">
        <p>
          ご本人からの開示・訂正・利用停止・削除のご依頼は、{LEGAL_INFO.contact}から受け付けます。ご本人であることを確認したうえで、合理的な期間内(目安として30日以内)に対応します。
          法令上保存が必要な情報は、必要な期間保存することがあります。
        </p>
      </Section>
      <Section title="9. 改定">
        <p>本ポリシーを改定する場合は、内容と効力の発生日を本サービス内でお知らせし、重要な変更は改めて同意をお願いします。</p>
      </Section>
      <Contact />
    </Page>
  )
}
