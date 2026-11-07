// Per-user Orbit installer. The same source builds the uninstaller with /define:UNINSTALLER.
// Orbit is installed under %LOCALAPPDATA%\Programs so the built-in updater can replace it without elevation.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Orbit 2 Setup")]
[assembly: AssemblyProduct("Orbit 2")]
[assembly: AssemblyCompany("Creation Soft")]

static class Setup
{
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbit";
    const string ReleaseRoot = "Orbit2-win32-x64/";

    static string DefaultInstallDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Orbit 2"); } }
    static string UninstallerPath { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Orbit 2 Setup", "Uninstall Orbit 2.exe"); } }
    static string StartMenuShortcut { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Orbit 2.lnk"); } }
    static string DesktopShortcut { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Orbit 2.lnk"); } }

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    [STAThread]
    static int Main(string[] args)
    {
        bool silent = HasFlag(args, "/silent"), launch = !HasFlag(args, "/nolaunch");
        string dir = Option(args, "/dir=");
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
#if UNINSTALLER
            return RunUninstall(silent);
#else
            string version = ReadVersion();
            string target = Path.GetFullPath(dir ?? DefaultInstallDir);
            if (silent) { Install(target, dir == null, _ => { }); if (launch) Launch(target); return 0; }
            using (var form = new SetupForm(version, target, dir == null)) Application.Run(form);
            return 0;
#endif
        }
        catch (Exception error)
        {
            if (!silent) MessageBox.Show(error.Message, "Orbit 2", MessageBoxButtons.OK, MessageBoxIcon.Error);
            else Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    static bool HasFlag(string[] args, string flag) { return args.Any(a => string.Equals(a, flag, StringComparison.OrdinalIgnoreCase)); }
    static string Option(string[] args, string prefix) { return args.Where(a => a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)).Select(a => a.Substring(prefix.Length)).FirstOrDefault(); }

    // Stops every Orbit copy that holds the single-instance lock, including its native mouse helper.
    static void CloseOrbit(string target)
    {
        var processes = Process.GetProcessesByName("Orbit2").Concat(Process.GetProcessesByName("Orbit2.Input")).ToList();
        var elevated = new List<int>();
        foreach (var process in processes)
        {
            try
            {
                string file = process.MainModule.FileName, folder = Path.GetDirectoryName(file);
                bool orbit = string.Equals(Path.GetFileName(file), "Orbit2.exe", StringComparison.OrdinalIgnoreCase) && File.Exists(Path.Combine(folder, "resources", "app.asar"));
                bool helper = string.Equals(Path.GetFileName(file), "Orbit2.Input.exe", StringComparison.OrdinalIgnoreCase);
                if (!orbit && !helper) continue;
                process.Kill();
                process.WaitForExit(10000);
            }
            // An Orbit running as administrator cannot be inspected or stopped from here.
            catch (System.ComponentModel.Win32Exception) { elevated.Add(process.Id); }
            catch { }
            // An open handle to a stopped process keeps its executable locked.
            finally { process.Dispose(); }
        }
        if (elevated.Count > 0) QuitElevatedOrbit(target, elevated);
        Thread.Sleep(500);
    }

    // "Orbit2.exe --quit" reaches the elevated copy through its own administrator task, which then closes normally.
    static void QuitElevatedOrbit(string target, List<int> ids)
    {
        string orbit = string.IsNullOrEmpty(target) ? null : Path.Combine(target, "Orbit2.exe");
        if (orbit == null || !File.Exists(orbit)) return;
        try
        {
            using (var quit = Process.Start(new ProcessStartInfo(orbit, "--quit") { WorkingDirectory = target, UseShellExecute = false })) quit.WaitForExit(15000);
        }
        catch (Exception error) { Log("Elevated Orbit not asked to quit: " + error.Message); return; }
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (DateTime.UtcNow < deadline && ids.Any(IsRunning)) Thread.Sleep(200);
    }

    // Listing processes needs no handle, unlike HasExited on an elevated process.
    static bool IsRunning(int id)
    {
        var running = Process.GetProcesses();
        try { return running.Any(process => process.Id == id); }
        finally { foreach (var process in running) process.Dispose(); }
    }

    static void Launch(string target)
    {
        Process.Start(new ProcessStartInfo(Path.Combine(target, "Orbit2.exe")) { WorkingDirectory = target, UseShellExecute = true });
    }

    static void Log(string message)
    {
        try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "Orbit2-Setup.log"), DateTime.Now.ToString("s") + " " + message + Environment.NewLine); } catch { }
    }

    static void Retry(Action action)
    {
        for (int attempt = 0; ; attempt++)
        {
            try { action(); return; }
            catch (IOException error) { Log(error.Message); if (attempt >= 20) throw; }
            catch (UnauthorizedAccessException error) { Log(error.Message); if (attempt >= 20) throw; }
            Thread.Sleep(250);
        }
    }

    static bool IsOrbitFolder(string folder)
    {
        return File.Exists(Path.Combine(folder, "Orbit2.exe")) && File.Exists(Path.Combine(folder, "resources", "app.asar"));
    }

    static void CreateShortcut(string link, string target)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(link));
        Type type = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(type);
        try
        {
            object shortcut = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
            Type kind = shortcut.GetType();
            kind.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { Path.Combine(target, "Orbit2.exe") });
            kind.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { target });
            kind.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { Path.Combine(target, "Orbit2.exe") + ",0" });
            kind.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "Orbit 2" });
            kind.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            Marshal.FinalReleaseComObject(shortcut);
        }
        finally { Marshal.FinalReleaseComObject(shell); }
    }

#if !UNINSTALLER
    static Stream Resource(string name)
    {
        Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
        if (stream == null) throw new InvalidOperationException("Інсталятор пошкоджено: бракує " + name + ".");
        return stream;
    }

    // Release archives made by Windows PowerShell store backslash separators.
    static string EntryName(ZipArchiveEntry entry) { return entry.FullName.Replace('\\', '/'); }

    static string ReadVersion()
    {
        using (var zip = new ZipArchive(Resource("Orbit.zip"), ZipArchiveMode.Read))
        {
            var marker = zip.Entries.FirstOrDefault(e => EntryName(e) == ReleaseRoot + "orbit-release.json");
            if (marker == null) throw new InvalidOperationException("Інсталятор пошкоджено: бракує orbit-release.json.");
            using (var reader = new StreamReader(marker.Open(), Encoding.UTF8))
            {
                string text = reader.ReadToEnd();
                var match = System.Text.RegularExpressions.Regex.Match(text, "\"version\"\\s*:\\s*\"([0-9A-Za-z.+-]+)\"");
                if (!match.Success || !text.Contains("com.creationsoft.orbit2")) throw new InvalidOperationException("Інсталятор містить не той пакет.");
                return match.Groups[1].Value;
            }
        }
    }

    // Extracts beside the target, swaps folders, and only then removes the previous copy.
    // Shortcuts and the uninstall entry are registered only for the default per-user location.
    internal static void Install(string target, bool register, Action<int> progress)
    {
        string parent = Path.GetDirectoryName(target);
        if (string.IsNullOrEmpty(parent)) throw new InvalidOperationException("Неправильна папка встановлення.");
        if (Directory.Exists(target) && Directory.EnumerateFileSystemEntries(target).Any() && !IsOrbitFolder(target))
            throw new InvalidOperationException("Папка " + target + " не порожня й не містить Orbit.");
        Directory.CreateDirectory(parent);
        foreach (string leftover in Directory.GetDirectories(parent, ".Orbit2-old-*").Concat(Directory.GetDirectories(parent, ".Orbit2-new-*")))
        {
            try { Directory.Delete(leftover, true); } catch (Exception error) { Log("Leftover not removed: " + leftover + ": " + error.Message); }
        }
        string id = Guid.NewGuid().ToString("N").Substring(0, 12), stage = Path.Combine(parent, ".Orbit2-new-" + id), old = Path.Combine(parent, ".Orbit2-old-" + id);
        string stageRoot = Path.GetFullPath(stage) + Path.DirectorySeparatorChar;
        try
        {
            using (var zip = new ZipArchive(Resource("Orbit.zip"), ZipArchiveMode.Read))
            {
                var entries = zip.Entries.Where(e => EntryName(e).StartsWith(ReleaseRoot, StringComparison.Ordinal) && EntryName(e).Length > ReleaseRoot.Length).ToList();
                for (int index = 0; index < entries.Count; index++)
                {
                    var entry = entries[index];
                    string name = EntryName(entry), destination = Path.GetFullPath(Path.Combine(stage, name.Substring(ReleaseRoot.Length)));
                    if (!destination.StartsWith(stageRoot, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Інсталятор містить небезпечний шлях.");
                    if (name.EndsWith("/", StringComparison.Ordinal)) Directory.CreateDirectory(destination);
                    else { Directory.CreateDirectory(Path.GetDirectoryName(destination)); entry.ExtractToFile(destination, true); }
                    progress((index + 1) * 90 / entries.Count);
                }
            }
            if (!IsOrbitFolder(stage) || !File.Exists(Path.Combine(stage, "orbit-release.json"))) throw new InvalidOperationException("Пакет Orbit неповний.");
            CloseOrbit(target);
            bool moved = false;
            if (Directory.Exists(target)) { Retry(() => Directory.Move(target, old)); moved = true; }
            try { Retry(() => Directory.Move(stage, target)); }
            catch
            {
                if (moved) { try { Retry(() => Directory.Move(old, target)); } catch (Exception restore) { Log("Previous Orbit not restored from " + old + ": " + restore.Message); } }
                throw;
            }
            // Files of just-stopped processes can stay locked for a moment.
            if (moved) { try { Retry(() => Directory.Delete(old, true)); } catch { } }
            progress(95);
            if (register)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(UninstallerPath));
                using (var source = Resource("Uninstall.exe")) using (var output = File.Create(UninstallerPath)) source.CopyTo(output);
                using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
                {
                    key.SetValue("DisplayName", "Orbit 2");
                    key.SetValue("Publisher", "Creation Soft");
                    key.SetValue("DisplayVersion", ReadVersion());
                    key.SetValue("DisplayIcon", Path.Combine(target, "Orbit2.exe") + ",0");
                    key.SetValue("InstallLocation", target);
                    key.SetValue("UninstallString", "\"" + UninstallerPath + "\"");
                    key.SetValue("QuietUninstallString", "\"" + UninstallerPath + "\" /silent");
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                }
                foreach (string link in new[] { StartMenuShortcut, DesktopShortcut })
                {
                    try { CreateShortcut(link, target); } catch (Exception error) { Log("Shortcut not created: " + link + ": " + error.Message); }
                }
            }
            progress(100);
        }
        finally
        {
            if (Directory.Exists(stage)) { try { Directory.Delete(stage, true); } catch { } }
        }
    }

    sealed class SetupForm : Form
    {
        readonly Label status;
        readonly ProgressBar bar;
        readonly Button primary;
        readonly CheckBox launchAfter;
        readonly string target;
        readonly bool register;
        bool installed;

        public SetupForm(string version, string target, bool register)
        {
            this.target = target; this.register = register;
            Text = "Встановлення Orbit 2 " + version;
            Font = new Font("Segoe UI", 10f);
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(520, 250);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            Controls.Add(new Label { Text = "Orbit 2 " + version, Font = new Font("Segoe UI Semibold", 15f), AutoSize = true, Location = new Point(24, 20) });
            status = new Label { Text = "Orbit 2 буде встановлено в:\n" + target + "\n\nЗапущений Orbit 2 буде закрито. Меню й налаштування збережуться.", Location = new Point(24, 62), Size = new Size(472, 96) };
            bar = new ProgressBar { Location = new Point(24, 164), Size = new Size(472, 14), Visible = false };
            launchAfter = new CheckBox { Text = "Запустити Orbit 2", Checked = true, AutoSize = true, Location = new Point(24, 204), Visible = false };
            primary = new Button { Text = "Встановити", Size = new Size(140, 34), Location = new Point(356, 198) };
            primary.Click += OnPrimary;
            Controls.AddRange(new Control[] { status, bar, launchAfter, primary });
            AcceptButton = primary;
        }

        async void OnPrimary(object sender, EventArgs e)
        {
            if (installed) { if (launchAfter.Checked) Launch(target); Close(); return; }
            primary.Enabled = false; bar.Visible = true; ControlBox = false;
            status.Text = "Встановлюємо Orbit 2…";
            var report = new Progress<int>(value => bar.Value = Math.Max(0, Math.Min(100, value)));
            try
            {
                await Task.Run(() => Install(target, register, value => ((IProgress<int>)report).Report(value)));
                installed = true;
                status.Text = "Orbit 2 встановлено в:\n" + target + (register ? "\n\nЯрлики додано на робочий стіл і в меню «Пуск»." : "");
                launchAfter.Visible = true; primary.Text = "Готово"; primary.Enabled = true;
            }
            catch (Exception error)
            {
                status.Text = "Не вдалося встановити Orbit 2:\n" + error.Message;
                primary.Text = "Повторити"; primary.Enabled = true; bar.Visible = false;
            }
            finally { ControlBox = true; }
        }
    }
#else
    static int RunUninstall(bool silent)
    {
        string target;
        using (var key = Registry.CurrentUser.OpenSubKey(UninstallKey)) target = key == null ? null : key.GetValue("InstallLocation") as string;
        if (!silent && MessageBox.Show("Видалити Orbit 2 з цього комп'ютера?\n\nМеню й налаштування залишаться в %APPDATA%\\Orbit 2.", "Orbit 2", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 1;
        CloseOrbit(target);
        // The administrator start task belongs to this copy; removing it asks UAC once, so a silent uninstall leaves it.
        string helper = string.IsNullOrEmpty(target) ? null : Path.Combine(target, "resources", "app.asar.unpacked", "native", "Orbit2.Input.exe");
        if (!silent && helper != null && File.Exists(helper))
        {
            try { using (var remove = Process.Start(new ProcessStartInfo(helper, "--admin-task=remove") { CreateNoWindow = true, UseShellExecute = false })) remove.WaitForExit(); }
            catch (Exception error) { Log("Administrator start task not removed: " + error.Message); }
        }
        if (!string.IsNullOrEmpty(target) && Directory.Exists(target) && IsOrbitFolder(target)) Retry(() => Directory.Delete(target, true));
        foreach (string link in new[] { StartMenuShortcut, DesktopShortcut }) { try { File.Delete(link); } catch { } }
        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
        // The running uninstaller removes itself once it has exited.
        string self = Application.ExecutablePath, folder = Path.GetDirectoryName(self);
        if (!silent) MessageBox.Show("Orbit 2 видалено.", "Orbit 2", MessageBoxButtons.OK, MessageBoxIcon.Information);
        Process.Start(new ProcessStartInfo("cmd.exe", "/c for /l %i in (1,1,30) do (ping 127.0.0.1 -n 2 >nul & del /f /q \"" + self + "\" 2>nul & if not exist \"" + self + "\" (rmdir \"" + folder + "\" 2>nul & exit))") { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
        return 0;
    }
#endif
}
