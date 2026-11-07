using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Principal;

// The UAC prompt for creating the task names the helper by this title.
[assembly: AssemblyTitle("Orbit 2")]
[assembly: AssemblyProduct("Orbit 2")]

// "Start as administrator" is a Task Scheduler task with the highest run level. Creating or removing it needs
// one UAC confirmation; afterwards Windows starts Orbit elevated through the task without asking again.
// The task passes Run()'s parameter as $(Arg0), so a hand-over keeps --hidden (sign-in) or --quit.
internal static class AdminTask
{
    internal const string Name = "Orbit 2 (administrator)";
    private const int Done = 0, Failed = 1, NotApplicable = 3, Canceled = 4;
    private const int TokenElevationType = 18, TokenElevation = 20, ElevationTypeLimited = 3, RunLevelHighest = 1;

    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int length, out int returned);

    // status          prints {"available","enabled","elevated"} as JSON
    // start:<arg>     hands the start over to the task; 3 when there is no task for this copy or Orbit is already elevated
    // register|remove creates or deletes the task, asking UAC first when needed; 4 when the prompt was declined
    internal static int Run(string command)
    {
        try
        {
            if (command == "status")
            {
                bool elevated, available = CanElevate(out elevated) && OrbitPath() != null;
                Console.WriteLine("{\"available\":" + Json(available) + ",\"enabled\":" + Json(available && TaskMatches()) + ",\"elevated\":" + Json(elevated) + "}");
                return Done;
            }
            if (command.StartsWith("start:")) return Start(command.Substring(6));
            if (command == "register" || command == "remove") return Change(command == "register");
            Console.Error.WriteLine("Unsupported task command.");
            return 2;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return Failed; }
    }

    private static int Start(string argument)
    {
        bool elevated;
        if (!CanElevate(out elevated) || elevated || !TaskMatches()) return NotApplicable;
        Call(FindTask(), "Run", argument);
        return Done;
    }

    private static int Change(bool register)
    {
        bool elevated;
        string orbit = OrbitPath();
        if (orbit == null || !CanElevate(out elevated)) { Console.Error.WriteLine("Orbit cannot start as administrator from this copy or account."); return NotApplicable; }
        if (!register && FindTask() == null) return Done;
        if (!elevated) return RunElevated("--admin-task=" + (register ? "register" : "remove"));
        object folder = Call(Service(), "GetFolder", "\\");
        if (!register) { if (FindTask() != null) Call(folder, "DeleteTask", Name, 0); return Done; }
        // 6 = create or update, 3 = run in the signed-in user's session.
        Call(folder, "RegisterTask", Name, TaskXml(orbit), 6, null, null, 3, null);
        return TaskMatches() ? Done : Failed;
    }

    private static int RunElevated(string arguments)
    {
        var info = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, arguments) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
        try
        {
            using (Process process = Process.Start(info)) { process.WaitForExit(); return process.ExitCode; }
        }
        catch (Win32Exception error)
        {
            if (error.NativeErrorCode == 1223) return Canceled;
            throw;
        }
    }

    // Only an administrator account gets a higher token from the task; a standard user would run it unchanged.
    private static bool CanElevate(out bool elevated)
    {
        using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
        {
            int value, type, size;
            elevated = GetTokenInformation(identity.Token, TokenElevation, out value, 4, out size) && value != 0;
            bool limited = GetTokenInformation(identity.Token, TokenElevationType, out type, 4, out size) && type == ElevationTypeLimited;
            return limited || (elevated && new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator));
        }
    }

    // The helper ships in <Orbit>\resources\app.asar.unpacked\native; a development checkout has no Orbit2.exe there.
    private static string OrbitPath()
    {
        string native = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
        string root = Path.GetFullPath(Path.Combine(native, "..", "..", ".."));
        string orbit = Path.Combine(root, "Orbit2.exe");
        return File.Exists(orbit) && File.Exists(Path.Combine(root, "resources", "app.asar")) ? orbit : null;
    }

    // A task left by another Orbit folder must not start that copy instead of this one.
    private static bool TaskMatches()
    {
        object task = FindTask();
        string orbit = OrbitPath();
        if (task == null || orbit == null) return false;
        object definition = Get(task, "Definition");
        if (Convert.ToInt32(Get(Get(definition, "Principal"), "RunLevel")) != RunLevelHighest) return false;
        object actions = Get(definition, "Actions");
        if (Convert.ToInt32(Get(actions, "Count")) != 1) return false;
        string command = (Get(Get(actions, "Item", 1), "Path") as string ?? "").Trim().Trim('"');
        return string.Equals(Path.GetFullPath(command), orbit, StringComparison.OrdinalIgnoreCase);
    }

    private static object FindTask()
    {
        try { return Call(Call(Service(), "GetFolder", "\\"), "GetTask", Name); }
        catch (TargetInvocationException) { return null; }
        catch (COMException) { return null; }
    }

    private static object Service()
    {
        object service = Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service", true));
        Call(service, "Connect");
        return service;
    }

    private static string TaskXml(string orbit)
    {
        string user = WindowsIdentity.GetCurrent().User.Value;
        return "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\n" +
            "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\n" +
            "  <RegistrationInfo><Author>Orbit 2</Author><Description>Starts Orbit with administrator rights without a UAC prompt, so the side mouse button also works in programs that run as administrator. Turn it off in Orbit settings.</Description></RegistrationInfo>\n" +
            "  <Principals><Principal id=\"Author\"><UserId>" + user + "</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>\n" +
            // Parallel lets a second start reach the running Orbit, which then shows its window or quits.
            "  <Settings><MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>" +
            "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>false</StartWhenAvailable>" +
            "<AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>4</Priority>" +
            "<IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings></Settings>\n" +
            "  <Actions Context=\"Author\"><Exec><Command>\"" + SecurityElement.Escape(orbit) + "\"</Command><Arguments>--elevated-task $(Arg0)</Arguments>" +
            "<WorkingDirectory>" + SecurityElement.Escape(Path.GetDirectoryName(orbit)) + "</WorkingDirectory></Exec></Actions>\n" +
            "</Task>";
    }

    private static object Call(object target, string name, params object[] arguments) { return target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, arguments); }
    private static object Get(object target, string name, params object[] arguments) { return target.GetType().InvokeMember(name, BindingFlags.GetProperty, null, target, arguments); }
    private static string Json(bool value) { return value ? "true" : "false"; }
}
