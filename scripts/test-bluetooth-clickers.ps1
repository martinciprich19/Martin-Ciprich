param(
    [switch]$CheckOnly,
    [switch]$Control,
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This diagnostic requires Windows.'
}
if (-not $CheckOnly -and -not $SelfTest -and [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    throw 'Run with powershell.exe -NoProfile -STA -File .\scripts\test-bluetooth-clickers.ps1'
}

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace RivaClickerDiagnostic
{
    public class MonitorWindow : Form
    {
        private const uint InputSink = 0x100;
        private const uint Remove = 0x1;
        private const uint InputCommand = 0x10000003;
        private const uint DeviceNameCommand = 0x20000007;
        private const int InputMessage = 0x00FF;
        private readonly RichTextBox output;
        private bool registered;

        [StructLayout(LayoutKind.Sequential)]
        private struct RawInputDevice
        {
            public ushort UsagePage;
            public ushort Usage;
            public uint Flags;
            public IntPtr Target;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RawInputHeader
        {
            public uint Type;
            public uint Size;
            public IntPtr Device;
            public IntPtr WParam;
        }

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool RegisterRawInputDevices(
            [In] RawInputDevice[] devices, uint count, uint size);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint GetRawInputData(
            IntPtr input, uint command, IntPtr data, ref uint size, uint headerSize);

        [DllImport("user32.dll", EntryPoint = "GetRawInputDeviceInfoW", SetLastError = true)]
        private static extern uint GetDeviceNameSize(
            IntPtr device, uint command, IntPtr data, ref uint size);

        [DllImport("user32.dll", EntryPoint = "GetRawInputDeviceInfoW",
            CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetDeviceName(
            IntPtr device, uint command, StringBuilder data, ref uint size);

        public MonitorWindow()
        {
            Text = "RIVA - Bluetooth clicker diagnostic (read-only)";
            Width = 1000;
            Height = 650;
            StartPosition = FormStartPosition.CenterScreen;

            var instructions = new Label {
                Dock = DockStyle.Top, Height = 110, Padding = new Padding(12),
                Text = "1. Press ONLY clicker 1 three times. Note Device and Path.\r\n" +
                    "2. Press ONLY clicker 2 three times. Compare Device and Path.\r\n" +
                    "Different nonzero Device IDs / Paths = distinguishable input sources.\r\n" +
                    "No events, zero IDs, or identical sources = not yet proven distinguishable.\r\n" +
                    "This tool does not remap keys, stop volume changes, or change match scores."
            };
            var clear = new Button {
                Dock = DockStyle.Bottom, Height = 36, Text = "Clear log"
            };
            output = new RichTextBox {
                Dock = DockStyle.Fill, ReadOnly = true, WordWrap = false,
                Font = new Font(FontFamily.GenericMonospace, 10)
            };
            clear.Click += delegate { output.Clear(); };
            Controls.Add(output);
            Controls.Add(clear);
            Controls.Add(instructions);
        }

        private static RawInputDevice[] Devices(uint flags, IntPtr target)
        {
            return new[] {
                new RawInputDevice { UsagePage = 0x0C, Usage = 0x01, Flags = flags, Target = target },
                new RawInputDevice { UsagePage = 0x01, Usage = 0x06, Flags = flags, Target = target }
            };
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            try
            {
                var devices = Devices(InputSink, Handle);
                if (!RegisterRawInputDevices(devices, (uint)devices.Length,
                    (uint)Marshal.SizeOf(typeof(RawInputDevice))))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                registered = true;
                Log("READY: listening for Consumer Control HID reports and volume/play keyboard events.");
                Log("No drivers, administrator rights, network, or log files are used.");
                Log("Keyboard letters/passwords are not displayed. Device paths stay in this window.");
            }
            catch (Exception error)
            {
                Log("ERROR: Raw Input registration failed: " + error.Message);
            }
        }

        protected void Log(string text)
        {
            output.AppendText(text + Environment.NewLine);
            output.SelectionStart = output.TextLength;
            output.ScrollToCaret();
        }

        protected void SetInstructions(string text)
        {
            foreach (Control control in Controls)
                if (control is Label) control.Text = text;
        }

        private static string DevicePath(IntPtr device)
        {
            if (device == IntPtr.Zero)
                return "(no physical device identity supplied by Windows)";
            uint count = 0;
            if (GetDeviceNameSize(device, DeviceNameCommand, IntPtr.Zero, ref count) == uint.MaxValue)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            var name = new StringBuilder(checked((int)count + 1));
            if (GetDeviceName(device, DeviceNameCommand, name, ref count) == uint.MaxValue)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            return name.ToString();
        }

        protected virtual void OnConsumerReport(string path, byte[] report) { }

        private void ReadInput(IntPtr input)
        {
            uint headerSize = (uint)Marshal.SizeOf(typeof(RawInputHeader));
            uint size = 0;
            if (GetRawInputData(input, InputCommand, IntPtr.Zero, ref size, headerSize) == uint.MaxValue)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (size < headerSize)
                throw new InvalidOperationException("Raw Input packet is smaller than its header.");
            IntPtr data = Marshal.AllocHGlobal(checked((int)size));
            try
            {
                uint copied = GetRawInputData(input, InputCommand, data, ref size, headerSize);
                if (copied == uint.MaxValue)
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                if (copied != size)
                    throw new InvalidOperationException("Incomplete Raw Input packet.");
                var header = (RawInputHeader)Marshal.PtrToStructure(data, typeof(RawInputHeader));
                IntPtr payload = IntPtr.Add(data, (int)headerSize);
                string signal;
                if (header.Type == 1)
                {
                    if (size < headerSize + 16)
                        throw new InvalidOperationException("Incomplete keyboard packet.");
                    ushort key = unchecked((ushort)Marshal.ReadInt16(payload, 6));
                    if (key != 0xAF && key != 0xAE && key != 0xB3)
                        return;
                    ushort flags = unchecked((ushort)Marshal.ReadInt16(payload, 2));
                    signal = (key == 0xAF ? "VolumeUp" : key == 0xAE ? "VolumeDown" : "MediaPlayPause")
                        + ((flags & 1) != 0 ? " RELEASE" : " PRESS");
                }
                else if (header.Type == 2)
                {
                    if (size < headerSize + 8)
                        throw new InvalidOperationException("Incomplete HID packet.");
                    uint reportSize = unchecked((uint)Marshal.ReadInt32(payload, 0));
                    uint reportCount = unchecked((uint)Marshal.ReadInt32(payload, 4));
                    ulong byteCount = (ulong)reportSize * reportCount;
                    if (byteCount > size - headerSize - 8)
                        throw new InvalidOperationException("Invalid HID report size.");
                    // A bounded preview is sufficient to compare press/release reports.
                    var bytes = new byte[(int)Math.Min(byteCount, 64UL)];
                    Marshal.Copy(IntPtr.Add(payload, 8), bytes, 0, bytes.Length);
                    signal = "Consumer HID reports=" + reportCount + " bytes=" + byteCount
                        + " data=" + BitConverter.ToString(bytes)
                        + (byteCount > 64 ? " (first 64 bytes)" : "");
                    if (header.Device != IntPtr.Zero && reportSize > 0 && reportSize <= 64)
                    {
                        string path = DevicePath(header.Device);
                        for (uint index = 0; index < reportCount; index++)
                        {
                            var report = new byte[(int)reportSize];
                            Marshal.Copy(IntPtr.Add(payload, checked(8 + (int)(index * reportSize))),
                                report, 0, report.Length);
                            OnConsumerReport(path, report);
                        }
                    }
                }
                else return;

                Log(DateTime.Now.ToString("HH:mm:ss.fff") + "  Device=0x"
                    + header.Device.ToInt64().ToString("X") + "  " + signal);
                Log("  Path: " + DevicePath(header.Device));
            }
            finally
            {
                Marshal.FreeHGlobal(data);
            }
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == InputMessage)
            {
                try { ReadInput(message.LParam); }
                catch (Exception error) { Log("ERROR reading input: " + error.Message); }
            }
            base.WndProc(ref message);
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            if (registered)
            {
                var devices = Devices(Remove, IntPtr.Zero);
                if (!RegisterRawInputDevices(devices, (uint)devices.Length,
                    (uint)Marshal.SizeOf(typeof(RawInputDevice))))
                    Console.Error.WriteLine("Raw Input cleanup failed: "
                        + new Win32Exception(Marshal.GetLastWin32Error()).Message);
            }
            base.OnFormClosed(e);
        }

        [STAThread]
        public static void Run()
        {
            Application.EnableVisualStyles();
            using (var window = new MonitorWindow())
                Application.Run(window);
        }
    }

    // These reports were observed on model 497764. Other report layouts are not guessed.
    public class ShutterMapping
    {
        public string Team1 { get; private set; }
        public string Team2 { get; private set; }
        public int Learning { get; private set; }
        public string LastIgnoredReason { get; private set; }
        private readonly System.Collections.Generic.HashSet<string> held =
            new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public void Learn(int team)
        {
            if (team != 1 && team != 2) throw new ArgumentOutOfRangeException("team");
            Learning = team;
        }

        public int Receive(string path, byte[] report, long milliseconds)
        {
            LastIgnoredReason = null;
            if (String.IsNullOrEmpty(path) || report.Length != 3 || report[0] != 2
                || report[2] != 0 || (report[1] != 0 && report[1] != 1))
            {
                LastIgnoredReason = "UNSUPPORTED REPORT: this is not the supported 02-01-00 press / 02-00-00 release.";
                return 0;
            }
            if (report[1] == 0) { held.Remove(path); return 0; }
            if (!held.Add(path))
            {
                LastIgnoredReason = "HELD: repeated press without a release report. Release the button before pressing again.";
                return 0;
            }
            if (Learning != 0)
            {
                string other = Learning == 1 ? Team2 : Team1;
                if (String.Equals(path, other, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("This clicker already belongs to the other team. Press the OTHER clicker.");
                if (Learning == 1) Team1 = path; else Team2 = path;
                Learning = 0;
                return 0;
            }
            int team = String.Equals(path, Team1, StringComparison.OrdinalIgnoreCase) ? 1
                : String.Equals(path, Team2, StringComparison.OrdinalIgnoreCase) ? 2 : 0;
            if (team == 0)
                LastIgnoredReason = "UNASSIGNED DEVICE: this device is not assigned to either team (its identity may have changed after reconnecting). Assign Team 1 and Team 2 again, then ENABLE sending.";
            return team;
        }

        public static void SelfTest()
        {
            var mapping = new ShutterMapping();
            var press = new byte[] { 2, 1, 0 };
            var release = new byte[] { 2, 0, 0 };
            mapping.Learn(1);
            if (mapping.Receive("one", press, 0) != 0 || mapping.Team1 != "one") throw new Exception("Calibration failed");
            mapping.Receive("one", release, 1);
            mapping.Learn(2);
            bool rejected = false;
            try { mapping.Receive("one", press, 10); }
            catch (InvalidOperationException) { rejected = true; }
            if (!rejected) throw new Exception("Duplicate device accepted");
            mapping.Receive("one", release, 11);
            mapping.Receive("two", press, 20);
            mapping.Receive("two", release, 21);
            if (mapping.Team2 != "two" || mapping.Learning != 0) throw new Exception("Team 2 calibration failed");
            if (mapping.Receive("one", press, 420) != 1) throw new Exception("Team 1 failed");
            if (mapping.Receive("one", press, 1000) != 0) throw new Exception("Held key repeated");
            if (mapping.LastIgnoredReason == null || !mapping.LastIgnoredReason.StartsWith("HELD:")) throw new Exception("Held diagnostic missing");
            mapping.Receive("one", release, 1001);
            if (mapping.Receive("two", press, 1100) != 2) throw new Exception("Other team rapid press failed");
            mapping.Receive("two", release, 819);
            if (mapping.Receive("two", press, 1200) != 2) throw new Exception("Double-click second press failed");
            if (mapping.Receive("unknown", press, 2000) != 0) throw new Exception("Unknown device accepted");
            if (mapping.LastIgnoredReason == null || !mapping.LastIgnoredReason.StartsWith("UNASSIGNED DEVICE:")) throw new Exception("Unknown-device diagnostic missing");
            if (mapping.Receive("one", new byte[] { 3, 1, 0 }, 2000) != 0) throw new Exception("Unknown report accepted");
            if (mapping.LastIgnoredReason == null || !mapping.LastIgnoredReason.StartsWith("UNSUPPORTED REPORT:")) throw new Exception("Unsupported-report diagnostic missing");
            mapping.Receive("one", release, 2001);
            if (mapping.LastIgnoredReason != null) throw new Exception("Release must not show an error");
            if (mapping.Receive("one", press, 2100) != 1 || mapping.LastIgnoredReason != null) throw new Exception("Valid press must clear diagnostic");
            Console.WriteLine("OK: calibration, duplicate-device rejection, release/hold, exact reports, unknown sources and released double-click forwarding.");
        }
    }

    public static class NativeKeySender
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct MouseInput
        {
            public int X, Y;
            public uint Data, Flags, Time;
            public UIntPtr Extra;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KeyboardInput
        {
            public ushort Key, Scan;
            public uint Flags, Time;
            public UIntPtr Extra;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct InputData
        {
            [FieldOffset(0)] public MouseInput Mouse;
            [FieldOffset(0)] public KeyboardInput Keyboard;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Input
        {
            public uint Type;
            public InputData Data;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint count, Input[] inputs, int size);

        private static Input[] Keys(int team)
        {
            if (team != 1 && team != 2) throw new ArgumentOutOfRangeException("team");
            ushort key = (ushort)(team == 1 ? 0x7C : 0x7D);
            return new[] {
                new Input { Type = 1, Data = new InputData { Keyboard = new KeyboardInput { Key = key } } },
                new Input { Type = 1, Data = new InputData { Keyboard = new KeyboardInput { Key = key, Flags = 2 } } }
            };
        }

        public static void Send(int team)
        {
            var keys = Keys(team);
            int size = Marshal.SizeOf(typeof(Input));
            uint sent = SendInput((uint)keys.Length, keys, size);
            if (sent != keys.Length)
            {
                int error = Marshal.GetLastWin32Error();
                if (sent == 1) SendInput(1, new[] { keys[1] }, size);
                throw new InvalidOperationException("Windows SendInput inserted " + sent
                    + "/2 events (error " + error + "). Check that the browser and helper run at the same privilege level.");
            }
        }

        public static void SelfTest()
        {
            if (Marshal.SizeOf(typeof(Input)) != (IntPtr.Size == 8 ? 40 : 28))
                throw new Exception("Incorrect Win32 INPUT layout.");
            for (int team = 1; team <= 2; team++)
            {
                var keys = Keys(team);
                if (keys.Length != 2 || keys[0].Type != 1
                    || keys[0].Data.Keyboard.Key != 0x7B + team
                    || keys[0].Data.Keyboard.Flags != 0 || keys[1].Data.Keyboard.Flags != 2
                    || keys[1].Data.Keyboard.Key != keys[0].Data.Keyboard.Key)
                    throw new Exception("Incorrect F13/F14 key down/up packet.");
            }
            Console.WriteLine("OK: SendInput native layout and F13/F14 down/up packets (no keys injected).");
        }
    }

    public class ControlWindow : MonitorWindow
    {
        private readonly ShutterMapping mapping = new ShutterMapping();
        private readonly System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
        private readonly Label status;
        private readonly CheckBox armed;
        private IntPtr target;
        private string targetTitle;
        private sealed class WindowChoice
        {
            public IntPtr Handle;
            public string Title;
            public override string ToString() { return Title; }
        }

        private delegate bool EnumWindowCallback(IntPtr window, IntPtr parameter);
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EnumWindows(EnumWindowCallback callback, IntPtr parameter);
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr window, StringBuilder title, int length);
        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int key);

        private static string WindowTitle(IntPtr window)
        {
            var title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            return title.ToString();
        }

        private static bool IsBrowserWindow(IntPtr window)
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId == 0) return false;
            try
            {
                using (var process = System.Diagnostics.Process.GetProcessById((int)processId))
                {
                    string name = process.ProcessName;
                    return name.Equals("chrome", StringComparison.OrdinalIgnoreCase)
                        || name.Equals("msedge", StringComparison.OrdinalIgnoreCase)
                        || name.Equals("firefox", StringComparison.OrdinalIgnoreCase);
                }
            }
            catch (ArgumentException) { return false; } // Window closed during enumeration.
        }

        private WindowChoice ChooseWindow()
        {
            using (var dialog = new Form {
                Text = "Vyber okno prehliadaca so zapasom", Width = 800, Height = 420,
                StartPosition = FormStartPosition.CenterParent, MinimizeBox = false, MaximizeBox = false
            })
            {
                var instructions = new Label { Dock = DockStyle.Top, Height = 65, Padding = new Padding(8),
                    Text = "Najprv otvor skore zapasu v samostatnom Chrome/Edge/Firefox.\r\n" +
                        "V zozname vyber toto okno a klikni Pouzit. Ziadny casovy limit.\r\n" +
                        "Ak chyba, otvor zapas v prehliadaci (nie vo VS Code) a klikni Obnovit." };
                var list = new ListBox { Dock = DockStyle.Fill, HorizontalScrollbar = true };
                var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 45 };
                var refresh = new Button { Text = "Obnovit", Width = 110 };
                var use = new Button { Text = "Pouzit vybrane okno", Width = 180, Enabled = false };
                var cancel = new Button { Text = "Spat", DialogResult = DialogResult.Cancel, Width = 100 };
                Action load = delegate {
                    list.Items.Clear();
                    if (!EnumWindows(delegate(IntPtr window, IntPtr parameter) {
                        if (!IsWindowVisible(window) || !IsBrowserWindow(window)) return true;
                        string title = WindowTitle(window);
                        if (!String.IsNullOrWhiteSpace(title))
                            list.Items.Add(new WindowChoice { Handle = window, Title = title });
                        return true;
                    }, IntPtr.Zero))
                        throw new Win32Exception(Marshal.GetLastWin32Error());
                    use.Enabled = false;
                };
                refresh.Click += delegate {
                    try { load(); }
                    catch (Exception error) { MessageBox.Show(dialog, error.Message, "Chyba nacitania okien"); }
                };
                list.SelectedIndexChanged += delegate { use.Enabled = list.SelectedItem != null; };
                use.Click += delegate {
                    var selected = list.SelectedItem as WindowChoice;
                    if (selected == null) return;
                    if (!IsWindowVisible(selected.Handle) || !IsBrowserWindow(selected.Handle)
                        || WindowTitle(selected.Handle) != selected.Title)
                    {
                        MessageBox.Show(dialog, "Okno sa zmenilo. Klikni Obnovit a vyber ho znova.", "Vyber okna");
                        return;
                    }
                    dialog.DialogResult = DialogResult.OK;
                };
                buttons.Controls.AddRange(new Control[] { refresh, use, cancel });
                dialog.Controls.Add(list);
                dialog.Controls.Add(buttons);
                dialog.Controls.Add(instructions);
                dialog.CancelButton = cancel;
                load();
                return dialog.ShowDialog(this) == DialogResult.OK ? list.SelectedItem as WindowChoice : null;
            }
        }

        public ControlWindow()
        {
            Text = "RIVA - Windows clicker helper";
            SetInstructions("Model 497764 helper - supports observed reports 02-01-00 / 02-00-00 only.\r\n" +
                "1. In the match page enable 'Windows pomocnik', then assign each clicker below.\r\n" +
                "2. Select the target window, enable sending, return to the active match and click its heading.\r\n" +
                "3. Test each team separately. Media volume may still change; this helper does not block Windows volume.\r\n" +
                "No network, drivers, or saved device IDs. Close the helper to stop. Reassign after reconnecting.");
            Height = 820;
            var panel = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 155, Padding = new Padding(8) };
            var team1 = new Button { Text = "1. Assign Team 1", Width = 155, Height = 34 };
            var team2 = new Button { Text = "2. Assign Team 2", Width = 155, Height = 34 };
            var capture = new Button { Text = "3. Vybrat okno zapasu", Width = 230, Height = 34 };
            armed = new CheckBox { Text = "4. ENABLE sending", Width = 180, Height = 34 };
            status = new Label { Width = 900, Height = 65, Text = "STOPPED. Assign each clicker, then select the match window." };
            team1.Click += delegate { armed.Checked = false; mapping.Learn(1); status.Text = "Press and release ONLY Team 1 clicker."; };
            team2.Click += delegate { armed.Checked = false; mapping.Learn(2); status.Text = "Press and release ONLY Team 2 clicker."; };
            capture.Click += delegate {
                armed.Checked = false;
                target = IntPtr.Zero;
                capture.Text = "3. Vybrat okno zapasu";
                try
                {
                    var selected = ChooseWindow();
                    if (selected == null) { status.Text = "Vyber okna zruseny. Klikni 3. Vybrat okno zapasu."; return; }
                    target = selected.Handle;
                    targetTitle = selected.Title;
                    capture.Text = "3. Window selected";
                    status.Text = "Selected: " + targetTitle + ". Enable sending, then switch to the match.";
                    Log("OK: target window selected: " + targetTitle);
                }
                catch (Exception error) { status.Text = "ERROR selecting window: " + error.Message; Log(status.Text); }
            };
            armed.CheckedChanged += delegate {
                if (!armed.Checked) { status.Text = "STOPPED. No scoring signals will be sent."; return; }
                if (mapping.Team1 == null || mapping.Team2 == null || mapping.Learning != 0 || target == IntPtr.Zero)
                {
                    armed.Checked = false;
                    var missing = new System.Collections.Generic.List<string>();
                    if (mapping.Team1 == null) missing.Add("Tim 1: klikni Assign Team 1 a stlac prvy kliker.");
                    if (mapping.Team2 == null) missing.Add("Tim 2: klikni Assign Team 2 a stlac druhy kliker.");
                    if (mapping.Learning != 0) missing.Add("Cakam na priradenie: stlac kliker pre Tim " + mapping.Learning + ".");
                    if (target == IntPtr.Zero) missing.Add("Okno: klikni 3. Vybrat okno zapasu, vyber prehliadac a klikni Pouzit.");
                    status.Text = "CHYBA - chyba nastavenie: " + String.Join(" ", missing);
                    foreach (string item in missing) Log("CHYBA: " + item);
                    return;
                }
                status.Text = "ENABLED. Only the selected foreground browser window receives F13/F14. Enable Windows helper mode in the match page!";
            };
            panel.Controls.AddRange(new Control[] { team1, team2, capture, armed, status });
            Controls.Add(panel);
            panel.BringToFront();
        }

        protected override void OnConsumerReport(string path, byte[] report)
        {
            int learning = mapping.Learning;
            int team = mapping.Receive(path, report, clock.ElapsedMilliseconds);
            if (learning != 0 && mapping.Learning == 0)
            {
                status.Text = "Team " + learning + " assigned. Release the button. No point sent.";
                foreach (Control control in Controls)
                    if (control is FlowLayoutPanel)
                        foreach (Control button in control.Controls)
                            if (button is Button && button.Text.StartsWith(learning + "."))
                                button.Text = learning + ". Team " + learning + " OK";
                Log("Assigned Team " + learning + " (local HID identity; not saved to disk).");
            }
            if (team == 0)
            {
                if (mapping.LastIgnoredReason != null)
                {
                    status.Text = mapping.LastIgnoredReason;
                    Log(status.Text);
                }
                return;
            }
            if (!armed.Checked)
            {
                status.Text = "SENDING OFF: Team " + team + " recognized. Check 4. ENABLE sending, then return to the match.";
                Log(status.Text);
                return;
            }
            if (GetForegroundWindow() != target || WindowTitle(target) != targetTitle)
            {
                Log("SKIPPED: selected match window is not active or its title changed.");
                return;
            }
            if (GetAsyncKeyState(0x10) < 0 || GetAsyncKeyState(0x11) < 0 || GetAsyncKeyState(0x12) < 0
                || GetAsyncKeyState(0x5B) < 0 || GetAsyncKeyState(0x5C) < 0)
            {
                Log("SKIPPED: release Shift/Ctrl/Alt/Windows keys.");
                return;
            }
            try
            {
                NativeKeySender.Send(team);
                Log("INJECTED Team " + team + " (F" + (team == 1 ? "13" : "14")
                    + "): Windows accepted key down/up. Check 'Windows helper input' on the match page; this is NOT a save confirmation.");
            }
            catch (Exception error)
            {
                armed.Checked = false;
                Log("ERROR sending input; helper stopped: " + error.Message);
            }
        }

        public static void RunControl()
        {
            bool created;
            using (var singleInstance = new System.Threading.Mutex(true, "Local\\RivaClickerHelper", out created))
            {
                if (!created)
                    throw new InvalidOperationException("The RIVA clicker helper is already running. Close the other helper first.");
                try
                {
                    Application.EnableVisualStyles();
                    using (var window = new ControlWindow())
                        Application.Run(window);
                }
                finally { singleInstance.ReleaseMutex(); }
            }
        }
    }
}
'@

if ($SelfTest) {
    [RivaClickerDiagnostic.ShutterMapping]::SelfTest()
    [RivaClickerDiagnostic.NativeKeySender]::SelfTest()
    $window = New-Object RivaClickerDiagnostic.ControlWindow
    $window.Dispose()
    Write-Output 'OK: helper window constructed and disposed without starting input capture.'
} elseif ($CheckOnly) {
    Write-Output 'OK: Windows Raw Input diagnostic compiled. No listener or window was started.'
} elseif ($Control) {
    [RivaClickerDiagnostic.ControlWindow]::RunControl()
} else {
    [RivaClickerDiagnostic.MonitorWindow]::Run()
}
