# Android kiosk with clicker input

To keep using Fully Kiosk Browser instead of this standalone WebView, use the
separate [Fully clicker bridge](fully-clicker.md).

This is a separate app from RIVA Clicker Test. It opens the HTTPS kiosk in an
Android WebView and enables the Android helper automatically. It does not work
alongside Chrome or in the background. Kiosk mode and this Android app display
the generic **Pomocník pre rozpoznávanie klikrov** checkbox, not the Windows label.
It enables/disables F13/F14 handling and is checked by default in the native app.
In an ordinary kiosk browser it starts unchecked and does not create a native
connection by itself. Diagnostic input appears underneath while checked.

This native app does not require Accessibility permission. A RIVA Padel icon
installed through Chrome is a different app and cannot identify Android input
device IDs. Launch **RIVA Android Kiosk** for native input.

## Build and installation

Use the existing local Android SDK and JDK:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\android\kiosk\build.ps1 -SdkRoot "$env:LOCALAPPDATA\RivaAndroidTools\sdk" -JavaHome "$env:LOCALAPPDATA\RivaAndroidTools\jdk-17.0.20.1+1"
```

Transfer only `android/kiosk/dist/riva-android-kiosk.apk` to the tablet and install
**RIVA Android Kiosk**. This APK uses the local debug certificate; it is for
private device testing, not Play Store distribution.

Deploy the updated website before testing. Enter the full deployed kiosk URL,
for example `https://your-domain/kiosk?courtId=1`, and tap **Otvorit kiosk**.
Version 1.2 defaults to `https://www.rivapadel.app/kiosk` and also accepts
`https://www.rivapadel.app/match?mode=kiosk`. Opening the URL clears assignments;
assign both clickers afterwards. The heading identifies the installed native version.
`localhost` points at the tablet, not the development computer. Only HTTPS and
navigation within the configured origin are allowed. The address is saved
locally; it must point at a trusted RIVA deployment. Camera permission is used
only for QR scanning on that origin. No microphone permission or native
JavaScript interface is exposed.

## Clickers

Version 1.3 requires sequential confirmation inside the native app before a
match can be operated. Game selection stays available; when a URL with
`/match?id=...` opens (including client-side navigation), the match WebView is
hidden until both distinct devices are assigned and the continuation button is
pressed. This is a local native UI gate, not a server authorization change or a
Chrome/PWA feature. No new web/native JavaScript interface is exposed.

1. Pair both clickers in Android Bluetooth settings and choose a game in RIVA.
2. At **1/2**, press and release only the clicker for Team 1.
3. At **2/2**, press and release the different clicker for Team 2. Duplicate IDs
   are rejected. These setup presses never dispatch scoring events.
4. Tap **Klikre potvrdene - pokracovat do zapasu** and select the initial server.
   The match cannot be operated by touch or clicker before this confirmation.
   Touch the match heading to focus
   the web content. The generic helper checkbox is already checked in the native
   app; leave it checked to accept clicker input.
5. Alternate three presses per team, at least one second apart. Verify each
   changes only that team's score and that the score is saved.
6. Double-click one clicker 60-349 ms apart. Verify it removes that team's last
   point without first adding a point, including after an opponent's point.
7. Verify no scoring while editing a field, selecting rules, pausing, saving or
   after completion. Leaving the app cancels queued input and clears assignments.
   Reassign both clickers after returning, reconnecting or restarting.
8. Test QR scanning and permission denial on the physical tablet.

Version 1.1 no longer filters assigned devices by the event source-class flag.
While foreground, unassigned physical shutter/media input is consumed with an
explicit device-ID message instead of silently changing volume. Virtual or
missing device identities are reported without scoring. Native toolbar
Enter/Space remains usable for unassigned keyboards. The delivery message
distinguishes web-consumed, unhandled and hidden-page input; consumed input does
not prove that a point was saved (for example, held/media input can be ignored).
Install the updated APK over version 1.0 and reassign both clickers.

Version 1.2 adds a separate persistent press counter, Android device ID and
key name above the page, including unassigned input. The team buttons show
assigned IDs. A received clicker event while the activity is paused is consumed
and explicitly reported without scoring, rather than passed to Android volume
handling. Volume mute is handled too. Main-page network/HTTP errors remain visible.
If volume changes but the counter stays at zero, this activity did not receive
the event: confirm the native heading is visible and report the device behavior.
The counter is evidence of native receipt, not a saved point.

Each different match requires fresh confirmation. Reloading the same match
without leaving the app preserves confirmation. Leaving the app, device
invalidation or manually reassigning a clicker locks the current match again.
There is no touch-only skip in the native app; ordinary browsers are unchanged.

The live match view does not return to game selection on inactivity, in either
the native app or a browser. Between points the match must stay open even without
touch input. The existing 60-second inactivity reset remains on setup/selection
screens. Returning from a match uses the explicit match actions.

The native activity routes distinct Android input-device IDs to F13/F14 DOM
events, using the existing web handler, save guards and double-click logic.
Outside the native Android app, a kiosk browser does not automatically gain
device identification. Install and launch the APK rather than opening Chrome.
Native delivery status does not mean Supabase accepted the point. No scoring
credentials are embedded in the APK. Same-device-ID clickers cannot be assigned
to different teams. A built-in volume button can also have a physical device ID:
always assign using the actual clickers.

This is not Android device-owner lockdown. The toolbar remains available.
Compilation and web tests do not establish Bluetooth compatibility or WebView
camera support on a particular tablet; the physical acceptance test is required.
