using System.Collections.Concurrent;

namespace DshToastQuestion;

static partial class Program
{

    [System.Runtime.InteropServices.DllImport("winmm.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    static extern bool PlaySound(string name, IntPtr module, uint flags);

    /// <summary>SND_ASYNC | SND_FILENAME | SND_NODEFAULT: fire and forget.</summary>
    const uint SoundFlags = 0x00020001;

    /// <summary>SND_SYNC | SND_FILENAME | SND_NODEFAULT, played from the cue thread.</summary>
    const uint SoundFlagsSync = 0x00020002;

    /// <summary>
    /// Cues waiting to be played. winmm's PlaySound owns ONE playback channel per
    /// process, so a second call cuts the first short. A completion cue and a
    /// turn-start cue arriving together therefore truncated each other; every cue
    /// is queued here instead and played to its end by one worker thread.
    /// </summary>
    static readonly BlockingCollection<string> CueQueue = new(new ConcurrentQueue<string>(), 8);
    static readonly object CueThreadLock = new();
    static Thread? _cueThread;

    /// <summary>Queue one resolved cue file; the worker plays them strictly in order.</summary>
    static void EnqueueCue(string path)
    {
        lock (CueThreadLock)
        {
            if (_cueThread is null || !_cueThread.IsAlive)
            {
                _cueThread = new Thread(CueLoop) { IsBackground = true, Name = "dsh-cue-queue" };
                _cueThread.Start();
            }
        }
        if (!CueQueue.TryAdd(path))
        {
            // A burst of turns must not become a long jingle: drop the newcomer
            // instead of delaying everything already queued behind it.
            Log("cue dropped (queue full): " + Path.GetFileName(path));
        }
    }

    /// <summary>Play queued cues one by one, each to its own end.</summary>
    static void CueLoop()
    {
        foreach (string path in CueQueue.GetConsumingEnumerable())
        {
            string name = Path.GetFileName(path);
            long expected = ExpectedCueMs(path);
            Log($"cue: {name} (~{expected} ms, pending {CueQueue.Count})");
            var clock = Stopwatch.StartNew();
            PlaySound(path, IntPtr.Zero, SoundFlagsSync);
            clock.Stop();
            // A trimmed playback is the diagnostic that matters: SND_SYNC must
            // run roughly as long as the file, otherwise something stopped it.
            Log($"cue end: {name} after {clock.ElapsedMilliseconds} ms");
        }
    }

    /// <summary>Rough length of a 44.1 kHz mono 16-bit wav in ms, for diagnostics.</summary>
    static long ExpectedCueMs(string path)
    {
        try
        {
            long bytes = new FileInfo(path).Length - 44;
            return bytes <= 0 ? 0 : (long)Math.Round(bytes / 88200.0 * 1000);
        }
        catch
        {
            return 0;
        }
    }

    /// <summary>Let the cue thread drain and stop once the helper is going away.</summary>
    static void StopCues()
    {
        try { CueQueue.CompleteAdding(); } catch { }
    }

    /// <summary>
    /// Resolve a cue that sits next to the helper: the requested file when it
    /// exists, else the bundled notify.wav, else the first matching Windows
    /// system cue. An empty string means nothing playable was found.
    /// </summary>
    static string ResolveCue(string? name)
    {
        if (!string.IsNullOrWhiteSpace(name))
        {
            // Only a bare file name is honoured: a host-supplied string must
            // never become an arbitrary path the helper would play.
            string requested = Path.Combine(AppContext.BaseDirectory, Path.GetFileName(name!));
            if (File.Exists(requested)) return requested;
        }
        string bundled = Path.Combine(AppContext.BaseDirectory, "notify.wav");
        if (File.Exists(bundled)) return bundled;
        string media = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Media");
        foreach (string candidate in new[] { "Windows Notify System Generic.wav", "Windows Notify.wav", "notify.wav" })
        {
            string path = Path.Combine(media, candidate);
            if (File.Exists(path)) return path;
        }
        return "";
    }

    /// <summary>Play the notification cue (bundled notify.wav) for a toast.</summary>
    static void PlayNotificationSound() => PlayCue(null);

    /// <summary>
    /// Play one cue file and nothing else — the "sound only" op. No toast, no
    /// taskbar flash and no focus gate: the host decides when a cue is wanted,
    /// so the cue must not depend on which window happens to be in front.
    /// The file is queued, never played directly, so it cannot cut a cue short.
    /// </summary>
    static void PlayCue(string? name)
    {
        if (!SoundEnabled) return;
        string path = ResolveCue(name);
        if (path.Length == 0)
        {
            Log("cue unavailable: " + (name ?? "notify.wav"));
            return;
        }
        EnqueueCue(path);
    }

    // ---------------------------------------------------------------------
    // Non-interactive notifications (done / compact / alert / notice /
    // approval). They are shown by this process so Activated and Dismissed are
    // available: the flash starts only after Windows times the toast out, and
    // clicking the toast focuses DSH. The toast's own `launch` argument also
    // covers the cold path where Windows starts this exe just for the click.
    // ---------------------------------------------------------------------
    static void ShowNotification(InboundMessage message)
    {
        if (!NotifyWhenFocused && TestDshWindowFocused())
        {
            Log("notify skipped: DSH is focused");
            return;
        }

        PlayNotificationSound();

        string title = message.Title ?? "";
        string body = message.Body ?? "";
        string duration = string.Equals(message.Duration, "long", StringComparison.OrdinalIgnoreCase) ? "long" : "short";
        string launch = string.IsNullOrEmpty(message.Launch) ? "--focus" : message.Launch!;

        var sb = new StringBuilder();
        // The toast schema has no activationType attribute; `launch` is passed
        // to this app on a normal (foreground) activation, which is exactly what
        // `--focus` needs. A cold click starts this exe with that argument.
        sb.Append("<toast launch=\"").Append(XmlEscape(launch))
          .Append("\" duration=\"").Append(duration)
          .Append("\"><visual><binding template=\"ToastGeneric\">");
        sb.Append("<text>").Append(XmlEscape(title)).Append("</text>");
        sb.Append("<text>").Append(XmlEscape(body)).Append("</text>");
        sb.Append("</binding></visual>");
        // Explicit sound: without this element Windows may show the toast silently.
        sb.Append("<audio silent=\"true\" />");
        sb.Append("</toast>");

        try
        {
            var doc = new XmlDocument();
            doc.LoadXml(sb.ToString());
            string tag = "dsh-n-" + Interlocked.Increment(ref _notifyTagSeq).ToString();
            var toast = new ToastNotification(doc)
            {
                Tag = tag,
                Group = NotifyGroup,
            };
            Track(tag);
            toast.Activated += (sender, eventArgs) =>
            {
                StopTaskbarFlash();
                FocusDsh();
            };
            toast.Dismissed += (sender, eventArgs) =>
            {
                if (eventArgs.Reason == ToastDismissalReason.TimedOut) FlashTaskbar();
            };
            if (!ShowToast(toast))
            {
                Log("notify toast failed; falling back to balloon");
                ShowBalloon(title, body);
            }
            Log("notify: kind=" + (message.Kind ?? "") + " tag=" + tag +
                " reason=" + (message.Reason ?? "") + " code=" + (message.Code ?? ""));
        }
        catch (Exception error)
        {
            Log("notify failed: " + error.Message);
            ShowBalloon(title, body);
        }
    }

    /// <summary>
    /// Show a toast with the branded identity, falling back to the PowerShell
    /// identity only if the branded notifier cannot be created. There is no
    /// script host anywhere in the notification path.
    /// </summary>
    static bool ShowToast(ToastNotification toast)
    {
        foreach (string appId in ToastIdentities)
        {
            try
            {
                ToastNotificationManager.CreateToastNotifier(appId).Show(toast);
                return true;
            }
            catch (Exception error)
            {
                Log("toast identity failed: " + appId + " (" + error.Message + ")");
            }
        }
        return false;
    }

    /// <summary>Last-resort balloon when even the toast could not be shown.</summary>
    static void ShowBalloon(string title, string body)
    {
        try
        {
            var icon = new NotifyIcon
            {
                Icon = SystemIcons.Information,
                Visible = true,
                BalloonTipTitle = title,
                BalloonTipText = body,
                BalloonTipIcon = ToolTipIcon.Info,
            };
            icon.ShowBalloonTip(8000);
            var previous = _balloon;
            _balloon = icon;
            previous?.Dispose();
            _ = Task.Delay(9000).ContinueWith(_ =>
            {
                try
                {
                    if (ReferenceEquals(_balloon, icon)) _balloon = null;
                    icon.Dispose();
                }
                catch { }
            });
        }
        catch (Exception error)
        {
            Log("balloon failed: " + error.Message);
        }
    }

    static void RemoveToast(string tag, string group)
    {
        try
        {
            ToastNotificationManager.History.Remove(tag, group, Aumid);
        }
        catch { }
        lock (LiveToasts) LiveToasts.Remove(tag);
    }

    static void Track(string tag)
    {
        lock (LiveToasts)
        {
            if (!LiveToasts.Add(tag)) return;
            TrackOrder.Enqueue(tag);
            // Only the newest toasts need shutdown cleanup; older ones have
            // already expired. This keeps both structures bounded.
            while (TrackOrder.Count > 32)
            {
                LiveToasts.Remove(TrackOrder.Dequeue());
            }
        }
    }

    static void CleanupToasts()
    {
        // The helper is going away: on a hot reload or DSH exit the shell must
        // not keep a flash armed for a toast nobody owns anymore.
        StopTaskbarFlash();
        string[] tags;
        lock (LiveToasts) tags = LiveToasts.ToArray();
        foreach (var tag in tags)
        {
            string group = tag.StartsWith("dsh-q-", StringComparison.Ordinal) ? QuestionGroup
                : tag.StartsWith("dsh-n-", StringComparison.Ordinal) ? NotifyGroup
                : AnswerGroup;
            RemoveToast(tag, group);
        }
        lock (LiveToasts) LiveToasts.Clear();
    }
}
