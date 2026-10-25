package sk.rivapadel.clickerdiagnostic;

import android.app.Activity;
import android.hardware.input.InputManager;
import android.os.Bundle;
import android.os.SystemClock;
import android.graphics.Typeface;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.Locale;

public final class MainActivity extends Activity implements InputManager.InputDeviceListener {
    private final ArrayDeque<String> lines = new ArrayDeque<>();
    private final int[] assigned = {-1, -1};
    private final String[] descriptors = {null, null};
    private final long[] lastPress = {-1, -1};
    private final int[] presses = {0, 0};
    private InputManager inputs;
    private TextView status;
    private TextView devices;
    private TextView log;
    private Button team1;
    private Button team2;
    private ScrollView logScroll;
    private int learning = -1;
    private int eventCount = 0;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        inputs = (InputManager) getSystemService(INPUT_SERVICE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        final int padding = dp(12);
        root.setPadding(padding, padding, padding, padding);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(padding + insets.getSystemWindowInsetLeft(),
                padding + insets.getSystemWindowInsetTop(),
                padding + insets.getSystemWindowInsetRight(),
                padding + insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(root);
        TextView title = text("RIVA - Android clicker test", 22);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title);
        root.addView(text("Test bez internetu a bez zmeny skore.\n"
            + "1. Sparuj oba klikre v Bluetooth nastaveniach.\n"
            + "2. Prirad prvy kliker Timu 1 a druhy Timu 2.\n"
            + "3. Striedavo stlac kazdy 3x, potom skus dvojklik.\n"
            + "Nechaj tuto aplikaciu v popredi. Po navrate z nastaveni prirad klikre znova.", 15));
        LinearLayout buttons = new LinearLayout(this);
        team1 = button("1. Prirad Tim 1", () -> learn(0));
        team2 = button("2. Prirad Tim 2", () -> learn(1));
        buttons.addView(team1, new LinearLayout.LayoutParams(0, -2, 1));
        buttons.addView(team2, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(buttons);
        status = text("Cakam na stlacenie. Test nepridava ani neodobera body.", 17);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(status);
        devices = text("", 12);
        ScrollView deviceScroll = new ScrollView(this);
        deviceScroll.addView(devices);
        root.addView(deviceScroll, new LinearLayout.LayoutParams(-1, dp(100)));
        root.addView(button("Vymaz zaznam a priradenia", this::reset));
        log = text("", 13);
        log.setTypeface(Typeface.MONOSPACE);
        log.setTextIsSelectable(true);
        logScroll = new ScrollView(this);
        logScroll.addView(log);
        root.addView(logScroll, new LinearLayout.LayoutParams(-1, 0, 1));
        showDevices();
        append("READY: Bez sietovych opravneni. Priradenia platia iba pocas tejto relacie.");
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setPadding(0, dp(4), 0, dp(4));
        return view;
    }

    private Button button(String label, Runnable action) {
        Button result = new Button(this);
        result.setText(label);
        result.setAllCaps(false);
        result.setOnClickListener(view -> action.run());
        return result;
    }

    private void learn(int team) {
        learning = team;
        status.setText("Stlac a uvolni iba kliker pre Tim " + (team + 1) + ".");
        append("ASSIGN: cakam na kliker pre Tim " + (team + 1));
    }

    private void resetAssignments() {
        learning = -1;
        for (int i = 0; i < 2; i++) {
            assigned[i] = -1;
            descriptors[i] = null;
            lastPress[i] = -1;
            presses[i] = 0;
        }
        updateButtons();
    }

    private void reset() {
        resetAssignments();
        eventCount = 0;
        lines.clear();
        log.setText("");
        status.setText("Vymazane. Prirad oba klikre znova.");
        showDevices();
    }

    private void updateButtons() {
        team1.setText(assigned[0] == -1 ? "1. Prirad Tim 1" : "Tim 1: ID " + assigned[0]);
        team2.setText(assigned[1] == -1 ? "2. Prirad Tim 2" : "Tim 2: ID " + assigned[1]);
    }

    private void append(String message) {
        String time = new SimpleDateFormat("HH:mm:ss.SSS", Locale.ROOT).format(new Date());
        lines.addLast(time + " " + message);
        while (lines.size() > 100) lines.removeFirst();
        StringBuilder content = new StringBuilder();
        for (String line : lines) content.append(line).append('\n');
        log.setText(content);
        logScroll.post(() -> logScroll.fullScroll(View.FOCUS_DOWN));
    }

    private String describe(InputDevice device) {
        return "ID=" + device.getId() + " name=" + device.getName()
            + "\ndescriptor=" + device.getDescriptor()
            + "\nvendor=" + device.getVendorId() + " product=" + device.getProductId()
            + " sources=0x" + Integer.toHexString(device.getSources())
            + " virtual=" + device.isVirtual();
    }

    private void showDevices() {
        StringBuilder list = new StringBuilder("Zariadenia viditelne pre Android:\n");
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice device = InputDevice.getDevice(id);
            if (device != null) list.append(describe(device)).append("\n\n");
        }
        devices.setText(list);
    }

    private static boolean isClickerKey(int code) {
        return code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN
            || code == KeyEvent.KEYCODE_VOLUME_MUTE || code == KeyEvent.KEYCODE_CAMERA
            || code == KeyEvent.KEYCODE_FOCUS || code == KeyEvent.KEYCODE_HEADSETHOOK
            || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || code == KeyEvent.KEYCODE_MEDIA_PLAY
            || code == KeyEvent.KEYCODE_MEDIA_PAUSE || code == KeyEvent.KEYCODE_ENTER
            || code == KeyEvent.KEYCODE_SPACE || code == KeyEvent.KEYCODE_A || code == KeyEvent.KEYCODE_L;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (!isClickerKey(code)) return super.dispatchKeyEvent(event);
        int id = event.getDeviceId();
        InputDevice device = event.getDevice();
        eventCount++;
        String action = event.getAction() == KeyEvent.ACTION_DOWN ? "DOWN"
            : event.getAction() == KeyEvent.ACTION_UP ? "UP" : "MULTIPLE";
        append("#" + eventCount + " " + action
            + " " + KeyEvent.keyCodeToString(code) + " id=" + id
            + " scan=" + event.getScanCode() + " repeat=" + event.getRepeatCount()
            + " eventTime=" + event.getEventTime());
        if (event.getAction() != KeyEvent.ACTION_DOWN || event.getRepeatCount() != 0) return true;
        if (device == null || device.isVirtual()) {
            status.setText("NEPREUKAZANE: Android neposkytol fyzicke zariadenie. Posli snimku zaznamu.");
            append("NO PHYSICAL ID: " + (device == null ? "device=null" : describe(device)));
            return true;
        }
        append(describe(device));
        if (learning != -1) {
            int other = 1 - learning;
            if (assigned[other] == id) {
                status.setText("ROVNAKE ID " + id + ": tento vstup uz patri Timu "
                    + (other + 1) + ". Stlac druhy fyzicky kliker.");
                append("SAME DEVICE: oba stlacene vstupy maju ID=" + id
                    + ". Ak si stlacil druhy kliker, Android ich zatial nerozlisil.");
                return true;
            }
            int team = learning;
            assigned[team] = id;
            descriptors[team] = device.getDescriptor();
            presses[team] = 0;
            lastPress[team] = -1;
            learning = -1;
            updateButtons();
            status.setText("Tim " + (team + 1) + " priradeny: ID " + id
                + ". Toto je iba test, skore sa nemeni.");
            append("ASSIGNED Team " + (team + 1) + " id=" + id);
            if (assigned[0] != -1 && assigned[1] != -1) {
                append("DISTINCT IDs: " + assigned[0] + " / " + assigned[1]
                    + ". Over striedanim oboch klikrov. Rozdielne ID same o sebe este nepotvrdzuju spravne priradenie.");
            }
            return true;
        }
        int team = assigned[0] == id ? 0 : assigned[1] == id ? 1 : -1;
        if (team == -1) {
            status.setText("Nepriradeny vstup ID " + id + ". Pouzi tlacidlo Prirad Tim.");
            return true;
        }
        long now = SystemClock.uptimeMillis();
        long gap = lastPress[team] < 0 ? -1 : now - lastPress[team];
        lastPress[team] = now;
        presses[team]++;
        String timing = gap < 0 ? "" : " | odstup " + gap + " ms";
        String doubleClick = gap >= 60 && gap < 350 ? " | DVOJKLIK <350 ms" : "";
        status.setText("TIM " + (team + 1) + " | ID " + id + " | stlaceni " + presses[team]
            + timing + doubleClick + "\nIba diagnostika - ziadne body sa nemenia.");
        append("TEAM " + (team + 1) + timing + doubleClick);
        return true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        inputs.registerInputDeviceListener(this, null);
        showDevices();
    }

    @Override
    protected void onPause() {
        inputs.unregisterInputDeviceListener(this);
        resetAssignments();
        status.setText("Test pozastaveny. Po navrate prirad oba klikre znova.");
        append("PAUSED: priradenia zrusene, aby sa nepouzili stare ID zariadeni.");
        super.onPause();
    }

    @Override
    public void onInputDeviceAdded(int id) {
        showDevices();
        append("DEVICE ADDED id=" + id);
    }

    @Override
    public void onInputDeviceRemoved(int id) {
        if (assigned[0] == id || assigned[1] == id) {
            resetAssignments();
            status.setText("Kliker odpojeny (ID " + id + "). Prirad oba klikre znova.");
        }
        showDevices();
        append("DEVICE REMOVED id=" + id);
    }

    @Override
    public void onInputDeviceChanged(int id) {
        InputDevice device = InputDevice.getDevice(id);
        for (int team = 0; team < 2; team++) {
            if (assigned[team] == id && (device == null || !device.getDescriptor().equals(descriptors[team]))) {
                resetAssignments();
                status.setText("Identita zariadenia sa zmenila. Prirad oba klikre znova.");
                break;
            }
        }
        showDevices();
        append("DEVICE CHANGED id=" + id);
    }
}
