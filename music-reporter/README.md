# MK Music Reporter (Windows)

Reads what's currently playing on your PC — Apple Music, Spotify, or anything else that reports to Windows' built-in media controls (the same system behind the "now playing" widget in your volume flyout) — and reports it to your MK account's status, so friends see "Song - Artist" under your name in MK, the same idea as Discord's Rich Presence.

This is a Windows-only tool (it uses PowerShell + Windows' media-control API, `GlobalSystemMediaTransportControlsSessionManager`).

## Setup

Requires Node.js 18+ (check with `node -v` in a terminal — get it from nodejs.org if you don't have it).

```
cd music-reporter
node reporter.js
```

The first time you run it, it'll ask for:
- Your MK backend URL (the Render URL, e.g. `https://mk-app-dd6m.onrender.com` — NOT the frontend URL)
- Your MK username and password

It logs in once, saves the session to a file in your user folder (`.mk-music-reporter.json`), and then runs in the background, checking every 15 seconds. Leave the terminal window open while you want your status to update — see below for running it without a window.

If Windows blocks the PowerShell script from running (a security prompt or an error mentioning "execution policy"), the script already runs with `-ExecutionPolicy Bypass` for just that one call, so this should just work — but if you still see a block, you may need to allow scripts once via an admin PowerShell: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`.

It picks up whichever app is registered with Windows as playing media; if multiple things are running (e.g. a YouTube tab and Apple Music), it prefers a source with "Music" in its name, falling back to whatever Windows currently considers the active session.

## Running it in the background permanently

If you don't want to keep a terminal window open, set it up as a scheduled task that starts at login:

1. Open Task Scheduler → Create Task
2. General tab: name it "MK Music Reporter", check "Run whether user is logged on or not" if you want it fully background, or leave default for a visible-if-you-look setup
3. Triggers tab: New → "At log on"
4. Actions tab: New →
   - Program/script: `node` (or the full path from `where node`)
   - Add arguments: `reporter.js`
   - Start in: the full path to this `music-reporter` folder
5. Save

(Run `node reporter.js` manually once first to complete the login setup before switching to the background version, since the interactive login prompt won't show up when Task Scheduler runs it.)

## Stopping / resetting

- Stop the foreground process with Ctrl+C.
- To log in as a different account, delete `.mk-music-reporter.json` from your user folder (`%USERPROFILE%`) and run it again.
