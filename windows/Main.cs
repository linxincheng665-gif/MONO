using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Mono.Research.Windows
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string smokeReport = args.Length == 2 && args[0] == "--smoke-test" ? Path.GetFullPath(args[1]) : null;
            string profile = smokeReport == null
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MONO", "WebView2")
                : Path.Combine(Path.GetTempPath(), "mono-webview-smoke-" + Guid.NewGuid().ToString("N"));

            using (var window = new MonoWindow(profile, smokeReport))
            {
                Application.Run(window);
                return window.ExitCode;
            }
        }
    }

    internal sealed class MonoWindow : Form
    {
        private const string Host = "mono.windows.local";
        private const string StartPage = "https://" + Host + "/index.html";
        private const string RuntimeDownload = "https://developer.microsoft.com/microsoft-edge/webview2/#download";
        private const string Headers = "Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            + "img-src 'self' data:; font-src 'self'; connect-src https: wss:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\r\n"
            + "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCache-Control: no-store";
        private static readonly IDictionary<string, string> Types = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { ".html", "text/html; charset=utf-8" }, { ".css", "text/css; charset=utf-8" },
            { ".mjs", "text/javascript; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" },
            { ".png", "image/png" }, { ".svg", "image/svg+xml" }, { ".woff2", "font/woff2" },
            { ".txt", "text/plain; charset=utf-8" },
        };

        private readonly string profile;
        private readonly string smokeReport;
        private readonly WebView2 web;
        private readonly AlpacaVault vault;
        private CoreWebView2Environment environment;
        private bool smokeRunning;

        internal MonoWindow(string profile, string smokeReport)
        {
            this.profile = profile;
            this.smokeReport = smokeReport;
            vault = new AlpacaVault(Path.Combine(smokeReport == null ? Path.GetDirectoryName(profile) : profile, "alpaca.dpapi"));
            Text = "MONO · 投资研究终端";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            AutoScaleMode = AutoScaleMode.Dpi;
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(620, 510);
            Rectangle workArea = Screen.PrimaryScreen.WorkingArea;
            ClientSize = new Size(Math.Min(1320, workArea.Width - 80), Math.Min(900, workArea.Height - 90));
            BackColor = Color.FromArgb(250, 251, 252);
            if (smokeReport != null) ShowInTaskbar = false;

            web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
            Controls.Add(web);
            Shown += Start;
        }

        internal int ExitCode { get; private set; }

        private async void Start(object sender, EventArgs args)
        {
            try
            {
                environment = await CoreWebView2Environment.CreateAsync(null, profile);
                if (IsDisposed) return;
                await web.EnsureCoreWebView2Async(environment);
                if (IsDisposed) return;
                CoreWebView2 core = web.CoreWebView2;
                core.Settings.AreHostObjectsAllowed = false;
                core.Settings.IsWebMessageEnabled = true;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsGeneralAutofillEnabled = false;
                core.Settings.IsPasswordAutosaveEnabled = false;
                core.AddWebResourceRequestedFilter("https://" + Host + "/*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
                core.WebResourceRequested += ServeApp;
                core.NavigationStarting += BlockExternalNavigation;
                core.NewWindowRequested += BlockNewWindow;
                core.PermissionRequested += (o, e) => e.State = CoreWebView2PermissionState.Deny;
                core.WebMessageReceived += AcceptVaultMessage;
                core.NavigationCompleted += Loaded;
                using (var script = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("Mono.Windows.Vault")))
                    await core.AddScriptToExecuteOnDocumentCreatedAsync(script.ReadToEnd());
                core.Navigate(StartPage);
            }
            catch (Exception error)
            {
                if (!IsDisposed) Fail(error);
            }
        }

        private static bool IsLocal(Uri uri)
        {
            return uri != null && uri.Scheme == Uri.UriSchemeHttps && uri.Host == Host && uri.IsDefaultPort && uri.UserInfo.Length == 0;
        }

        private static void BlockExternalNavigation(object sender, CoreWebView2NavigationStartingEventArgs args)
        {
            Uri uri;
            if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out uri) || !IsLocal(uri) || uri.AbsolutePath != "/index.html") args.Cancel = true;
        }

        private static void BlockNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs args)
        {
            args.Handled = true;
            Uri uri;
            if (args.IsUserInitiated && Uri.TryCreate(args.Uri, UriKind.Absolute, out uri) && uri.Scheme == Uri.UriSchemeHttps && !IsLocal(uri))
            {
                OpenExternal(uri.AbsoluteUri);
            }
        }

        private async void ServeApp(object sender, CoreWebView2WebResourceRequestedEventArgs args)
        {
            Uri uri;
            if (!Uri.TryCreate(args.Request.Uri, UriKind.Absolute, out uri) || !IsLocal(uri)) return;
            string filename = uri.AbsolutePath.TrimStart('/');
            string mime;
            Stream stream = null;
            int code = 404;
            string reason = "Not Found";
            if (args.Request.Method != "GET")
            {
                code = 405;
                reason = "Method Not Allowed";
            }
            else if (filename == "public-research")
            {
                var deferral = args.GetDeferral();
                try
                {
                    int upstreamStatus = 502;
                    byte[] bytes = new byte[0];
                    try
                    {
                        string requestUrl = uri.Query.Length > 1 ? Uri.UnescapeDataString(uri.Query.Substring(1)) : "";
                        bytes = await Task.Run(() => PublicResearch.Read(requestUrl, out upstreamStatus));
                    }
                    catch (ArgumentException) { upstreamStatus = 400; }
                    catch (UriFormatException) { upstreamStatus = 400; }
                    catch (InvalidOperationException) { upstreamStatus = 502; }
                    if (upstreamStatus < 400 || upstreamStatus > 599) upstreamStatus = upstreamStatus == 200 ? 200 : 502;
                    args.Response = environment.CreateWebResourceResponse(new MemoryStream(bytes), upstreamStatus,
                        upstreamStatus == 200 ? "OK" : "Unavailable", Headers + "\r\nContent-Type: application/octet-stream");
                }
                finally { deferral.Complete(); }
                return;
            }
            else if (filename.IndexOf('/') < 0 && Types.TryGetValue(Path.GetExtension(filename), out mime))
            {
                stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Mono.Assets." + filename);
                if (stream != null)
                {
                    args.Response = environment.CreateWebResourceResponse(stream, 200, "OK", Headers + "\r\nContent-Type: " + mime);
                    return;
                }
            }
            args.Response = environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(reason)), code,
                reason, Headers + "\r\nContent-Type: text/plain; charset=utf-8");
        }

        private void AcceptVaultMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            Uri uri;
            if (!Uri.TryCreate(args.Source, UriKind.Absolute, out uri) || !IsLocal(uri) || uri.AbsolutePath != "/index.html") return;
            vault.Answer(web.CoreWebView2, args.WebMessageAsJson);
        }

        private async void Loaded(object sender, CoreWebView2NavigationCompletedEventArgs args)
        {
            if (!args.IsSuccess && args.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
            {
                Fail(new InvalidOperationException("无法加载工作区。" + args.WebErrorStatus));
                return;
            }
            if (smokeReport == null || smokeRunning || !args.IsSuccess) return;
            smokeRunning = true;

            try
            {
                const string check = "location.origin === 'https://mono.windows.local' && isSecureContext && "
                    + "typeof crypto.randomUUID === 'function' && !!document.querySelector('#app .shell h1') && !!document.querySelector('a[href=\"#market\"]')";
                bool loaded = false;
                for (int attempt = 0; attempt < 30; attempt++)
                {
                    loaded = await web.CoreWebView2.ExecuteScriptAsync(check) == "true";
                    if (loaded) break;
                    await Task.Delay(125);
                }
                if (!loaded) throw new InvalidOperationException("The workspace did not render.");
                const string fontCheck = "document.fonts.load('550 16px Inter', '0123456789').then("
                    + "faces => window.monoSmokeFont = faces.some(face => face.family === 'Inter' && face.status === 'loaded'),"
                    + "() => window.monoSmokeFont = false)";
                await web.CoreWebView2.ExecuteScriptAsync(fontCheck);
                bool fontLoaded = false;
                for (int attempt = 0; attempt < 30; attempt++)
                {
                    fontLoaded = await web.CoreWebView2.ExecuteScriptAsync("window.monoSmokeFont") == "true";
                    if (fontLoaded) break;
                    await Task.Delay(100);
                }
                if (!fontLoaded) throw new InvalidOperationException("The bundled Inter font could not load.");
                const string storageCheck = "(function(){var key='mono-windows-smoke'; localStorage.setItem(key,'ok'); var result=localStorage.getItem(key)==='ok'; localStorage.removeItem(key); return result;})()";
                if (await web.CoreWebView2.ExecuteScriptAsync(storageCheck) != "true") throw new InvalidOperationException("Local storage is unavailable.");

                await web.CoreWebView2.ExecuteScriptAsync("location.hash='#market'");
                string title = "null";
                for (int attempt = 0; attempt < 30; attempt++)
                {
                    title = await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#main-content h1')?.textContent");
                    if (title == "\"市场观察\"") break;
                    await Task.Delay(100);
                }
                if (title != "\"市场观察\"") throw new InvalidOperationException("The market route did not render: " + title);

                const string researchCheck = "(async function(){ try { window.monoSmokeResearch=(await fetch('/public-research?'+encodeURIComponent('https://example.com/'))).status; } catch(e) { window.monoSmokeResearch=0; } })()";
                await web.CoreWebView2.ExecuteScriptAsync(researchCheck);
                await web.CoreWebView2.ExecuteScriptAsync("location.hash='#quant'");
                bool researchReady = false;
                for (int attempt = 0; attempt < 30; attempt++)
                {
                    researchReady = await web.CoreWebView2.ExecuteScriptAsync("window.monoSmokeResearch===403 && document.querySelector('#main-content h1')?.textContent==='量化实验室'") == "true";
                    if (researchReady) break;
                    await Task.Delay(100);
                }
                if (!researchReady) throw new InvalidOperationException("The quant route or research source allowlist is unavailable.");

                const string vaultCheck = "(async function(){ const raw=JSON.stringify({key:'TESTKEY1',secret:'TESTSECRET1',feed:'iex'});"
                    + "window.monoSmokeVault=await MonoNative.saveAlpaca(raw) && JSON.parse(await MonoNative.loadAlpaca())?.key==='TESTKEY1' && "
                    + "await MonoNative.clearAlpaca() && await MonoNative.loadAlpaca()===null; })()";
                await web.CoreWebView2.ExecuteScriptAsync(vaultCheck);
                bool encrypted = false;
                for (int attempt = 0; attempt < 30; attempt++)
                {
                    encrypted = await web.CoreWebView2.ExecuteScriptAsync("window.monoSmokeVault") == "true";
                    if (encrypted) break;
                    await Task.Delay(100);
                }
                if (!encrypted) throw new InvalidOperationException("Encrypted credential storage is unavailable.");

                File.WriteAllText(smokeReport, "OK\r\nWebView2 " + environment.BrowserVersionString + "\r\nSecure origin, bundled Inter font, local storage, market and quant views, research source allowlist and Windows credential vault verified.\r\n", new UTF8Encoding(false));
                Close();
            }
            catch (Exception error) { Fail(error); }
        }

        private static void OpenExternal(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (System.ComponentModel.Win32Exception) { }
        }

        private void Fail(Exception error)
        {
            ExitCode = 1;
            if (smokeReport != null)
            {
                File.WriteAllText(smokeReport, "FAILED\r\n" + error, new UTF8Encoding(false));
            }
            else if (error is WebView2RuntimeNotFoundException)
            {
                var result = MessageBox.Show(this, "MONO 需要 Microsoft Edge WebView2 Runtime。是否打开 Microsoft 官方下载？",
                    "MONO", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (result == DialogResult.Yes) OpenExternal(RuntimeDownload);
            }
            else
            {
                MessageBox.Show(this, error.Message, "MONO 无法启动", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            Close();
        }
    }
}
