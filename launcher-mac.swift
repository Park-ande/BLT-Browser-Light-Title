import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem?
    var serverProcess: Process?
    var currentPort: Int = 3000

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupStatusItem()
        startNodeServer()
    }

    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let iconPath = Bundle.main.path(forResource: "app", ofType: "icns"),
           let originalImage = NSImage(contentsOfFile: iconPath) {
            let resizedImage = NSImage(size: NSSize(width: 18, height: 18))
            resizedImage.lockFocus()
            originalImage.draw(in: NSRect(x: 0, y: 0, width: 18, height: 18),
                               from: NSRect(origin: .zero, size: originalImage.size),
                               operation: .sourceOver,
                               fraction: 1.0)
            resizedImage.unlockFocus()
            statusItem?.button?.image = resizedImage
        } else {
            statusItem?.button?.title = "BLT"
        }

        buildMenu()
    }

    func buildMenu() {
        let menu = NSMenu()

        // 1. 브라우저 컨트롤러 열기
        let openItem = NSMenuItem(title: "Open Web Console", action: #selector(openBrowser), keyEquivalent: "o")
        openItem.target = self
        menu.addItem(openItem)

        menu.addItem(NSMenuItem.separator())

        // 2. 앱 종료 (포트 모니터링 메뉴 제거)
        let quitItem = NSMenuItem(title: "Quit BLT", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem?.menu = menu
    }

    func startNodeServer() {
        guard let macOsDir = Bundle.main.executableURL?.deletingLastPathComponent() else { return }
        let binaryUrl = macOsDir.appendingPathComponent("BLT_bin")

        let process = Process()
        process.executableURL = binaryUrl

        let devNull = FileHandle.nullDevice
        process.standardOutput = devNull
        process.standardError = devNull

        // 자식 프로세스(BLT_bin)가 종료되었을 때 메뉴 막대 런처도 함께 종료
        process.terminationHandler = { _ in
            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        }

        do {
            try process.run()
            self.serverProcess = process
        } catch {
            print("Failed to start BLT_bin: \(error)")
        }
    }

    @objc func openBrowser() {
        readCurrentPort()
        // localhost 및 127.0.0.1 모두 매핑 가능하도록 명시적 호출
        if let url = URL(string: "http://127.0.0.1:\(currentPort)") {
            NSWorkspace.shared.open(url)
        }
    }

    func readCurrentPort() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let portFile = home.appendingPathComponent("Library/Application Support/browser-lite-titles/current_port.json")
        if let data = try? Data(contentsOf: portFile),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let port = json["port"] as? Int {
            self.currentPort = port
        }
    }

    @objc func quitApp() {
        // 메뉴 중복 클릭 방지
        statusItem?.menu = nil

        if let process = serverProcess, process.isRunning {
            process.terminate() // SIGTERM 전달 -> Node 백엔드가 handleShutdown() 실행

            // 백엔드가 자막 클리어(400ms) 및 정리를 수행한 뒤 스스로 종료(terminationHandler)되도록 대기.
            // 만약 프로세스가 응답하지 않을 경우를 대비해 1.5초 후 강제 종료 fallback 설정
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                NSApp.terminate(nil)
            }
        } else {
            NSApp.terminate(nil)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let process = serverProcess, process.isRunning {
            process.terminate()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()