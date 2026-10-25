# Appearance

The app uses a fixed dark appearance. There is no theme switch or stored
appearance preference.

[themes.css](../app/themes.css) defines shared surface, foreground, border and
accent tokens exposed as Tailwind `app-*` colors. All screens and match statistics
use these tokens. New UI should use them rather than hardcoded dark surfaces or
white text. Photo backgrounds retain their original opacity, color and dark
overlays. Lime brand buttons, player photos and black-on-white QR codes are not
inverted.
