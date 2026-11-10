import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { guardedLookup, isPublicAddress, safeFetch } from '../../../api/_lib/safeFetch.js'
import dns from 'node:dns'

describe('公開アドレスの判定', () => {
  it('社内・ループバック・リンクローカル・予約済みのアドレスは使わない', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2001:db8::1', 'not-an-ip']) {
      expect(isPublicAddress(a), a).toBe(false)
    }
    for (const a of ['93.184.216.34', '172.32.0.1', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(a), a).toBe(true)
    }
  })

  it('名前解決の結果に社内のアドレスが1つでもあれば接続しない', async () => {
    const spy = vi.spyOn(dns, 'lookup').mockImplementation((host, opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]))
    const err = await new Promise((resolve) => guardedLookup('mixed.example.com', {}, (e) => resolve(e)))
    expect(err?.code).toBe('BLOCKED_HOST')
    spy.mockImplementation((host, opts, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]))
    const ok = await new Promise((resolve) => guardedLookup('ok.example.com', {}, (e, address) => resolve(e ?? address)))
    expect(ok).toBe('93.184.216.34')
    spy.mockRestore()
  })
})

// https.request の代わり: 宛先ごとに決めた応答を返す
function fakeRequest(routes) {
  const calls = []
  const request = (opts, onResponse) => {
    const req = new EventEmitter()
    req.destroy = vi.fn()
    req.end = () => {
      calls.push(`${opts.hostname}${opts.path}`)
      const route = routes[`${opts.hostname}${opts.path}`]
      if (!route) return req.emit('error', Object.assign(new Error('nope'), { code: 'ENOTFOUND' }))
      const res = new PassThrough()
      res.statusCode = route.status ?? 200
      res.headers = route.headers ?? { 'content-type': 'text/html' }
      onResponse(res)
      res.end(route.body ?? '')
    }
    return req
  }
  return { request, calls }
}

describe('safeFetch', () => {
  const lookup = (h, o, cb) => cb(null, '93.184.216.34', 4)

  it('https のリダイレクトはたどり、gzip を展開する', async () => {
    const { request } = fakeRequest({
      'a.example.com/r': { status: 301, headers: { location: 'https://b.example.com/r2' } },
      'b.example.com/r2': { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' }, body: gzipSync('<p>ok</p>') },
    })
    expect(await safeFetch('https://a.example.com/r', { request, lookup })).toMatchObject({ body: '<p>ok</p>', url: 'https://b.example.com/r2' })
  })

  it('http・IP アドレスへのリダイレクト、回数の上限、大きすぎるページ、HTML 以外は断る', async () => {
    const { request } = fakeRequest({
      'a.example.com/http': { status: 302, headers: { location: 'http://a.example.com/x' } },
      'a.example.com/ip': { status: 302, headers: { location: 'https://169.254.169.254/latest' } },
      'a.example.com/loop': { status: 302, headers: { location: '/loop' } },
      'a.example.com/big': { body: 'x'.repeat(2000) },
      'a.example.com/pdf': { headers: { 'content-type': 'application/pdf' }, body: '%PDF' },
    })
    expect((await safeFetch('https://a.example.com/http', { request, lookup })).error).toBe('fetch_redirect')
    expect((await safeFetch('https://a.example.com/ip', { request, lookup })).error).toBe('blocked_host')
    expect((await safeFetch('https://a.example.com/loop', { request, lookup })).error).toBe('fetch_redirect')
    expect((await safeFetch('https://a.example.com/big', { request, lookup, maxBytes: 1000 })).error).toBe('fetch_size')
    expect((await safeFetch('https://a.example.com/pdf', { request, lookup })).error).toBe('fetch_type')
  })

  it('名前解決で社内のアドレスと分かったら blocked_host', async () => {
    const request = (opts) => {
      const req = new EventEmitter()
      req.destroy = vi.fn()
      req.end = () => opts.lookup('evil.example.com', {}, (e) => req.emit('error', e))
      return req
    }
    const lookupBlocked = (h, o, cb) => cb(Object.assign(new Error('blocked_host'), { code: 'BLOCKED_HOST' }))
    expect((await safeFetch('https://evil.example.com/', { request, lookup: lookupBlocked })).error).toBe('blocked_host')
  })
})
