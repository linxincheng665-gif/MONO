package app.mono.research;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String HOST = "mono.android.local";
    private static final String BASE_URL = "https://" + HOST;
    private static final String START_PAGE = BASE_URL + "/index.html";
    private static final int OPEN_HISTORY = 1;
    private static final String[] HISTORY_MIME_TYPES = {
        "text/csv", "text/tab-separated-values", "text/plain",
        "application/csv", "application/x-csv", "application/vnd.ms-excel",
        "application/octet-stream", "application/json"
    };
    private static final String CLOSE_TRANSIENT_UI = "(function () {"
        + "var dialog = document.getElementById('workspace-dialog');"
        + "if (dialog && dialog.open) { dialog.close(); return true; }"
        + "var shell = document.querySelector('.shell[data-menu=open]');"
        + "var close = shell && shell.querySelector('[data-action=close-menu]');"
        + "if (close) { close.click(); return true; }"
        + "return false; })()";
    private static final String CHECK_WEBVIEW = "(function () {"
        + "if (window.crypto && typeof window.crypto.randomUUID === 'function' &&"
        + "typeof Object.hasOwn === 'function' && typeof Array.prototype.at === 'function' &&"
        + "typeof HTMLDialogElement !== 'undefined' && HTMLDialogElement.prototype.showModal) return;"
        + "var root = document.getElementById('app');"
        + "if (root && !root.firstChild) root.innerHTML = '<main class=\"main-content\"><h1>MONO</h1>"
        + "<p>请更新 Android System WebView 或 Chrome，再重新打开 MONO。</p></main>';"
        + "})()";
    private static final Map<String, String> ASSET_TYPES;
    private static final Map<String, String> RESPONSE_HEADERS;

    static {
        Map<String, String> types = new HashMap<>();
        types.put("/index.html", "text/html");
        types.put("/mono-icon.svg", "image/svg+xml");
        types.put("/styles.css", "text/css");
        types.put("/views.css", "text/css");
        types.put("/app.mjs", "text/javascript");
        types.put("/model.mjs", "text/javascript");
        types.put("/views.mjs", "text/javascript");
        types.put("/feed.mjs", "text/javascript");
        types.put("/instruments.mjs", "text/javascript");
        types.put("/public-stock-feed.mjs", "text/javascript");
        types.put("/stock-history.mjs", "text/javascript");
        types.put("/trend-data.mjs", "text/javascript");
        types.put("/market-chart.mjs", "text/javascript");
        types.put("/investment-engine.mjs", "text/javascript");
        types.put("/research-data.mjs", "text/javascript");
        types.put("/research-discovery.mjs", "text/javascript");
        types.put("/market-research.mjs", "text/javascript");
        types.put("/quant-lab.mjs", "text/javascript");
        types.put("/model-gateway.mjs", "text/javascript");
        types.put("/workspace-analysis.mjs", "text/javascript");
        types.put("/chart-navigation.mjs", "text/javascript");
        types.put("/market-chart.css", "text/css");
        types.put("/InterVariable.woff2", "font/woff2");
        types.put("/Inter-OFL.txt", "text/plain");
        ASSET_TYPES = Collections.unmodifiableMap(types);

        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy",
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            + "img-src 'self' data:; font-src 'self'; connect-src https: wss:; base-uri 'none'; "
            + "form-action 'none'; frame-src 'none'; frame-ancestors 'none'");
        headers.put("X-Content-Type-Options", "nosniff");
        RESPONSE_HEADERS = Collections.unmodifiableMap(headers);
    }

    private WebView webView;
    private ValueCallback<Uri[]> selectedFiles;
    private Runnable unregisterBack;
    private boolean backPending;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        int porcelain = getColor(R.color.mono_porcelain);
        FrameLayout content = new FrameLayout(this);
        content.setBackgroundColor(porcelain);
        webView = new WebView(this);
        webView.setBackgroundColor(porcelain);
        content.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        configureSystemBars(content, porcelain);
        setContentView(content);
        content.requestApplyInsets();
        configureWebView();

        if (Build.VERSION.SDK_INT >= 33) {
            unregisterBack = ModernBack.register(this, this::handleBack);
        }
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(START_PAGE);
        }
    }

    @SuppressWarnings("deprecation")
    private void configureSystemBars(FrameLayout content, int porcelain) {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(lightBars, lightBars);
            }
            content.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return WindowInsets.CONSUMED;
            });
            return;
        }

        window.setStatusBarColor(porcelain);
        window.setNavigationBarColor(Build.VERSION.SDK_INT >= 26 ? porcelain : getColor(R.color.mono_accent));
        int lightBars = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) lightBars |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        window.getDecorView().setSystemUiVisibility(lightBars);
    }

    @SuppressWarnings("deprecation")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(false);
        webView.setWebViewClient(new LocalClient());
        webView.addJavascriptInterface(new AlpacaCredentialVault(this), "MonoNative");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (selectedFiles != null) {
                    callback.onReceiveValue(null);
                    return true;
                }

                selectedFiles = callback;
                Intent open = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                open.addCategory(Intent.CATEGORY_OPENABLE);
                open.setType("*/*");
                open.putExtra(Intent.EXTRA_MIME_TYPES, HISTORY_MIME_TYPES);
                open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivityForResult(Intent.createChooser(open, getString(R.string.choose_history)), OPEN_HISTORY);
                } catch (ActivityNotFoundException error) {
                    finishFileSelection(null);
                    Toast.makeText(MainActivity.this, R.string.chooser_unavailable, Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
    }

    private static boolean isAppOrigin(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getUserInfo() == null
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private static String assetPath(Uri uri) {
        String path = uri.getEncodedPath();
        return path == null || path.isEmpty() || "/".equals(path) ? "/index.html" : path;
    }

    private static boolean isAppPage(Uri uri) {
        return isAppOrigin(uri) && "/index.html".equals(assetPath(uri));
    }

    private static WebResourceResponse invalidAsset(int status, String message) {
        return new WebResourceResponse("text/plain", "UTF-8", status, message, RESPONSE_HEADERS,
            new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }

    private void openSourceInBrowser(Uri uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                || HOST.equalsIgnoreCase(uri.getHost())) return;
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "找不到可打开来源链接的浏览器。", Toast.LENGTH_SHORT).show();
        }
    }

    private final class LocalClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isAppPage(uri)) return false;
            if (request.isForMainFrame() && request.hasGesture() && "GET".equals(request.getMethod())) openSourceInBrowser(uri);
            return true;
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (isAppPage(uri)) return false;
            WebView.HitTestResult hit = view.getHitTestResult();
            if (hit != null && (hit.getType() == WebView.HitTestResult.SRC_ANCHOR_TYPE ||
                    hit.getType() == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) && url.equals(hit.getExtra())) openSourceInBrowser(uri);
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isAppOrigin(uri)) return null;
            String path = assetPath(uri);
            if ("/public-research".equals(path)) {
                if (!"GET".equals(request.getMethod())) return invalidAsset(405, "Method Not Allowed");
                return PublicResearch.read(uri, RESPONSE_HEADERS);
            }
            String mimeType = ASSET_TYPES.get(path);
            if (mimeType == null) return invalidAsset(404, "Not Found");
            if (!"GET".equals(request.getMethod())) return invalidAsset(405, "Method Not Allowed");

            try {
                return new WebResourceResponse(mimeType, mimeType.startsWith("text/") ? "UTF-8" : null, 200, "OK", RESPONSE_HEADERS,
                    getAssets().open(path.substring(1)));
            } catch (IOException error) {
                return invalidAsset(404, "Not Found");
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (isAppPage(Uri.parse(url))) view.evaluateJavascript(CHECK_WEBVIEW, null);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != OPEN_HISTORY) return;
        Uri result = resultCode == RESULT_OK && data != null ? data.getData() : null;
        finishFileSelection(result != null && "content".equals(result.getScheme()) ? new Uri[]{result} : null);
    }

    private void finishFileSelection(Uri[] result) {
        ValueCallback<Uri[]> callback = selectedFiles;
        selectedFiles = null;
        if (callback != null) callback.onReceiveValue(result);
    }

    @Override
    public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (webView == null || backPending) return;
        backPending = true;
        webView.evaluateJavascript(CLOSE_TRANSIENT_UI, result -> {
            backPending = false;
            if (isFinishing() || isDestroyed() || "true".equals(result)) return;
            if (webView.canGoBack()) webView.goBack();
            else finish();
        });
    }

    private static final class ModernBack {
        private ModernBack() {}

        static Runnable register(Activity activity, Runnable handleBack) {
            OnBackInvokedDispatcher dispatcher = activity.getOnBackInvokedDispatcher();
            OnBackInvokedCallback callback = handleBack::run;
            dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
            return () -> dispatcher.unregisterOnBackInvokedCallback(callback);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (webView != null) webView.saveState(state);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (unregisterBack != null) unregisterBack.run();
        finishFileSelection(null);
        if (webView != null) {
            webView.removeJavascriptInterface("MonoNative");
            ((FrameLayout) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
