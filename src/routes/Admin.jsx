import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { Button } from '@/components/ui/button'
import { CONTACT_CATEGORIES } from '@/routes/Contact'

const GATE_MESSAGES = {
  forbidden: 'この画面は運営者だけが使えます',
  locked: 'アクセスが続けて拒否されたため、しばらく使えません',
}
const STATUS_LABELS = { open: '未対応', in_progress: '対応中', closed: '完了' }

function Table({ caption, columns, rows }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-sm font-medium">{caption}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">データがありません</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {columns.map((c) => (
                  <th key={c.key} className="px-2 py-1.5 font-normal">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className="px-2 py-1.5">
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function rate(success, total) {
  return total > 0 ? `${Math.round((success / total) * 100)}%` : '-'
}

function ContactRow({ contact, onSave }) {
  const [status, setStatus] = useState(contact.status)
  const [note, setNote] = useState(contact.admin_note ?? '')
  const [saving, setSaving] = useState(false)
  const label = CONTACT_CATEGORIES.find((c) => c.id === contact.category)?.label ?? contact.category
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {new Date(contact.created_at).toLocaleString('ja-JP')}・{label}・v{contact.app_version ?? '-'}
        </span>
        <span>{contact.reply_email ?? (contact.email_purged ? '返信先は削除済み' : '返信先なし')}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{contact.body}</p>
      <div className="flex items-center gap-2">
        <select aria-label="対応状況" className="h-8 rounded-md border bg-background px-1 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(STATUS_LABELS).map(([id, l]) => (
            <option key={id} value={id}>
              {l}
            </option>
          ))}
        </select>
        <input aria-label="対応メモ" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            await onSave(contact.id, status, note)
            setSaving(false)
          }}
        >
          保存
        </Button>
      </div>
    </li>
  )
}

// 運営者の管理画面。運営者かどうかはサーバー(admin_dashboard RPC)が判断し、運営者でなければデータを返さない
export function Admin() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [gate, setGate] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: result, error } = await supabase.rpc('admin_dashboard', { p_days: days })
    setLoading(false)
    if (error) {
      setGate('error')
      return
    }
    if (result?.error) {
      setGate(result.error)
      setData(null)
      return
    }
    setGate('ok')
    setData(result)
  }, [days])

  useEffect(() => {
    load()
  }, [load])

  async function saveContact(id, status, note) {
    const { data: result } = await supabase.rpc('admin_update_contact', { p_id: id, p_status: status, p_note: note })
    if (result === 'ok') load()
    else setGate(result ?? 'error')
  }

  if (loading && !data) return <p className="text-sm text-muted-foreground">読み込み中...</p>
  if (gate !== 'ok') return <p className="text-sm text-muted-foreground">{GATE_MESSAGES[gate] ?? '読み込めませんでした'}</p>

  const imports = data.imports ?? []
  const totals = imports.reduce((t, r) => ({ total: t.total + r.total, success: t.success + r.success }), { total: 0, success: 0 })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">管理</h1>
        <select aria-label="集計期間" className="h-8 rounded-md border bg-background px-1 text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90].map((d) => (
            <option key={d} value={d}>
              直近{d}日
            </option>
          ))}
        </select>
      </div>

      <Table
        caption="日別の利用"
        columns={[
          { key: 'day', label: '日付' },
          { key: 'users', label: '利用者' },
          { key: 'groups', label: 'グループ' },
          { key: 'page_views', label: 'PV' },
        ]}
        rows={[...(data.daily ?? [])].reverse()}
      />
      <Table
        caption="月別の利用(保存期間90日の範囲)"
        columns={[
          { key: 'month', label: '月' },
          { key: 'users', label: '利用者' },
          { key: 'groups', label: 'グループ' },
          { key: 'page_views', label: 'PV' },
        ]}
        rows={[...(data.monthly ?? [])].reverse()}
      />
      <Table
        caption="バージョン別(直近7日)"
        columns={[
          { key: 'app_version', label: 'バージョン' },
          { key: 'users', label: '利用者' },
          { key: 'page_views', label: 'PV' },
        ]}
        rows={data.versions ?? []}
      />
      <Table
        caption="日別のエラー"
        columns={[
          { key: 'day', label: '日付' },
          { key: 'errors', label: '件数' },
          { key: 'users', label: '利用者' },
        ]}
        rows={[...(data.errors_daily ?? [])].reverse()}
      />
      <Table
        caption="多いエラー"
        columns={[
          { key: 'count', label: '件数' },
          { key: 'message', label: '内容' },
          { key: 'paths', label: '画面' },
        ]}
        rows={data.errors_top ?? []}
      />
      <Table
        caption={`レシピ取り込み(成功率 ${rate(totals.success, totals.total)}${data.imports_since ? `、${new Date(data.imports_since).toLocaleDateString('ja-JP')} から計測` : '、まだ記録なし'})`}
        columns={[
          { key: 'site', label: 'サイト' },
          { key: 'total', label: '件数' },
          { key: 'success', label: '成功' },
          { key: 'rate', label: '成功率', render: (r) => rate(r.success, r.total) },
          { key: 'fetch_failed', label: '取得失敗' },
          { key: 'no_recipe_data', label: '材料なし' },
        ]}
        rows={imports}
      />

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-medium">お問い合わせ(新しい順、最大100件)</h2>
        {(data.contacts ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">お問い合わせはありません</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border bg-card">
            {data.contacts.map((c) => (
              <ContactRow key={`${c.id}-${c.status}-${c.admin_note ?? ''}`} contact={c} onSave={saveContact} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
