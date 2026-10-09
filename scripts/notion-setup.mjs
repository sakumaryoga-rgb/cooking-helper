#!/usr/bin/env node
// COOKDOOR のお問い合わせ用 Notion データベースを作る(1回だけ、運営者の端末で実行する)。
// 列の名前・種類・選択肢は api/contact-notify.js と一致させてある。
//
// 使い方(シークレットをチャットやリポジトリに貼らないこと。シェルの履歴に残したくない場合は read -s で入力する):
//   read -s NOTION_API_KEY && export NOTION_API_KEY
//   node scripts/notion-setup.mjs <親ページの URL か ID>
//
// - 親ページには、先に Notion の「…」→「接続」で Integration を追加しておく(しないと 404)。
// - 同じ親ページの下に「COOKDOOR お問い合わせ」があれば作らずに、その ID を表示する(何度実行しても同じ)。
// - 表示されるのは、データベース ID と、担当者に使える人のユーザー ID だけ(シークレットは表示しない)。

const NOTION_VERSION = '2022-06-28'
const TITLE = 'COOKDOOR お問い合わせ'
const key = process.env.NOTION_API_KEY
const input = process.argv[2]

if (!key || !input) {
  console.error('使い方: NOTION_API_KEY を環境変数に入れて、node scripts/notion-setup.mjs <親ページの URL か ID>')
  process.exit(1)
}

// URL の末尾の32桁(ハイフンあり・なし)をページ ID として取り出す
const match = input.replace(/-/g, '').match(/([0-9a-f]{32})(?:\?|$|#)/i) ?? input.replace(/-/g, '').match(/([0-9a-f]{32})/i)
if (!match) {
  console.error('親ページの ID が読み取れません。ページの URL をそのまま渡してください')
  process.exit(1)
}
const parentId = match[1]

async function notion(method, path, body) {
  const r = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Notion API ${r.status} ${data.code ?? ''}: ${data.message ?? ''}`)
  return data
}

const select = (names) => ({ select: { options: names.map((name) => ({ name })) } })
const schema = {
  名前: { title: {} },
  受付番号: { rich_text: {} },
  種別: select(['使い方の質問', '不具合の報告', '機能の要望', 'アカウント・データ', 'その他']),
  受信日時: { date: {} },
  内容: { rich_text: {} },
  ステータス: select(['未対応', '対応中', '完了']),
  担当者: { people: {} },
}

try {
  // 既にあるか(親ページの子ブロックからデータベースを探す)
  const children = await notion('GET', `blocks/${parentId}/children?page_size=100`)
  const existing = children.results.find((b) => b.type === 'child_database' && b.child_database?.title === TITLE)
  let databaseId = existing?.id
  if (databaseId) {
    console.log(`既にあります: ${TITLE}`)
  } else {
    const db = await notion('POST', 'databases', {
      parent: { type: 'page_id', page_id: parentId },
      title: [{ type: 'text', text: { content: TITLE } }],
      properties: schema,
    })
    databaseId = db.id
    console.log(`作成しました: ${TITLE}`)
  }

  // 列が揃っているかを確かめる
  const db = await notion('GET', `databases/${databaseId}`)
  const missing = Object.entries(schema).filter(([name, def]) => db.properties[name]?.type !== Object.keys(def)[0])
  if (missing.length) {
    console.log(`列の名前か種類が違います: ${missing.map(([n]) => n).join('、')}(Notion で直してください)`)
  }

  console.log(`\nNOTION_DATABASE_ID = ${databaseId.replace(/-/g, '')}`)
  console.log(`データベースの URL: ${db.url}`)

  // 担当者に使える人(無料プランでの通知用。NOTION_ASSIGNEE_USER_ID に入れる)
  const users = await notion('GET', 'users?page_size=100')
  const people = users.results.filter((u) => u.type === 'person')
  console.log('\n担当者に使える人(NOTION_ASSIGNEE_USER_ID の候補):')
  for (const u of people) console.log(`  ${u.name ?? '(名前なし)'}: ${u.id}`)
  if (!people.length) console.log('  見つかりません(Integration の機能で「ユーザー情報の読み取り」をオンにすると表示されます)')
} catch (e) {
  console.error(e.message)
  if (String(e.message).includes('404')) console.error('親ページに Integration が接続されていない可能性があります(ページの「…」→「接続」)')
  process.exit(1)
}
