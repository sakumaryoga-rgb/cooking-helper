import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpenInBrowserGate, CONTINUE_KEY } from './OpenInBrowserGate'
import { InstallGuide } from './InstallGuide'

function setUA(ua) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('アプリ内ブラウザの案内', () => {
  it('LINE では「Safari で開く」を出し、このまま見ることもできる', async () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari Line/14.10.0')
    const onContinue = vi.fn()
    render(<OpenInBrowserGate appName="LINE" onContinue={onContinue} />)
    expect(screen.getByRole('button', { name: /Safari で開く/ })).toBeInTheDocument()
    expect(screen.getByText(/右下の「共有」または「…」から「Safariで開く」/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /このまま LINE の中で見る/ }))
    expect(onContinue).toHaveBeenCalled()
    expect(sessionStorage.getItem(CONTINUE_KEY)).toBe('1')
  })
  it('Instagram では URL のコピーと、メニューの場所を案内する', () => {
    setUA(ANDROID_CHROME + ' Instagram 350.0')
    render(<OpenInBrowserGate appName="Instagram" onContinue={() => {}} />)
    expect(screen.getByRole('button', { name: /URL をコピーする/ })).toBeInTheDocument()
    expect(screen.getByText(/「外部ブラウザで開く」/)).toBeInTheDocument()
  })
})

describe('ホーム画面に追加の案内', () => {
  it('iPhone の Safari では、共有ボタンからの3つの手順', () => {
    setUA(IOS_SAFARI)
    render(<InstallGuide />)
    expect(screen.getByText('画面下の共有ボタンを押す')).toBeInTheDocument()
    expect(screen.getByText('「ホーム画面に追加」を選ぶ')).toBeInTheDocument()
  })
  it('Android の Chrome では、メニューからの手順', () => {
    setUA(ANDROID_CHROME)
    render(<InstallGuide />)
    expect(screen.getByText(/「ホーム画面に追加」か「アプリをインストール」/)).toBeInTheDocument()
  })
  it('PC では出さない。閉じたら次から出さない', async () => {
    setUA(DESKTOP)
    const { container } = render(<InstallGuide />)
    expect(container).toBeEmptyDOMElement()
    setUA(IOS_SAFARI)
    const second = render(<InstallGuide dismissible />)
    await userEvent.click(screen.getByRole('button', { name: 'ホーム画面に追加の案内を閉じる' }))
    expect(second.container).toBeEmptyDOMElement()
    expect(localStorage.getItem('cookdoor:installGuideDismissed')).toBe('1')
  })
})
