# Appearance

The app uses a fixed dark appearance. There is no theme switch or stored
appearance preference.

[themes.css](../app/themes.css) defines shared surface, foreground, border and
accent tokens exposed as Tailwind `app-*` colors. All screens and match statistics
use these tokens. New UI should use them rather than hardcoded dark surfaces or
white text. Photo backgrounds retain their original opacity, color and dark
overlays. Lime brand buttons, player photos and black-on-white QR codes are not
inverted.

Profile photos are uploaded to a new Storage object path each time so browsers
and the CDN do not reuse an older image. After the profile points to the new
photo, the previous owned object is removed; a cleanup failure is reported to
the user. If an update cannot be confirmed, refresh and check the profile before
retrying. Existing photos remain compatible with the new upload and removal flow.
