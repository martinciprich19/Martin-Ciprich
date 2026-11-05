package sk.rivapadel.apptest;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.SystemClock;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

final class ScreenPreview {
    private final Activity activity;
    private final WebView web;
    private ScheduledExecutorService worker;
    private volatile boolean active;
    private long lastHeartbeat;
    private static final String ENDPOINT = "https://www.rivapadel.app/api/kiosk-preview";

    ScreenPreview(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    void start() {
        stop();
        active = true;
        lastHeartbeat = 0;
        worker = Executors.newSingleThreadScheduledExecutor();
        worker.scheduleWithFixedDelay(this::request, 2, 3, TimeUnit.SECONDS);
    }

    void stop() {
        active = false;
        if (worker != null) worker.shutdownNow();
        worker = null;
    }

    private HttpURLConnection connection(String cookie) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(ENDPOINT).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Cookie", cookie);
        return connection;
    }

    private void request() {
        if (!active) return;
        String cookie = CookieManager.getInstance().getCookie(ENDPOINT);
        if (cookie == null || !cookie.contains("riva-kiosk-device=")) return;
        if (lastHeartbeat == 0 || SystemClock.elapsedRealtime() - lastHeartbeat >= 20000) {
            heartbeat(cookie);
            lastHeartbeat = SystemClock.elapsedRealtime();
        }
        HttpURLConnection connection = null;
        try {
            connection = connection(cookie);
            if (connection.getResponseCode() != 200) throw new Exception("Preview status HTTP " + connection.getResponseCode());
            ByteArrayOutputStream response = new ByteArrayOutputStream();
            try (java.io.InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    response.write(buffer, 0, count);
                    if (response.size() > 4096) throw new Exception("Invalid preview status size");
                }
            }
            if (new JSONObject(response.toString("UTF-8")).optBoolean("requested")) {
                activity.runOnUiThread(() -> capture(cookie));
            }
        } catch (Exception error) {
            if (active) Log.e("RivaScreenPreview", "Preview request failed", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void heartbeat(String cookie) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("https://www.rivapadel.app/api/device-heartbeat").openConnection();
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("X-Riva-Source", "android");
            connection.setRequestProperty("X-Riva-Version",
                activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName);
            Intent battery = activity.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (battery != null) {
                int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                if (level >= 0 && scale > 0 && level <= scale) {
                    connection.setRequestProperty("X-Riva-Battery", String.valueOf(Math.round(level * 100f / scale)));
                }
                int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                if (status != -1) connection.setRequestProperty("X-Riva-Charging",
                    String.valueOf(status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL));
            }
            if (connection.getResponseCode() != 200) throw new Exception("Heartbeat HTTP " + connection.getResponseCode());
        } catch (Exception error) {
            if (active) Log.e("RivaScreenPreview", "Device heartbeat failed", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void capture(String cookie) {
        if (!active || !AppPolicy.trusted(web.getUrl()) || activity.isFinishing()) return;
        View root = activity.findViewById(android.R.id.content);
        if (root.getWidth() <= 0 || root.getHeight() <= 0) return;
        Bitmap bitmap = null;
        try {
            float scale = Math.min(1f, 960f / Math.max(root.getWidth(), root.getHeight()));
            bitmap = Bitmap.createBitmap(Math.max(1, (int) (root.getWidth() * scale)),
                Math.max(1, (int) (root.getHeight() * scale)), Bitmap.Config.RGB_565);
            Canvas canvas = new Canvas(bitmap);
            canvas.scale(scale, scale);
            root.draw(canvas);
            ByteArrayOutputStream image = new ByteArrayOutputStream();
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 65, image)) throw new Exception("Image encoding failed");
            byte[] bytes = image.toByteArray();
            if (bytes.length > 400000) throw new Exception("Preview image exceeds size limit");
            ScheduledExecutorService current = worker;
            if (active && current != null && !current.isShutdown()) current.execute(() -> upload(cookie, bytes));
        } catch (Exception error) {
            Log.e("RivaScreenPreview", "Screen capture failed", error);
        } finally {
            if (bitmap != null) bitmap.recycle();
        }
    }

    private void upload(String cookie, byte[] image) {
        if (!active) return;
        HttpURLConnection connection = null;
        try {
            connection = connection(cookie);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "image/jpeg");
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(image.length);
            try (java.io.OutputStream output = connection.getOutputStream()) { output.write(image); }
            if (connection.getResponseCode() != 200) throw new Exception("Preview upload HTTP " + connection.getResponseCode());
        } catch (Exception error) {
            if (active) Log.e("RivaScreenPreview", "Preview upload failed", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
