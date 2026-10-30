package sk.rivapadel.fullyclicker;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.hardware.input.InputManager;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;
import java.util.HashSet;
import java.util.Set;

public final class ClickerService extends AccessibilityService implements InputManager.InputDeviceListener {
    static final String FULLY = "com.fullykiosk.browser";
    static ClickerService instance;
    private final int[] assigned = {-1, -1};
    private final String[] descriptors = {null, null};
    private final Set<String> held = new HashSet<>();
    private String foreground = "";
    private int learning = -1;
    String status = "Prirad oba klikre.";
    private InputManager inputs;

    @Override protected void onServiceConnected() {
        instance = this;
        inputs = (InputManager) getSystemService(INPUT_SERVICE);
        inputs.registerInputDeviceListener(this, null);
        update("Sluzba zapnuta. Prirad oba klikre.");
    }

    void learn(int team) {
        if (team != 0 && team != 1) return;
        if (MainActivity.visible == null || !MainActivity.visible.hasWindowFocus()) return;
        foreground = getPackageName();
        learning = team;
        update("Stlac iba fyzicky kliker pre Tim " + (team + 1) + ".");
    }

    void reset() {
        learning = -1;
        for (int i = 0; i < 2; i++) { assigned[i] = -1; descriptors[i] = null; }
        update("Priradenia vymazane. Prirad oba klikre.");
    }

    private void update(String text) {
        status = text;
        if (MainActivity.visible != null) MainActivity.visible.refresh();
    }

    String teamLabel(int team) {
        return "Tim " + (team + 1) + (assigned[team] < 0 ? ": nepriradeny" : ": ID " + assigned[team]);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && event.getPackageName() != null) {
            foreground = event.getPackageName().toString();
            if (!foreground.equals(getPackageName())) learning = -1;
        }
    }

    private static boolean shutter(int key) {
        return key == KeyEvent.KEYCODE_VOLUME_UP || key == KeyEvent.KEYCODE_VOLUME_DOWN
            || key == KeyEvent.KEYCODE_VOLUME_MUTE || key == KeyEvent.KEYCODE_CAMERA
            || key == KeyEvent.KEYCODE_FOCUS || key == KeyEvent.KEYCODE_HEADSETHOOK
            || key == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || key == KeyEvent.KEYCODE_MEDIA_PLAY
            || key == KeyEvent.KEYCODE_MEDIA_PAUSE || key == KeyEvent.KEYCODE_ENTER
            || key == KeyEvent.KEYCODE_SPACE;
    }

    @Override protected boolean onKeyEvent(KeyEvent event) {
        String press = event.getDeviceId() + ":" + event.getKeyCode();
        if (event.getAction() == KeyEvent.ACTION_UP) return held.remove(press);
        if (event.getAction() != KeyEvent.ACTION_DOWN || !shutter(event.getKeyCode())) return false;
        if (held.contains(press)) return true;
        boolean assigning = learning >= 0 && foreground.equals(getPackageName());
        if (!assigning && !FULLY.equals(foreground)) return false;
        InputDevice device = event.getDevice();
        if (device == null || device.isVirtual()) {
            update("Vstup nema fyzicku identitu. Nedokazem urcit tim.");
            return false;
        }
        int id = event.getDeviceId();
        int team = assigned[0] == id ? 0 : assigned[1] == id ? 1 : -1;
        if (!assigning && team < 0 && (event.getKeyCode() == KeyEvent.KEYCODE_ENTER
            || event.getKeyCode() == KeyEvent.KEYCODE_SPACE)) return false;
        held.add(press);
        if (event.getRepeatCount() != 0) return true;
        if (assigning) {
            int slot = learning;
            if (assigned[1 - slot] == id) {
                update("ROVNAKE ID: stlac druhy fyzicky kliker.");
                return true;
            }
            assigned[slot] = id;
            descriptors[slot] = device.getDescriptor();
            learning = -1;
            update("Tim " + (slot + 1) + " priradeny: ID " + id + ".");
            return true;
        }
        if (team < 0) {
            update("Nepriradeny kliker ID " + id + ". Vrat sa sem a prirad ho.");
            return true;
        }
        if (!device.getDescriptor().equals(descriptors[team])) {
            reset();
            update("Identita klikra sa zmenila. Prirad oba klikre znova.");
            return true;
        }
        if (assigned[0] < 0 || assigned[1] < 0) {
            update("Najprv prirad oba klikre.");
            return true;
        }
        String code = getSharedPreferences("bridge", MODE_PRIVATE).getString("code", "");
        if (!code.matches("[a-f0-9]{32}")) {
            update("Chyba parovaci kod. Otvor RIVA Fully Clicker.");
            return true;
        }
        sendBroadcast(new Intent("sk.rivapadel.clicker." + code + (team == 0 ? ".TEAM_A" : ".TEAM_B"))
            .setPackage(FULLY));
        update("Tim " + (team + 1) + ": odoslane do Fully. Ulozenie bodu over v RIVA.");
        return true;
    }

    @Override public void onInterrupt() {
        foreground = "";
        held.clear();
        reset();
    }

    @Override public void onDestroy() {
        if (inputs != null) inputs.unregisterInputDeviceListener(this);
        if (instance == this) instance = null;
        if (MainActivity.visible != null) MainActivity.visible.refresh();
        super.onDestroy();
    }

    private void invalidate(int id) {
        if (assigned[0] == id || assigned[1] == id) {
            reset();
            update("Kliker sa zmenil alebo odpojil. Prirad oba znova.");
        }
    }
    @Override public void onInputDeviceAdded(int id) {}
    @Override public void onInputDeviceRemoved(int id) { invalidate(id); }
    @Override public void onInputDeviceChanged(int id) { invalidate(id); }
}
