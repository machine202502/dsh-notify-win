// Language dimension for the default toast texts.
//
// Covers the `language` setting (auto | ru | en | zh), the `auto` resolution
// chain (Intl locale -> LC_ALL/LANG -> en, ru* -> ru, zh* -> zh, else en), the
// per-key profile overrides that must win over the language table, and the
// pieces of a body that are not a plain title/body pair (project separator,
// failure code suffix, error hint, retry suffix, approval tool line).
import plugin from '../lib/index.js'
import { createHarness, ensureFakeDotnet } from './fake-helper.mjs'

await ensureFakeDotnet()

const YIELD = () => new Promise((resolve) => setTimeout(resolve, 80))

let failed = false
const assert = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra.length > 0 ? ` (${extra})` : ''}`)
  if (!ok) failed = true
}

const realDateTimeFormat = Intl.DateTimeFormat
const realEnv = { LC_ALL: process.env.LC_ALL, LANG: process.env.LANG }

/** Run `fn` with a fake Intl locale and POSIX locale environment. */
const withLocale = async ({ locale = '', LC_ALL, LANG } = {}, fn) => {
  Intl.DateTimeFormat = function fakeDateTimeFormat() {
    return { resolvedOptions: () => ({ locale }) }
  }
  if (LC_ALL === undefined) delete process.env.LC_ALL
  else process.env.LC_ALL = LC_ALL
  if (LANG === undefined) delete process.env.LANG
  else process.env.LANG = LANG
  try {
    return await fn()
  } finally {
    Intl.DateTimeFormat = realDateTimeFormat
    if (realEnv.LC_ALL === undefined) delete process.env.LC_ALL
    else process.env.LC_ALL = realEnv.LC_ALL
    if (realEnv.LANG === undefined) delete process.env.LANG
    else process.env.LANG = realEnv.LANG
  }
}

let seq = 0

/** One notification produced by a completed turn, under one config. */
const doneNote = async (config, sessionHeader = { delegationDepth: 0 }) => {
  const h = createHarness(plugin, { dedupMs: 0, ...config })
  await h.start()
  seq += 1
  const session = { id: `lang-${seq}`, header: sessionHeader }
  h.handlers['agent/status']({ status: 'idle', agent: { session } })
  await YIELD()
  const note = h.helper().writes.filter((message) => message.op === 'notify').at(-1)
  h.dispose()
  return note
}

/** One alert produced by a failed turn with retry facts, under one config. */
const errorNote = async (config) => {
  const h = createHarness(plugin, { dedupMs: 0, ...config })
  await h.start()
  seq += 1
  const session = { id: `lang-${seq}`, header: { delegationDepth: 0 } }
  h.handlers['session/event'](session, { type: 'turn/start', data: { turn: 1 } })
  h.handlers['session/event'](session, {
    type: 'llm/retry',
    data: { retry: 2, maxRetries: 3, failure: { code: 'RATE_LIMIT', message: 'busy' } },
  })
  h.handlers['session/event'](session, {
    type: 'turn/end',
    data: { turn: 1, reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: 'busy' } } },
  })
  h.handlers['agent/status']({ status: 'idle', agent: { session } })
  await YIELD()
  const note = h.helper().writes.filter((message) => message.op === 'notify').at(-1)
  h.dispose()
  return note
}

// --- 1. Explicit language picks the matching table ------------------------
{
  const zh = await doneNote({ language: 'zh' })
  assert(
    zh?.title === 'DeepSeek Harness · 任务完成' &&
      zh?.body === '任务已完成，可以查看结果。',
    'zh keeps the historical Chinese defaults',
    zh?.body,
  )

  const en = await doneNote({ language: 'en' })
  assert(
    en?.title === 'DeepSeek Harness · Task complete' &&
      en?.body === 'The task is complete — the result is ready to review.',
    'en has its own done texts',
    en?.body,
  )

  const ru = await doneNote({ language: 'ru' })
  assert(
    ru?.title === 'DeepSeek Harness · Задача выполнена' &&
      ru?.body === 'Задача выполнена, результат можно посмотреть.',
    'ru has its own done texts',
    ru?.body,
  )
}

// --- 2. auto follows the Intl locale --------------------------------------
{
  const ru = await withLocale({ locale: 'ru-RU' }, () => doneNote({ language: 'auto' }))
  assert(ru?.body === 'Задача выполнена, результат можно посмотреть.', 'auto ru-RU -> ru', ru?.body)

  const zh = await withLocale({ locale: 'zh-Hans-CN' }, () => doneNote({ language: 'auto' }))
  assert(zh?.body === '任务已完成，可以查看结果。', 'auto zh-Hans-CN -> zh', zh?.body)

  const en = await withLocale({ locale: 'de-DE' }, () => doneNote({ language: 'auto' }))
  assert(en?.body === 'The task is complete — the result is ready to review.', 'auto de-DE -> en', en?.body)
}

// --- 3. auto falls back to LC_ALL / LANG when Intl yields nothing --------
{
  const fromLang = await withLocale({ locale: '', LANG: 'ru_RU.UTF-8' }, () => doneNote({ language: 'auto' }))
  assert(fromLang?.body === 'Задача выполнена, результат можно посмотреть.', 'auto reads LANG', fromLang?.body)

  const fromLcAll = await withLocale(
    { locale: '', LC_ALL: 'zh_CN.UTF-8', LANG: 'ru_RU.UTF-8' },
    () => doneNote({ language: 'auto' }),
  )
  assert(fromLcAll?.body === '任务已完成，可以查看结果。', 'LC_ALL wins over LANG', fromLcAll?.body)

  const bare = await withLocale({ locale: '' }, () => doneNote({ language: 'auto' }))
  assert(
    bare?.body === 'The task is complete — the result is ready to review.',
    'no locale at all falls back to en',
    bare?.body,
  )

  const unsupported = await withLocale({ locale: 'fr-FR' }, () => doneNote({ language: 'auto' }))
  assert(unsupported?.body === 'The task is complete — the result is ready to review.', 'unsupported locale -> en', unsupported?.body)
}

// --- 4. An explicit ru/en/zh wins over the system locale -----------------
{
  const en = await withLocale({ locale: 'ru-RU' }, () => doneNote({ language: 'en' }))
  assert(en?.body === 'The task is complete — the result is ready to review.', 'explicit en beats a ru locale', en?.body)

  const zh = await withLocale({ locale: 'en-US' }, () => doneNote({ language: 'zh' }))
  assert(zh?.body === '任务已完成，可以查看结果。', 'explicit zh beats an en locale', zh?.body)

  const bogus = await withLocale({ locale: 'ru-RU' }, () => doneNote({ language: 'de' }))
  assert(bogus?.body === 'Задача выполнена, результат можно посмотреть.', 'an unsupported setting behaves like auto', bogus?.body)
}

// --- 5. Per-key overrides win over the language table --------------------
{
  const note = await doneNote({ language: 'en', doneTitle: 'Turn finished', doneBody: 'Custom body' })
  assert(
    note?.title === 'Turn finished' && note?.body === 'Custom body',
    'explicit per-key overrides beat the language table',
    `${note?.title} | ${note?.body}`,
  )

  const partial = await doneNote({ language: 'ru', doneTitle: 'Готово' })
  assert(
    partial?.title === 'Готово' && partial?.body === 'Задача выполнена, результат можно посмотреть.',
    'one overridden key leaves the rest in the configured language',
    partial?.body,
  )

  const empty = await doneNote({ language: 'en', doneTitle: '' })
  assert(
    empty?.title === 'DeepSeek Harness · Task complete',
    'an empty override keeps the language default',
    empty?.title,
  )
}

// --- 6. Project label separator follows the language ---------------------
{
  const { mkdtemp, mkdir, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const tmp = await mkdtemp(join(tmpdir(), 'dsh-notify-lang-'))
  const projectDir = join(tmp, 'my-project')
  await mkdir(projectDir, { recursive: true })

  try {
    const en = await doneNote({ language: 'en' }, { delegationDepth: 0, cwd: projectDir })
    assert(
      en?.body === 'my-project: The task is complete — the result is ready to review.',
      'en joins the project label with ": "',
      en?.body,
    )

    const zh = await doneNote({ language: 'zh' }, { delegationDepth: 0, cwd: projectDir })
    assert(zh?.body === 'my-project：任务已完成，可以查看结果。', 'zh keeps the full-width colon', zh?.body)

    const ru = await doneNote({ language: 'ru' }, { delegationDepth: 0, cwd: projectDir })
    assert(ru?.body?.startsWith('my-project: Задача выполнена'), 'ru joins the project label with ": "', ru?.body)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

// --- 7. Error body: localized hint, code suffix, retry suffix ------------
{
  const en = await errorNote({ language: 'en' })
  assert(
    en?.body === 'The task stopped with an error: rate limited (RATE_LIMIT) (retried 2/3 times)',
    'en error body has its own hint, code suffix and retry suffix',
    en?.body,
  )

  const ru = await errorNote({ language: 'ru' })
  assert(
    ru?.body === 'Задача остановлена с ошибкой: превышен лимит запросов (RATE_LIMIT) (повторов: 2/3)',
    'ru error body has its own hint, code suffix and retry suffix',
    ru?.body,
  )

  const zh = await errorNote({ language: 'zh' })
  assert(
    zh?.body === '任务异常停止：接口限流（RATE_LIMIT）（已重试 2/3 次）',
    'zh error body is unchanged',
    zh?.body,
  )
}

// --- 8. The approval toast's tool line follows the language --------------
{
  const runApproval = async (language) => {
    const h = createHarness(plugin, { dedupMs: 0, language })
    await h.start()
    seq += 1
    const root = { session: { id: `lang-${seq}`, header: { delegationDepth: 0 } } }
    await h.handlers['approval/request']({ agent: root, toolName: 'pwsh', reason: 'rm -rf build' }, () => 'fallback')
    await YIELD()
    const approval = h.helper().writes.find((message) => message.op === 'question' && message.approval === true)
    h.dispose()
    return approval
  }

  const en = await runApproval('en')
  assert(en?.questions?.[0]?.detail === 'Tool: pwsh', 'en approval tool line', en?.questions?.[0]?.detail)
  assert(en?.title === 'DeepSeek Harness · Confirmation needed', 'en approval title', en?.title)

  const ru = await runApproval('ru')
  assert(ru?.questions?.[0]?.detail === 'Инструмент: pwsh', 'ru approval tool line', ru?.questions?.[0]?.detail)

  const zh = await runApproval('zh')
  assert(zh?.questions?.[0]?.detail === '工具：pwsh', 'zh approval tool line is unchanged', zh?.questions?.[0]?.detail)
}

console.log(failed ? 'LANGUAGE TEST FAILED' : 'LANGUAGE TEST PASSED')
if (failed) process.exit(1)
