# Android clicker diagnostic

This standalone native app tests whether Android exposes distinct `InputDevice`
IDs for two identical Bluetooth shutters. It does not contain the website,
Supabase credentials, scoring actions, network permissions or Bluetooth scanning.
Pair shutters through Android Settings before opening the app. It needs Android
6.0 or newer. The app is a diagnostic, not the finished Android scoring helper.
For the separate WebView kiosk with automatic scoring input, see
[Android kiosk](android-kiosk.md).

## Build on Windows

Requires JDK 17, Android SDK platform 35 and build-tools 35.0.0.
Accept Google's SDK license yourself before installing the SDK components.
No Gradle, Android Studio, npm dependency or system-wide installation is needed.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\android\clicker-diagnostic\build.ps1 -SdkRoot "$env:LOCALAPPDATA\RivaAndroidTools\sdk" -JavaHome "$env:LOCALAPPDATA\RivaAndroidTools\jdk-17.0.20.1+1"
```

Output: `android/clicker-diagnostic/dist/riva-clicker-test.apk`.
Build intermediates and APKs are ignored by Git. The local diagnostic signing
key is outside the repository at
`%LOCALAPPDATA%\RivaAndroidTools\diagnostic-debug.keystore`. This uses the public
Android debug password and is not suitable for production/Play Store signing.
The build verifies APK signatures, prints manifest metadata and its SHA-256.

## Install and test

1. Transfer only `riva-clicker-test.apk` to the tablet by USB or a private transfer.
2. Open it in the tablet's file manager. If prompted, temporarily allow installing
   apps from that file manager. Restore that setting after installation. Do not
   disable Play Protect or managed-device restrictions.
3. Pair both clickers in Android's Bluetooth settings, then open **RIVA Clicker
   Test**. Leave it in the foreground with the screen unlocked.
4. Tap **1. Prirad Tim 1**, press/release the first shutter only. Repeat with
   **2. Prirad Tim 2** and the other shutter. Use the shutters, not the tablet's
   physical volume buttons: these can also produce valid device IDs.
5. Alternate three separate presses of each shutter, at least one second apart.
   Team 1 should always show one ID and Team 2 another, without swapping.
   `ROVNAKE ID` on pressing the second physical clicker means those inputs are
   not distinguished by this capture path. `NEPREUKAZANE` means Android supplied
   no physical identity; it is inconclusive rather than a hardware verdict.
6. Double-click each shutter: the log shows the measured gap and marks gaps
   of 60–349 ms. It records only diagnostics and never changes scores.
7. Take a screenshot of the team result and recent key/device records. Descriptors
   and device names may identify hardware: share privately, not in public logs.
8. Close the app when done. The bounded log (last 100 lines) and assignments are
   memory-only. Leaving the app clears assignments, as does disconnection of an
   assigned device. Reassign after reconnecting; Android IDs are session-local.

The app consumes recognized shutter/volume keys only while its Activity receives
them. It does not install an accessibility service or global keyboard hook and
does not claim background/iOS support. Back/Home retain normal behavior.
Some Android versions, OEM firmware or Bluetooth devices may intercept volume
keys before they reach the Activity. If no events appear, record tablet model,
Android version and whether ordinary volume buttons produce events in this app.
Two different IDs alone are not proof: physically alternating both clickers is
the required acceptance test. Production-site access has no bearing on this test.

## Verification limits

Build/signature/manifest validation proves the artifact is installable in format,
not that a particular tablet delivers distinct hardware inputs. Installation,
input routing and double-click timing must be tested on the actual tablet.
