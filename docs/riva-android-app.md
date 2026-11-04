# RIVA Padel Test for Android

This experimental hybrid app opens the **entire deployed RIVA website**, starting
at `https://www.rivapadel.app/`. It is not an offline export of the Next.js server.
Profiles, leagues, rankings, arenas, authentication and matches use the existing
web pages and backend; nothing is copied into a separate database.

## Isolation and installation

- App name: **RIVA Padel Test**, version 1.10.
- Package: `sk.rivapadel.apptest`, distinct from the Chrome-installed PWA,
  standalone kiosk and Fully helper. It installs alongside them.
- Cookies, login state and storage are private to this app. Log in separately.
- Native notifications need the existing push migrations and matching web deployment.
  Court-bound tablet/TV pairing additionally requires migrations 080 and 081 (see below).
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

## Native Android notifications

Version 1.9 adds Firebase Cloud Messaging to the Android app. Register the
Android package `sk.rivapadel.apptest` in the same Firebase project used by the
server, then save its `google-services.json` as
`android/riva-app/app/google-services.json` (this local config is ignored by Git).
The Android app ID and Firebase project must match the server's Firebase
configuration. Rebuild and install the APK as an update; do not uninstall the
existing app, so its signing identity and login data remain intact.

In the signed-in RIVA profile, enable **Natívne notifikácie** and grant Android's
notification permission when prompted. The app obtains its own FCM token and
registers it through the signed-in user's existing Supabase session. Firebase
server credentials remain on the server and are never included in the APK.
Disabling notifications removes that device token from the user's registration.
Android 13 and later require notification permission; notifications can also be
disabled in Android's app settings. Tapping one opens the RIVA profile. Delivery
and visible notification behavior should be checked on a physical Android
device, both while the app is open and while it is in the background.

## Web features

### Assign this Android installation to a court

Use the existing Android app, not a Chrome tab: its private WebView cookie identifies
the installation and its native clicker input remains available during matches.
Pairing itself requires no new APK if the tablet already runs the native-clicker
version. The private live admin screen preview requires Android app version 1.10.

For the preview apply `scripts/083_kiosk_screen_preview.sql` after 081, deploy
the web, then install the new `android/riva-app/dist/riva-padel-test.apk` over
the existing installation (do not uninstall or clear data). In arena management,
**Živý náhľad kiosku** opens an admin-only read-only image of that court's tablet.
The app captures its own interface, including native clicker assignment, only
while a manager is viewing; frames refresh roughly every three seconds. No
remote control, Android system dialogs, or live camera/video surfaces are shared.
When the app is backgrounded or requests stop, capture stops. Old frames are
hidden after ten seconds; the private database retains only the latest frame per
device. The tablet must be active, paired and online.
If OneDrive locks intermediate build files, `build.ps1 -BuildRoot` can point to
a local folder outside OneDrive; the signed APK is still copied into `dist`.

1. In Supabase apply `scripts/080_court_bound_kiosks.sql` after 071, 072, 076,
   079 and the existing rematch migrations, then apply `scripts/081_remote_device_pairing.sql`.
   Deploy the updated web application. Pairing code creation needs the server's
   existing `SUPABASE_SERVICE_ROLE_KEY`; never put that key on a tablet or TV.
2. Open the Android app on the tablet. On the home page choose **Pripojiť tablet / TV ku kurtu**
   in the footer and **Zobraziť párovací kód**. No admin login is needed on the tablet.
   Any existing local player session/push registration is cleared when generating a code.
3. On your separate admin device sign in and open **Správa arény → Tablety a monitory kurtov**.
   Enter the tablet's eight-character code, select an active court, enter its name,
   select **Tablet – kiosk** and choose **Priradiť zariadenie**. The admin session stays here.
4. The tablet automatically opens the court's game selection: quick game, PIN or QR.
   For the TV open `https://www.rivapadel.app/device-pair` in its browser, generate
   a different code and claim it from the same admin panel with **TV – monitor skóre**.
   The TV automatically opens only its assigned court's scoreboard.
5. Start the selected game and select the match rules. Confirm the native clickers
   when the Android assignment screen appears, then select the first server.
6. From the admin device, **Monitor skóre** in the same court row provides a
   read-only preview of that court. It does not mirror the tablet's exact UI.
   The TV scoreboard fills the browser viewport without scrolling. Points are
   the largest numbers; sets and games stay visible alongside both teams.
   Player names occupy separate lines. While the court is idle, sponsor images
   fill the available width with a centered crop and slide left as the next
   sponsor enters from the right, using each ad's configured display duration.
   A single sponsor stays still; reduced-motion preferences disable sliding.
   Reload is inside the scoreboard header.
   Apply `scripts/082_scoreboard_serving_player.sql` after 073 to show the
   serving team and a tennis ball beside the current server. These follow the
   stored serving team/player, including tie-breaks, on each score refresh.
7. Verify a point from each clicker appears on the tablet and TV, then test a
   pause/resume, finalization and rematch. Reopen the Android app and confirm it
   returns to this court (or its remembered active match).

Each court can have one non-revoked tablet and one monitor. Codes expire after
ten minutes, can be claimed once and are rate-limited. To replace a device,
revoke the old device from another admin device before authorizing the replacement.
Existing unbound registrations remain in legacy mode; revoke and reauthorize
them to bind them to a court. Clearing app data or uninstalling removes its
authorization cookie; the database registration must then be revoked/replaced.

Every page request validates the installation token. Altering a court URL does
not change the tablet's assignment. Pausing the court/arena displays a blocked
screen without deleting the cookie, so reactivation and a reload restore access.
Revocation removes kiosk mode on its next page request; it does not remotely erase
the app or terminate an already-loaded match. Continuous heartbeat, remote commands,
interactive screen streaming are not implemented. This is app-level
navigation restriction, not Android device-owner/OS lock-task enforcement.
Use Android screen pinning to prevent players leaving the RIVA application.

All same-origin HTTPS pages remain inside the WebView. **Domov** opens the full
home page and Android Back uses web history.
JavaScript, DOM storage and first-party cookies are enabled. Web permissions and
authorization remain the responsibility of the existing website.

The shared web layout includes a circular **Obnoviť stránku** (Reload page)
button in the top toolbar on every page, including match/kiosk and login pages.
On profile and public pages it is an inline header control with its own layout
space, not a floating overlay; pages without that header get a small top toolbar.
It fully reloads the current URL, preserving its query parameters and existing
login/device storage. Unsaved form edits or unsent points are not recovered.
The button does not overlap the bottom navigation or other controls.
This requires web deployment, not a new APK.

On mobile, selecting another profile bottom-navigation tab slides its content
up from below the screen over 860 ms, matching the side menu easing. The header
and bottom navigation stay in place. Selecting the current tab does not restart
the animation; desktop and reduced-motion users see an immediate tab switch.

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

Version 1.8 removes only the approved image's empty margins for the native launcher
icon, making the artwork about 83% of the visible icon width. Android 8+ uses an
adaptive icon with a dark background and a 72dp artwork layer within the 108dp
canvas, avoiding legacy-icon shrinking by the launcher. Older Android retains
a bitmap fallback. All bright artwork fits the guaranteed 66dp safe circle,
including the PLAY TOGETHER text. Web/PWA assets and in-app logos are unchanged.
Run `node scripts\generate-riva-brand-assets.mjs` without an argument to regenerate
from the saved approved source. Install the new APK as an update; actual launcher
size and icon cache refresh still need verification on the device.

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
grant authorization. Version 1.7 keeps team descriptors and confirmation for the
entire same-match session, with no idle timeout. Bluetooth sleep/disconnect only
clears the connected input ID and held-key state, not the team assignment. When
the same descriptor returns (including a new Android device ID), it reconnects
automatically to its original team. Unknown devices, virtual devices, reused IDs
with a different descriptor and simultaneous duplicate descriptors never score
as an assigned team. Both original clickers need distinct stable descriptors.
A new match, explicit reset, or app process restart still requires assignment;
there is no claim of persistence across process death. Same-match navigation and
temporary app pauses preserve confirmation. A physically sleeping clicker may
consume the first press to wake its Bluetooth connection; the app cannot prevent
hardware sleep or replay a key Android never delivered.
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
  point is scored on resume. Reconnect either original clicker: no assignment
  panel returns, and delivered presses continue controlling the original team.
- Leave the clickers idle for 10 minutes, one hour and two hours during the same
  live match. Wake each and verify exact team identity without re-confirmation,
  including when Android allocates new device IDs. An unknown clicker must not
  score. These physical checks remain required; native tests simulate disconnects
  and reconnections but cannot measure the hardware's sleep behavior.

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
metadata changes. Resume validates both physical IDs/descriptors. Before 1.7,
real removal or identity changes required confirmation. Version 1.7 retains
the original descriptors on removal and restores only those same physical
identities automatically; it never guesses a team for a different device.
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
