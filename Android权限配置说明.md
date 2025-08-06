# Android 摄像头权限配置说明

## 1. 在 AndroidManifest.xml 中添加权限声明

确保在你的 Android 项目的 `app/src/main/AndroidManifest.xml` 文件中添加以下权限：

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.opencv.webwhiteboard">

    <!-- 摄像头权限 -->
    <uses-permission android:name="android.permission.CAMERA" />
    
    <!-- 存储权限（用于保存图片和下载文件） -->
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    
    <!-- 网络权限（如果需要） -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    
    <!-- 下载权限 -->
    <uses-permission android:name="android.permission.DOWNLOAD_WITHOUT_NOTIFICATION" />
    
    <!-- 摄像头硬件特性 -->
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
    
    <!-- 应用配置 -->
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.AppCompat.Light.NoActionBar"
        android:usesCleartextTraffic="true">
        
        <!-- WebWhiteBoardActivity -->
        <activity
            android:name=".WebWhiteBoardActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:hardwareAccelerated="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        
    </application>

</manifest>
```

## 2. 在 WebWhiteBoardActivity.java 中添加权限处理

确保你的 `WebWhiteBoardActivity.java` 文件包含以下修改：

### 添加必要的导入
```java
import android.Manifest;
import android.content.pm.PackageManager;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.os.Environment;
import android.content.Context;
import android.app.DownloadManager;
import android.os.Build;
```

### 添加权限请求常量和自定义下载路径
```java
private final static int CAMERA_PERMISSION_REQUEST_CODE = 10001;
private final static int STORAGE_PERMISSION_REQUEST_CODE = 10002;

// 自定义下载路径，默认为应用外部存储的 gcodes 文件夹
private String customDownloadPath = Environment.DIRECTORY_DOWNLOADS;
```

### 在 WebSettings 中启用媒体权限
```java
// 启用摄像头和麦克风权限
webSettings.setMediaPlaybackRequiresUserGesture(false);
webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
```

### 设置自定义下载路径
```java
// 设置自定义下载路径为 gcodes 文件夹
File gcodesDir = getExternalFilesDir("gcodes");
if (gcodesDir != null) {
    customDownloadPath = gcodesDir.getAbsolutePath();
}
```

### 设置下载监听器
```java
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
```

### 添加 blob 下载处理方法
```java
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
```

### 添加下载处理方法
```java
/**
 * 设置自定义下载路径
 * @param path 下载路径，可以是相对路径或绝对路径
 */
public void setCustomDownloadPath(String path) {
    this.customDownloadPath = path;
}

/**
 * 获取当前下载路径
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
```

### 在 JavaScript 接口中添加下载路径控制
```java
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
```

### 在 WebChromeClient 中处理权限请求
```java
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
```

### 添加权限结果处理
```java
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
```

## 3. 权限说明

### 必需权限
- `android.permission.CAMERA`: 访问摄像头
- `android.permission.WRITE_EXTERNAL_STORAGE`: 保存图片到外部存储和下载文件
- `android.permission.READ_EXTERNAL_STORAGE`: 读取外部存储中的图片
- `android.permission.DOWNLOAD_WITHOUT_NOTIFICATION`: 允许下载文件

### 可选权限
- `android.permission.INTERNET`: 网络访问（如果需要）
- `android.permission.ACCESS_NETWORK_STATE`: 网络状态检查

### 硬件特性
- `android.hardware.camera`: 摄像头硬件（required="false" 表示不是必需的）
- `android.hardware.camera.autofocus`: 自动对焦功能（required="false"）

## 4. 下载功能说明

### 下载功能特性
1. **自动权限检查**: 在下载前自动检查存储权限
2. **智能文件名**: 根据 URL 和 Content-Disposition 自动生成文件名
3. **下载进度通知**: 在通知栏显示下载进度
4. **下载完成通知**: 下载完成后显示通知
5. **错误处理**: 完善的错误处理和用户提示
6. **自定义下载路径**: 支持自定义文件下载位置
7. **Blob URL 支持**: 自动处理 blob URL 下载，通过 JavaScript 转换并保存

### Blob URL 处理
当 WebView 尝试下载 blob URL 时（如 `blob:file:///ed5c10b7-c851-4aa8-b336-5bb4799e9b3d`），系统会：

1. **自动检测**: 检测到 blob URL 后，自动调用 blob 处理函数
2. **JavaScript 转换**: 通过 JavaScript 将 blob 数据转换为 base64 格式
3. **文件保存**: 将转换后的数据保存到指定的下载路径
4. **用户反馈**: 显示保存成功或失败的提示信息

#### Blob URL 处理流程
```
blob URL → JavaScript 转换 → base64 数据 → Android 解码 → 文件保存
```

#### 支持的 Blob 类型
- 图片文件 (PNG, JPG, GIF, WebP 等)
- 文档文件 (PDF, DOC, TXT 等)
- 音频文件 (MP3, WAV 等)
- 视频文件 (MP4, AVI 等)
- 其他任何类型的文件