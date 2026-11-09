# dsh-notify-win (fork)

Windows notifications for DeepSeek Harness: a native toast plus a taskbar flash when a
turn finishes, fails, or needs your input.

> **Fork note.** Fork of [Andyqwe44/dsh-notify-win](https://github.com/Andyqwe44/dsh-notify-win)
> (MIT). Event handling, toasts, question/approval toasts, click-to-focus and the taskbar
> flash are the original author's work; the original `LICENSE` is kept unchanged.

## What the fork changes

- **Custom notification cue** — `lib/notify.wav` (kalimba) is played by the resident helper
  through `winmm!PlaySound`, so the toast keeps the system look but gets our sound.
- **No doubled sound** — the toast's own `<audio>` is muted; only the bundled cue plays.
- **Turn-start cue** — `lib/start.wav` (a double bell strike) plays when the agent picks
  a turn up. It is a sound-only notice: the helper's `sound` op plays the cue and creates
  no toast, so it does not depend on the toast focus policy and never arms the taskbar flash.
- **App-style icon** — `icon.svg` in the plugin palette; the helper registers it for the
  AppUserModelID.
- **Prebuilt helper in the package** — `lib/dsh-toast-question.exe` is committed and shipped,
  so installing from GitHub does not require a .NET SDK.

Everything else behaves like upstream; see its README for the full event table and the
answer-toast protocol.

## Requirements

- Windows 10/11;
- .NET 10 Desktop Runtime (the helper shows every toast; there is no PowerShell fallback).

## Install

In `~/.dsh/profiles/desktop/package.json`:

```json
{
  "dependencies": {
    "@machine202502/dsh-notify-win": "0.5.3-fork.1"
  },
  "dsh": { "profile": { "bundles": ["…", "@machine202502/dsh-notify-win"] } }
}
```

Then restart DSH. The plugin starts `dsh-toast-question.exe` for its lifetime.

## Configuration

Override any of these in the profile `cordis.patch.yml` under `- id: dsh-notify-win`:

```yaml
- id: dsh-notify-win
  config:
    language: auto                 # auto | ru | en | zh
    doneTitle: 'Turn finished'
    doneBody: '…'
    questionTitle: 'Input needed'
    questionBody: '…'
    dedupMs: 1500
    questionToastDuration: short   # short | long
    doneToastDuration: short
    approvalToastDuration: long
    answerPendingTimeoutMs: 30000
    showProject: true
    notifyWhenFocused: true
    notifyOnTurnStart: true
    startSoundFile: start.wav
    notifyOnCancel: true
    notifyOnError: true
    includeErrorCode: true
    helperLog: ''
```

`notifyWhenFocused`, `notifyOnTurnStart`, `notifyOnCancel`, `notifyOnError`, `showProject`,
`includeErrorCode`, `language` and the `*Title`/`*Body` strings are optional; defaults live in
`lib/index.js`.

## Languages / Языки

The default toast texts ship in three languages: **ru**, **en** and **zh**. That covers every
title and body (done, compact, question, ask, cancelled, hook-cancelled, max-tokens, blocked,
error, unknown stop, compaction failure), plus the error hints, the failure-code suffix and the
retry suffixes.

```yaml
- id: dsh-notify-win
  config:
    language: auto   # auto | ru | en | zh
```

`language: auto` (the default) follows the system locale: `Intl.DateTimeFormat()` first, then
`LC_ALL` / `LANG`, and English when neither is usable. A locale starting with `ru` or `zh`
selects that set; everything else is English. An explicit `ru`, `en` or `zh` wins over the
system locale.

Any text can still be overridden per key in the profile config, and such an override always
beats the language table:

```yaml
- id: dsh-notify-win
  config:
    language: en
    doneTitle: 'Turn finished'
    maxTokensBody: 'Hit the output ceiling — send "continue" to carry on.'
```

## Sound

The toast cue is `lib/notify.wav` next to the helper: ~0.72 s, mono, 44.1 kHz, −13 dBFS with
a smooth tail. The turn-start cue is `lib/start.wav`: two struck A5 bells 0.22 s apart with a
~1.2 s tail, so the start of a turn is unmistakably different from the completion cue. Both
are resolved next to the helper: replace a file to change the sound, or point `startSoundFile`
at another bundled cue. A missing file falls back to the system notification sound.

## Build

The helper is C# (.NET 10). To rebuild:

```bash
npm run build   # dotnet publish → copies dsh-toast-question.exe into lib/
```

Requires `dotnet` on PATH (or `DOTNET` pointing at the SDK).

## Tests

```bash
npm test        # flash policy, smoke, proof, language, helper protocol
```

## License

MIT. Upstream copyright is kept in `LICENSE`; fork changes are MIT as well.
