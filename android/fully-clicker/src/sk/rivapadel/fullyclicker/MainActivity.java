package sk.rivapadel.fullyclicker;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.util.UUID;

public final class MainActivity extends Activity {
    static MainActivity visible;
    private TextView status;
    private final Button[] teams = new Button[2];
    private String code;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        code = getSharedPreferences("bridge", MODE_PRIVATE).getString("code", "");
        if (!code.matches("[a-f0-9]{32}")) {
            code = UUID.randomUUID().toString().replace("-", "");
            getSharedPreferences("bridge", MODE_PRIVATE).edit().putString("code", code).apply();
        }
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(24, 24, 24, 24);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(24 + insets.getSystemWindowInsetLeft(), 24 + insets.getSystemWindowInsetTop(),
                24 + insets.getSystemWindowInsetRight(), 24 + insets.getSystemWindowInsetBottom());
            return insets;
        });
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(root);
        setContentView(scroll);
        TextView title = new TextView(this);
        title.setText("RIVA Fully Clicker 1.0\n"
            + "Most pre Fully Kiosk Browser. Nie testovacia aplikacia.\n\n"
            + "Povol sluzbu v Pristupnosti. Zachytava klavesy pri priradovani a vo Fully, "
            + "necita obsah obrazovky a nepouziva internet. Pre ine aplikacie klavesy neblokuje.\n"
            + "Vo Fully povol JavaScript Interface (PLUS) a URL Whitelist iba pre RIVA domenu.");
        root.addView(title);
        add(root, "1. Nastavenia Pristupnosti", () -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        for (int i = 0; i < 2; i++) {
            final int team = i;
            teams[i] = add(root, "Prirad Tim " + (i + 1), () -> {
                if (ClickerService.instance == null) toast("Najprv povol sluzbu v Pristupnosti.");
                else ClickerService.instance.learn(team);
            });
        }
        TextView pairing = new TextView(this);
        pairing.setText("Parovaci kod (nezverejnuj):\n" + code);
        pairing.setTextIsSelectable(true);
        root.addView(pairing);
        add(root, "Kopirovat kod", () -> {
            ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE))
                .setPrimaryClip(ClipData.newPlainText("RIVA Fully pairing", code));
            toast("Kod skopirovany. Vloz ho do RIVA v casti Prepojenie s Fully Kiosk.");
        });
        add(root, "Otvorit Fully Kiosk", () -> {
            Intent launch = getPackageManager().getLaunchIntentForPackage(ClickerService.FULLY);
            if (launch == null) toast("Fully Kiosk Browser com.fullykiosk.browser nie je nainstalovany.");
            else startActivity(launch);
        });
        add(root, "Vymazat priradenia", () -> {
            if (ClickerService.instance != null) ClickerService.instance.reset();
        });
        status = new TextView(this);
        status.setAccessibilityLiveRegion(android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(status);
    }

    private Button add(LinearLayout root, String text, Runnable action) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setOnClickListener(v -> action.run());
        root.addView(button);
        return button;
    }

    private void toast(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
    void refresh() {
        if (status == null) return;
        ClickerService service = ClickerService.instance;
        status.setText(service == null ? "Sluzba nie je zapnuta." : service.status);
        for (int i = 0; i < 2; i++)
            teams[i].setText(service == null ? "Prirad Tim " + (i + 1) : service.teamLabel(i));
    }

    @Override protected void onResume() { super.onResume(); visible = this; refresh(); }
    @Override protected void onPause() { visible = null; super.onPause(); }
}
