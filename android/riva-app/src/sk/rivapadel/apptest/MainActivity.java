package sk.rivapadel.apptest;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.input.InputManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.util.Log;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity implements InputManager.InputDeviceListener {
    private static final String TAG = "RivaPadelTest";
    private static final int FILE_REQUEST = 11;
    private static final int CAMERA_REQUEST = 12;
    private final ClickerSession clickers = new ClickerSession();
    private WebView web;
    private TextView status;
    private TextView setupPrompt;
    private TextView receipt;
    private LinearLayout setup;
    private Button continueMatch;
    private InputManager inputs;
    private ValueCallback<Uri[]> files;
    private PermissionRequest camera;
    private boolean foreground;
    private boolean loadFailed;
    private boolean cameraApproved;
    private int presses;

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
        status = new TextView(this);
        receipt = new TextView(this);
        receipt.setText("Klikre: zatial ziadne zachytene stlacenie.");
        setup = new LinearLayout(this);
        setup.setOrientation(LinearLayout.VERTICAL);
        setupPrompt = new TextView(this);
        setupPrompt.setTextSize(22);
        setup.addView(setupPrompt);
        continueMatch = button("Potvrdit klikre a otvorit zapas", () -> {
            if (!foreground || !clickers.confirm()) {
                message("Najprv stlac a uvolni oba rozne klikre.");
                return;
            }
            updateSetup();
            status.setText("Klikre potvrdene. Vyber podanie. Skore over aj na druhom displeji.");
            web.requestFocus();
        });
        setup.addView(continueMatch);
        setup.addView(button("Priradit klikre odznova", () -> {
            cancelPending();
            clickers.reset();
            updateSetup();
        }));
        root.addView(setup);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(true);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString()
            + " RivaAndroidKiosk/1 RivaPadelTest/1");
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
        navigate(AppPolicy.HOME);
        immersive();
    }

    private Button button(String text, Runnable action) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setOnClickListener(view -> action.run());
        return button;
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
        updateSetup();
    }

    private void updateSetup() {
        boolean blocked = clickers.blocked();
        setup.setVisibility(blocked ? View.VISIBLE : View.GONE);
        continueMatch.setEnabled(clickers.nextTeam() == -1);
        setupPrompt.setText(clickers.nextTeam() == 0
            ? "1/2: Stlac a uvolni kliker Timu 1. Toto neprida bod."
            : clickers.nextTeam() == 1
                ? "Tim 1: ID " + clickers.id(0) + ". 2/2: Stlac a uvolni INY kliker pre Tim 2."
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
        if (foreground) trackMatch(web.getUrl());
        InputDevice device = event.getDevice();
        int id = event.getDeviceId();
        int key = event.getKeyCode();
        String descriptor = device == null ? null : device.getDescriptor();
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
        if (request != CAMERA_REQUEST) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) grantCamera();
        else {
            denyCamera();
            message("Kamera nebola povolena. QR skenovanie vyzaduje povolenie kamery v nastaveniach RIVA Test.");
        }
    }

    @Override public void onBackPressed() {
        cancelPending();
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        immersive();
        web.onResume();
        inputs.registerInputDeviceListener(this, null);
        trackMatch(web.getUrl());
        if (cameraApproved) grantCamera();
    }

    @Override protected void onPause() {
        foreground = false;
        cancelPending();
        clickers.reset();
        updateSetup();
        // Keep a pending file/camera request alive while Android's own picker or permission dialog is open.
        web.onPause();
        inputs.unregisterInputDeviceListener(this);
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override protected void onDestroy() {
        denyCamera();
        cancelFiles();
        web.destroy();
        super.onDestroy();
    }

    @Override public void onInputDeviceAdded(int id) {}
    @Override public void onInputDeviceRemoved(int id) { invalidate(id); }
    @Override public void onInputDeviceChanged(int id) { invalidate(id); }
    private void invalidate(int id) {
        if (clickers.invalidates(id)) {
            cancelPending();
            clickers.reset();
            updateSetup();
            message("Kliker bol odpojeny alebo zmeneny. Potvrd oba klikre znova.");
        }
    }
}
