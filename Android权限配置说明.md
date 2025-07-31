# Android 摄像头权限配置说明

## 1. 在 AndroidManifest.xml 中添加权限声明

确保在你的 Android 项目的 `app/src/main/AndroidManifest.xml` 文件中添加以下权限：

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.opencv.webwhiteboard">

    <!-- 摄像头权限 -->
    <uses-permission android:name="android.permission.CAMERA" />
    
    <!-- 存储权限（用于保存图片） -->
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    
    <!-- 网络权限（如果需要） -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    
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
```

### 添加权限请求常量
```java
private final static int CAMERA_PERMISSION_REQUEST_CODE = 10001;
```

### 在 WebSettings 中启用媒体权限
```java
// 启用摄像头和麦克风权限
webSettings.setMediaPlaybackRequiresUserGesture(false);
webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
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
    }
}
```

## 3. 权限说明

### 必需权限
- `android.permission.CAMERA`: 访问摄像头
- `android.permission.WRITE_EXTERNAL_STORAGE`: 保存图片到外部存储
- `android.permission.READ_EXTERNAL_STORAGE`: 读取外部存储中的图片

### 可选权限
- `android.permission.INTERNET`: 网络访问（如果需要）
- `android.permission.ACCESS_NETWORK_STATE`: 网络状态检查

### 硬件特性
- `android.hardware.camera`: 摄像头硬件（required="false" 表示不是必需的）
- `android.hardware.camera.autofocus`: 自动对焦功能（required="false"）

## 4. 测试步骤

1. 编译并安装应用到 Android 设备
2. 首次使用拍照功能时，系统会弹出权限请求对话框
3. 用户选择"允许"后，拍照功能即可正常使用
4. 如果用户选择"拒绝"，应用会显示提示信息

## 5. 常见问题

### 问题1: 权限被拒绝后如何重新请求？
用户需要在设备的"设置" -> "应用" -> "你的应用" -> "权限" 中手动开启摄像头权限。

### 问题2: 在模拟器中测试摄像头功能
模拟器通常不支持真实的摄像头功能，建议在真实设备上测试。

### 问题3: WebView 中的摄像头访问
确保 WebView 的 `setMediaPlaybackRequiresUserGesture(false)` 已设置，否则摄像头可能无法正常工作。 