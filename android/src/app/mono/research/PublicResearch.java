package app.mono.research;

import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.regex.Pattern;

final class PublicResearch {
    private static final int MAX_BYTES = 12_000_000;
    private static final int MAX_QUOTE_BYTES = 64 * 1024;
    private static final String SINA_SYMBOL = "gb_[a-z][a-z0-9]{0,14}(?:\\$[a-z0-9]{1,4})?";
    private static final Pattern SINA_QUOTE_URL = Pattern.compile("https://hq\\.sinajs\\.cn/list=" + SINA_SYMBOL + "(?:," + SINA_SYMBOL + "){0,29}");
    private static final Semaphore SLOTS = new Semaphore(6);
    private static long nextSecRequest;

    private static boolean allowed(URI uri) {
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || (uri.getPort() != -1 && uri.getPort() != 443)
            || uri.getUserInfo() != null || uri.getFragment() != null) return false;
        String path = uri.getPath();
        String query = uri.getQuery() == null ? "" : uri.getQuery().replace('+', ' ');
        switch (uri.getHost()) {
            case "www.sec.gov":
                return query.isEmpty() && ("/files/company_tickers.json".equals(path) || "/files/company_tickers_mf.json".equals(path) ||
                    path.matches("/Archives/edgar/data/\\d{1,10}/\\d{18}/primary_doc\\.xml"));
            case "data.sec.gov":
                return query.isEmpty() && path.matches("/(?:submissions|api/xbrl/companyfacts)/CIK\\d{10}\\.json");
            case "np-anotice-stock.eastmoney.com":
                return "/api/security/ann".equals(path) && query.matches("sr=-1&page_size=8&page_index=1&ann_type=A&client_source=web&stock_list=\\d{6}");
            case "push2.eastmoney.com":
                return "/api/qt/ulist.np/get".equals(path) && "secids=1.000001,0.399001&fields=f12,f14,f104,f105,f106,f124".equals(query);
            case "query.sse.com.cn":
                return "/security/stock/queryCompanyBulletin.do".equals(path) && query.matches("isPagination=true&productId=\\d{6}&securityType=0101,120100,020100,020200,120200&pageHelp\\.pageSize=5&pageHelp\\.pageNo=1");
            case "api.fund.eastmoney.com":
                return ("/f10/lsjz".equals(path) && query.matches("fundCode=\\d{6}&pageIndex=1&pageSize=5")) ||
                    ("/f10/JJGG".equals(path) && query.matches("fundcode=\\d{6}&pageIndex=1&pageSize=8&type=0"));
            case "cdn-api.cboe.com":
                return "/api/global/us_indices/daily_prices/VIX_History.csv".equals(path) && query.isEmpty();
            case "www.ssga.com":
                return "/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy".equals(path) && query.isEmpty();
            case "feeds.finance.yahoo.com":
                return "/rss/2.0/headline".equals(path) && query.matches("s=[A-Z][A-Z0-9.-]{0,13}&region=US&lang=en-US");
            case "hq.sinajs.cn":
                return SINA_QUOTE_URL.matcher(uri.toString()).matches();
            case "news.google.com":
                return "/rss/search".equals(path) && query.matches("q=\"[\\p{L}\\p{N} .·（）()\\-]{1,100}\"&hl=zh-CN&gl=CN&ceid=CN:zh-Hans");
            default: return false;
        }
    }

    private static synchronized void throttleSec() throws InterruptedException {
        long remaining = nextSecRequest - android.os.SystemClock.elapsedRealtime();
        if (remaining > 0) Thread.sleep(remaining);
        nextSecRequest = android.os.SystemClock.elapsedRealtime() + 300;
    }

    private static WebResourceResponse response(int status, byte[] bytes, Map<String, String> headers) {
        return new WebResourceResponse("application/octet-stream", null, status, status == 200 ? "OK" : "Unavailable", headers,
            new ByteArrayInputStream(bytes));
    }

    static WebResourceResponse read(Uri request, Map<String, String> headers) {
        final byte[] empty = new byte[0];
        String raw = request.getQuery();
        final URI uri;
        try { uri = raw == null || raw.length() > 1100 ? null : URI.create(raw); }
        catch (IllegalArgumentException error) { return response(400, empty, headers); }
        if (uri == null || !allowed(uri)) return response(403, empty, headers);
        boolean sinaQuote = "hq.sinajs.cn".equals(uri.getHost());
        int maxBytes = sinaQuote ? MAX_QUOTE_BYTES : MAX_BYTES;
        if (sinaQuote) {
            headers = new HashMap<>(headers);
            headers.put("Cache-Control", "no-store");
        }
        if (!SLOTS.tryAcquire()) return response(429, empty, headers);
        HttpURLConnection connection = null;
        try {
            if (uri.getHost().endsWith(".sec.gov")) throttleSec();
            connection = (HttpURLConnection)uri.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("User-Agent", "MONO Public Research/3.2");
            if ("query.sse.com.cn".equals(uri.getHost())) connection.setRequestProperty("Referer", "https://www.sse.com.cn/");
            if ("api.fund.eastmoney.com".equals(uri.getHost())) connection.setRequestProperty("Referer", "https://fundf10.eastmoney.com/");
            if (sinaQuote) {
                connection.setUseCaches(false);
                connection.setRequestProperty("Referer", "https://finance.sina.com.cn/");
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return response(status >= 400 && status < 600 ? status : 502, empty, headers);
            if (connection.getContentLength() > maxBytes) return response(502, empty, headers);
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] chunk = new byte[8192];
                int count;
                while ((count = input.read(chunk)) != -1) {
                    if (bytes.size() + count > maxBytes) return response(502, empty, headers);
                    bytes.write(chunk, 0, count);
                }
                return response(200, bytes.toByteArray(), headers);
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return response(504, empty, headers);
        } catch (IOException error) {
            return response(502, empty, headers);
        } finally {
            if (connection != null) connection.disconnect();
            SLOTS.release();
        }
    }
}
