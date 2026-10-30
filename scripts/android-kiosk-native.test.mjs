import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const javaHome = process.env.JAVA_HOME || path.join(process.env.LOCALAPPDATA || '', 'RivaAndroidTools', 'jdk-17.0.20.1+1')
const javac = path.join(javaHome, 'bin', 'javac.exe')
const java = path.join(javaHome, 'bin', 'java.exe')

test('native kiosk routes same-key devices, reports receipt and failures, and accepts kiosk entry URLs', {
  skip: !existsSync(javac) ? 'Local JDK unavailable; run with JAVA_HOME set.' : false,
}, () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'riva-kiosk-test-'))
  const files = {
    'android/Manifest.java': `package android; public class Manifest {
      public static class permission { public static final String CAMERA="camera"; }
    }`,
    'android/os/Bundle.java': 'package android.os; public class Bundle {}',
    'android/graphics/Bitmap.java': 'package android.graphics; public class Bitmap {}',
    'android/text/InputType.java': `package android.text; public class InputType {
      public static final int TYPE_CLASS_TEXT=1, TYPE_TEXT_VARIATION_URI=2;
    }`,
    'android/content/pm/PackageManager.java': `package android.content.pm;
      public class PackageManager { public static final int PERMISSION_GRANTED=0; }`,
    'android/content/SharedPreferences.java': `package android.content;
      public class SharedPreferences {
        public String getString(String key, String fallback) { return fallback; }
        public SharedPreferences edit() { return this; }
        public SharedPreferences putString(String key, String value) { return this; }
        public void apply() {}
      }`,
    'android/view/WindowManager.java': `package android.view; public class WindowManager {
      public static class LayoutParams { public static final int FLAG_KEEP_SCREEN_ON=128; }
    }`,
    'android/view/Window.java': 'package android.view; public class Window { public void addFlags(int flags) {} }',
    'android/view/WindowInsets.java': `package android.view; public class WindowInsets {
      public int getSystemWindowInsetLeft(){return 0;} public int getSystemWindowInsetTop(){return 0;}
      public int getSystemWindowInsetRight(){return 0;} public int getSystemWindowInsetBottom(){return 0;}
    }`,
    'android/view/View.java': `package android.view; public class View {
      public static final int VISIBLE=0,INVISIBLE=4,GONE=8;
      public int visibility=VISIBLE; public boolean enabled=true;
      public interface Listener { void click(View view); }
      public interface InsetsListener { WindowInsets apply(View view, WindowInsets insets); }
      public Listener listener; public boolean focused=true;
      public void setOnClickListener(Listener value){listener=value;}
      public void setOnApplyWindowInsetsListener(InsetsListener value){}
      public void setPadding(int a,int b,int c,int d){}
      public void setVisibility(int value){visibility=value;} public void setEnabled(boolean value){enabled=value;}
      public boolean requestFocus(){focused=true;return true;} public boolean hasFocus(){return focused;}
    }`,
    'android/widget/TextView.java': `package android.widget; public class TextView extends android.view.View {
      private String text=""; public TextView(Object context){}
      public void setText(String value){text=value;} public CharSequence getText(){return text;}
      public void setTextSize(int size){}
    }`,
    'android/widget/EditText.java': `package android.widget; public class EditText extends TextView {
      public EditText(Object context){super(context);} public void setSingleLine(boolean value){}
      public void setHint(String value){} public void setInputType(int value){}
    }`,
    'android/widget/Button.java': `package android.widget; public class Button extends TextView {
      public Button(Object context){super(context);}
    }`,
    'android/widget/LinearLayout.java': `package android.widget; public class LinearLayout extends android.view.View {
      public static final int VERTICAL=1; public LinearLayout(Object context){}
      public void setOrientation(int value){} public void addView(android.view.View view){}
      public void addView(android.view.View view,LayoutParams params){}
      public static class LayoutParams { public LayoutParams(int a,int b){} public LayoutParams(int a,int b,int c){} }
    }`,
    'android/widget/Toast.java': `package android.widget; public class Toast {
      public static final int LENGTH_LONG=1;
      public static Toast makeText(Object context,String text,int length){return new Toast();}
      public void show(){}
    }`,
    'android/hardware/input/InputManager.java': `package android.hardware.input; public class InputManager {
      public interface InputDeviceListener {
        void onInputDeviceAdded(int id); void onInputDeviceRemoved(int id); void onInputDeviceChanged(int id);
      }
      public void registerInputDeviceListener(InputDeviceListener listener,Object handler){}
      public void unregisterInputDeviceListener(InputDeviceListener listener){}
    }`,
    'android/view/InputDevice.java': `package android.view; public class InputDevice {
      public static java.util.Map<Integer,InputDevice> devices=new java.util.HashMap<>();
      private String descriptor; private boolean virtual;
      public InputDevice(String value,boolean flag){descriptor=value;virtual=flag;}
      public String getDescriptor(){return descriptor;} public boolean isVirtual(){return virtual;}
      public String getName(){return "AB Shutter3";}
    }`,
    'android/view/KeyEvent.java': `package android.view; public class KeyEvent {
      public static final int ACTION_DOWN=0,ACTION_UP=1,KEYCODE_VOLUME_UP=24,KEYCODE_VOLUME_DOWN=25,
        KEYCODE_VOLUME_MUTE=164,KEYCODE_CAMERA=27,KEYCODE_FOCUS=80,KEYCODE_HEADSETHOOK=79,
        KEYCODE_MEDIA_PLAY_PAUSE=85,KEYCODE_MEDIA_PLAY=126,KEYCODE_MEDIA_PAUSE=127,
        KEYCODE_ENTER=66,KEYCODE_SPACE=62;
      private int id,key,action,repeat;
      public KeyEvent(int device,int code,int kind,int repeats){id=device;key=code;action=kind;repeat=repeats;}
      public int getDeviceId(){return id;} public int getKeyCode(){return key;}
      public int getAction(){return action;} public int getRepeatCount(){return repeat;}
      public InputDevice getDevice(){return InputDevice.devices.get(id);}
      public static String keyCodeToString(int key){return "KEY_"+key;}
    }`,
    'android/app/Activity.java': `package android.app; public class Activity {
      public static final String INPUT_SERVICE="input"; public static final int MODE_PRIVATE=0;
      public int passed=0; public void onCreate(android.os.Bundle state){}
      public Object getSystemService(String key){return new android.hardware.input.InputManager();}
      public android.view.Window getWindow(){return new android.view.Window();}
      public void setContentView(android.view.View view){}
      public android.content.SharedPreferences getPreferences(int mode){return new android.content.SharedPreferences();}
      public void runOnUiThread(Runnable task){task.run();} public int checkSelfPermission(String permission){return 0;}
      public void requestPermissions(String[] permissions,int code){}
      public boolean dispatchKeyEvent(android.view.KeyEvent event){passed++;return false;}
      public void onRequestPermissionsResult(int code,String[] permissions,int[] results){}
      protected void onResume(){} protected void onPause(){} protected void onDestroy(){}
    }`,
    'android/net/Uri.java': `package android.net; public class Uri {
      private java.net.URI value; private Uri(String text){value=java.net.URI.create(text);}
      public static Uri parse(String text){return new Uri(text);}
      public String getScheme(){return value.getScheme();} public String getHost(){return value.getHost();}
      public String getUserInfo(){return value.getUserInfo();} public String getEncodedAuthority(){return value.getRawAuthority();}
      public String getPath(){return value.getPath();}
      public String getQueryParameter(String key){
        String query=value.getRawQuery(); if(query==null)return null;
        for(String pair:query.split("&")){String[] parts=pair.split("=",2);
          if(parts[0].equals(key))return parts.length==2?parts[1]:"";}
        return null;
      }
      public String toString(){return value.toString();}
    }`,
    'android/webkit/WebSettings.java': `package android.webkit; public class WebSettings {
      public void setJavaScriptEnabled(boolean value){} public void setDomStorageEnabled(boolean value){}
      public void setAllowFileAccess(boolean value){} public void setAllowContentAccess(boolean value){}
      public String getUserAgentString(){return "Android";} public void setUserAgentString(String value){}
    }`,
    'android/webkit/WebView.java': `package android.webkit; public class WebView extends android.view.View {
      public interface Callback {void result(String value);}
      public java.util.List<String> scripts=new java.util.ArrayList<>();
      public String url, result="\\"handled\\""; public WebViewClient client;
      public WebView(Object context){} public WebSettings getSettings(){return new WebSettings();}
      public void setWebViewClient(WebViewClient value){client=value;} public void setWebChromeClient(WebChromeClient value){}
      public void loadUrl(String value){url=value;} public String getUrl(){return url;}
      public void evaluateJavascript(String script,Callback callback){scripts.add(script);if(callback!=null)callback.result(result);}
      public void onResume(){} public void onPause(){} public void destroy(){}
    }`,
    'android/webkit/WebResourceRequest.java': `package android.webkit; public class WebResourceRequest {
      public android.net.Uri getUrl(){return android.net.Uri.parse("https://www.rivapadel.app/kiosk");}
      public boolean isForMainFrame(){return true;}
    }`,
    'android/webkit/WebResourceError.java': `package android.webkit; public class WebResourceError {
      public CharSequence getDescription(){return "offline";}
    }`,
    'android/webkit/WebResourceResponse.java': `package android.webkit; public class WebResourceResponse {
      public int getStatusCode(){return 500;}
    }`,
    'android/webkit/WebViewClient.java': `package android.webkit; public class WebViewClient {
      public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return false;}
      public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){}
      public void onPageFinished(WebView view,String url){}
      public void doUpdateVisitedHistory(WebView view,String url,boolean reload){}
      public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){}
      public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){}
    }`,
    'android/webkit/WebChromeClient.java': `package android.webkit; public class WebChromeClient {
      public void onPermissionRequest(PermissionRequest request){}
      public void onPermissionRequestCanceled(PermissionRequest request){}
    }`,
    'android/webkit/PermissionRequest.java': `package android.webkit; public class PermissionRequest {
      public static final String RESOURCE_VIDEO_CAPTURE="video";
      public android.net.Uri getOrigin(){return android.net.Uri.parse("https://www.rivapadel.app");}
      public String[] getResources(){return new String[]{RESOURCE_VIDEO_CAPTURE};}
      public void deny(){} public void grant(String[] resources){}
    }`,
    'sk/rivapadel/kiosk/NativeTest.java': `package sk.rivapadel.kiosk;
      import android.view.*; import android.widget.*; import android.webkit.*;
      public class NativeTest {
        static void check(boolean value,String label){if(!value)throw new AssertionError(label);}
        static Object field(MainActivity app,String name)throws Exception{
          java.lang.reflect.Field field=MainActivity.class.getDeclaredField(name);field.setAccessible(true);return field.get(app);
        }
        static boolean key(MainActivity app,int id,int code,int action,int repeat){
          return app.dispatchKeyEvent(new KeyEvent(id,code,action,repeat));
        }
        static void open(MainActivity app,String url)throws Exception{
          ((EditText)field(app,"address")).setText(url);
          java.lang.reflect.Method method=MainActivity.class.getDeclaredMethod("openKiosk");method.setAccessible(true);method.invoke(app);
        }
        public static void main(String[] args)throws Exception{
          MainActivity app=new MainActivity();app.onCreate(null);app.onResume();
          WebView web=(WebView)field(app,"web"); TextView status=(TextView)field(app,"status");
          TextView receipt=(TextView)field(app,"inputStatus");
          check(web.url.equals("https://www.rivapadel.app/kiosk"),"default RIVA URL");
          open(app,"https://www.rivapadel.app/match?mode=kiosk");
          check(web.url.endsWith("/match?mode=kiosk"),"accept kiosk match URL");
          open(app,"https://www.rivapadel.app/match?mode=normal");
          check(web.url.endsWith("/match?mode=kiosk"),"reject non-kiosk entry");
          open(app,"http://www.rivapadel.app/kiosk");
          check(web.url.startsWith("https:"),"reject HTTP");
          InputDevice.devices.put(16,new InputDevice("first",false));
          InputDevice.devices.put(17,new InputDevice("second",false));
          Button[] buttons=(Button[])field(app,"buttons");
          web.url="https://www.rivapadel.app/match?id=first&mode=kiosk";
          web.client.doUpdateVisitedHistory(web,web.url,false);
          Button begin=(Button)field(app,"beginMatch");
          check(web.visibility==View.INVISIBLE&&!begin.enabled,"block touch before assignment");
          check(!buttons[1].enabled,"team one first");
          web.scripts.clear();
          InputDevice.devices.put(1,new InputDevice("virtual",true));
          key(app,1,24,0,0);
          check(!begin.enabled&&!buttons[1].enabled,"virtual input cannot confirm team one");
          key(app,16,24,0,0);
          check(web.visibility==View.INVISIBLE&&!begin.enabled,"first device not enough");
          buttons[1].listener.click(buttons[1]);key(app,16,24,0,0);
          check(status.getText().toString().contains("ROVNAKE ID"),"reject duplicate");
          key(app,17,24,0,0);check(buttons[1].getText().toString().contains("17"),"show team ID");
          check(begin.enabled&&web.visibility==View.INVISIBLE,"require explicit continuation");
          for(String script:web.scripts)check(!script.contains("KeyboardEvent"),"assignment never scores");
          web.scripts.clear();key(app,16,24,0,0);
          check(web.scripts.isEmpty(),"no scoring before continuation");
          begin.listener.click(begin);
          check(web.visibility==View.VISIBLE,"unlock after confirmation");
          web.client.doUpdateVisitedHistory(web,web.url,true);
          check(web.visibility==View.VISIBLE,"same match history keeps confirmation");
          web.scripts.clear();
          check(key(app,16,24,0,0),"consume first");check(web.scripts.get(0).contains("F13"),"team A");
          check(key(app,17,24,0,0),"consume second");check(web.scripts.get(1).contains("F14"),"team B");
          key(app,17,24,1,0);key(app,17,24,0,1);
          check(web.scripts.size()==2,"no repeats or release scoring");
          check(receipt.getText().toString().contains("ID 17"),"receipt survives releases");
          web.focused=false;key(app,16,24,0,0);check(web.scripts.size()==2,"focus guard");web.focused=true;
          web.result="\\"unhandled\\"";key(app,16,24,0,0);
          check(status.getText().toString().contains("neprijal"),"report web rejection");
          check(web.client.shouldOverrideUrlLoading(web,new WebResourceRequest(){
            public android.net.Uri getUrl(){return android.net.Uri.parse("https://evil.example/match");}
          }),"origin restriction");
          web.client.onPageStarted(web,web.url,null);
          web.client.onReceivedError(web,new WebResourceRequest(),new WebResourceError());
          web.client.onPageFinished(web,web.url);
          check(status.getText().toString().contains("offline"),"preserve network error");
          app.onPause();web.scripts.clear();key(app,16,24,0,0);
          check(web.scripts.isEmpty()&&status.getText().toString().contains("popredi"),"paused receipt no scoring");
          app.onResume();
          check(web.visibility==View.INVISIBLE&&!begin.enabled,"reconfirm after pause");
          key(app,16,164,0,0);
          check(!begin.enabled,"reset on pause and accept first mute assignment");
          key(app,17,24,0,0);begin.listener.click(begin);
          web.url="https://www.rivapadel.app/match?id=second&mode=kiosk";
          web.client.doUpdateVisitedHistory(web,web.url,false);
          check(web.visibility==View.INVISIBLE&&!begin.enabled,"new match requires new confirmation");
          key(app,16,24,0,0);key(app,17,24,0,0);begin.listener.click(begin);
          app.onInputDeviceRemoved(17);
          check(web.visibility==View.INVISIBLE&&!begin.enabled,"disconnect locks match");
          web.url="https://www.rivapadel.app/match?id=third&mode=kiosk";
          web.client.onPageStarted(web,web.url,null);
          check(web.visibility==View.INVISIBLE&&!buttons[1].enabled,"full navigation locks match");
          web.url="https://www.rivapadel.app/match?mode=kiosk";
          web.client.doUpdateVisitedHistory(web,web.url,false);
          check(web.visibility==View.VISIBLE&&begin.visibility==View.GONE,"game selection remains available");
          check(app.passed==0,"never pass clickers to volume handling");
          System.out.println("Native kiosk assertions passed");
        }
      }`,
  }
  try {
    const sources = []
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(folder, name)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, content)
      sources.push(file)
    }
    sources.push(path.resolve('android', 'kiosk', 'src', 'sk', 'rivapadel', 'kiosk', 'MainActivity.java'))
    execFileSync(javac, ['-encoding', 'UTF-8', '--release', '8', '-d', folder, ...sources], { stdio: 'pipe' })
    const output = execFileSync(java, ['-cp', folder, 'sk.rivapadel.kiosk.NativeTest'], { encoding: 'utf8' })
    assert.match(output, /Native kiosk assertions passed/)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
