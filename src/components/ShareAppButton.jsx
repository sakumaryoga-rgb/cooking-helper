import { useState } from 'react'
import { Check, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'

const SHARE = {
  title: 'COOKDOOR',
  text: '冷蔵庫の食材から、今日つくれる料理がわかるアプリ。家族で在庫とレシピを共有できます',
  url: 'https://cookdoor.app/',
}

// アプリを LINE などで教える。共有先で開いた人は、LINE の中なら自動で Safari / Chrome に移る(lib/inAppBrowser)。
// 家に招待するのは「招待リンク」(家族の管理)で、ここはアプリそのものを紹介するだけ
export function ShareAppButton() {
  const [copied, setCopied] = useState(false)

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share(SHARE)
        return
      } catch (e) {
        if (e?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(`${SHARE.text}\n${SHARE.url}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Button type="button" variant="outline" className="w-full rounded-full" onClick={share}>
      {copied ? <Check /> : <Send />}
      {copied ? '紹介文と URL をコピーしました' : 'COOKDOOR を LINE などで教える'}
    </Button>
  )
}
