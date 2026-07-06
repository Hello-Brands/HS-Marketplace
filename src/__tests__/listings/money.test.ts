import { describe, it, expect } from 'vitest'
import {
  dollarsToCents,
  centsToDollars,
  formatUsdCents,
  formatUsdCentsCompact,
} from '@/lib/money'

describe('dollarsToCents', () => {
  it('converts whole dollars to integer cents', () => {
    expect(dollarsToCents(500_000)).toBe(50_000_000)
    expect(dollarsToCents(1)).toBe(100)
  })

  it('returns 0 for 0', () => {
    expect(dollarsToCents(0)).toBe(0)
  })

  it('rounds fractional dollars to the nearest cent (no float drift)', () => {
    expect(dollarsToCents(1234.56)).toBe(123_456)
    expect(dollarsToCents(0.1)).toBe(10)
    // 19.99 * 100 = 1998.9999... in float; must round to 1999.
    expect(dollarsToCents(19.99)).toBe(1999)
  })
})

describe('centsToDollars', () => {
  it('converts cents back to dollars', () => {
    expect(centsToDollars(50_000_000)).toBe(500_000)
    expect(centsToDollars(0)).toBe(0)
    expect(centsToDollars(1999)).toBe(19.99)
  })

  it('round-trips with dollarsToCents for whole dollars', () => {
    expect(centsToDollars(dollarsToCents(250_000))).toBe(250_000)
  })
})

describe('formatUsdCents', () => {
  it('formats cents as a full USD string with thousands separators', () => {
    expect(formatUsdCents(50_000_000)).toBe('$500,000')
    expect(formatUsdCents(123_456_700)).toBe('$1,234,567')
  })

  it('formats 0 as $0', () => {
    expect(formatUsdCents(0)).toBe('$0')
  })

  it('rounds to whole dollars (no cents shown)', () => {
    expect(formatUsdCents(199_999)).toBe('$2,000')
    expect(formatUsdCents(150)).toBe('$2')
  })
})

describe('formatUsdCentsCompact', () => {
  it('abbreviates millions with one decimal + M', () => {
    expect(formatUsdCentsCompact(120_000_000)).toBe('$1.2M')
    expect(formatUsdCentsCompact(250_000_000)).toBe('$2.5M')
    expect(formatUsdCentsCompact(100_000_000)).toBe('$1.0M')
  })

  it('abbreviates thousands with k (no decimals) at the $1,000 threshold', () => {
    expect(formatUsdCentsCompact(50_000_000)).toBe('$500k')
    expect(formatUsdCentsCompact(100_000)).toBe('$1k')
  })

  it('shows the plain dollar amount below $1,000', () => {
    expect(formatUsdCentsCompact(99_900)).toBe('$999')
    expect(formatUsdCentsCompact(0)).toBe('$0')
  })

  it('uses the M form exactly at $1,000,000 and the k form just below it', () => {
    expect(formatUsdCentsCompact(100_000_000)).toBe('$1.0M')
    // $990,000 stays in the k form (toFixed(0) rounds to a whole thousands count).
    expect(formatUsdCentsCompact(99_000_000)).toBe('$990k')
  })
})
