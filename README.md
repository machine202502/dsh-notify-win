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
    "dsh-notify-win": "github:machine202502/dsh-notify-win#main"
  },
  "dsh": { "profile": { "bundles": ["…", "dsh-notify-win"] } }
}
```

Then restart DSH. The plugin starts `dsh-toast-question.exe` for its lifetime.

## Configuration

Override any of these in the profile `cordis.patch.yml` under `- id: dsh-notify-win`:

```yaml
- id: dsh-notify-win
  config:
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
    notifyOnCancel: true
    notifyOnError: true
    includeErrorCode: true
    helperLog: ''
```

`notifyOnCancel`, `notifyOnError`, `showProject`, `includeErrorCode` and the `*Title`/`*Body`
strings are optional; defaults live in `lib/index.js`.

## Sound

The cue is `lib/notify.wav` next to the helper: ~0.72 s, mono, 44.1 kHz, −13 dBFS with a
smooth tail. Replace the file to change the sound; the helper prefers it over the system
sound and falls back to the system sound when missing.

## Build

The helper is C# (.NET 10). To rebuild:

```bash
npm run build   # dotnet publish → copies dsh-toast-question.exe into lib/
```

Requires `dotnet` on PATH (or `DOTNET` pointing at the SDK).

## Tests

```bash
npm test        # flash policy, smoke, proof, helper protocol
```

## License

MIT. Upstream copyright is kept in `LICENSE`; fork changes are MIT as well.
