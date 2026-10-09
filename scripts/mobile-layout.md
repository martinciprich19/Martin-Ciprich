# Mobile layout

Run the regression checks with `node --test scripts/mobile-layout.test.mjs`.

The root layout emits `width=device-width`, `initial-scale=1`,
`maximum-scale=1`, and `user-scalable=no`. Global CSS constrains the document
width, hides horizontal document overflow, and wraps long unbroken text.
Touch gestures allow vertical scrolling and horizontal scrolling inside
dedicated containers, but do not opt into pinch zoom. Mobile form controls use
16px text to avoid iOS focus zoom.

Check the home page, public navigation, rankings, authentication forms, and
signed-in profile at widths 320, 375, 390, 430, and 844px:

- Document scroll width must not exceed the viewport width.
- All content and controls must remain reachable; clipping is not a layout fix.
- Opening mobile navigation must not widen the document.
- Vertical scrolling must work; match-detail tables must still scroll locally.
- On a physical iPhone, check pinch gestures, input focus, and rotation.

Safari or accessibility settings may ignore viewport zoom restrictions.
Disabling zoom reduces accessibility; these restrictions are intentional.
