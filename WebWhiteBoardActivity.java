package com.example.opencv.webwhiteboard;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.content.Intent;
import android.net.Uri;
import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import android.os.Environment;
import android.content.Context;
import android.app.DownloadManager;
import android.os.Build;

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
    private final static int CAMERA_PERMISSION_REQUEST_CODE = 10001;
    private final static int STORAGE_PERMISSION_REQUEST_CODE = 10002;

    // 自定义下载路径，默认为 Downloads 文件夹
    private String customDownloadPath = Environment.DIRECTORY_DOWNLOADS;

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

        // 设置自定义下载路径为 gcodes 文件夹
        File gcodesDir = getExternalFilesDir("gcodes");
        if (gcodesDir != null) {
            customDownloadPath = gcodesDir.getAbsolutePath();
        }

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

        // 启用摄像头和麦克风权限
        webSettings.setMediaPlaybackRequiresUserGesture(false);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // 设置下载监听器
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                // 检查是否是 blob URL
                if (url.startsWith("blob:")) {
                    // 处理 blob URL
                    handleBlobDownload(url, contentDisposition, mimeType);
                    return;
                }

                // 检查存储权限
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    if (ContextCompat.checkSelfPermission(WebWhiteBoardActivity.this,
                            Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        ActivityCompat.requestPermissions(WebWhiteBoardActivity.this,
                                new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                                STORAGE_PERMISSION_REQUEST_CODE);
                        return;
                    }
                }

                // 开始下载
                startDownload(url, contentDisposition, mimeType);
            }
        });

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

            // 处理摄像头权限请求
            @Override
            public void onPermissionRequest(android.webkit.PermissionRequest request) {
                String[] resources = request.getResources();
                for (String resource : resources) {
                    if (resource.equals(android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                        // 检查摄像头权限
                        if (ContextCompat.checkSelfPermission(WebWhiteBoardActivity.this,
                                Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            // 请求摄像头权限
                            ActivityCompat.requestPermissions(WebWhiteBoardActivity.this,
                                    new String[]{Manifest.permission.CAMERA},
                                    CAMERA_PERMISSION_REQUEST_CODE);
                        } else {
                            // 权限已授予，允许访问
                            request.grant(request.getResources());
                        }
                        return;
                    }
                }
                // 其他权限请求
                request.grant(request.getResources());
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

            // 新增：设置自定义下载路径
            @JavascriptInterface
            public void setDownloadPath(String path) {
                runOnUiThread(() -> {
                    customDownloadPath = path;
                    Toast.makeText(WebWhiteBoardActivity.this, "下载路径已设置为: " + path, Toast.LENGTH_SHORT).show();
                });
            }

            // 新增：获取当前下载路径
            @JavascriptInterface
            public String getDownloadPath() {
                return customDownloadPath;
            }

            // 新增：保存 blob 文件
            @JavascriptInterface
            public void saveBlobFile(String base64, String fileName, String mimeType) {
                runOnUiThread(() -> {
                    try {
                        // 解码 base64 数据
                        byte[] decodedBytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);

                        // 创建目标文件
                        File targetFile;
                        if (customDownloadPath.startsWith("/")) {
                            // 绝对路径
                            File downloadDir = new File(customDownloadPath);
                            if (!downloadDir.exists()) {
                                downloadDir.mkdirs();
                            }
                            targetFile = new File(downloadDir, fileName);
                        } else {
                            // 相对路径（相对于外部存储）
                            File downloadDir = new File(Environment.getExternalStoragePublicDirectory(customDownloadPath), fileName);
                            targetFile = downloadDir;
                        }

                        // 写入文件
                        java.io.FileOutputStream fos = new java.io.FileOutputStream(targetFile);
                        fos.write(decodedBytes);
                        fos.close();

                        Toast.makeText(WebWhiteBoardActivity.this,
                                "文件已保存: " + fileName + " 到 " + customDownloadPath,
                                Toast.LENGTH_SHORT).show();

                    } catch (Exception e) {
                        e.printStackTrace();
                        Toast.makeText(WebWhiteBoardActivity.this,
                                "保存文件失败: " + e.getMessage(),
                                Toast.LENGTH_SHORT).show();
                    }
                });
            }
        }, "Android");

        // 设置WebViewClient来处理页面加载完成后的操作
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);

                // 处理图片传递
                String imagePath = getIntent().getStringExtra("imagePath");
                String vectorIMAGE = getIntent().getStringExtra("vectorIMAGE");
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
                } else if (vectorIMAGE != null && !vectorIMAGE.isEmpty()) {
                    try {
                        File file;
                        if (vectorIMAGE.startsWith("content://")) {
                            Uri uri = Uri.parse(vectorIMAGE);
                            InputStream is = getContentResolver().openInputStream(uri);
                            // 读取为字符串
                            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                            byte[] buffer = new byte[4096];
                            int len;
                            while ((len = is.read(buffer)) > 0) {
                                baos.write(buffer, 0, len);
                            }
                            is.close();
                            String content = new String(baos.toByteArray(), "UTF-8");

                            // 尝试从 uri 推断扩展名
                            String ext = "svg";
                            String path = uri.getPath();
                            if (path != null) {
                                String lower = path.toLowerCase();
                                if (lower.endsWith(".dxf")) ext = "dxf";
                                else if (lower.endsWith(".plt")) ext = "plt";
                                else if (lower.endsWith(".svg")) ext = "svg";
                            }

                            String js = "window.setWhiteboardVector(" + JSONObject.quote(content) + ", '" + ext + "')";
                            webView.evaluateJavascript(js, null);
                        } else {
                            if (vectorIMAGE.startsWith("file://")) {
                                vectorIMAGE = vectorIMAGE.substring(7);
                            }
                            file = new File(vectorIMAGE);
                            if (file.exists()) {
                                FileInputStream fis = new FileInputStream(file);
                                byte[] bytes = new byte[(int) file.length()];
                                int read = fis.read(bytes);
                                fis.close();
                                String content = new String(bytes, "UTF-8");

                                String ext = "svg";
                                String fileName = file.getName().toLowerCase();
                                if (fileName.endsWith(".dxf")) ext = "dxf";
                                else if (fileName.endsWith(".plt")) ext = "plt";
                                else if (fileName.endsWith(".svg")) ext = "svg";

                                String js = "window.setWhiteboardVector(" + JSONObject.quote(content) + ", '" + ext + "')";
                                webView.evaluateJavascript(js, null);
                            }
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                } else {
                    // 当imagePath为空或不存在时，直接跳转到白板界面
                    String jsCode = "window.setWhiteboardImage();";
                    webView.evaluateJavascript(jsCode, null);

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

    /**
     * 设置自定义下载路径
     *
     * @param path 下载路径，可以是相对路径或绝对路径
     */
    public void setCustomDownloadPath(String path) {
        this.customDownloadPath = path;
    }

    /**
     * 获取当前下载路径
     *
     * @return 当前下载路径
     */
    public String getCustomDownloadPath() {
        return this.customDownloadPath;
    }

    /**
     * 开始下载文件
     */
    private void startDownload(String url, String contentDisposition, String mimeType) {
        try {
            // 获取文件名
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);

            // 创建下载请求
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("下载文件");
            request.setDescription("正在下载: " + fileName);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

            // 根据自定义路径设置下载位置
            if (customDownloadPath.startsWith("/")) {
                // 绝对路径
                File downloadDir = new File(customDownloadPath);
                if (!downloadDir.exists()) {
                    downloadDir.mkdirs();
                }
                request.setDestinationUri(Uri.fromFile(new File(downloadDir, fileName)));
            } else {
                // 相对路径（相对于外部存储）
                request.setDestinationInExternalPublicDir(customDownloadPath, fileName);
            }

            request.setMimeType(mimeType);

            // 获取下载管理器
            DownloadManager downloadManager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (downloadManager != null) {
                long downloadId = downloadManager.enqueue(request);
                Toast.makeText(this, "开始下载: " + fileName + " 到 " + customDownloadPath, Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(this, "下载管理器不可用", Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "下载失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    /**
     * 处理 blob URL 下载
     */
    private void handleBlobDownload(String url, String contentDisposition, String mimeType) {
        try {
            // 获取文件名
            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);

            // 通过 JavaScript 获取 blob 数据
            String jsCode = String.format(
                    "(function() {" +
                            "  var xhr = new XMLHttpRequest();" +
                            "  xhr.open('GET', '%s', false);" +
                            "  xhr.responseType = 'blob';" +
                            "  xhr.send();" +
                            "  var reader = new FileReader();" +
                            "  reader.onload = function() {" +
                            "    var base64 = reader.result.split(',')[1];" +
                            "    Android.saveBlobFile(base64, '%s', '%s');" +
                            "  };" +
                            "  reader.readAsDataURL(xhr.response);" +
                            "})();", url, fileName, mimeType);

            webView.evaluateJavascript(jsCode, null);

        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "下载失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
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

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == CAMERA_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // 摄像头权限已授予
                Toast.makeText(this, "摄像头权限已授予", Toast.LENGTH_SHORT).show();
                // 重新加载页面以启用摄像头功能
                webView.reload();
            } else {
                // 摄像头权限被拒绝
                Toast.makeText(this, "摄像头权限被拒绝，拍照功能将无法使用", Toast.LENGTH_LONG).show();
            }
        } else if (requestCode == STORAGE_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // 存储权限已授予
                Toast.makeText(this, "存储权限已授予，可以正常下载文件", Toast.LENGTH_SHORT).show();
            } else {
                // 存储权限被拒绝
                Toast.makeText(this, "存储权限被拒绝，无法下载文件", Toast.LENGTH_LONG).show();
            }
        }
    }
}