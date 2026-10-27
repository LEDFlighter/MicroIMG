package io.github.ledflighter.microimg;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity
{
    private static final String origin = "https://appassets.androidplatform.net";
    private static final int chooseFile = 10, saveFile = 11;
    private WebView webView;
    private NfcController nfc;
    private ValueCallback<Uri[]> fileCallback;
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private byte[] pendingExport;
    private boolean pageReady;

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle savedInstanceState)
    {
        super.onCreate(savedInstanceState);
        if(android.os.Build.VERSION.SDK_INT >= 30)
            getWindow().setDecorFitsSystemWindows(false);
        nfc = new NfcController(this, this::event);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(11, 15, 26));
        FrameLayout content = new FrameLayout(this);
        content.setBackgroundColor(Color.rgb(11, 15, 26));
        content.addView(webView, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(content);
        // Inset the parent so fixed HTML elements use the actual safe viewport, including the keyboard.
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            if(android.os.Build.VERSION.SDK_INT >= 30)
            {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            }
            else
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return android.os.Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        content.requestApplyInsets();
        // Only bundled assets can load; no network permission or remote navigation is allowed.
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new Bridge(), "Android");
        webView.setWebViewClient(new WebViewClient()
        {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request)
            {
                Uri uri = request.getUrl();
                if("https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()))
                {
                    String path = uri.getPath();
                    if(path != null && path.matches("/(index\\.html|style\\.css|app\\.js|codec\\.js|pako\\.js)"))
                        try
                        {
                            String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "application/javascript";
                            return new WebResourceResponse(mime, "UTF-8", getAssets().open(path.substring(1)));
                        }
                        catch(IOException ignored) { }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request)
            {
                return !request.getUrl().toString().equals(origin + "/index.html");
            }
            @Override public void onPageFinished(WebView view, String url)
            {
                pageReady = true;
                nfc.status();
            }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail)
            {
                pageReady = false;
                nfc.cancel(null);
                new AlertDialog.Builder(MainActivity.this).setMessage("Die Bildansicht wurde beendet. Bitte die App neu öffnen und ein kleineres Bild verwenden.").setPositiveButton("Schließen", (dialog, which) -> finish()).show();
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient()
        {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params)
            {
                if(fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                boolean imageOnly = Arrays.stream(params.getAcceptTypes()).anyMatch(type -> type.startsWith("image/"));
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(imageOnly ? "image/*" : "*/*");
                try { startActivityForResult(intent, chooseFile); }
                catch(ActivityNotFoundException error) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        if(android.os.Build.VERSION.SDK_INT >= 33)
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        webView.loadUrl(origin + "/index.html");
    }
    @Override protected void onResume()
    {
        super.onResume();
        nfc.resume();
    }
    @Override protected void onPause()
    {
        nfc.pause();
        super.onPause();
    }
    // API 33+ uses OnBackInvokedDispatcher above; older Android versions use this callback.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { handleBack(); }
    private void handleBack()
    {
        if(nfc.isRunning()) nfc.cancel("NFC-Vorgang abgebrochen. Bereits geschriebene Tags bleiben erhalten.");
        else super.onBackPressed();
    }
    private void event(JSONObject data)
    {
        runOnUiThread(() -> {
            if(pageReady && !isFinishing())
                webView.evaluateJavascript("window.onNativeEvent(" + data + ")", null);
        });
    }
    private void status(String type, String message)
    {
        try { event(new JSONObject().put("type", type).put("message", message)); }
        catch(org.json.JSONException error) { throw new IllegalStateException(error); }
    }
    final class Bridge
    {
        @JavascriptInterface public void read() { runOnUiThread(() -> nfc.startRead()); }
        @JavascriptInterface public void stopRead() { runOnUiThread(() -> nfc.stopRead()); }
        @JavascriptInterface public void cancel() { runOnUiThread(() -> nfc.cancel("NFC-Vorgang abgebrochen. Bereits geschriebene Tags bleiben erhalten.")); }
        @JavascriptInterface public void write(String json)
        {
            runOnUiThread(() -> {
                try
                {
                    if(json.length() > 3500000) throw new IllegalArgumentException("Die Serie ist zu groß.");
                    nfc.startWrite(new JSONArray(json));
                }
                catch(Exception error) { status("error", error.getMessage()); }
            });
        }
        @JavascriptInterface public void nfcSettings()
        {
            runOnUiThread(() -> {
                try { startActivity(new Intent(Settings.ACTION_NFC_SETTINGS)); }
                catch(ActivityNotFoundException error) { status("error", "NFC-Einstellungen sind auf diesem Gerät nicht verfügbar."); }
            });
        }
        @JavascriptInterface public void hardware() { runOnUiThread(() -> nfc.status()); }
        @JavascriptInterface public void pasteCode()
        {
            runOnUiThread(() -> {
                JSONObject data = new JSONObject();
                try
                {
                    data.put("type", "paste");
                    ClipData clip = ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).getPrimaryClip();
                    CharSequence text = clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).getText() : null;
                    if(text == null || text.length() == 0)
                        data.put("error", "Die Zwischenablage enthält keinen Text.");
                    else if(text.length() > 3000000)
                        data.put("error", "Der Text ist zu groß (max. 3 MB).");
                    else data.put("text", text.toString());
                    event(data);
                }
                catch(Exception error) { status("error", "Die Zwischenablage konnte nicht gelesen werden. Bitte den Text direkt einfügen."); }
            });
        }
        @JavascriptInterface public void copy(String text)
        {
            if(text.length() > 3000000) return;
            runOnUiThread(() -> ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("MicroIMG", text)));
        }
        @JavascriptInterface public void save(String filename, String mime, String base64)
        {
            if(base64.length() > 24000000 || !(mime.equals("image/png") || mime.equals("text/plain"))) return;
            runOnUiThread(() -> {
                if(pendingExport != null) { status("error", "Bitte den laufenden Export zuerst abschließen."); return; }
                try
                {
                    pendingExport = Base64.decode(base64, Base64.DEFAULT);
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, filename.replaceAll("[^a-zA-Z0-9._-]", "_"));
                    startActivityForResult(intent, saveFile);
                }
                catch(Exception error) { pendingExport = null; status("error", "Die Datei konnte nicht exportiert werden."); }
            });
        }
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data)
    {
        super.onActivityResult(requestCode, resultCode, data);
        if(requestCode == chooseFile && fileCallback != null)
        {
            fileCallback.onReceiveValue(resultCode == RESULT_OK && data != null && data.getData() != null ? new Uri[] {data.getData()} : null);
            fileCallback = null;
        }
        if(requestCode == saveFile)
        {
            byte[] bytes = pendingExport;
            pendingExport = null;
            if(resultCode != RESULT_OK || data == null || data.getData() == null || bytes == null) return;
            Uri uri = data.getData();
            files.execute(() -> {
                try(OutputStream output = getContentResolver().openOutputStream(uri, "wt"))
                {
                    if(output == null) throw new IOException("Kein Dateizugriff.");
                    output.write(bytes);
                    status("saved", "Datei gespeichert.");
                }
                catch(IOException error) { status("error", "Speichern fehlgeschlagen: " + error.getMessage()); }
            });
        }
    }
    @Override protected void onDestroy()
    {
        pageReady = false;
        nfc.destroy();
        files.shutdown();
        if(fileCallback != null) fileCallback.onReceiveValue(null);
        webView.removeJavascriptInterface("Android");
        webView.destroy();
        super.onDestroy();
    }
}
