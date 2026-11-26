using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;

namespace Mono.Research.Windows
{
    internal sealed class AlpacaVault
    {
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("MONO.Windows.AlpacaVault.1");
        private static readonly Regex Credential = new Regex(@"\A[A-Za-z0-9_-]{5,256}\z", RegexOptions.CultureInvariant);
        private readonly string path;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 4096, RecursionLimit = 5 };

        internal AlpacaVault(string path) { this.path = path; }

        internal void Answer(CoreWebView2 core, string message)
        {
            if (message == null || message.Length > json.MaxJsonLength) return;
            IDictionary<string, object> request;
            try { request = json.DeserializeObject(message) as IDictionary<string, object>; }
            catch (ArgumentException) { return; }
            catch (InvalidOperationException) { return; }

            object rawId;
            string operation = Field(request, "operation");
            if (Field(request, "channel") != "mono-vault" || !request.TryGetValue("id", out rawId) || !(rawId is int)) return;
            object result;
            try
            {
                switch (operation)
                {
                    case "load": result = Load(); break;
                    case "save": result = Save(Field(request, "payload")); break;
                    case "clear": File.Delete(path); result = true; break;
                    default: return;
                }
            }
            catch (Exception error)
            {
                if (!(error is IOException || error is UnauthorizedAccessException || error is CryptographicException ||
                    error is ArgumentException || error is InvalidOperationException)) throw;
                result = operation == "load" ? null : (object)false;
            }
            core.PostWebMessageAsJson(json.Serialize(new { channel = "mono-vault", id = rawId, result = result }));
        }

        private static string Field(IDictionary<string, object> fields, string key)
        {
            object value;
            return fields != null && fields.TryGetValue(key, out value) ? value as string : null;
        }

        private string Load()
        {
            if (!File.Exists(path)) return null;
            if (new FileInfo(path).Length > 8192) return null;
            byte[] protectedBytes = File.ReadAllBytes(path);
            byte[] plain = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.CurrentUser);
            try { return Encoding.UTF8.GetString(plain); }
            finally { Array.Clear(plain, 0, plain.Length); }
        }

        private bool Save(string rawValue)
        {
            if (rawValue == null) return false;
            var values = json.DeserializeObject(rawValue) as IDictionary<string, object>;
            var key = Field(values, "key");
            var secret = Field(values, "secret");
            var feed = Field(values, "feed");
            if (key == null || secret == null || !Credential.IsMatch(key) || !Credential.IsMatch(secret) ||
                (feed != "iex" && feed != "sip")) return false;

            byte[] plain = Encoding.UTF8.GetBytes(json.Serialize(new { key = key, secret = secret, feed = feed }));
            byte[] encrypted;
            try { encrypted = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser); }
            finally { Array.Clear(plain, 0, plain.Length); }

            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string staged = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllBytes(staged, encrypted);
                if (File.Exists(path)) File.Replace(staged, path, null);
                else File.Move(staged, path);
                return true;
            }
            finally { File.Delete(staged); }
        }
    }
}
