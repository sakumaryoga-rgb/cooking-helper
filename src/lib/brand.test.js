import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { APP_NAME } from '@/lib/brand'

const root = path.resolve(import.meta.dirname, '../..')
const OLD_NAMES = ['お料理ヘルパー', 'Cooking Helper']

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    return statSync(p).isDirectory() ? listFiles(p) : [p]
  })
}

describe('ブランド名', () => {
  it('正式名は COOKDOOR', () => {
    expect(APP_NAME).toBe('COOKDOOR')
  })

  it('画面・HTML・manifest に旧ブランド名が残っていない', () => {
    // supabase/ の SQL コメントは DB の履歴なので対象外
    const files = [
      ...listFiles(path.join(root, 'src')).filter((p) => /\.(jsx?|css)$/.test(p) && !p.endsWith('brand.test.js')),
      path.join(root, 'index.html'),
      path.join(root, 'vite.config.js'),
    ]
    const hits = files.filter((p) => OLD_NAMES.some((name) => readFileSync(p, 'utf8').includes(name)))
    expect(hits.map((p) => path.relative(root, p))).toEqual([])
  })

  it('manifest と HTML が新しいアイコンだけを参照する', () => {
    const html = readFileSync(path.join(root, 'index.html'), 'utf8')
    const config = readFileSync(path.join(root, 'vite.config.js'), 'utf8')
    for (const old of ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png']) {
      expect(html).not.toContain(old)
      expect(config).not.toContain(old)
    }
    expect(config).toContain("purpose: 'maskable'")
    expect(html).toContain('<title>COOKDOOR</title>')
  })
})
