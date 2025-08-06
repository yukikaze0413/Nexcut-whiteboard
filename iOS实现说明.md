# iOS WebView 下载功能实现说明

## 概述

本文档详细说明了如何在 iOS 应用中实现与 Android 类似的 WebView 下载功能，支持 blob URL 处理和自定义下载路径。

## 核心功能

### 1. 平台检测
前端代码会自动检测当前运行环境：
- `ios`: iOS 原生 WebView 环境
- `ios_browser`: iOS Safari 浏览器环境
- `android`: Android 原生 WebView 环境
- `android_browser`: Android 浏览器环境
- `web`: 桌面浏览器环境

### 2. JavaScript 接口
iOS 端需要提供以下 JavaScript 接口：

```swift
// 保存文件接口
saveBlobFile(base64: String, fileName: String, mimeType: String)

// 设置下载路径
setDownloadPath(path: String)

// 获取下载路径
getDownloadPath()

// 获取平台大小
getPlatformSize()
```

## 实现步骤

### 1. 创建 WKWebView 控制器

```swift
import UIKit
import WebKit

class WebWhiteBoardViewController: UIViewController, WKNavigationDelegate {
    var webView: WKWebView!
    private var customDownloadPath: String = ""
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupWebView()
        setupDownloadPath()
    }
}
```

### 2. 设置 WebView 配置

```swift
private func setupWebView() {
    // 创建WKWebView配置
    let configuration = WKWebViewConfiguration()
    
    // 添加JavaScript接口
    let contentController = WKUserContentController()
    contentController.add(self, name: "iOS")
    configuration.userContentController = contentController
    
    // 创建WKWebView
    webView = WKWebView(frame: view.bounds, configuration: configuration)
    webView.navigationDelegate = self
    view.addSubview(webView)
    
    // 设置下载路径为Documents/gcodes目录
    setupDownloadPath()
    
    // 加载网页
    if let url = URL(string: "your_webview_url_here") {
        let request = URLRequest(url: url)
        webView.load(request)
    }
}
```

### 3. 设置默认下载路径

```swift
private func setupDownloadPath() {
    // 设置默认下载路径为Documents/gcodes
    let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    let gcodesPath = documentsPath.appendingPathComponent("gcodes")
    
    // 创建目录（如果不存在）
    try? FileManager.default.createDirectory(at: gcodesPath, withIntermediateDirectories: true)
    
    customDownloadPath = gcodesPath.path
}
```

### 4. 实现 WKScriptMessageHandler

```swift
extension WebWhiteBoardViewController: WKScriptMessageHandler {
    
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "iOS" else { return }
        
        if let body = message.body as? [String: Any] {
            switch body["method"] as? String {
            case "saveBlobFile":
                handleSaveBlobFile(body)
            case "setDownloadPath":
                handleSetDownloadPath(body)
            case "getDownloadPath":
                handleGetDownloadPath()
            case "getPlatformSize":
                handleGetPlatformSize()
            default:
                break
            }
        }
    }
}
```

### 5. 处理文件保存

```swift
private func handleSaveBlobFile(_ body: [String: Any]) {
    guard let base64 = body["base64"] as? String,
          let fileName = body["fileName"] as? String,
          let mimeType = body["mimeType"] as? String else {
        return
    }
    
    DispatchQueue.main.async {
        self.saveBlobFile(base64: base64, fileName: fileName, mimeType: mimeType)
    }
}

private func saveBlobFile(base64: String, fileName: String, mimeType: String) {
    do {
        // 解码base64数据
        guard let data = Data(base64Encoded: base64) else {
            showAlert(message: "Base64解码失败")
            return
        }
        
        // 确定保存路径
        let targetPath: String
        if customDownloadPath.hasPrefix("/") {
            // 绝对路径
            targetPath = customDownloadPath
        } else {
            // 相对路径（相对于Documents目录）
            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
            targetPath = documentsPath.appendingPathComponent(customDownloadPath).path
        }
        
        // 创建目录（如果不存在）
        let targetURL = URL(fileURLWithPath: targetPath)
        try FileManager.default.createDirectory(at: targetURL, withIntermediateDirectories: true)
        
        // 保存文件
        let fileURL = targetURL.appendingPathComponent(fileName)
        try data.write(to: fileURL)
        
        showAlert(message: "文件已保存: \(fileName) 到 \(targetPath)")
        
    } catch {
        showAlert(message: "保存文件失败: \(error.localizedDescription)")
    }
}
```

### 6. 注入 JavaScript 接口

```swift
private func injectJavaScriptInterfaces() {
    let script = """
    window.iOS = {
        saveBlobFile: function(base64, fileName, mimeType) {
            window.webkit.messageHandlers.iOS.postMessage({
                method: 'saveBlobFile',
                base64: base64,
                fileName: fileName,
                mimeType: mimeType
            });
        },
        setDownloadPath: function(path) {
            window.webkit.messageHandlers.iOS.postMessage({
                method: 'setDownloadPath',
                path: path
            });
        },
        getDownloadPath: function() {
            window.webkit.messageHandlers.iOS.postMessage({
                method: 'getDownloadPath'
            });
        },
        getPlatformSize: function() {
            window.webkit.messageHandlers.iOS.postMessage({
                method: 'getPlatformSize'
            });
        },
        // 回调函数
        getDownloadPathCallback: function(path) {
            console.log('下载路径:', path);
        },
        getPlatformSizeCallback: function(size) {
            try {
                const sizeObj = JSON.parse(size);
                if (window.setCanvasSize) {
                    window.setCanvasSize(sizeObj.width, sizeObj.height);
                }
            } catch (e) {
                console.error('解析平台大小失败:', e);
            }
        }
    };
    """
    
    webView.evaluateJavaScript(script) { (result, error) in
        if let error = error {
            print("注入JavaScript接口失败: \(error)")
        }
    }
}

func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // 页面加载完成后注入JavaScript接口
    injectJavaScriptInterfaces()
}
```

## 权限配置

iOS 应用需要在 `Info.plist` 中添加以下权限：

```xml
<!-- 文件访问权限 -->
<key>NSDocumentsFolderUsageDescription</key>
<string>需要访问文档文件夹来保存G代码文件</string>

<!-- 如果需要访问外部存储 -->
<key>NSDownloadsFolderUsageDescription</key>
<string>需要访问下载文件夹来保存文件</string>
```

## 测试

### 1. 测试平台检测
在浏览器控制台中运行：
```javascript
console.log('当前平台:', detectPlatform());
```

### 2. 测试文件下载
生成G代码后点击下载，检查：
- 文件是否成功保存到指定目录
- 控制台是否有错误信息
- 用户界面是否显示成功提示

### 3. 测试错误处理
- 断开网络连接测试回退机制
- 模拟接口失败测试错误处理

## 注意事项

1. **文件路径**: iOS 使用沙盒机制，文件只能保存在应用沙盒内
2. **权限管理**: iOS 对文件访问有严格限制，需要正确配置权限
3. **内存管理**: 大文件处理时注意内存使用
4. **错误处理**: 确保所有可能的错误都有适当的处理
5. **用户体验**: 提供清晰的用户反馈和错误提示

## 与 Android 的差异

| 特性 | Android | iOS |
|------|---------|-----|
| 文件系统 | 外部存储 | 沙盒存储 |
| 权限管理 | 运行时权限 | 编译时权限 |
| JavaScript接口 | `@JavascriptInterface` | `WKScriptMessageHandler` |
| 默认下载路径 | `/storage/emulated/0/Android/data/.../gcodes` | `Documents/gcodes` |
| 错误处理 | Toast 提示 | Alert 提示 |

## 完整示例

参考 `iOS下载功能实现示例.swift` 文件获取完整的实现代码。 