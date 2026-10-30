# Two clickers in Fully Kiosk Browser

This bridge keeps RIVA inside **Fully Kiosk Browser** (`com.fullykiosk.browser`).
Use **RIVA Fully Clicker**, not RIVA Clicker Test or RIVA Android Kiosk.
No Supabase migration is required. Deploy the updated web app separately.

## Requirements and permissions

- Android 6 or later, two distinguishable physical Bluetooth input devices.
- Fully Kiosk Browser with the PLUS JavaScript interface and broadcast receiver
  support. Other Fully package variants are not supported by this build.
- Explicitly enable **RIVA Fully Clicker** in Android Accessibility settings.
  The service filters key events and observes foreground package changes. It
  cannot retrieve screen contents and has no network permission. It consumes
  shutter/media keys while Fully is foreground, including unassigned volume
  keys with a diagnostic rather than changing volume; outside Fully, keys pass
  through except during explicit assignment in the helper.
- Android allows only one accessibility key-filtering service to receive these
  inputs at a time. Other enabled services or OEM firmware can prevent delivery.
  Do not disable accessibility tools you depend on; report a conflict instead.
- Fully **Advanced Web Settings → Enable JavaScript Interface** must be enabled.
  This interface is powerful: restrict Fully's **URL Whitelist** to your trusted
  RIVA deployment, including required same-site paths. Do not browse arbitrary
  sites with this interface enabled. Keep HTTPS.
- In a managed/locked Fully installation, have the device administrator permit
  access to the helper and Android Accessibility settings. Do not bypass managed
  device restrictions or Play Protect. Android may restrict accessibility for
  sideloaded apps; approve only this locally built app if device policy allows.

## Build and install

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\android\fully-clicker\build.ps1 -SdkRoot "$env:LOCALAPPDATA\RivaAndroidTools\sdk" -JavaHome "$env:LOCALAPPDATA\RivaAndroidTools\jdk-17.0.20.1+1"
```

Transfer only `android/fully-clicker/dist/riva-fully-clicker.apk` to the tablet.
This private test build uses the existing local Android debug signing key, not
a production/Play Store signing identity.

1. Pair the clickers in Android Bluetooth settings.
2. Open **RIVA Fully Clicker** and tap **Nastavenia Pristupnosti**. Enable its
   service, then return to the helper. The status must say the service is on.
3. Assign Team 1 and Team 2 by physically pressing each different clicker.
   Never use built-in volume buttons to assign. Same-ID devices are rejected.
4. Copy the 32-character pairing code. Treat it as a local input capability,
   do not publish it. It stays in the helper's private, non-backed-up preferences.
5. Tap **Otvorit Fully Kiosk**. In RIVA, start a practice game and choose the
   initial server. Below the score, check **Pomocník pre rozpoznávanie klikrov**.
6. Under **Prepojenie s Fully Kiosk**, paste the code and tap **Spárovať**.
   Pairing is kept in this tab's session storage across matches, not in Supabase.
7. Touch the match heading to move focus away from the code field, then press a
   clicker. **Fully prijalo vstup: F13/F14 (#...)** confirms receipt by the page.
   The existing scoring diagnostic then reports waiting/accepted/ignored.
   Receiver registration alone is not proof of a working connection.

## Acceptance test on the tablet

- Alternate three separate presses per team, at least a second apart. Verify
  correct teams, unchanged Android volume, and saved scores on a second screen.
- Double-click 60-349 ms apart: only that team's previous point is removed.
- Test editing inputs, dialogs, no initial server, paused/finished matches,
  helper unchecked, switching apps and screen lock: no unintended points.
- Reconnect a clicker and restart the service: assignments are deliberately
  cleared. Return to the helper and reassign. Returning from Fully to the helper
  alone preserves assignments so its diagnostic can be read.
- If the native helper records delivery but the web count stays unchanged,
  check Fully PLUS/JS settings, code, active tab, helper checkbox and whether the
  installed Fully version accepts broadcasts from other apps.
- If no native input is recorded, check Accessibility service status and OEM
  key filtering. A different Android input path is not a guaranteed workaround.

The native service sends package-targeted broadcasts with random pairing actions.
Fully registers only those two actions and forwards them through its documented
`broadcastReceived` callback. The page maps them to F13/F14 using the existing
keyboard handler, not direct database writes. Existing authorization, focus,
visibility, debounce, double-click and save guards still apply. A native
"sent" status or web-consumed event does not prove a successful database save.
There is no background network listener, remote-admin password or embedded
database key. The pairing code is not a replacement for match authorization.

Sources: [Fully JavaScript Interface](https://www.fully-kiosk.com/docs/en/api/javascript)
(`bind`, `registerBroadcastReceiver`, `unregisterBroadcastReceiver`) and
[Android AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService).
Compilation and automated tests cannot establish actual accessibility key
delivery or Fully broadcast support on a particular device; the tablet test
above is required before using this for a league match.
