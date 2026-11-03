# RIVA Padel Test for Android

This experimental hybrid app opens the **entire deployed RIVA website**, starting
at `https://www.rivapadel.app/`. It is not an offline export of the Next.js server.
Profiles, leagues, rankings, arenas, authentication and matches use the existing
web pages and backend; nothing is copied into a separate database.

## Isolation and installation

- App name: **RIVA Padel Test**, version 1.6.
- Package: `sk.rivapadel.apptest`, distinct from the Chrome-installed PWA,
  standalone kiosk and Fully helper. It installs alongside them.
- Cookies, login state and storage are private to this app. Log in separately.
- No changes to the production website, database schema or other APKs are needed.
  Existing uncommitted web fixes are not included until separately deployed.
- **Tests against the deployed backend can create real matches, points and uploads.**
  Uninstalling the APK does not undo those records. Use deliberate test data.

Build using the already installed tools:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\android\riva-app\build.ps1 -SdkRoot "$env:LOCALAPPDATA\RivaAndroidTools\sdk" -JavaHome "$env:LOCALAPPDATA\RivaAndroidTools\jdk-17.0.20.1+1"
```

Transfer only `android/riva-app/dist/riva-padel-test.apk` to the tablet and install.
Version 1.4 replaces Android's light window theme with a dark RIVA theme.
The window, status/navigation bars, inset padding and WebView loading background
use `#061016`, avoiding a white strip when Xiaomi or another device reserves
system-bar space. Immersive hiding remains enabled; device-specific rendering
still requires physical verification. Install as an update without uninstalling
or clearing app data to retain the existing session and saved device tokens.
The APK is locally debug-signed for private testing, not a Play Store release.
The build and APK are ignored by Git. No credentials are embedded.
Return to the previous app at any time; uninstall only **RIVA Padel Test** if desired.

## Web features

All same-origin HTTPS pages remain inside the WebView. **Domov** opens the full
home page and Android Back uses web history.
JavaScript, DOM storage and first-party cookies are enabled. Web permissions and
authorization remain the responsibility of the existing website.

Android's document picker supports single and multiple file inputs for profile
photos and sponsor images without broad storage permission. File access
uses Android's content-provider grants for the selected files. QR camera capture
requires explicit Android camera permission and is granted only to the RIVA origin.
Denied permissions and main-page network/HTTP failures are reported onscreen.
Version 1.2 allows audio without a touch gesture so Bluetooth-triggered score
announcements and asynchronous server audio are not blocked by WebView autoplay.
Server speech still requires network access; Android WebView may lack the
browser speech-synthesis fallback. This change does not repair server failures.
No microphone, Accessibility,
device administrator or native JavaScript interface is enabled.

External HTTPS, email and telephone links require confirmation and open another
Android app. The RIVA login session is not forwarded. Downloads use that external
path; authenticated downloads and `blob:` downloads are **not implemented** in
this test build and report limitations explicitly. The current web code uses
file inputs for uploads and a blob URL for in-page audio, which stays inside RIVA.
External OAuth/deep-link login return flows are not implemented; the current
email/password and in-app OTP flows must be tested separately.

This preserves the existing web interface, **not a guarantee of browser feature
parity**. Android WebView can differ from Chrome in permissions, audio and file
handling. Each feature below needs a real-device test before release.

## Native clickers

Version 1.6 uses the approved RIVA PLAY TOGETHER artwork as the Android launcher
icon. Web logos, browser/PWA icons and notification icons use the same image;
web changes require a separate deployment. Generated variants preserve the
complete image and its padding. Regenerate using
`node scripts\generate-riva-brand-assets.mjs <approved-image-path>`.

Version 1.5 styles native assignment with the dark RIVA background, rounded
team cards (lime for Team 1, blue for Team 2), a highlighted current step and
a lime confirmation button enabled after both devices are assigned.
The setup scrolls on smaller screens and in landscape. Assignment, release
validation and scoring semantics are unchanged.

When an editable-route `/match?id=...` opens, an in-app setup panel requires:

1. Press and release the physical clicker for Team 1.
2. Press and release a different physical device for Team 2.
3. Tap **Potvrdit klikre a otvorit zapas** and select the initial server.

These assignment presses never score. Distinct Android IDs and descriptors map
the same `VOLUME_UP` key to F13/F14; the existing web clicker handler remains
responsible for scoring, authorization, busy/focus/pause guards and double-click.
The user agent includes the existing `RivaAndroidKiosk/1` compatibility marker,
so the deployed web enables native helper handling without a web modification.

The current match is hidden until confirmation. Viewer links (`view=viewer`) and
scoreboards do not require clickers. Other `/match?id=...` links require setup
even if the server later determines the user cannot edit; route gating does not
grant authorization. A new match or actual device identity change/disconnect
requires fresh confirmation. Same-match navigation and temporary app pauses
preserve confirmation if both input device IDs/descriptors remain valid.
Native receipt counts are not proof of saved points.

## Required tablet acceptance checks

- Launch alongside the old app; verify its login/storage remain unchanged.
- Login, logout, registration/OTP and password recovery inside RIVA.
- Profile edits, avatar upload, languages, rankings and league workflows.
- Arena administration and sponsor uploads under the proper authorized account.
- QR scan with allowed and denied camera permission; cancel and retry file selection.
- Back navigation, external links, rotation, audio after a user gesture, restart
  and network error/recovery.
- Both physical clickers: three alternating points per team, saved score on
  another screen, double-click undo, no scoring during setup/paused/finished match.
- Switch apps with both clickers connected: setup does not return and no queued
  point is scored on resume. Reconnect a clicker: setup returns without points.
- Leave a live match idle: the app uses the deployed site's behavior. The separate
  local inactivity fix must be deployed to remove the existing web timeout.

Quick matches now require an explicit initial serve draw in the shared web view
instead of assigning a random team at creation. The native confirmation panel
appears first; after confirmation the web draw is available. Once
`initial_server_chosen` is saved, the draw action disappears across devices and
reloads. Existing matches with an already chosen server are unchanged.
The shared inactivity fix disables both the live-view timer and the parent
selection timer whenever a match ID is present, even if scanning/rules state
remains set. Deploy these web changes for both browser and APK behavior.

Compilation, signature verification and native logic tests do not establish
full feature parity or Bluetooth compatibility on the physical tablet.

Version 1.1 removes the native toolbar and receipt/status strips from the normal
screen. The website occupies the available display; clicker setup remains
visible before matches. Android status/navigation bars use immersive mode,
restored on window focus and resume. Edge swipes can temporarily reveal system
controls; this is not device-owner lockdown. Network failures show a retry/home
dialog and other errors remain explicit toast notifications.

Version 1.3 preserves assignments across activity pauses and harmless input-device
metadata changes. Resume validates both physical IDs/descriptors; real removal
or identity changes still require confirmation rather than guessing the teams.
Held-key state and queued web actions are cleared on pause.

The current same-origin `/match?id=...` URL is remembered in private Android
preferences. Relaunch reopens that match with its last **server-saved** score
instead of the home page. Leaving the match for another RIVA page clears the
remembered URL. After process death assignments must be confirmed again; web
localStorage retains the existing QR device token. Unsent points are not recovered
or replayed. A terminated WebView renderer offers explicit match recovery.

The shared web clicker queue now catches synchronous scoring exceptions, clears
pending burst actions and surfaces the error in the match instead of allowing an
uncaught timer error. Errors disable clicker scoring until resolved/reloaded;
the error panel can reload the same URL. Four or more presses still follow the
existing rules: two presses 60–349 ms apart are a team undo, not two points.
The match route also has an error boundary for rendering failures with retry
and same-URL reload actions, not a redirect to game selection.
This web update requires deployment independently from the APK. The reported
real-device crash is not conclusively diagnosed without its original error.
