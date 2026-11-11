// macPaint 네이티브 셸: WKWebView에 웹 앱(번들 안의 web/)을 담는다. 인터넷 없이 동작한다.
import Cocoa
import WebKit

// macpaint://app/… 요청을 번들 안의 파일로 응답한다(file:// 에서는 ES 모듈이 막히기 때문).
final class BundleScheme: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root.standardizedFileURL }
    static let mime = ["html": "text/html", "js": "text/javascript", "css": "text/css", "svg": "image/svg+xml", "png": "image/png", "json": "application/json"]
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        var path = task.request.url?.path ?? "/"
        if path == "/" || path.isEmpty { path = "/index.html" }
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: task.request.url!, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!)
            task.didFinish(); return
        }
        let type = (BundleScheme.mime[file.pathExtension.lowercased()] ?? "application/octet-stream") + "; charset=utf-8"
        task.didReceive(HTTPURLResponse(url: task.request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type, "Content-Length": "\(data.count)", "Cache-Control": "no-store"])!)
        task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!

    func applicationDidFinishLaunching(_ note: Notification) {
        let cfg = WKWebViewConfiguration()
        let root = Bundle.main.resourceURL!.appendingPathComponent("web")
        cfg.setURLSchemeHandler(BundleScheme(root: root), forURLScheme: "macpaint")
        cfg.userContentController.add(self, name: "macPaint")
        cfg.userContentController.addUserScript(WKUserScript(source: "document.documentElement.classList.add('in-app')", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1360, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 960, height: 600)
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("macPaintMain")
        window.makeKeyAndOrderFront(nil)
        buildMenu()
        web.load(URLRequest(url: URL(string: "macpaint://app/index.html")!))
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // 파일 저장: 웹에서 {name, data(base64)}를 보내면 저장 대화상자를 띄운다.
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        if let d = m.body as? [String: String], d["drag"] != nil { if let e = NSApp.currentEvent { window.performDrag(with: e) }; return }
        if let d = m.body as? [String: String], d["zoom"] != nil { window.zoom(nil); return }
        guard let d = m.body as? [String: String], let name = d["name"], let b64 = d["data"], let data = Data(base64Encoded: b64) else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { r in
            if r == .OK, let url = panel.url { try? data.write(to: url) }
        }
    }
    // <input type=file> 열기 대화상자
    func webView(_ webView: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = p.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { r in done(r == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.beginSheetModal(for: window) { _ in done() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "확인"); a.addButton(withTitle: "취소")
        a.beginSheetModal(for: window) { done($0 == .alertFirstButtonReturn) }
    }

    @objc func selectAll(_ s: Any?) {
        web.evaluateJavaScript("(()=>{const a=document.activeElement;if(a&&/INPUT|TEXTAREA/.test(a.tagName)&&a.select)a.select();else window.dispatchEvent(new KeyboardEvent('keydown',{key:'a',metaKey:true,bubbles:true}))})()")
    }

    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) {
            let top = NSMenuItem(); main.addItem(top)
            let m = NSMenu(title: title); items.forEach { m.addItem($0) }; top.submenu = m
        }
        func item(_ t: String, _ sel: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: t, action: sel, keyEquivalent: key); i.keyEquivalentModifierMask = mods; return i
        }
        add("macPaint", [item("macPaint 정보", #selector(NSApplication.orderFrontStandardAboutPanel(_:))), .separator(),
                         item("macPaint 가리기", #selector(NSApplication.hide(_:)), "h"), item("나머지 가리기", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]), .separator(),
                         item("macPaint 종료", #selector(NSApplication.terminate(_:)), "q")])
        let all = item("전체 선택", #selector(selectAll(_:)), "a"); all.target = self
        add("편집", [item("잘라내기", #selector(NSText.cut(_:)), "x"), item("복사", #selector(NSText.copy(_:)), "c"), item("붙여넣기", #selector(NSText.paste(_:)), "v"), all])
        add("윈도우", [item("최소화", #selector(NSWindow.miniaturize(_:)), "m"), item("확대/축소", #selector(NSWindow.zoom(_:))), item("전체 화면", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])])
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
