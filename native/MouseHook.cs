using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class MouseHook
{
    private const int WH_MOUSE_LL = 14, WM_QUIT = 0x0012, WM_LBUTTONDOWN = 0x0201, WM_RBUTTONDOWN = 0x0204, WM_MBUTTONDOWN = 0x0207, WM_XBUTTONDOWN = 0x020B, WM_XBUTTONUP = 0x020C;
    private static readonly ConcurrentQueue<string> Events = new ConcurrentQueue<string>();
    private static readonly AutoResetEvent WakeWriter = new AutoResetEvent(false);
    private static readonly HookProc Callback = OnMouse;
    private static volatile bool Running = true;
    private static IntPtr Hook = IntPtr.Zero;
    private static uint MainThread;
    private static int SelectedButton = 4;

    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] private struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public INPUTUNION value; }
    [StructLayout(LayoutKind.Explicit)] private struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT keyboard; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct SIZE { public int width, height; }
    [StructLayout(LayoutKind.Sequential)] private struct BITMAP { public int type, width, height, widthBytes; public ushort planes, bitsPixel; public IntPtr bits; }
    [StructLayout(LayoutKind.Sequential)] private struct BITMAPINFOHEADER { public uint size; public int width, height; public ushort planes, bitCount; public uint compression, sizeImage; public int xPixelsPerMeter, yPixelsPerMeter; public uint colorsUsed, colorsImportant; }
    [StructLayout(LayoutKind.Sequential)] private struct BITMAPINFO { public BITMAPINFOHEADER header; public uint color; }
    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, uint flags, out IntPtr bitmap); }
    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern int GetMessage(out MSG message, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out MSG message, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] private static extern bool LockWorkStation();
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, uint id);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("kernel32.dll")] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)] private static extern int SHCreateItemFromParsingName(string path, IntPtr binding, ref Guid id, out IShellItemImageFactory item);
    [DllImport("gdi32.dll")] private static extern int GetObject(IntPtr item, int size, out BITMAP bitmap);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr dc, IntPtr bitmap, uint start, uint lines, byte[] pixels, ref BITMAPINFO info, uint usage);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr item);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (Array.IndexOf(args, "--self-test") >= 0) return RunSelfTest();
        foreach (string arg in args) if (arg.StartsWith("--icon=")) return ReadShellIcon(arg.Substring(7));
        foreach (string arg in args) if (arg.StartsWith("--action=")) return DoAction(arg.Substring(9));
        foreach (string arg in args) if (arg.StartsWith("--keys=")) return DoKeys(arg.Substring(7));
        foreach (string arg in args) if (arg.StartsWith("--admin-task=")) return AdminTask.Run(arg.Substring(13));
        int parentId = 0;
        foreach (string arg in args)
        {
            if (arg.StartsWith("--button=") && !int.TryParse(arg.Substring(9), out SelectedButton)) return 2;
            if (arg.StartsWith("--parent-pid=")) int.TryParse(arg.Substring(13), out parentId);
        }
        if (SelectedButton != 0 && SelectedButton != 4 && SelectedButton != 5) return 2;
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
        MainThread = GetCurrentThreadId();
        MSG message;
        PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
        ResolveForeground(ForegroundMarker());
        Hook = SetWindowsHookEx(WH_MOUSE_LL, Callback, GetModuleHandle(null), 0);
        if (Hook == IntPtr.Zero) { Console.Error.WriteLine("Unable to install mouse hook: " + Marshal.GetLastWin32Error()); return 3; }
        var writer = new Thread(WriteEvents); writer.IsBackground = true; writer.Start();
        // "foreground" asks for the program in front (keyboard-opened wheel); any other line stops the hook.
        var input = new Thread(delegate() { try { string line; while ((line = Console.ReadLine()) != null) { if (line.Trim() == "foreground") { Enqueue("{\"type\":\"foreground\",\"path\":\"" + JsonText(ForegroundPath()) + "\"}"); continue; } RequestStop(); break; } } catch { } RequestStop(); });
        input.IsBackground = true; input.Start();
        Timer watchdog = null;
        if (parentId > 0)
        {
            int owner = parentId;
            watchdog = new Timer(delegate(object unused) { try { using (var process = Process.GetProcessById(owner)) if (process.HasExited) RequestStop(); } catch { RequestStop(); } }, null, 1000, 1000);
        }
        Enqueue("{\"type\":\"ready\",\"button\":" + SelectedButton + "}");
        try { while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { } }
        finally { Running = false; if (Hook != IntPtr.Zero) UnhookWindowsHookEx(Hook); Hook = IntPtr.Zero; if (watchdog != null) watchdog.Dispose(); WakeWriter.Set(); writer.Join(500); }
        return 0;
    }

    private static IntPtr OnMouse(int code, IntPtr message, IntPtr data)
    {
        long kind = message.ToInt64();
        if (code >= 0 && (kind == WM_LBUTTONDOWN || kind == WM_RBUTTONDOWN || kind == WM_MBUTTONDOWN || kind == WM_XBUTTONDOWN || kind == WM_XBUTTONUP))
        {
            try
            {
                var mouse = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(data, typeof(MSLLHOOKSTRUCT));
                if (InspectMouse(kind, mouse)) return new IntPtr(1);
            }
            catch { }
        }
        return CallNextHookEx(Hook, code, message, data);
    }

    // Returns true only when this event must be consumed by Orbit.
    private static bool InspectMouse(long kind, MSLLHOOKSTRUCT mouse)
    {
        if (kind == WM_LBUTTONDOWN || kind == WM_RBUTTONDOWN || kind == WM_MBUTTONDOWN)
        {
            string button = kind == WM_LBUTTONDOWN ? "left" : kind == WM_RBUTTONDOWN ? "right" : "middle";
            Enqueue("{\"type\":\"click\",\"x\":" + mouse.pt.x + ",\"y\":" + mouse.pt.y + ",\"button\":\"" + button + "\"}");
            // Observation only: ordinary clicks always continue through the native hook chain.
            return false;
        }
        if (kind == WM_XBUTTONDOWN || kind == WM_XBUTTONUP)
        {
            int button = (int)((mouse.mouseData >> 16) & 0xffff) + 3;
            if (button == SelectedButton)
            {
                // The program in front is read here, before the wheel can take focus.
                string foreground = kind == WM_XBUTTONDOWN ? ",\"foreground\":\"" + ForegroundMarker() + "\"" : "";
                Enqueue("{\"type\":\"" + (kind == WM_XBUTTONDOWN ? "down" : "up") + "\",\"x\":" + mouse.pt.x + ",\"y\":" + mouse.pt.y + ",\"button\":" + button + foreground + "}");
                return true;
            }
        }
        return false;
    }

    private static int RunSelfTest()
    {
        // Exercise the same event decision code as the native callback, without installing
        // a hook, injecting input, moving the cursor, or invoking any system action.
        var mouse = new MSLLHOOKSTRUCT { pt = new POINT { x = 120, y = -80 } };
        bool passed = true;
        SelectedButton = 0;
        passed &= !InspectMouse(WM_LBUTTONDOWN, mouse);
        passed &= !InspectMouse(WM_RBUTTONDOWN, mouse);
        passed &= !InspectMouse(WM_MBUTTONDOWN, mouse);
        for (int button = 4; button <= 5; button++)
        {
            mouse.mouseData = (uint)((button - 3) << 16);
            passed &= !InspectMouse(WM_XBUTTONDOWN, mouse);
            passed &= !InspectMouse(WM_XBUTTONUP, mouse);
            SelectedButton = button;
            passed &= InspectMouse(WM_XBUTTONDOWN, mouse);
            passed &= InspectMouse(WM_XBUTTONUP, mouse);
            mouse.mouseData = (uint)((button == 4 ? 2 : 1) << 16);
            passed &= !InspectMouse(WM_XBUTTONDOWN, mouse);
            SelectedButton = 0;
        }
        string value;
        int events = 0, normalClicks = 0;
        bool left = false, right = false, middle = false;
        while (Events.TryDequeue(out value))
        {
            events++;
            if (value.Contains("\"type\":\"click\"") && value.Contains("\"x\":120") && value.Contains("\"y\":-80"))
            {
                normalClicks++;
                left |= value.Contains("\"button\":\"left\"");
                right |= value.Contains("\"button\":\"right\"");
                middle |= value.Contains("\"button\":\"middle\"");
            }
        }
        passed &= events == 7 && normalClicks == 3 && left && right && middle;
        if (!passed) { Console.Error.WriteLine("Mouse event self-test failed."); return 5; }
        Console.WriteLine("{\"ok\":true,\"architecture\":\"x64\",\"buttons\":[4,5],\"outsideWatcher\":true,\"normalClicksPassThrough\":true,\"watcherPassesSideButtons\":true}");
        return 0;
    }

    private static void Enqueue(string value) { Events.Enqueue(value); WakeWriter.Set(); }
    private static void WriteEvents()
    {
        try { while (Running || !Events.IsEmpty) { string value; while (Events.TryDequeue(out value)) Console.WriteLine(ResolveForeground(value)); WakeWriter.WaitOne(100); } }
        catch { RequestStop(); }
    }
    private static void RequestStop() { PostThreadMessage(MainThread, WM_QUIT, UIntPtr.Zero, IntPtr.Zero); }

    private static int ReadShellIcon(string file)
    {
        // This mode never installs an input hook or starts the selected application.
        // ICONONLY | BIGGERSIZEOK requests the actual Shell icon without SCALEUP.
        // Store apps have no file on disk; their Shell item is shell:AppsFolder\<family!app>.
        bool packaged = file != null && file.StartsWith(@"shell:AppsFolder\", StringComparison.Ordinal) && System.Text.RegularExpressions.Regex.IsMatch(file.Substring(17), @"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}![A-Za-z0-9][A-Za-z0-9._-]{0,63}$");
        if (!packaged)
        {
            if (string.IsNullOrWhiteSpace(file) || file.Length > 4096 || file.IndexOf('\0') >= 0 || file.Length < 3 || file[1] != ':' || (file[2] != '\\' && file[2] != '/') || !File.Exists(file)) return 2;
            string extension = Path.GetExtension(file);
            if (!extension.Equals(".exe", StringComparison.OrdinalIgnoreCase) && !extension.Equals(".lnk", StringComparison.OrdinalIgnoreCase)) return 2;
        }
        IShellItemImageFactory factory = null;
        IntPtr bitmap = IntPtr.Zero, dc = IntPtr.Zero;
        try
        {
            Guid id = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
            if (SHCreateItemFromParsingName(file, IntPtr.Zero, ref id, out factory) < 0 || factory == null) return 6;
            if (factory.GetImage(new SIZE { width = 256, height = 256 }, 0x00000005, out bitmap) < 0 || bitmap == IntPtr.Zero) return 6;
            BITMAP dimensions;
            if (GetObject(bitmap, Marshal.SizeOf(typeof(BITMAP)), out dimensions) == 0 || dimensions.width < 1 || dimensions.width > 512 || dimensions.height < 1 || dimensions.height > 512) return 6;
            var pixels = new byte[dimensions.width * dimensions.height * 4];
            var info = new BITMAPINFO { header = new BITMAPINFOHEADER { size = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER)), width = dimensions.width, height = -dimensions.height, planes = 1, bitCount = 32, compression = 0 } };
            dc = GetDC(IntPtr.Zero);
            if (GetDIBits(dc, bitmap, 0, (uint)dimensions.height, pixels, ref info, 0) != dimensions.height) return 6;
            Console.WriteLine("{\"width\":" + dimensions.width + ",\"height\":" + dimensions.height + ",\"pixels\":\"" + Convert.ToBase64String(pixels) + "\"}");
            return 0;
        }
        catch { return 6; }
        finally
        {
            if (dc != IntPtr.Zero) ReleaseDC(IntPtr.Zero, dc);
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            if (factory != null) Marshal.ReleaseComObject(factory);
        }
    }

    private static uint ForegroundId()
    {
        uint id;
        GetWindowThreadProcessId(GetForegroundWindow(), out id);
        return id;
    }

    private static string ForegroundPath() { return ProcessPath(ForegroundId()); }

    // Opening a process can be slowed by security software, so it never runs inside the hook callback:
    // the hook writes \u0001<pid>\u0001 and the writer thread swaps in the executable path.
    private static string ForegroundMarker() { return "\u0001" + ForegroundId() + "\u0001"; }

    private static string ResolveForeground(string value)
    {
        int start = value.IndexOf('\u0001'), end = start < 0 ? -1 : value.IndexOf('\u0001', start + 1);
        if (end < 0) return value;
        uint id;
        string path = uint.TryParse(value.Substring(start + 1, end - start - 1), out id) ? ProcessPath(id) : "";
        return value.Substring(0, start) + JsonText(path) + value.Substring(end + 1);
    }

    private static string ProcessPath(uint id)
    {
        if (id == 0) return "";
        IntPtr process = OpenProcess(0x1000, false, id);
        if (process == IntPtr.Zero) return "";
        try { var name = new StringBuilder(32768); int size = name.Capacity; return QueryFullProcessImageName(process, 0, name, ref size) ? name.ToString() : ""; }
        finally { CloseHandle(process); }
    }

    private static string JsonText(string value)
    {
        var text = new StringBuilder(value.Length + 8);
        foreach (char c in value)
        {
            if (c == '\\' || c == '"') text.Append('\\').Append(c);
            else if (c < ' ') text.Append("\\u").Append(((int)c).ToString("x4"));
            else text.Append(c);
        }
        return text.ToString();
    }

    private static int DoAction(string action)
    {
        if (action == "lock") return LockWorkStation() ? 0 : 4;
        ushort[] keys;
        switch (action)
        {
            case "screenshot": keys = new ushort[] { 0x5B, 0x10, 0x53 }; break;
            case "desktop": keys = new ushort[] { 0x5B, 0x44 }; break;
            case "mute": keys = new ushort[] { 0xAD }; break;
            case "volume-up": keys = new ushort[] { 0xAF }; break;
            case "volume-down": keys = new ushort[] { 0xAE }; break;
            case "media-play": keys = new ushort[] { 0xB3 }; break;
            case "media-next": keys = new ushort[] { 0xB0 }; break;
            case "media-prev": keys = new ushort[] { 0xB1 }; break;
            case "search": keys = new ushort[] { 0x5B, 0x53 }; break;
            case "run": keys = new ushort[] { 0x5B, 0x52 }; break;
            case "task-view": keys = new ushort[] { 0x5B, 0x09 }; break;
            case "clipboard": keys = new ushort[] { 0x5B, 0x56 }; break;
            case "emoji": keys = new ushort[] { 0x5B, 0xBE }; break;
            case "dictation": keys = new ushort[] { 0x5B, 0x48 }; break;
            case "notifications": keys = new ushort[] { 0x5B, 0x4E }; break;
            case "close-window": keys = new ushort[] { 0x12, 0x73 }; break;
            case "minimize-window": keys = new ushort[] { 0x5B, 0x28 }; break;
            case "maximize-window": keys = new ushort[] { 0x5B, 0x26 }; break;
            case "desktop-next": keys = new ushort[] { 0x11, 0x5B, 0x27 }; break;
            case "desktop-prev": keys = new ushort[] { 0x11, 0x5B, 0x25 }; break;
            default: Console.Error.WriteLine("Unsupported system action."); return 2;
        }
        return SendKeys(keys);
    }

    // "Keys" actions: --keys=17,16,84 presses the virtual keys in order and releases them in reverse.
    private static int DoKeys(string list)
    {
        string[] parts = list.Split(',');
        if (parts.Length < 1 || parts.Length > 5) { Console.Error.WriteLine("Between one and five keys are required."); return 2; }
        var keys = new ushort[parts.Length];
        for (int index = 0; index < parts.Length; index++)
        {
            int code;
            if (!int.TryParse(parts[index], out code) || code < 1 || code > 254) { Console.Error.WriteLine("Invalid virtual key."); return 2; }
            keys[index] = (ushort)code;
        }
        return SendKeys(keys);
    }

    // Navigation keys and Win are extended keys; without the flag some programs read them as numpad keys.
    private static bool Extended(ushort key)
    {
        return (key >= 0x21 && key <= 0x28) || key == 0x2D || key == 0x2E || key == 0x5B || key == 0x5C || key == 0x5D || key == 0x6F || key == 0x2C;
    }

    private static int SendKeys(ushort[] keys)
    {
        var inputs = new INPUT[keys.Length * 2];
        for (int index = 0; index < keys.Length; index++)
        {
            ushort down = keys[index], up = keys[keys.Length - index - 1];
            inputs[index].type = 1; inputs[index].value.keyboard.key = down; inputs[index].value.keyboard.flags = Extended(down) ? 1u : 0u;
            inputs[keys.Length + index].type = 1; inputs[keys.Length + index].value.keyboard.key = up; inputs[keys.Length + index].value.keyboard.flags = 2u | (Extended(up) ? 1u : 0u);
        }
        return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) == inputs.Length ? 0 : 4;
    }
}
