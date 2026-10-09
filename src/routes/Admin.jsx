import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'
import { Button } from '@/components/ui/button'
import { CONTACT_CATEGORIES } from '@/routes/Contact'
import { requestContactNotification } from '@/lib/contactNotify'

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

// 保存期間を過ぎた記録と、自動削除(pg_cron)の登録状況
function RetentionStatus({ retention }) {
  if (!retention) return <p className="text-xs text-muted-foreground">データがありません</p>
  const jobs = retention.cron_jobs ?? []
  const rows = [
    ['画面の利用記録', retention.page_views_overdue, 'purge-usage-and-error-logs', 'select * from purge_usage_and_error_logs();'],
    ['エラーの記録', retention.client_errors_overdue, 'purge-usage-and-error-logs', 'select * from purge_usage_and_error_logs();'],
    ['お問い合わせの返信先', retention.emails_overdue, 'purge-contact-emails', 'select purge_contact_emails();'],
  ]
  return (
    <ul className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-xs">
      {rows.map(([label, overdue, job, sql]) => (
        <li key={label} className="flex flex-col gap-0.5">
          <span>
            {label}: 90日を過ぎて残っている {overdue ?? 0} 件・自動削除 {jobs.includes(job) ? 'あり' : 'なし(手動)'}
          </span>
          {overdue > 0 && <code className="text-destructive">SQL Editor で {sql}</code>}
        </li>
      ))}
    </ul>
  )
}

function rate(success, total) {
  return total > 0 ? `${Math.round((success / total) * 100)}%` : '-'
}

function ContactRow({ contact, onSave, onRetryNotify }) {
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
      <p className="whitespace-pre-wrap break-words text-sm">{contact.body}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {contact.notified_at ? (
          contact.notion_page_id ? (
            <a
              className="text-muted-foreground underline"
              href={`https://www.notion.so/${contact.notion_page_id.replaceAll('-', '')}`}
              target="_blank"
              rel="noreferrer"
            >
              Notion 登録済み
            </a>
          ) : (
            <span className="text-muted-foreground">登録済み</span>
          )
        ) : contact.notify_error ? (
          <>
            <span className="text-destructive">
              Notion への登録に失敗({contact.notify_attempts}回): {contact.notify_error}
            </span>
            <Button size="sm" variant="ghost" onClick={() => onRetryNotify(contact.id)}>
              再送
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">Notion 未登録</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
  const [statusFilter, setStatusFilter] = useState('open')
  const [notifyMessage, setNotifyMessage] = useState('')

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

  async function retryNotify(id) {
    const { data: result } = await supabase.rpc('admin_retry_contact_notification', { p_id: id })
    if (result !== 'ok') {
      setGate(result ?? 'error')
      return
    }
    await notifyNow()
  }

  async function notifyNow() {
    setNotifyMessage('Notion に登録しています...')
    const result = await requestContactNotification()
    setNotifyMessage(
      result.error === 'not_configured'
        ? 'Notion の接続が設定されていません(docs/operations.md の「お問い合わせの Notion 登録」)'
        : result.error
          ? 'Notion に登録できませんでした。時間をおいて試してください'
          : `Notion に登録しました(成功 ${result.sent} 件、失敗 ${result.failed} 件)`
    )
    load()
  }

  if (loading && !data) return <p className="text-sm text-muted-foreground">読み込み中...</p>
  if (gate !== 'ok') return <p className="text-sm text-muted-foreground">{GATE_MESSAGES[gate] ?? '読み込めませんでした'}</p>

  const counts = data.contact_counts ?? {}
  const visibleContacts = (data.contacts ?? []).filter((c) => statusFilter === 'all' || c.status === statusFilter)
  const imports = data.imports ?? []
  const totals = imports.reduce((t, r) => ({ total: t.total + r.total, success: t.success + r.success }), { total: 0, success: 0 })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">
          管理
          {(counts.open ?? 0) > 0 && (
            <span className="ml-2 rounded-full bg-destructive px-2 py-0.5 text-xs text-white">未対応 {counts.open}</span>
          )}
        </h1>
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
        <h2 className="text-sm font-medium">保存期間(90日)</h2>
        <RetentionStatus retention={data.retention} />
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-medium">お問い合わせ(新しい順、最大100件)</h2>
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="対応状況で絞り込み">
          {[['open', '未対応'], ['in_progress', '対応中'], ['closed', '完了'], ['all', 'すべて']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={statusFilter === id}
              className={`rounded-full border px-3 py-1 text-xs ${statusFilter === id ? 'border-primary bg-primary text-primary-foreground font-medium' : 'bg-background text-muted-foreground'}`}
              onClick={() => setStatusFilter(id)}
            >
              {label}
              {id !== 'all' && ` ${counts[id] ?? 0}`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            Notion 未登録 {counts.unnotified ?? 0} 件(うち失敗 {counts.notify_failed ?? 0} 件)
          </span>
          {(counts.unnotified ?? 0) > 0 && (
            <Button size="sm" variant="outline" onClick={notifyNow}>
              Notion に登録
            </Button>
          )}
          {notifyMessage && <span>{notifyMessage}</span>}
        </div>
        {data.emails_overdue > 0 && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            受付から90日を過ぎても削除されていない返信先が {data.emails_overdue} 件あります。自動削除が動いていません。SQL Editor で
            「select purge_contact_emails();」を実行してください
          </p>
        )}
        {visibleContacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">該当するお問い合わせはありません</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border bg-card">
            {visibleContacts.map((c) => (
              <ContactRow key={`${c.id}-${c.status}-${c.admin_note ?? ''}-${c.notify_attempts}`} contact={c} onSave={saveContact} onRetryNotify={retryNotify} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
