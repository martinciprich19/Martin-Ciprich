# Android kiosk with clicker input

This is a separate app from RIVA Clicker Test. It opens the HTTPS kiosk in an
Android WebView and enables the Android helper automatically. It does not work
alongside Chrome or in the background. Kiosk mode and this Android app display
the generic **Pomocník pre rozpoznávanie klikrov** checkbox, not the Windows label.
It enables/disables F13/F14 handling and is checked by default in the native app.
In an ordinary kiosk browser it starts unchecked and does not create a native
connection by itself. Diagnostic input appears underneath while checked.

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
`localhost` points at the tablet, not the development computer. Only HTTPS and
navigation within the configured origin are allowed. The address is saved
locally; it must point at a trusted RIVA deployment. Camera permission is used
only for QR scanning on that origin. No microphone permission or native
JavaScript interface is exposed.

## Clickers

1. Pair both clickers in Android Bluetooth settings.
2. Tap **Prirad Tim 1**, then press only the first physical clicker.
3. Tap **Prirad Tim 2**, then press only the other clicker.
4. Open a match and select its initial server. Touch the match heading to focus
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
