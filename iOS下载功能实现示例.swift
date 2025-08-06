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
    
    private func setupDownloadPath() {
        // 设置默认下载路径为Documents/gcodes
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let gcodesPath = documentsPath.appendingPathComponent("gcodes")
        
        // 创建目录（如果不存在）
        try? FileManager.default.createDirectory(at: gcodesPath, withIntermediateDirectories: true)
        
        customDownloadPath = gcodesPath.path
    }
}

// MARK: - WKScriptMessageHandler
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
    
    private func handleSetDownloadPath(_ body: [String: Any]) {
        if let path = body["path"] as? String {
            customDownloadPath = path
        }
    }
    
    private func handleGetDownloadPath() {
        let script = "window.iOS.getDownloadPathCallback('\(customDownloadPath)')"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }
    
    private func handleGetPlatformSize() {
        let size = [
            "width": webView.frame.width,
            "height": webView.frame.height
        ]
        
        if let jsonData = try? JSONSerialization.data(withJSONObject: size),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            let script = "window.iOS.getPlatformSizeCallback('\(jsonString)')"
            webView.evaluateJavaScript(script, completionHandler: nil)
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
    
    private func showAlert(message: String) {
        let alert = UIAlertController(title: "下载状态", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "确定", style: .default))
        present(alert, animated: true)
    }
}

// MARK: - WKNavigationDelegate
extension WebWhiteBoardViewController {
    
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        
        // 处理下载链接
        if let url = navigationAction.request.url {
            let urlString = url.absoluteString
            
            // 检查是否是blob URL
            if urlString.hasPrefix("blob:") {
                // 对于blob URL，我们通过JavaScript接口处理
                decisionHandler(.allow)
                return
            }
            
            // 检查是否是文件下载
            if let mimeType = navigationAction.request.value(forHTTPHeaderField: "Content-Type"),
               mimeType.contains("application/") || mimeType.contains("text/") {
                
                // 这里可以添加下载处理逻辑
                decisionHandler(.allow)
                return
            }
        }
        
        decisionHandler(.allow)
    }
}

// MARK: - JavaScript接口注入
extension WebWhiteBoardViewController {
    
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
} 