// 対応サイト以外のページ(汎用の読み取り)を安全に取得する(SSRF 対策)
// - https だけ。ポートは 443 だけ。ドメインの形は sites.js の isPublicHostname で確かめる
// - 接続する直前に名前解決の結果を確かめ、社内・ループバック・リンクローカルなどのアドレスには接続しない
//   (確かめたアドレスにそのまま接続するので、確かめた後に名前解決の結果が変わっても社内には届かない)
// - リダイレクトは3回まで。行き先も同じ確認をする
// - 大きさ(展開後)と時間に上限をつける
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import zlib from 'node:zlib'
import { isPublicHostname } from '../../src/lib/recipeImport/sites.js'

const USER_AGENT = 'Mozilla/5.0 (compatible; COOKDOOR/1.3; +https://cookdoor.app)'

function ipv4ToInt(ip) {
  return ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0
}
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base), bits])

// 公開されたインターネット上のアドレスか(社内・予約済みのアドレスは false)
export function isPublicAddress(address) {
  const kind = net.isIP(address)
  if (kind === 4) {
    const n = ipv4ToInt(address)
    return !V4_BLOCKED.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits))
  }
  if (kind !== 6) return false
  const a = address.toLowerCase()
  // IPv4 を埋め込んだ形(::ffff:10.0.0.1 など)は IPv4 として確かめる。NAT64(64:ff9b::)は使わない
  if (a.startsWith('64:ff9b:')) return false
  const mapped = a.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPublicAddress(mapped[1])
  if (a.startsWith('::ffff:')) return false
  if (a === '::' || a === '::1') return false
  if (a.startsWith('2001:db8:') || a.startsWith('2001:0db8:')) return false // 文書用
  const first = parseInt(a.split(':')[0] || '0', 16)
  // グローバルユニキャスト(2000::/3)だけ。社内向け(fc00::/7)・リンクローカル(fe80::/10)・マルチキャスト(ff00::/8)は入らない
  return (first & 0xe000) === 0x2000
}

// 接続のときの名前解決: 公開アドレスだけを返す(1つでも社内のアドレスがあれば接続しない)
export function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err)
    const list = Array.isArray(addresses) ? addresses : []
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      const e = new Error('blocked_host')
      e.code = 'BLOCKED_HOST'
      return callback(e)
    }
    if (options?.all) return callback(null, list)
    return callback(null, list[0].address, list[0].family)
  })
}

function decoderFor(encoding) {
  switch (String(encoding ?? '').toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip()
    case 'deflate':
      return zlib.createInflate()
    case 'br':
      return zlib.createBrotliDecompress()
    default:
      return null
  }
}

function requestOnce(url, { accept, maxBytes, timeoutMs, lookup, request }) {
  return new Promise((resolve) => {
    const u = new URL(url)
    if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password || !isPublicHostname(u.hostname)) {
      resolve({ error: 'blocked_host' })
      return
    }
    let settled = false
    let timer = null
    const done = (v) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    const req = request(
      {
        protocol: 'https:',
        hostname: u.hostname,
        port: 443,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        lookup,
        headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'ja,en;q=0.5' },
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400) {
          res.resume()
          done({ redirect: res.headers.location ?? '', status })
          return
        }
        if (status < 200 || status >= 300) {
          res.resume()
          done({ error: 'fetch_status', status })
          return
        }
        const type = String(res.headers['content-type'] ?? '')
        const declared = Number(res.headers['content-length'])
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy()
          done({ error: 'fetch_size', status })
          return
        }
        const decoder = decoderFor(res.headers['content-encoding'])
        const stream = decoder ? res.pipe(decoder) : res
        const chunks = []
        let size = 0
        stream.on('data', (c) => {
          size += c.length
          if (size > maxBytes) {
            res.destroy()
            decoder?.destroy()
            done({ error: 'fetch_size', status })
            return
          }
          chunks.push(c)
        })
        stream.on('end', () => done({ status, type, body: Buffer.concat(chunks).toString('utf8') }))
        stream.on('error', () => done({ error: 'fetch_error', status }))
      }
    )
    timer = setTimeout(() => {
      req.destroy()
      done({ error: 'fetch_timeout' })
    }, timeoutMs)
    req.on('error', (e) => done({ error: e?.code === 'BLOCKED_HOST' ? 'blocked_host' : 'fetch_error' }))
    req.end()
  })
}

// 取得する。成功: { body, type, status, url(最後の URL) }。失敗: { error, status? }
// error: blocked_host / fetch_status / fetch_type / fetch_size / fetch_redirect / fetch_timeout / fetch_error
export async function safeFetch(
  url,
  {
    accept = 'text/html,application/xhtml+xml',
    maxBytes = 3 * 1024 * 1024,
    timeoutMs = 8000,
    expectType = /text\/html|application\/xhtml\+xml/i,
    lookup = guardedLookup,
    request = https.request,
    maxRedirects = 3,
  } = {}
) {
  let current = url
  for (let i = 0; i <= maxRedirects; i++) {
    const r = await requestOnce(current, { accept, maxBytes, timeoutMs, lookup, request })
    if (r.redirect !== undefined) {
      let next
      try {
        next = new URL(r.redirect, current)
      } catch {
        return { error: 'fetch_redirect', status: r.status }
      }
      if (next.protocol !== 'https:') return { error: 'fetch_redirect', status: r.status }
      current = next.toString()
      continue
    }
    if (r.error) return r
    if (expectType && !expectType.test(r.type)) return { error: 'fetch_type', status: r.status }
    return { body: r.body, type: r.type, status: r.status, url: current }
  }
  return { error: 'fetch_redirect' }
}
