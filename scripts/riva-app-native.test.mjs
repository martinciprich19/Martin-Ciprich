import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const javaHome = process.env.JAVA_HOME || path.join(process.env.LOCALAPPDATA || '', 'RivaAndroidTools', 'jdk-17.0.20.1+1')
const javac = path.join(javaHome, 'bin', 'javac.exe')
const java = path.join(javaHome, 'bin', 'java.exe')
const native = path.resolve('android', 'riva-app', 'src', 'sk', 'rivapadel', 'apptest')

test('full RIVA app has isolated identity, full home entry, file picker and camera support', () => {
  const manifest = readFileSync(path.resolve('android', 'riva-app', 'AndroidManifest.xml'), 'utf8')
  assert.match(manifest, /package="sk\.rivapadel\.apptest"/)
  assert.doesNotMatch(manifest, /BIND_ACCESSIBILITY_SERVICE|READ_EXTERNAL_STORAGE|RECORD_AUDIO/)
  const source = readFileSync(path.join(native, 'MainActivity.java'), 'utf8')
  assert.match(source, /navigate\(AppPolicy.resumable\(rememberedMatch\) \? rememberedMatch : AppPolicy.HOME\)/)
  assert.match(source, /onRenderProcessGone/)
  const pause = source.slice(source.indexOf('@Override protected void onPause()'), source.indexOf('@Override protected void onDestroy()'))
  assert.doesNotMatch(pause, /clickers.reset\(\)/)
  assert.match(pause, /clickers.pause\(\)/)
  assert.match(source, /ACTION_OPEN_DOCUMENT/)
  assert.match(source, /RESOURCE_VIDEO_CAPTURE/)
  assert.match(source, /setMediaPlaybackRequiresUserGesture\(false\)/)
  assert.match(source, /doUpdateVisitedHistory/)
  assert.match(source, /controller.hide\(WindowInsets.Type.systemBars\(\)\)/)
  assert.match(source, /BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE/)
  assert.match(source, /onWindowFocusChanged/)
  assert.doesNotMatch(source, /root.addView\((bar|status|receipt)\)/)
  assert.match(source, /root.addView\(setupScroll,/)
  assert.match(source, /Skusit znova/)
  assert.match(source, /"viewer"\.equals\(uri.getQueryParameter\("view"\)\)/)
  assert.doesNotMatch(source, /addJavascriptInterface|setAcceptThirdPartyCookies\(web, true\)/)
})

test('native window, system bars and WebView use the RIVA dark background', () => {
  const manifest = readFileSync(path.resolve('android', 'riva-app', 'AndroidManifest.xml'), 'utf8')
  const theme = readFileSync(path.resolve('android', 'riva-app', 'res', 'values', 'styles.xml'), 'utf8')
  const source = readFileSync(path.join(native, 'MainActivity.java'), 'utf8')
  assert.match(manifest, /android:theme="@style\/RivaTheme"/)
  assert.match(manifest, /android:versionCode="7" android:versionName="1.6"/)
  assert.match(theme, /parent="android:style\/Theme.Material.NoActionBar"/)
  assert.match(theme, /name="riva_background">#061016</)
  for (const item of ['windowBackground', 'colorBackground', 'statusBarColor', 'navigationBarColor']) {
    assert.ok(theme.includes(`name="android:${item}">@color/riva_background</item>`))
  }
  assert.match(theme, /name="android:windowLightStatusBar">false</)
  assert.match(theme, /name="android:windowLightNavigationBar">false</)
  assert.match(source, /BACKGROUND_COLOR = Color.rgb\(6, 16, 22\)/)
  assert.match(source, /root.setBackgroundColor\(BACKGROUND_COLOR\)/)
  assert.match(source, /web.setBackgroundColor\(BACKGROUND_COLOR\)/)
})

test('native assignment uses RIVA team cards, scrollable layout and stateful confirmation', () => {
  const source = readFileSync(path.join(native, 'MainActivity.java'), 'utf8')
  assert.match(source, /new ScrollView\(this\)/)
  assert.match(source, /setupScroll.setFillViewport\(true\)/)
  assert.match(source, /setupScroll.setVisibility\(blocked \? View.VISIBLE : View.GONE\)/)
  assert.match(source, /ACCESSIBILITY_LIVE_REGION_POLITE/)
  assert.match(source, /teamCards\[team\].setBackground\(panel/)
  assert.match(source, /Color.rgb\(168, 230, 60\)/)
  assert.match(source, /Color.rgb\(141, 207, 235\)/)
  assert.match(source, /continueMatch.setEnabled\(ready\)/)
  assert.match(source, /!foreground \|\| !clickers.confirm\(\)/)
})

test('real native clicker session and navigation policy preserve team identity and confirmation', {
  skip: !existsSync(javac) ? 'Local JDK unavailable; set JAVA_HOME.' : false,
}, () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'riva-app-test-'))
  try {
    const harness = path.join(folder, 'NativeTest.java')
    writeFileSync(harness, `
      package sk.rivapadel.apptest;
      public class NativeTest {
        static void check(boolean value,String name){if(!value)throw new AssertionError(name);}
        public static void main(String[] args) {
          check(AppPolicy.trusted(AppPolicy.HOME),"home");
          check(AppPolicy.trusted("https://www.rivapadel.app:443/profile?view=overview#arenas"),"full routes");
          check(!AppPolicy.trusted("https://www.rivapadel.app.evil.example/"),"suffix");
          check(!AppPolicy.trusted("https://user@www.rivapadel.app/"),"userinfo");
          check(!AppPolicy.trusted("http://www.rivapadel.app/"),"cleartext");
          check(!AppPolicy.trusted("https://www.rivapadel.app:8080/"),"other port");
          check(!AppPolicy.trusted("javascript:alert(1)"),"script");
          check(!AppPolicy.trusted("https://[invalid"),"malformed");
          check(!AppPolicy.trusted(null),"null");
          check(AppPolicy.resumable("https://www.rivapadel.app/match?id=ec2db372-4940-41af-9466-5e94e1afd54d&mode=kiosk"),"resume match");
          check(!AppPolicy.resumable("https://evil.example/match?id=ec2db372-4940-41af-9466-5e94e1afd54d"),"no external resume");
          check(!AppPolicy.resumable(AppPolicy.HOME),"home not match");
          check(!AppPolicy.resumable("https://www.rivapadel.app/match?mode=kiosk"),"selection not match");
          ClickerSession s=new ClickerSession();
          check(!s.blocked()&&!s.confirm(),"selection accessible");
          check(s.track("match1")&&s.blocked(),"match locks");
          check(!s.assign(1,"virtual",true),"no virtual assignment");
          check(!s.assign(1,null,false),"descriptor needed");
          check(s.press(16,24,0)&&s.assign(16,"first",false),"first volume clicker");
          check(!s.press(16,24,0)&&!s.press(16,24,1),"held and repeat suppressed");
          s.release(16,24);
          check(!s.assign(16,"first",false),"duplicate ID");
          check(!s.confirm(),"both required");
          check(s.press(17,24,0)&&s.assign(17,"second",false),"second same volume key");
          check(!s.confirm(),"release before continue");
          s.release(17,24);
          check(s.confirm()&&!s.blocked(),"confirm distinct devices");
          check(s.team(16,"first")==0&&s.team(17,"second")==1,"correct mapping");
          check(s.team(16,"reconnected")==-1,"descriptor mismatch");
          check(s.press(16,24,0)&&s.press(17,24,0),"independent simultaneous presses");
          s.release(16,24);s.release(17,24);
          s.press(16,24,0);s.pause();
          check(!s.blocked()&&s.team(16,"first")==0&&s.team(17,"second")==1,"pause preserves confirmed assignments");
          check(s.press(16,24,0),"pause clears held state");
          s.release(16,24);
          for(int i=0;i<1000;i++){
            check(s.press(16,24,0),"rapid first press");s.release(16,24);
            check(s.press(17,24,0),"rapid second press");s.release(17,24);
            check(!s.blocked(),"rapid presses never reset setup");
          }
          check(!s.track("match1")&&!s.blocked(),"same match preserves");
          check(s.invalidates(16)&&s.invalidates(17)&&!s.invalidates(99),"invalidation");
          s.reset();check(s.blocked()&&s.nextTeam()==0,"pause and disconnect lock");
          check(s.track("match2")&&s.blocked(),"rematch locks");
          check(s.track(null)&&!s.blocked()&&s.team(16,"first")==-1,"leave match clears");
          System.out.println("RIVA native assertions passed");
        }
      }`)
    execFileSync(javac, ['-encoding', 'UTF-8', '--release', '8', '-d', folder,
      path.join(native, 'AppPolicy.java'), path.join(native, 'ClickerSession.java'), harness], { stdio: 'pipe' })
    const output = execFileSync(java, ['-cp', folder, 'sk.rivapadel.apptest.NativeTest'], { encoding: 'utf8' })
    assert.match(output, /RIVA native assertions passed/)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
