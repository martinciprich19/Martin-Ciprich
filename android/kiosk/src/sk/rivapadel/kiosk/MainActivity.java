package sk.rivapadel.kiosk;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.hardware.input.InputManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity implements InputManager.InputDeviceListener {
    private WebView web;
    private TextView status;
    private EditText address;
    private Button[] buttons = new Button[2];
    private final int[] assigned = {-1, -1};
    private final String[] descriptors = {null, null};
    private int learning = -1;
    private boolean foreground;
    private String origin;
    private PermissionRequest cameraRequest;
    private InputManager inputs;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        inputs = (InputManager) getSystemService(INPUT_SERVICE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(root);
        address = new EditText(this);
        address.setSingleLine(true);
        address.setHint("https://tvoja-aplikacia/kiosk?courtId=1");
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setText(getPreferences(MODE_PRIVATE).getString("url", ""));
        root.addView(address);
        Button open = new Button(this);
        open.setText("Otvorit kiosk");
        open.setOnClickListener(v -> openKiosk());
        root.addView(open);
        LinearLayout teams = new LinearLayout(this);
        for (int i = 0; i < 2; i++) {
            final int team = i;
            buttons[i] = new Button(this);
            buttons[i].setOnClickListener(v -> {
                cancelPending();
                learning = team;
                status.setText("Stlac iba kliker pre Tim " + (team + 1));
            });
            teams.addView(buttons[i], new LinearLayout.LayoutParams(0, -2, 1));
        }
        root.addView(teams);
        status = new TextView(this);
        root.addView(status);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString() + " RivaAndroidKiosk/1");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (trusted(request.getUrl().toString())) return false;
                message("Navigacia mimo nastavenej HTTPS aplikacie bola zablokovana.");
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                denyCamera();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!foreground || !trusted(request.getOrigin().toString())
                        || !trusted(web.getUrl())) { request.deny(); return; }
                    boolean video = false;
                    for (String resource : request.getResources())
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) video = true;
                    if (!video) { request.deny(); return; }
                    denyCamera();
                    cameraRequest = request;
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
                        grantCamera();
                    else requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (cameraRequest == request) cameraRequest = null;
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        resetAssignments();
        if (!address.getText().toString().isEmpty()) openKiosk();
    }

    private boolean trusted(String url) {
        if (url == null || origin == null) return false;
        Uri uri = Uri.parse(url);
        return "https".equals(uri.getScheme()) && uri.getUserInfo() == null
            && origin.equals(uri.getScheme() + "://" + uri.getEncodedAuthority());
    }

    private void openKiosk() {
        String url = address.getText().toString().trim();
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null
            || uri.getUserInfo() != null || !"/kiosk".equals(uri.getPath())) {
            message("Zadaj HTTPS adresu kiosku, napr. https://tvoja-domena/kiosk?courtId=1");
            return;
        }
        cancelPending();
        origin = "https://" + uri.getEncodedAuthority();
        resetAssignments();
        getPreferences(MODE_PRIVATE).edit().putString("url", url).apply();
        web.loadUrl(url);
        web.requestFocus();
    }

    private void message(String text) {
        status.setText(text);
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    private void resetAssignments() {
        learning = -1;
        for (int i = 0; i < 2; i++) {
            assigned[i] = -1;
            descriptors[i] = null;
            buttons[i].setText("Prirad Tim " + (i + 1));
        }
        status.setText("Android pomocnik zapnuty. Prirad oba fyzicke klikre.");
    }

    private static boolean clickerKey(int key) {
        return key == KeyEvent.KEYCODE_VOLUME_UP || key == KeyEvent.KEYCODE_VOLUME_DOWN
            || key == KeyEvent.KEYCODE_CAMERA || key == KeyEvent.KEYCODE_FOCUS
            || key == KeyEvent.KEYCODE_HEADSETHOOK || key == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            || key == KeyEvent.KEYCODE_MEDIA_PLAY || key == KeyEvent.KEYCODE_MEDIA_PAUSE
            || key == KeyEvent.KEYCODE_ENTER || key == KeyEvent.KEYCODE_SPACE;
    }

    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        if (!foreground || !clickerKey(event.getKeyCode()))
            return super.dispatchKeyEvent(event);
        InputDevice device = event.getDevice();
        int id = event.getDeviceId();
        int team = assigned[0] == id ? 0 : assigned[1] == id ? 1 : -1;
        // Keep typing/activation in the native toolbar usable for unassigned keyboards.
        if (learning < 0 && team < 0
            && (event.getKeyCode() == KeyEvent.KEYCODE_ENTER || event.getKeyCode() == KeyEvent.KEYCODE_SPACE))
            return super.dispatchKeyEvent(event);
        if (device == null || device.isVirtual()) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0)
                status.setText("Vstup bez fyzickej identity: ID " + id + ". Android neposkytol identitu klikra.");
            return true;
        }
        if (learning >= 0) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                team = learning;
                if (assigned[1 - team] == id) {
                    message("ROVNAKE ID: stlac iny fyzicky kliker. Android ich musi rozlisovat.");
                } else {
                    assigned[team] = id;
                    descriptors[team] = device.getDescriptor();
                    buttons[team].setText("Tim " + (team + 1) + ": priradeny");
                    learning = -1;
                    status.setText("Tim " + (team + 1) + " priradeny: ID " + id
                        + ". Stlacenie bude spracovane iba v aktivnom zapase.");
                    web.requestFocus();
                }
            }
            return true;
        }
        if (team < 0) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0)
                status.setText("Nepriradeny vstup: ID " + id + ", "
                    + KeyEvent.keyCodeToString(event.getKeyCode())
                    + ". Prirad tento kliker cez Prirad Tim 1 alebo Prirad Tim 2.");
            return true;
        }
        if (event.getAction() != KeyEvent.ACTION_DOWN || event.getRepeatCount() != 0) return true;
        if (!device.getDescriptor().equals(descriptors[team])) {
            cancelPending();
            resetAssignments();
            return true;
        }
        if (assigned[0] < 0 || assigned[1] < 0) {
            message("Najprv prirad oba klikre.");
            return true;
        }
        if (!trusted(web.getUrl()) || !"/match".equals(Uri.parse(web.getUrl()).getPath())
            || !web.hasFocus()) {
            status.setText("Kliker ignorovany: otvor aktivny zapas a klikni do jeho obrazovky.");
            return true;
        }
        String key = team == 0 ? "F13" : "F14";
        final int teamNumber = team + 1;
        web.evaluateJavascript("(function(){if(document.visibilityState!=='visible')return 'hidden';"
            + "return (document.activeElement||document.body).dispatchEvent(new KeyboardEvent('keydown',"
            + "{key:'" + key + "',code:'" + key + "',bubbles:true,cancelable:true}))"
            + "?'unhandled':'handled';})()", result -> {
                if (!foreground) return;
                if ("\"handled\"".equals(result))
                    status.setText("Tim " + teamNumber + ": web spracoval vstup. Over ulozene skore.");
                else if ("\"hidden\"".equals(result))
                    status.setText("Kliker ignorovany: web nie je viditelny.");
                else
                    status.setText("Tim " + teamNumber
                        + ": web vstup neprijal. Over podanie, pauzu a nasadenie aktualnej webovej aplikacie.");
            });
        return true;
    }

    private void cancelPending() {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null);
    }

    private void denyCamera() {
        if (cameraRequest != null) { cameraRequest.deny(); cameraRequest = null; }
    }

    private void grantCamera() {
        if (cameraRequest == null) return;
        if (foreground && trusted(web.getUrl()) && trusted(cameraRequest.getOrigin().toString())) {
            cameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            cameraRequest = null;
        } else denyCamera();
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 1 && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) grantCamera();
        else { denyCamera(); message("Kamera nie je povolena. Povol ju v nastaveniach aplikacie."); }
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        web.onResume();
        inputs.registerInputDeviceListener(this, null);
    }

    @Override protected void onPause() {
        foreground = false;
        cancelPending();
        denyCamera();
        resetAssignments();
        inputs.unregisterInputDeviceListener(this);
        web.onPause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @Override public void onInputDeviceAdded(int id) {}
    @Override public void onInputDeviceRemoved(int id) { invalidate(id); }
    @Override public void onInputDeviceChanged(int id) { invalidate(id); }
    private void invalidate(int id) {
        if (assigned[0] == id || assigned[1] == id) {
            cancelPending();
            resetAssignments();
            message("Kliker sa zmenil alebo odpojil. Prirad oba klikre znova.");
        }
    }
}
