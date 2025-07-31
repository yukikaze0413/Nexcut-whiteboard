package com.example.opencv.webwhiteboard;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.content.Intent;
import android.net.Uri;
import android.app.Activity;

import androidx.activity.EdgeToEdge;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.example.opencv.Constant;
import com.example.opencv.R;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class WebWhiteBoardActivity extends AppCompatActivity {
    private WebView webView;
    private ValueCallback<Uri[]> uploadMessage;
    private final static int FILE_CHOOSER_RESULT_CODE = 10000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 1. 启用 EdgeToEdge 模式
        EdgeToEdge.enable(this);
        setContentView(R.layout.activity_webwhiteboard);

        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO);

        // 隐藏导航栏和状态栏
        View decorView = getWindow().getDecorView();
        int uiOptions = View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        decorView.setSystemUiVisibility(uiOptions);

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.main), (v, insets) -> {
            // 获取系统栏（状态栏、导航栏）的 Insets
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            // 获取键盘（IME）的 Insets
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());

            // 计算底部的 padding
            // 当键盘弹出时，ime.bottom 是键盘高度，通常大于 systemBars.bottom
            // 当键盘收起时，ime.bottom 是 0，我们取 systemBars.bottom 作为导航栏的间距
            int bottomPadding = Math.max(systemBars.bottom, ime.bottom);

            // 为根布局设置新的 padding
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, bottomPadding);

            // 返回原始 insets，让系统继续处理
            return insets;
        });
        // 实例化 WebView 并设置为内容视图 (只执行一次)
        webView = findViewById(R.id.webView);
//        webView = new WebView(this);
//        setContentView(webView);

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowUniversalAccessFromFileURLs(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setAllowContentAccess(true);

        // 支持input type=file文件选择
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (uploadMessage != null) {
                    uploadMessage.onReceiveValue(null);
                    uploadMessage = null;
                }
                uploadMessage = filePathCallback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*"); // 只允许选择图片
                startActivityForResult(Intent.createChooser(intent, "选择图片"), FILE_CHOOSER_RESULT_CODE);
                return true;
            }
        });

        // 注入JS接口
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void onNextStep(String data) {
                runOnUiThread(() -> {
                    Intent intent = new Intent(WebWhiteBoardActivity.this, com.example.opencv.image.LayerPreviewActivity.class);
                    intent.putExtra("layerData", data);
                    startActivity(intent);
                    // finish();
                });
            }
            @JavascriptInterface
            public String saveTempFile(String base64, String fileName) {
                try {
                    String pureBase64 = base64.contains(",") ? base64.split(",")[1] : base64;
                    byte[] decodedBytes = android.util.Base64.decode(pureBase64, android.util.Base64.DEFAULT);
                    java.io.File tempFile = new java.io.File(getCacheDir(), fileName);
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(tempFile);
                    fos.write(decodedBytes);
                    fos.close();
                    return tempFile.getAbsolutePath();
                } catch (Exception e) {
                    e.printStackTrace();
                    return "";
                }
            }
            // 新增：前端主动请求画布大小
            @JavascriptInterface
            public String getPlatformSize() {
                return String.format("{\"width\":%d,\"height\":%d}", Constant.PlatformWidth, Constant.PlatformHeight);
            }
        }, "Android");

        // 设置WebViewClient来处理页面加载完成后的操作
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);

                // 处理图片传递
                String imagePath = getIntent().getStringExtra("imagePath");
                //Uri imageUri = getIntent().getParcelableExtra("imageUri");

                if (imagePath != null && !imagePath.isEmpty()) {
                    try {
                        File file;
                        if (imagePath.startsWith("content://")) {
                            // 通过ContentResolver读取并保存为临时文件
                            Uri uri = Uri.parse(imagePath);
                            InputStream is = getContentResolver().openInputStream(uri);
                            file = new File(getCacheDir(), "temp_image.jpg");
                            OutputStream fos = new java.io.FileOutputStream(file);
                            byte[] buffer = new byte[4096];
                            int len;
                            while ((len = is.read(buffer)) > 0) {
                                fos.write(buffer, 0, len);
                            }
                            fos.close();
                            is.close();
                        } else {
                            if (imagePath.startsWith("file://")) {
                                imagePath = imagePath.substring(7);
                            }
                            file = new File(imagePath);
                        }
                        if (file.exists()) {
                            FileInputStream fis = new FileInputStream(file);
                            byte[] bytes = new byte[(int) file.length()];
                            fis.read(bytes);
                            fis.close();
                            String base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.DEFAULT);

                            // 根据文件扩展名确定MIME类型
                            String mimeType = "image/png";
                            String fileName = file.getName().toLowerCase();
                            if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) {
                                mimeType = "image/jpeg";
                            } else if (fileName.endsWith(".gif")) {
                                mimeType = "image/gif";
                            } else if (fileName.endsWith(".webp")) {
                                mimeType = "image/webp";
                            }

                            String dataUrl = "data:" + mimeType + ";base64," + base64;
                            String safeJsArg = JSONObject.quote(dataUrl);
                            String jsCode = "window.setHomePageImage(" + safeJsArg + ");";
                            webView.evaluateJavascript(jsCode, null);
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                } else {
                    // 旧方案：通过base64参数传递（已注释，保留作为备份）
                    /*
                    String imageBase64 = getIntent().getStringExtra("imageBase64");
                    if (imageBase64 != null && !imageBase64.isEmpty()) {
                        String jsCode = "window.setWhiteboardImage('" + imageBase64 + "');";
                        webView.evaluateJavascript(jsCode, null);
                    }
                    */
                }
            }
        });

        webView.loadUrl("file:///android_asset/whiteboard/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_RESULT_CODE) {
            if (uploadMessage == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                Uri uri = data.getData();
                if (uri != null) {
                    results = new Uri[]{uri};
                }
            }
            uploadMessage.onReceiveValue(results);
            uploadMessage = null;
        }
    }
}