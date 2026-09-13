/**
 * 投稿规则相关的纯函数测试。
 *
 * 这些模块不依赖 Vue / Vite，Node 可以直接用类型剥离运行（注意必须写全 .ts 后缀）。
 * 用法：npm run test:unit
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isEventOngoing, remainingLabel } from '../src/utils/eventWindow.ts'
import { describeUrlProblem, normalizeHttpUrl, safeHref } from '../src/utils/url.ts'

const NOW = Date.parse('2026-09-13T12:00:00.000Z')

function event(overrides = {}) {
  return {
    status: 'open',
    acceptSubmissions: true,
    startAt: '2026-09-01T00:00:00.000Z',
    endAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  }
}

/* ------------------------------------------------------------ isEventOngoing */

test('进行中的活动才允许投稿', () => {
  assert.equal(isEventOngoing(event(), NOW), true)
})

test('未开始 / 已截止的活动不算进行中', () => {
  assert.equal(isEventOngoing(event({ startAt: '2026-10-01T00:00:00.000Z' }), NOW), false)
  assert.equal(isEventOngoing(event({ endAt: '2026-09-01T00:00:00.000Z' }), NOW), false)
})

test('起止时间边界视为进行中', () => {
  const boundaryStart = Date.parse('2026-09-01T00:00:00.000Z')
  const boundaryEnd = Date.parse('2026-09-30T00:00:00.000Z')
  assert.equal(isEventOngoing(event(), boundaryStart), true)
  assert.equal(isEventOngoing(event(), boundaryEnd), true)
})

test('状态不是 open 时一律不算进行中', () => {
  for (const status of ['draft', 'upcoming', 'closed', 'archived']) {
    assert.equal(isEventOngoing(event({ status }), NOW), false, `status=${status} 不应可投稿`)
  }
})

test('关闭投稿开关后不算进行中', () => {
  assert.equal(isEventOngoing(event({ acceptSubmissions: false }), NOW), false)
})

test('缺少起止时间时按「长期开放」处理', () => {
  assert.equal(isEventOngoing(event({ startAt: undefined, endAt: undefined }), NOW), true)
  assert.equal(isEventOngoing(event({ endAt: undefined }), NOW), true)
})

/* ----------------------------------------------------------- remainingLabel */

test('剩余时间文案覆盖分钟 / 小时 / 天 / 已截止 / 长期开放', () => {
  assert.equal(remainingLabel(event({ endAt: undefined }), NOW), '长期开放')
  assert.equal(remainingLabel(event({ endAt: '2026-09-01T00:00:00.000Z' }), NOW), '已截止')
  assert.equal(remainingLabel(event({ endAt: '2026-09-13T12:00:10.000Z' }), NOW), '剩余 1 分钟')
  assert.equal(remainingLabel(event({ endAt: '2026-09-13T12:30:00.000Z' }), NOW), '剩余 30 分钟')
  assert.equal(remainingLabel(event({ endAt: '2026-09-13T17:00:00.000Z' }), NOW), '剩余 5 小时')
  assert.equal(remainingLabel(event({ endAt: '2026-09-16T12:00:00.000Z' }), NOW), '剩余 3 天')
})

/* ------------------------------------------------------------ URL 白名单 */

test('normalizeHttpUrl 只放行 http/https', () => {
  assert.equal(normalizeHttpUrl('https://example.com/a.zip'), 'https://example.com/a.zip')
  assert.equal(normalizeHttpUrl('  http://example.com  '), 'http://example.com/')
  assert.equal(normalizeHttpUrl('javascript:alert(1)'), null)
  assert.equal(normalizeHttpUrl('data:text/html;base64,QQ=='), null)
  assert.equal(normalizeHttpUrl('example.com/a.zip'), null)
  assert.equal(normalizeHttpUrl(''), null)
  assert.equal(normalizeHttpUrl(undefined), null)
})

test('safeHref 对危险链接返回空字符串', () => {
  assert.equal(safeHref('javascript:alert(1)'), '')
  assert.equal(safeHref('https://example.com/x'), 'https://example.com/x')
})

test('describeUrlProblem 给出可读的中文原因', () => {
  assert.equal(describeUrlProblem(''), '请填写链接地址。')
  assert.match(describeUrlProblem('javascript:alert(1)'), /不支持/)
  assert.match(describeUrlProblem('www.example.com/a.zip'), /http:\/\/ 或 https:\/\//)
  assert.match(describeUrlProblem('https://'), /有效的链接地址/)
  assert.equal(describeUrlProblem('https://example.com/a.zip'), null)
})
