using System;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;

namespace Mono.Research.Windows
{
    internal static class PublicResearch
    {
        private const int MaxBytes = 12000000;
        private static readonly SemaphoreSlim Slots = new SemaphoreSlim(6);
        private static readonly object SecThrottle = new object();
        private static DateTime nextSecRequest;

        private static bool Allowed(Uri uri)
        {
            if (uri == null || uri.Scheme != "https" || !uri.IsDefaultPort || uri.Fragment.Length != 0 || uri.UserInfo.Length != 0) return false;
            string path = uri.AbsolutePath;
            string query = Uri.UnescapeDataString(uri.Query.Replace("+", " "));
            switch (uri.Host)
            {
                case "www.sec.gov":
                    return query.Length == 0 && (path == "/files/company_tickers.json" || path == "/files/company_tickers_mf.json" ||
                        Regex.IsMatch(path, @"^/Archives/edgar/data/\d{1,10}/\d{18}/primary_doc\.xml$"));
                case "data.sec.gov":
                    return query.Length == 0 && Regex.IsMatch(path, @"^/(?:submissions|api/xbrl/companyfacts)/CIK\d{10}\.json$");
                case "np-anotice-stock.eastmoney.com":
                    return path == "/api/security/ann" && Regex.IsMatch(query, @"^\?sr=-1&page_size=8&page_index=1&ann_type=A&client_source=web&stock_list=\d{6}$");
                case "push2.eastmoney.com":
                    return path == "/api/qt/ulist.np/get" && query == "?secids=1.000001,0.399001&fields=f12,f14,f104,f105,f106,f124";
                case "query.sse.com.cn":
                    return path == "/security/stock/queryCompanyBulletin.do" && Regex.IsMatch(query, @"^\?isPagination=true&productId=\d{6}&securityType=0101,120100,020100,020200,120200&pageHelp\.pageSize=5&pageHelp\.pageNo=1$");
                case "api.fund.eastmoney.com":
                    return (path == "/f10/lsjz" && Regex.IsMatch(query, @"^\?fundCode=\d{6}&pageIndex=1&pageSize=5$")) ||
                        (path == "/f10/JJGG" && Regex.IsMatch(query, @"^\?fundcode=\d{6}&pageIndex=1&pageSize=8&type=0$"));
                case "cdn-api.cboe.com":
                    return path == "/api/global/us_indices/daily_prices/VIX_History.csv" && query.Length == 0;
                case "www.ssga.com":
                    return path == "/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy" && query.Length == 0;
                case "feeds.finance.yahoo.com":
                    return path == "/rss/2.0/headline" && Regex.IsMatch(query, @"^\?s=[A-Z][A-Z0-9.-]{0,13}&region=US&lang=en-US$");
                case "news.google.com":
                    return path == "/rss/search" && Regex.IsMatch(query, @"^\?q=""[\p{L}\p{N} .·（）()\-]{1,100}""&hl=zh-CN&gl=CN&ceid=CN:zh-Hans$");
                default: return false;
            }
        }

        internal static byte[] Read(string raw, out int status)
        {
            status = 403;
            Uri uri;
            if (raw.Length > 1100 || !Uri.TryCreate(raw, UriKind.Absolute, out uri) || !Allowed(uri)) return new byte[0];
            status = 429;
            if (!Slots.Wait(0)) return new byte[0];
            try
            {
                if (uri.Host.EndsWith(".sec.gov", StringComparison.Ordinal))
                {
                    lock (SecThrottle)
                    {
                        int remaining = (int)(nextSecRequest - DateTime.UtcNow).TotalMilliseconds;
                        if (remaining > 0) Thread.Sleep(remaining);
                        nextSecRequest = DateTime.UtcNow.AddMilliseconds(300);
                    }
                }
                var request = (HttpWebRequest)WebRequest.Create(uri);
                request.AllowAutoRedirect = false;
                request.Timeout = 8000;
                request.ReadWriteTimeout = 8000;
                request.UserAgent = "MONO Public Research/3.2";
                if (uri.Host == "query.sse.com.cn") request.Referer = "https://www.sse.com.cn/";
                if (uri.Host == "api.fund.eastmoney.com") request.Referer = "https://fundf10.eastmoney.com/";
                request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var stream = response.GetResponseStream())
                using (var buffer = new MemoryStream())
                {
                    status = 502;
                    if (response.StatusCode != HttpStatusCode.OK || response.ContentLength > MaxBytes) return new byte[0];
                    var chunk = new byte[8192];
                    int count;
                    while ((count = stream.Read(chunk, 0, chunk.Length)) > 0)
                    {
                        if (buffer.Length + count > MaxBytes) return new byte[0];
                        buffer.Write(chunk, 0, count);
                    }
                    status = 200;
                    return buffer.ToArray();
                }
            }
            catch (WebException error)
            {
                var response = error.Response as HttpWebResponse;
                status = response == null ? 504 : (int)response.StatusCode;
                if (response != null) response.Dispose();
                return new byte[0];
            }
            catch (IOException) { status = 502; return new byte[0]; }
            finally { Slots.Release(); }
        }
    }
}
