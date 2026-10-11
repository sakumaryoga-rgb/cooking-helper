import { describe, expect, it } from 'vitest'
import { detectInAppBrowser, detectPlatform, externalBrowserUrl, isIosNonSafari } from './inAppBrowser'

const IOS_LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0'
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1'
const ANDROID_INSTAGRAM = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Instagram 350.0'

describe('アプリ内ブラウザの判定', () => {
  it('LINE・Instagram を見分け、Safari・Chrome はアプリ内ブラウザとみなさない', () => {
    expect(detectInAppBrowser(IOS_LINE)).toBe('LINE')
    expect(detectInAppBrowser(ANDROID_INSTAGRAM)).toBe('Instagram')
    expect(detectInAppBrowser(IOS_SAFARI)).toBeNull()
    expect(detectInAppBrowser(IOS_CHROME)).toBeNull()
  })
  it('端末とブラウザ', () => {
    expect(detectPlatform(IOS_SAFARI)).toBe('ios')
    expect(detectPlatform(ANDROID_INSTAGRAM)).toBe('android')
    expect(isIosNonSafari(IOS_CHROME)).toBe(true)
    expect(isIosNonSafari(IOS_SAFARI)).toBe(false)
  })
})

describe('標準のブラウザで開き直す URL', () => {
  it('LINE は openExternalBrowser=1 を付け、招待リンク(#invite=)はそのまま引き継ぐ', () => {
    expect(externalBrowserUrl('LINE', 'https://cookdoor.app/onboarding#invite=abc_123')).toBe('https://cookdoor.app/onboarding?openExternalBrowser=1#invite=abc_123')
    expect(externalBrowserUrl('LINE', 'https://cookdoor.app/?x=1')).toBe('https://cookdoor.app/?x=1&openExternalBrowser=1')
  })
  it('直接開く仕組みのないアプリ(Instagram など)は null(URL のコピーで案内する)', () => {
    expect(externalBrowserUrl('Instagram', 'https://cookdoor.app/')).toBeNull()
  })
})
