import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const javaHome = process.env.JAVA_HOME || path.join(process.env.LOCALAPPDATA || '', 'RivaAndroidTools', 'jdk-17.0.20.1+1')
const javac = path.join(javaHome, 'bin', 'javac.exe')
const java = path.join(javaHome, 'bin', 'java.exe')

test('native Fully service gates input, assigns devices, suppresses repeats and emits paired team broadcasts', {
  skip: !existsSync(javac) ? 'Local JDK unavailable; run with JAVA_HOME set.' : false,
}, () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'riva-fully-test-'))
  const files = {
    'android/content/Intent.java': `
      package android.content;
      public class Intent {
        public String action, target;
        public Intent(String value) { action = value; }
        public Intent setPackage(String value) { target = value; return this; }
      }`,
    'android/content/SharedPreferences.java': `
      package android.content;
      public class SharedPreferences {
        public String getString(String key, String fallback) { return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; }
      }`,
    'android/hardware/input/InputManager.java': `
      package android.hardware.input;
      public class InputManager {
        public interface InputDeviceListener {
          void onInputDeviceAdded(int id); void onInputDeviceRemoved(int id); void onInputDeviceChanged(int id);
        }
        public void registerInputDeviceListener(InputDeviceListener listener, Object handler) {}
        public void unregisterInputDeviceListener(InputDeviceListener listener) {}
      }`,
    'android/view/InputDevice.java': `
      package android.view;
      public class InputDevice {
        public static java.util.Map<Integer, InputDevice> devices = new java.util.HashMap<>();
        private String descriptor; private boolean virtual;
        public InputDevice(String value, boolean flag) { descriptor = value; virtual = flag; }
        public boolean isVirtual() { return virtual; }
        public String getDescriptor() { return descriptor; }
      }`,
    'android/view/KeyEvent.java': `
      package android.view;
      public class KeyEvent {
        public static final int ACTION_DOWN=0, ACTION_UP=1,
          KEYCODE_VOLUME_UP=24, KEYCODE_VOLUME_DOWN=25, KEYCODE_VOLUME_MUTE=164,
          KEYCODE_CAMERA=27, KEYCODE_FOCUS=80, KEYCODE_HEADSETHOOK=79,
          KEYCODE_MEDIA_PLAY_PAUSE=85, KEYCODE_MEDIA_PLAY=126, KEYCODE_MEDIA_PAUSE=127,
          KEYCODE_ENTER=66, KEYCODE_SPACE=62;
        private int id, key, action, repeat;
        public KeyEvent(int device, int code, int kind, int repeats) { id=device; key=code; action=kind; repeat=repeats; }
        public int getDeviceId() { return id; } public int getKeyCode() { return key; }
        public int getAction() { return action; } public int getRepeatCount() { return repeat; }
        public InputDevice getDevice() { return InputDevice.devices.get(id); }
      }`,
    'android/view/accessibility/AccessibilityEvent.java': `
      package android.view.accessibility;
      public class AccessibilityEvent {
        public static final int TYPE_WINDOW_STATE_CHANGED=32;
        private String name;
        public AccessibilityEvent(String value) { name=value; }
        public int getEventType() { return TYPE_WINDOW_STATE_CHANGED; }
        public CharSequence getPackageName() { return name; }
      }`,
    'android/accessibilityservice/AccessibilityService.java': `
      package android.accessibilityservice;
      import android.content.*; import android.hardware.input.InputManager;
      import android.view.*; import android.view.accessibility.AccessibilityEvent;
      public abstract class AccessibilityService {
        public static final String INPUT_SERVICE="input"; public static final int MODE_PRIVATE=0;
        public java.util.List<Intent> sent = new java.util.ArrayList<>();
        public Object getSystemService(String key) { return new InputManager(); }
        public String getPackageName() { return "sk.rivapadel.fullyclicker"; }
        public SharedPreferences getSharedPreferences(String key, int mode) { return new SharedPreferences(); }
        public void sendBroadcast(Intent intent) { sent.add(intent); }
        protected void onServiceConnected() {} protected boolean onKeyEvent(KeyEvent event) { return false; }
        public void onDestroy() {}
        public abstract void onAccessibilityEvent(AccessibilityEvent event);
        public abstract void onInterrupt();
      }`,
    'sk/rivapadel/fullyclicker/MainActivity.java': `
      package sk.rivapadel.fullyclicker;
      public class MainActivity {
        public static MainActivity visible = new MainActivity();
        public boolean hasWindowFocus() { return true; }
        public void refresh() {}
      }`,
    'sk/rivapadel/fullyclicker/NativeTest.java': `
      package sk.rivapadel.fullyclicker;
      import android.view.*; import android.view.accessibility.AccessibilityEvent;
      public class NativeTest {
        static void check(boolean value, String label) { if (!value) throw new AssertionError(label); }
        static boolean key(ClickerService service, int device, int code, int action, int repeat) {
          return service.onKeyEvent(new KeyEvent(device, code, action, repeat));
        }
        static void press(ClickerService service, int device) {
          check(key(service,device,24,0,0), "consume down");
          check(key(service,device,24,1,0), "consume up");
        }
        public static void main(String[] args) {
          InputDevice.devices.put(15,new InputDevice("first",false));
          InputDevice.devices.put(14,new InputDevice("second",false));
          ClickerService service = new ClickerService(); service.onServiceConnected();
          service.learn(0); press(service,15);
          service.learn(1); press(service,15);
          check(service.status.contains("ROVNAKE ID"),"same identity rejected");
          press(service,14);
          check(service.teamLabel(0).contains("15"),"first assigned");
          check(service.teamLabel(1).contains("14"),"second assigned");
          check(service.sent.size()==0,"assignment never scores");
          service.onAccessibilityEvent(new AccessibilityEvent("other.app"));
          check(!key(service,15,24,0,0),"outside Fully down passes");
          check(!key(service,15,24,1,0),"outside Fully up passes");
          service.onAccessibilityEvent(new AccessibilityEvent(ClickerService.FULLY));
          check(key(service,15,24,0,0),"Fully down consumed");
          check(key(service,15,24,0,1),"repeat consumed");
          check(service.sent.size()==1,"repeat no extra broadcast");
          check(key(service,15,24,1,0),"release consumed");
          press(service,14);
          check(service.sent.get(0).action.equals("sk.rivapadel.clicker.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.TEAM_A"),"team A action");
          check(service.sent.get(1).action.endsWith(".TEAM_B"),"team B action");
          check(service.sent.get(0).target.equals(ClickerService.FULLY),"package scoped");
          service.onInputDeviceRemoved(15);
          press(service,14);
          check(service.sent.size()==2,"disconnected assignment cannot score");
          check(service.status.contains("Nepriradeny"),"unassigned diagnostic");
          check(!key(service,14,66,0,0),"unassigned Enter preserved");
          check(!key(service,99,24,0,0),"missing identity does not score");
          service.onInterrupt();
          check(!key(service,14,24,0,0),"interrupted service passes through");
          service.onDestroy();
          check(ClickerService.instance==null,"service reference removed");
          System.out.println("Native routing verified");
        }
      }`,
  }
  try {
    const sources = Object.entries(files).map(([name, content]) => {
      const file = path.join(folder, name)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, content)
      return file
    })
    sources.push(path.resolve('android', 'fully-clicker', 'src', 'sk', 'rivapadel', 'fullyclicker', 'ClickerService.java'))
    execFileSync(javac, ['-d', folder, ...sources], { stdio: 'pipe' })
    const output = execFileSync(java, ['-cp', folder, 'sk.rivapadel.fullyclicker.NativeTest'], { encoding: 'utf8' })
    assert.match(output, /Native routing verified/)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
