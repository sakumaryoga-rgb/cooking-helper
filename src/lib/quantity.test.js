import { describe, expect, it } from 'vitest'
import { formatQuantity, parseQuantity, snapToStock, withFraction } from './quantity'

describe('parseQuantity: 分数と小数を同じ数として読む', () => {
  it.each([
    ['1/2', 0.5],
    ['0.5', 0.5],
    ['.5', 0.5],
    ['½', 0.5],
    ['半分', 0.5],
    ['１／２', 0.5],
    ['1と1/2', 1.5],
    ['1 1/2', 1.5],
    ['1+1/2', 1.5],
    ['1½', 1.5],
    ['1.5', 1.5],
    ['3/4', 0.75],
    ['¾', 0.75],
    ['1/3', 0.333333],
    ['2', 2],
    ['２．５', 2.5],
    ['1.5/3', 0.5],
  ])('%s → %s', (text, expected) => {
    expect(parseQuantity(text)).toBe(expected)
  })

  it.each(['', 'abc', '1/0', '0', '-1', '1/', '1と', '1..2'])('%s は読めない', (text) => {
    expect(parseQuantity(text)).toBeNull()
  })

  it('ジャガイモ 1/2 と 0.5 は等しい', () => {
    expect(parseQuantity('1/2')).toBe(parseQuantity('0.5'))
    expect(parseQuantity('2/4')).toBe(parseQuantity('½'))
  })
})

describe('formatQuantity', () => {
  it('小数で割り切れるものは小数、3分の1系は分数', () => {
    expect(formatQuantity(0.5)).toBe('0.5')
    expect(formatQuantity(2)).toBe('2')
    expect(formatQuantity(0.25)).toBe('0.25')
    expect(formatQuantity(0.333333)).toBe('1/3')
    expect(formatQuantity(1.666667)).toBe('1と2/3')
    expect(formatQuantity(0)).toBe('0')
  })
})

describe('withFraction / snapToStock', () => {
  it('整数部分を残して端数を変える', () => {
    expect(withFraction('', [1, 2])).toBe('1/2')
    expect(withFraction('2', [1, 4])).toBe('2と1/4')
    expect(withFraction('1と1/2', [3, 4])).toBe('1と3/4')
  })
  it('1/3 を3回引くと、在庫がちょうど0になる', () => {
    let stock = 1
    for (let i = 0; i < 3; i++) stock = Math.round((stock - snapToStock(parseQuantity('1/3'), stock)) * 1e6) / 1e6
    expect(stock).toBe(0)
  })
  it('在庫と離れた量はそのまま', () => {
    expect(snapToStock(0.5, 2)).toBe(0.5)
  })
})
