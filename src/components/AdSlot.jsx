const ADS_ENABLED = import.meta.env.VITE_ADS_ENABLED === 'true'

// 広告表示用のプレースホルダー。VITE_ADS_ENABLED=true になるまでは何も描画しない。
// 有効化する際は、Google AdSense の <ins class="adsbygoogle"> スニペットをここに実装する
// (要: プライバシーポリシーページ、AdSense審査通過)。
export function AdSlot() {
  if (!ADS_ENABLED) return null

  return (
    <div className="w-full flex items-center justify-center text-xs text-muted-foreground border border-dashed rounded-md py-6 mt-4">
      広告スロット(未設定)
    </div>
  )
}
