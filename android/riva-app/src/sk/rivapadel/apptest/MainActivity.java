package sk.rivapadel.apptest;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.input.InputManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.SystemClock;
import android.view.HapticFeedbackConstants;
import android.util.Log;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.View;
import android.view.Gravity;
import android.view.WindowManager;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.RenderProcessGoneDetail;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.ScrollView;
import org.json.JSONObject;
import com.google.firebase.messaging.FirebaseMessaging;

public final class MainActivity extends Activity implements InputManager.InputDeviceListener {
    private static final String TAG = "RivaPadelTest";
    private static final int BACKGROUND_COLOR = Color.rgb(6, 16, 22);
    private static final int FILE_REQUEST = 11;
    private static final int CAMERA_REQUEST = 12;
    private static final int PUSH_PERMISSION_REQUEST = 13;
    private final ClickerSession clickers = new ClickerSession();
    private WebView web;
    private ScreenPreview screenPreview;
    private TextView status;
    private TextView setupPrompt;
    private TextView receipt;
    private LinearLayout setup;
    private ScrollView setupScroll;
    private final TextView[] teamCards = new TextView[2];
    private Button continueMatch;
    private InputManager inputs;
    private ValueCallback<Uri[]> files;
    private PermissionRequest camera;
    private boolean foreground;
    private boolean loadFailed;
    private boolean cameraApproved;
    private int presses;
    private String rememberedMatch;
    private String pendingPushRequestId;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        inputs = (InputManager) getSystemService(INPUT_SERVICE);
        LinearLayout root = new LinearLayout(this);
        root.setBackgroundColor(BACKGROUND_COLOR);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(root);
        status = new TextView(this);
        receipt = new TextView(this);
        receipt.setText("Klikre: zatial ziadne zachytene stlacenie.");
        setup = new LinearLayout(this);
        setup.setOrientation(LinearLayout.VERTICAL);
        setup.setGravity(Gravity.CENTER_HORIZONTAL);
        setup.setPadding(dp(24), dp(32), dp(24), dp(32));
        setupScroll = new ScrollView(this);
        setupScroll.setFillViewport(true);
        setupScroll.addView(setup);
        TextView brand = setupText("RIVA / PRIPRAVA ZAPASU", 12, Color.rgb(168, 230, 60), true);
        addSetupView(brand, 0);
        addSetupView(setupText("Priradte klikre", 30, Color.WHITE, true), 12);
        addSetupView(setupText("Kazdy tim ma vlastny kliker. Priradenie nepridava body do zapasu.", 15,
            Color.rgb(156, 174, 183), false), 12);
        setupPrompt = setupText("", 17, Color.WHITE, true);
        setupPrompt.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        addSetupView(setupPrompt, 28);
        for (int team = 0; team < 2; team++) {
            teamCards[team] = setupText("", 18, Color.WHITE, true);
            teamCards[team].setPadding(dp(20), dp(22), dp(20), dp(22));
            addSetupView(teamCards[team], 14);
        }
        continueMatch = button("Potvrdit klikre a otvorit zapas", () -> {
            if (!foreground || !clickers.confirm()) {
                message("Najprv stlac a uvolni oba rozne klikre.");
                return;
            }
            updateSetup();
            status.setText("Klikre potvrdene. Vyber podanie. Skore over aj na druhom displeji.");
            web.requestFocus();
        });
        continueMatch.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        continueMatch.setTextSize(16);
        continueMatch.setMinHeight(dp(56));
        continueMatch.setBackgroundTintList(null);
        addSetupView(continueMatch, 24);
        Button resetClickers = button("Priradit klikre odznova", () -> {
            cancelPending();
            clickers.reset();
            updateSetup();
        });
        resetClickers.setTextColor(Color.rgb(178, 195, 204));
        resetClickers.setBackgroundTintList(null);
        resetClickers.setBackground(panel(Color.rgb(13, 28, 36), Color.rgb(43, 62, 72)));
        resetClickers.setMinHeight(dp(52));
        addSetupView(resetClickers, 12);
        addSetupView(setupText("Po priradeni oba klikre potvrdte. Potom mozete vybrat podanie a zacat hrat.",
            13, Color.rgb(156, 174, 183), false), 18);
        root.addView(setupScroll, new LinearLayout.LayoutParams(-1, -1));
        web = new WebView(this);
        screenPreview = new ScreenPreview(this, web);
        web.setBackgroundColor(BACKGROUND_COLOR);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new NativePushBridge(), "RivaNativePush");
        web.addJavascriptInterface(new NativeHapticsBridge(), "RivaNativeHaptics");
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString()
            + " RivaAndroidKiosk/1 RivaPadelTest/1 RivaTelemetry/1");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (AppPolicy.trusted(url)) return false;
                if (request.isForMainFrame()) offerExternal(url);
                else message("Navigacia mimo RIVA bola zablokovana.");
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                denyCamera();
                loadFailed = false;
                immersive();
                trackMatch(url);
                status.setText("Nacitavam RIVA...");
            }
            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
                trackMatch(url);
            }
            @Override public void onPageFinished(WebView view, String url) {
                trackMatch(url);
                if (!AppPolicy.trusted(url)) {
                    loadFailed = true;
                    web.setVisibility(View.INVISIBLE);
                    message("Stranka mimo doveryhodnej RIVA domeny bola zablokovana.");
                    return;
                }
                CookieManager.getInstance().flush();
                if (!loadFailed) status.setText(clickers.blocked()
                    ? "Pred zapasom potvrd oba klikre." : "RIVA nacitana.");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    loadFailed = true;
                    pageError("Nacitanie zlyhalo: " + error.getDescription() + ". Skontroluj internet.");
                }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) {
                    loadFailed = true;
                    pageError("Server RIVA vratil HTTP " + response.getStatusCode() + ".");
                }
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.e(TAG, "WebView renderer terminated; crashed=" + detail.didCrash());
                foreground = false;
                ((LinearLayout) view.getParent()).removeView(view);
                view.destroy();
                web = null;
                new AlertDialog.Builder(MainActivity.this).setTitle("RIVA potrebuje obnovit obrazovku")
                    .setMessage("Obnovime posledny zapas s ulozenym skore. Posledna neulozena zmena nemusi byt zachovana.")
                    .setCancelable(false)
                    .setPositiveButton("Obnovit zapas", (dialog, which) -> recreate()).show();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                cancelFiles();
                if (!foreground || !AppPolicy.trusted(web.getUrl())) {
                    callback.onReceiveValue(null);
                    message("Subor mozno vybrat iba v otvorenej RIVA.");
                    return true;
                }
                files = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                String[] accepted = params.getAcceptTypes();
                if (accepted.length > 0 && !accepted[0].isEmpty())
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, accepted);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(intent, FILE_REQUEST);
                } catch (ActivityNotFoundException error) {
                    Log.e(TAG, "File picker unavailable", error);
                    cancelFiles();
                    message("Android nema dostupny vyber suborov.");
                }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!foreground || !AppPolicy.trusted(web.getUrl())
                        || !AppPolicy.trusted(request.getOrigin().toString())) {
                        request.deny();
                        message("Pristup ku kamere mimo RIVA bol odmietnuty.");
                        return;
                    }
                    boolean video = false;
                    for (String resource : request.getResources())
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) video = true;
                    if (!video) {
                        request.deny();
                        message("Pozadovane opravnenie nie je podporovane; mikrofon aplikacia nepouziva.");
                        return;
                    }
                    denyCamera();
                    camera = request;
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
                        grantCamera();
                    else requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (camera == request) camera = null;
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> offerExternal(url));
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        updateSetup();
        rememberedMatch = getPreferences(MODE_PRIVATE).getString("active-match-url", null);
        String notificationUrl = getIntent() == null || getIntent().getData() == null
            ? null : getIntent().getData().toString();
        navigate(AppPolicy.trusted(notificationUrl) ? notificationUrl
            : AppPolicy.resumable(rememberedMatch) ? rememberedMatch : AppPolicy.HOME);
        immersive();
    }

    private final class NativeHapticsBridge {
        private long lastTap;

        @JavascriptInterface public void tap() {
            runOnUiThread(() -> {
                if (!foreground || web == null || !AppPolicy.trusted(web.getUrl())) return;
                long now = SystemClock.elapsedRealtime();
                if (now - lastTap < 80) return;
                lastTap = now;
                if (!web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)) {
                    Log.d(TAG, "Navigation haptic unavailable or disabled by device settings.");
                }
            });
        }
    }

    private final class NativePushBridge {
        @JavascriptInterface public boolean hasNotificationPermission() {
            return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface public void requestPushToken(String requestId) {
            if (requestId == null || !requestId.matches("[A-Za-z0-9_-]{1,80}")) return;
            runOnUiThread(() -> {
                if (web == null || !AppPolicy.trusted(web.getUrl())) {
                    finishPushTokenRequest(requestId, null, "Otvori RIVA stránku a skús to znova.");
                    return;
                }
                if (Build.VERSION.SDK_INT >= 33
                    && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    pendingPushRequestId = requestId;
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PUSH_PERMISSION_REQUEST);
                    return;
                }
                fetchPushToken(requestId);
            });
        }
    }

    private void fetchPushToken(String requestId) {
        FirebaseMessaging.getInstance().getToken()
            .addOnSuccessListener(token -> finishPushTokenRequest(requestId, token, null))
            .addOnFailureListener(error -> {
                Log.e(TAG, "Firebase token registration failed", error);
                finishPushTokenRequest(requestId, null, "Firebase token sa nepodarilo získať. Skontroluj pripojenie a Firebase konfiguráciu.");
            });
    }

    private void finishPushTokenRequest(String requestId, String token, String error) {
        if (web == null || !AppPolicy.trusted(web.getUrl())) return;
        String script = "if(typeof window.__rivaNativePushResult==='function')window.__rivaNativePushResult("
            + JSONObject.quote(requestId) + ","
            + (token == null ? "null" : JSONObject.quote(token)) + ","
            + (error == null ? "null" : JSONObject.quote(error)) + ")";
        web.evaluateJavascript(script, null);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent == null ? null : intent.getData();
        if (data != null && AppPolicy.trusted(data.toString())) navigate(data.toString());
    }

    private Button button(String text, Runnable action) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable panel(int fill, int border) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(fill);
        background.setCornerRadius(dp(18));
        background.setStroke(dp(1), border);
        return background;
    }

    private TextView setupText(String text, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER);
        view.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
        return view;
    }

    private void addSetupView(View view, int marginTop) {
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2);
        layout.topMargin = dp(marginTop);
        setup.addView(view, layout);
    }

    private void navigate(String url) {
        cancelPending();
        web.loadUrl(url);
        trackMatch(url);
        web.requestFocus();
    }

    private void trackMatch(String url) {
        String id = null;
        if (AppPolicy.trusted(url)) {
            Uri uri = Uri.parse(url);
            if ("/match".equals(uri.getPath()) && !"viewer".equals(uri.getQueryParameter("view"))) {
                String value = uri.getQueryParameter("id");
                if (value != null && !value.isEmpty()) id = value;
            }
        }
        if (clickers.track(id)) cancelPending();
        if (AppPolicy.trusted(url)) {
            String next = AppPolicy.resumable(url) ? url : null;
            if (next == null ? rememberedMatch != null : !next.equals(rememberedMatch)) {
                rememberedMatch = next;
                getPreferences(MODE_PRIVATE).edit().putString("active-match-url", next).apply();
            }
        }
        updateSetup();
    }

    private void updateSetup() {
        boolean blocked = clickers.blocked();
        setupScroll.setVisibility(blocked ? View.VISIBLE : View.GONE);
        boolean ready = clickers.nextTeam() == -1 && clickers.id(0) >= 0 && clickers.id(1) >= 0;
        continueMatch.setEnabled(ready);
        continueMatch.setTextColor(ready ? BACKGROUND_COLOR : Color.rgb(156, 174, 183));
        continueMatch.setBackground(panel(ready ? Color.rgb(168, 230, 60) : Color.rgb(25, 43, 52),
            ready ? Color.rgb(168, 230, 60) : Color.rgb(43, 62, 72)));
        for (int team = 0; team < 2; team++) {
            boolean assigned = clickers.assigned(team);
            int accent = team == 0 ? Color.rgb(168, 230, 60) : Color.rgb(141, 207, 235);
            teamCards[team].setText("TIM " + (team + 1) + "\n\n"
                + (assigned ? "Kliker priradeny" : clickers.nextTeam() == team ? "Stlac a uvolni svoj kliker" : "Caka na priradenie")
                + (assigned ? clickers.id(team) >= 0 ? "\nZariadenie ID " + clickers.id(team) : "\nCaka na opatovne pripojenie" : ""));
            teamCards[team].setTextColor(assigned || clickers.nextTeam() == team ? accent : Color.rgb(156, 174, 183));
            teamCards[team].setBackground(panel(Color.rgb(13, 28, 36),
                assigned || clickers.nextTeam() == team ? accent : Color.rgb(43, 62, 72)));
        }
        setupPrompt.setText(clickers.nextTeam() == 0
            ? "1/2: Stlac a uvolni kliker Timu 1. Toto neprida bod."
            : clickers.nextTeam() == 1
                ? "Tim 1: ID " + clickers.id(0) + ". 2/2: Stlac a uvolni INY kliker pre Tim 2."
                : !ready ? "Priradenie zostava ulozene. Zapni povodne klikre a pockaj na pripojenie."
                    : "Tim 1: ID " + clickers.id(0) + " | Tim 2: ID " + clickers.id(1) + ". Potvrd oba klikre.");
        if (web != null) web.setVisibility(blocked || (web.getUrl() != null
            && !AppPolicy.trusted(web.getUrl())) ? View.INVISIBLE : View.VISIBLE);
    }

    private static boolean clickerKey(int key) {
        return key == KeyEvent.KEYCODE_VOLUME_UP || key == KeyEvent.KEYCODE_VOLUME_DOWN
            || key == KeyEvent.KEYCODE_VOLUME_MUTE || key == KeyEvent.KEYCODE_CAMERA
            || key == KeyEvent.KEYCODE_FOCUS || key == KeyEvent.KEYCODE_HEADSETHOOK
            || key == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || key == KeyEvent.KEYCODE_MEDIA_PLAY
            || key == KeyEvent.KEYCODE_MEDIA_PAUSE || key == KeyEvent.KEYCODE_ENTER || key == KeyEvent.KEYCODE_SPACE;
    }

    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        if (!clickerKey(event.getKeyCode())) return super.dispatchKeyEvent(event);
        if (web == null) return true;
        if (foreground) trackMatch(web.getUrl());
        InputDevice device = event.getDevice();
        int id = event.getDeviceId();
        int key = event.getKeyCode();
        String descriptor = device == null ? null : device.getDescriptor();
        if (device != null && !device.isVirtual()) clickers.reconnect(id, descriptor, false);
        int team = clickers.team(id, descriptor);
        if (!clickers.blocked() && team < 0
            && (key == KeyEvent.KEYCODE_ENTER || key == KeyEvent.KEYCODE_SPACE))
            return super.dispatchKeyEvent(event);
        if (event.getAction() == KeyEvent.ACTION_UP) {
            clickers.release(id, key);
            return true;
        }
        if (event.getAction() != KeyEvent.ACTION_DOWN || event.getRepeatCount() != 0) return true;
        presses++;
        receipt.setText("Zachytene: " + presses + " | ID " + id + " | "
            + KeyEvent.keyCodeToString(key) + (device == null ? "" : " | " + device.getName()));
        if (!foreground) {
            status.setText("Kliker zachyteny mimo popredia. Bod nebol pridany.");
            return true;
        }
        if (clickers.invalidates(id) && team < 0) {
            disconnectClicker(id);
            message("Zachyteny iny kliker. Povodne priradenie zostava; toto stlacenie neprida bod.");
            return true;
        }
        if (device == null || device.isVirtual()) {
            message("Android neposkytol fyzicku identitu klikra. Bod nebol pridany.");
            return true;
        }
        if (!clickers.press(id, key, event.getRepeatCount())) return true;
        if (clickers.blocked()) {
            if (clickers.nextTeam() >= 0) {
                if (!clickers.assign(id, descriptor, false))
                    message("Tento kliker uz patri Timu 1. Stlac iny fyzicky kliker.");
                else status.setText("Kliker potvrdeny bez pridania bodu. Uvolni tlacidlo.");
                updateSetup();
            } else message("Oba klikre su priradene. Uvolni kliker a potvrd pokracovanie.");
            return true;
        }
        if (team < 0 || !clickers.hasMatch() || !web.hasFocus() || !AppPolicy.trusted(web.getUrl())) {
            status.setText("Kliker ignorovany: otvor zapas, potvrd oba klikre a tukni do zapasu.");
            return true;
        }
        final int teamNumber = team + 1;
        String mapped = team == 0 ? "F13" : "F14";
        web.evaluateJavascript("(function(){if(document.visibilityState!=='visible')return 'hidden';"
            + "return (document.activeElement||document.body).dispatchEvent(new KeyboardEvent('keydown',"
            + "{key:'" + mapped + "',code:'" + mapped + "',bubbles:true,cancelable:true}))"
            + "?'unhandled':'handled';})()", result -> {
                if (!foreground) return;
                if ("\"handled\"".equals(result))
                    status.setText("Tim " + teamNumber + ": web prijal vstup. Over ulozene skore.");
                else if ("\"hidden\"".equals(result))
                    status.setText("Bod nebol pridany: stranka nie je viditelna.");
                else message("Web neprijal kliker. Over podanie, pauzu a aktualnu webovu verziu RIVA.");
            });
        return true;
    }

    private void offerExternal(String url) {
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (!("https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme))) {
            message("Tento typ odkazu alebo stahovania nie je podporovany: " + scheme);
            return;
        }
        new AlertDialog.Builder(this).setTitle("Otvorit mimo RIVA?")
            .setMessage("Odkaz sa otvori v inej Android aplikacii. Prihlasena relacia RIVA sa neprenasa.")
            .setNegativeButton("Zrusit", null)
            .setPositiveButton("Otvorit", (dialog, which) -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException error) {
                    Log.e(TAG, "External handler unavailable", error);
                    message("Na otvorenie odkazu nie je dostupna aplikacia.");
                }
            }).show();
    }

    private void message(String text) {
        status.setText(text);
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    private void pageError(String text) {
        message(text);
        new AlertDialog.Builder(this).setTitle("RIVA sa nenacitala")
            .setMessage(text)
            .setNegativeButton("Domov", (dialog, which) -> navigate(AppPolicy.HOME))
            .setPositiveButton("Skusit znova", (dialog, which) -> web.reload()).show();
    }

    private void immersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    private void cancelPending() {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null);
    }

    private void cancelFiles() {
        if (files != null) {
            files.onReceiveValue(null);
            files = null;
        }
    }

    private void denyCamera() {
        if (camera != null) { camera.deny(); camera = null; }
        cameraApproved = false;
    }

    private void grantCamera() {
        if (camera == null) return;
        if (!foreground) { cameraApproved = true; return; }
        if (AppPolicy.trusted(web.getUrl()) && AppPolicy.trusted(camera.getOrigin().toString()))
            camera.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else camera.deny();
        camera = null;
        cameraApproved = false;
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != FILE_REQUEST || files == null) return;
        ValueCallback<Uri[]> callback = files;
        files = null;
        if (result != RESULT_OK || data == null || !AppPolicy.trusted(web.getUrl())) {
            callback.onReceiveValue(null);
            status.setText("Vyber suboru bol zruseny.");
            return;
        }
        if (data.getClipData() != null) {
            Uri[] selected = new Uri[data.getClipData().getItemCount()];
            for (int i = 0; i < selected.length; i++) selected[i] = data.getClipData().getItemAt(i).getUri();
            callback.onReceiveValue(selected);
        } else callback.onReceiveValue(data.getData() == null ? null : new Uri[]{data.getData()});
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == PUSH_PERMISSION_REQUEST) {
            String requestId = pendingPushRequestId;
            pendingPushRequestId = null;
            if (requestId == null) return;
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) fetchPushToken(requestId);
            else finishPushTokenRequest(requestId, null,
                "Povolenie notifikácií nebolo udelené. Povoľ ho v nastaveniach aplikácie Android.");
            return;
        }
        if (request != CAMERA_REQUEST) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) grantCamera();
        else {
            denyCamera();
            message("Kamera nebola povolena. QR skenovanie vyzaduje povolenie kamery v nastaveniach RIVA Test.");
        }
    }

    @Override public void onBackPressed() {
        cancelPending();
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = web != null;
        immersive();
        if (web == null) return;
        web.onResume();
        screenPreview.start();
        inputs.registerInputDeviceListener(this, null);
        validateAssignments();
        trackMatch(web.getUrl());
        if (cameraApproved) grantCamera();
    }

    @Override protected void onPause() {
        foreground = false;
        if (screenPreview != null) screenPreview.stop();
        cancelPending();
        clickers.pause();
        // Keep a pending file/camera request alive while Android's own picker or permission dialog is open.
        if (web != null) web.onPause();
        inputs.unregisterInputDeviceListener(this);
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override protected void onDestroy() {
        if (screenPreview != null) screenPreview.stop();
        denyCamera();
        cancelFiles();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override public void onInputDeviceAdded(int id) { validateAssignments(); }
    @Override public void onInputDeviceRemoved(int id) { disconnectClicker(id); }
    @Override public void onInputDeviceChanged(int id) {
        InputDevice device = InputDevice.getDevice(id);
        if (clickers.invalidates(id) && (device == null || device.isVirtual()
            || clickers.team(id, device.getDescriptor()) < 0)) disconnectClicker(id);
        if (device != null && clickers.reconnect(id, device.getDescriptor(), device.isVirtual())) {
            updateSetup();
        }
    }
    private void validateAssignments() {
        for (int team = 0; team < 2; team++) {
            int id = clickers.id(team);
            if (id >= 0) onInputDeviceChanged(id);
        }
        for (int id : InputDevice.getDeviceIds()) onInputDeviceChanged(id);
    }
    private void disconnectClicker(int id) {
        if (clickers.invalidates(id)) {
            cancelPending();
            clickers.disconnect(id);
            updateSetup();
            message("Kliker je docasne odpojeny. Priradenie zostava ulozene; po pripojeni mozes pokracovat.");
        }
    }
}
