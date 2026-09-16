# BLT-Browser-Light-Title
Real-time live title overlay system for OBS Studio Browser Source | OBS Studio 브라우저 소스 연동을 위한 실시간 라이브 자막 오버레이 시스템
  
<img width="1920" height="1152" alt="screenshot_02" src="https://github.com/user-attachments/assets/79bcd035-121f-470c-9da0-b034a126343f" />  

> **Notice:** This documentation is provided in both English and Korean. The English version below is an AI translation of the original Korean text. The original Korean documentation follows immediately in the second section.  
> **안내:** 본 문서는 영문 및 한국어로 구성되어 있습니다. 상단의 영문 문서는 한국어 원문을 AI로 번역한 버전이며, 하단에 한국어 원문이 이어집니다.

---

# BLT (Browser Lite Title) - English

A lightweight, standalone real-time lower-third and title control system for OBS Studio browser sources  
Web Typography · Per-Character Granular Styling · Multi-Layer Graphic Plates · Separated Remote Operating

---

## 1. Project Background & Purpose

* **Overcoming OBS Native Text Limitations**  
  Eliminates the stroke distortion, misalignment, and font rendering constraints of the built-in OBS Studio GDI+ text source by leveraging modern browser engines to deliver high-quality web typography in real time.
* **Partial Text Formatting & Multi-Layer Compositing**  
  Breaks away from applying uniform styles across entire sentences. Operators can select and highlight specific words or characters by dragging to apply distinct text colors, font sizes, tracking (letter-spacing), and stroke widths. Multiple text layers and graphic plate assets (logos, background banners, decorative elements) can be composited without layer limits.
* **Decoupled Operation for Solo & Small-Scale Broadcasting**  
  Separates the main transmission workstation from the title control interface, allowing operators to remotely and independently control live titles using auxiliary devices (laptops, tablets, smartphones) over the local area network (LAN).

---

## 2. Key Features & Architecture

### 2.1 Native Launcher Standalone Execution
* **Windows (.exe):** Built as a single executable packaging a C#-based system tray launcher with an embedded Node.js background engine. Runs in the background without terminal console windows, allowing operators to launch the controller, inspect active ports, or terminate the application via the system tray icon.
* **macOS (.app):** Packaged as a native Swift menu bar resident application, enabling operators to check server status and open the browser controller directly from the status item without displaying an icon in the Dock.
* Runs standalone with zero runtime dependencies (bundled Node.js engine).

### 2.2 Dynamic Port Allocation & Lifecycle Management
* By default, the local web server launches in the background on port `3000`. If port collisions occur, the engine sequentially scans and binds to the next available port (`3001`, `3002`, etc.).
* Active port mappings and process IDs are recorded in real time in the OS standard application data directory (`current_port.json`):
  * **Windows:** `%APPDATA%\browser-lite-titles\current_port.json`
  * **macOS:** `~/Library/Application Support/browser-lite-titles/current_port.json`
* **Instance Handling Recommendation:** Re-executing application binaries (`BLT.exe`, `BLT.app`) while an instance is already active may spawn redundant background processes or split port configurations. If a browser tab is accidentally closed, do not re-run the binary; select **[Open Controller]** from the Windows system tray or macOS menu bar icon to invoke the active session.

### 2.3 Two-Tier Security & Memory Session Model
* **Localhost Privilege Isolation:** Core broadcast-affecting operations—including project creation, project file loading, and session initialization—are strictly restricted to the local host machine (`127.0.0.1` / `localhost`).
* **Two-Tier Authentication:** Features separate credentials for the Primary Administrator (default: `admin1234`) and Remote Operators (default: `title1234`).
* **Immediate Operator Revocation (Kick):** Modifying the operator password in administrator settings regenerates session tokens and forcibly closes all active remote operator WebSocket sessions (`close 4001`), returning clients to the login screen.
* **RAM Memory Session Security (BFCache Defense):** Authentication tokens are stored exclusively in volatile browser RAM variables rather than persistent browser storage (`sessionStorage` / `localStorage`). Closing tabs, accessing browser history, or restoring through back/forward caches (BFCache) will immediately prompt for credential re-entry.
* **Independent Overlay Key (`viewKey`):** Overlay URLs are authenticated using a combination of Channel ID and a cryptographically randomized view key (`viewKey`). Regenerating the `viewKey` immediately disconnects active OBS overlay browser sources without invalidating remote operator sessions.
* ⚠️ **Session Overwrite Warning:** Executing [Open Project File] or [Start New Session] (New Project) while an active broadcast session is running will completely replace the existing session data and title deck, and previous sessions cannot be restored or accessed. Operators must save (`Save`) existing progress before opening a new project.

### 2.4 Typography & Broadcast Graphic Engine
* **OS Installed System Font Detection & Rendering Notes:**  
  * Automatically detects fonts installed on the host operating system in the background and populates the font selection dropdown. Prioritizes standard Korean typefaces (`Malgun Gothic` on Windows, `Apple SD Gothic Neo` on macOS), falling back to detected local fonts and standard `sans-serif` on foreign OS environments. Custom font names can also be specified manually via the **[Custom]** toggle.
  * ⚠️ **Font Requirement for Broadcast Rigs:** As browser sources reference local system font resources, **if the main host PC is separate from the OBS transmission PC, fonts used in the title project must also be installed on the OBS PC** to render intended typefaces (missing fonts fall back to the system default sans-serif font).
* **Text Auto-Fit Within Box:** Prevents broadcast issues caused by long text overflowing bounding boxes and clipping outside the frame by dynamically reducing and fitting font sizes to the box area in real time using a binary search algorithm.
* **Smart Guides & Magnetic Snapping:** Moving layers across the preview canvas reveals visual red center and edge alignment guides with a 14px magnetic snap threshold. Dragging bounding box handles while holding `Shift` preserves native aspect ratios.
* **Pre-Transition Asynchronous Image Decoding (`decode()`):** When triggering **[TAKE]** on titles containing graphic plates, the engine awaits complete asynchronous decoding of image buffers in browser GPU memory before starting dissolve transitions, preventing visual flickering during on-air cut/fade events.
* **Multi-Channel Architecture & Transition Control:** Supports multiple independent channel tabs to output to distinct OBS browser sources simultaneously, with 0.35s real-time dissolved fades and instant cut transitions.

### 2.5 All-in-One Project Package (`.bltproj`) & Media Specifications
* **All-in-One Packaging Format (`.bltproj`):** Saving a project bundles both title layout metadata and all registered raw graphic plate binaries (images) into a single archive package (`.bltproj`). Moving projects between computers requires transferring only this single package file; all media assets are automatically unpacked and restored into the local session without missing file links.
* **Media Upload & Package Limits:**
  * **Single Image Upload Limit:** Maximum **30MB** (Supported formats: `JPG`, `PNG`, `GIF`, `WEBP`, `SVG`)
  * **Project Package Upload Limit:** Maximum **500MB**
* **Temporary Media Lifecycle (Data Cleanup & Disk Protection):** Uploaded graphics operate strictly from a session-specific temporary directory (`media_uploads`). Initializing a new project (**`New`**) or shutting down the application (**`Shutdown`**) automatically purges these files from disk, leaving no residual files.
* **Media Relink Utility:** While routine file transfers do not require relinking due to the embedded nature of `.bltproj`, the **[🔄 Relink]** utility is available whenever operators wish to swap out an asset folder or batch-replace graphics with an identically named asset set during production.

---

## 3. Quick Start Guide

### 3.1 Initial Setup & Launch
1. Execute the binary for your operating system.
   * **macOS:** On first launch, an unsigned app warning may appear. Navigate to `System Settings > Privacy & Security` and click "Open Anyway", or right-click `BLT.app` and choose "Open".
   * **Windows:** If Windows Defender SmartScreen triggers, click "More info > Run anyway".
2. The background engine initializes, placing the BLT icon in the Windows taskbar tray or macOS menu bar, and automatically launches your default web browser.
3. Configure your session in the browser console modal:
   * **Start New Session:** Configure administrator and operator credentials (default: `admin1234` / `title1234`) to create a new session.
   * **Connect to Session:** Enter the password to access an active broadcast session.
   * **Open Project File:** Load a previously saved BLT project package (`.bltproj`) (requires the administrator password configured when the project was saved).
4. ⚠️ **Duplicate Session Warning:** Do not initialize a new session or load a project file while another broadcast session is actively in progress, as this will terminate and replace the running session, making previous title states inaccessible.

### 3.2 OBS Studio Integration
1. Select the desired channel tab in the top navigation bar and click **[Copy URL]** to copy the overlay address.
   * Address format: `http://<HOST_IP>:<PORT>/overlay.html?channel=ch_xxxx&viewKey=xxxx`
   * 💡 An integrated clipboard API fallback mechanism ensures reliable URL copying even when accessing the console over unencrypted HTTP on auxiliary client devices (tablets, laptops, etc.).
2. In OBS Studio, click `+` under Sources and add a **Browser** source.
3. Paste the copied URL and ensure the Width and Height match your Canvas Resolution (default: `1920` × `1080`).
4. The overlay canvas uses a transparent background and composites over video feeds without requiring Chroma Key filters.

### 3.3 Remote Sub-Operator Setup
1. Connect the main transmission PC and auxiliary control devices (laptops, tablets, smartphones) to the **same local area network (LAN / Wi-Fi)**.
2. Open a web browser on the secondary device and enter the private IP address shown on the main host console header (e.g., `http://192.168.0.15:3000`).
   * 💡 **Firewall Troubleshooting:** If the console does not load on the auxiliary client, verify that the host operating system's firewall (Windows Defender Firewall or macOS Firewall) allows inbound local network connections for the BLT application.
3. Enter the operator password (default: `title1234`) to log in. Operators receive restricted permissions covering title editing, playlist management, and live transmission (**TAKE / CLEAR**), while administrative project reset, load, and security settings remain inaccessible.

### 3.4 Operational Tips
* **Partial Highlighting:** Highlight specific words or characters within the title composition editor and adjust color, size, or stroke settings in the right inspector panel to style text granularly.
* **Aspect Ratio Preservation:** Hold `Shift` while dragging corner handles on the canvas to resize plates or text boxes proportionally.
* **Instant Take:** Click **[⚡ Take]** to save the active layer state to the title deck and push it live to air simultaneously.
* **All-in-One Project Archival:** Clicking **[💾 Save]** or **[📁 Save As...]** in the top bar packages all titles and registered images into a single `.bltproj` file for archival or workstation handoffs.

### 3.5 Shutdown
* **Via Web Console:** Click **[⏻ Shutdown]** in the top menu bar to immediately clear on-air graphics, remove temporary session media files, and terminate both the background server process and native launcher.
* **Via Native Launcher:** Right-click the Windows system tray icon and select `BLT 종료` (Quit BLT), or click the macOS menu bar icon and select `BLT 종료` to clean up all processes.

---

## 4. Building from Source & Local Development

Follow these steps to modify the codebase or run BLT in a local development environment.

### 4.1 Prerequisites
* [Node.js](https://nodejs.org/) v20.0 or higher
* **Windows Builds:** .NET Framework 4.0 or higher (`csc.exe` included with Windows)
* **macOS Builds:** Xcode Command Line Tools (`swiftc` included)

### 4.2 Running the Development Server
Clone the repository and run the following in your terminal:
```bash
# Install dependencies
npm install

# Start local server (automatically opens default browser)
npm start
```
> **Note:** `npm start` runs the application as a standalone Node.js process without the system tray/menu bar launcher. All web console features remain functional. Stop the server by pressing `Ctrl + C` in your terminal or clicking `[⏻ Shutdown]` in the web console.

### 4.3 Packaging Standalone Executables
* **Windows Executable (`dist/BLT.exe`):**
  ```bash
  node scripts-build-win.js
  ```
  *(Packages static web assets via inline VFS into a Node.js SEA binary, which is embedded as a resource inside a C# tray launcher to create a single executable.)*
* **macOS Application Bundle (`dist/BLT.app`):**
  ```bash
  node scripts-build-mac.js
  ```
  *(Packages an `.app` bundle containing the Swift menu bar resident agent and the internal Node.js SEA background engine binary.)*

---

## 5. Network Security & Legal Disclaimer

### 5.1 Security Guidelines
* **Private LAN Operation Only:** BLT transmits over unencrypted HTTP and WebSocket connections. It must strictly be deployed within secure, password-protected private local area networks.
* **No Public Exposure:** Never expose BLT server ports to the public internet using router port forwarding, DMZ configurations, or open Wi-Fi networks.
* **Update Default Credentials:** Default passwords (`admin1234`, `title1234`) are vulnerable. Operators must update credentials via the **[🔒 Passwords]** menu prior to production deployments.

### 5.2 Development Nature & Disclaimer of Liability
* **Vibe Coding Development Model:** This software was designed and implemented through interactive human-AI rapid prototyping (Vibe Coding) as an indie open-source project. It has not undergone enterprise-grade QA testing or institutional security audits, and unexpected bugs, runtime errors, or functional anomalies may occur under specific environments or operational edge cases.
* **Provided "AS IS":** The software is provided "AS IS", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement.
* **Limitation of Liability:** In no event shall the authors or copyright holders be liable for any claim, broadcast interruption, network compromise, data loss, hardware failure, or other damages arising from the use of this software. The user assumes all operational and network security risks.

---

## 6. Localization & License

* **Localization Notice:** All feature planning, architecture designs, source code, and user interface strings were originally authored in **Korean**. This English documentation was translated using artificial intelligence (AI) to provide accessibility for international users.
* **License:** Distributed under the [MIT License](LICENSE).

---
---

# BLT (Browser Lite Title) - 한국어 원문

OBS Studio 브라우저 소스 연동을 위한 로컬 독립 구동형 실시간 자막/타이틀 제어 시스템  
웹 타이포그래피 · 단어별 미세 서식 · 멀티 레이어 그래픽 플레이트 · 분리형 원격 오퍼레이팅

---

## 1. 기획 의도

* **OBS 기본 텍스트 도구의 한계 극복**  
  OBS Studio의 내장 텍스트(GDI+) 소스 특유의 외곽선 왜곡, 부자연스러운 정렬, 폰트 렌더링 한계를 벗어나 모던 브라우저 엔진 기반의 고품질 웹 타이포그래피를 실시간으로 송출합니다.
* **부분 서식 지정 및 멀티 레이어 합성**  
  문장 전체에 동일한 스타일을 적용해야 했던 방식에서 벗어나, 원하는 단어나 글자만 마우스로 드래그하여 글자색, 크기, 자간, 외곽선 두께 등을 개별 지정할 수 있습니다. 텍스트 레이어와 그래픽 플레이트(로고, 배경 바, 장식 에셋 등)를 제한 없이 다중 레이어로 중첩 배치할 수 있습니다.
* **1인 방송 및 소규모 중계를 위한 운영 분리**  
  송출용 메인 PC와 자막 조작 환경을 물리적으로 분리하여, 동일 네트워크 내 태블릿, 스마트폰, 보조 노트북 등 서브 기기를 통해 오퍼레이터가 원격으로 실시간 자막을 분리 제어할 수 있습니다.

---

## 2. 주요 특징 및 아키텍처

### 2.1 네이티브 런처 기반 독립 실행
* **Windows (.exe):** C# 기반 시스템 트레이 런처 내부에 Node.js 백그라운드 엔진이 임베디드 리소스로 내장된 단일 실행 파일 구조입니다. 콘솔 창 표시 없이 백그라운드에서 구동되며, 작업표시줄 시스템 트레이 아이콘을 통해 컨트롤러 열기, 포트 확인, 종료를 제어합니다.
* **macOS (.app):** Swift 기반 네이티브 메뉴 막대 상주 앱으로 빌드되어, Dock 아이콘 노출 없이 상단 메뉴 막대 상태 아이콘에서 서버 상태 확인 및 브라우저 컨트롤러 호출이 가능합니다.
* 시스템에 Node.js나 별도의 런타임을 설치할 필요 없이 즉시 독립 실행됩니다.

### 2.2 동적 포트 할당 및 프로세스 수명 주기
* 기본 `3000`번 포트로 로컬 웹 서버가 백그라운드 구동됩니다. 포트 충돌 시 빈 포트(`3001`, `3002` 등)를 자동 순차 탐색하여 바인딩합니다.
* 가동된 활성 포트 정보는 OS 표준 사용자 데이터 경로의 `current_port.json` 파일에 실시간으로 기록됩니다.
  * **Windows:** `%APPDATA%\browser-lite-titles\current_port.json`
  * **macOS:** `~/Library/Application Support/browser-lite-titles/current_port.json`
* **인스턴스 호출 권장:** 이미 프로그램이 실행 중일 때 실행 파일(`BLT.exe`, `BLT.app`)을 중복 실행하면 새로운 백엔드 프로세스가 생성되거나 포트가 분기될 수 있습니다. 브라우저 창을 닫았을 때는 실행 파일을 다시 켜지 마시고, **시스템 트레이(Windows) 또는 상단 메뉴 막대(macOS) 아이콘의 [컨트롤러 열기]** 메뉴를 통해 현재 가동 중인 세션을 호출해 주십시오.

### 2.3 이원화된 보안 및 세션 정책
* **로컬 호스트(Localhost) 제어 권한 보호:** 신규 프로젝트 생성, 프로젝트 파일 로드, 초기 세션 시작 등 방송 전체에 영향을 주는 핵심 기능은 메인 송출 PC(127.0.0.1 / localhost)에서만 수행할 수 있도록 엔드포인트가 엄격히 제한됩니다.
* **이원화된 비밀번호 체계:** 메인 관리자(기본값: `admin1234`)와 원격 서브 오퍼레이터(기본값: `title1234`)의 권한이 분리되어 운영됩니다.
* **서브 오퍼레이터 강제 차단 (Kick):** 관리자 화면에서 서브 오퍼레이터 비밀번호를 변경하면 세션 토큰이 갱신되며, 연결되어 있던 모든 서브 오퍼레이터의 웹소켓 연결이 강제 종료(`close 4001`)되어 로그인 화면으로 전환됩니다.
* **RAM 메모리 세션 보안 (무인증 재진입 차단):** 브라우저 저장소(`sessionStorage` / `localStorage`)에 인증 토큰을 영구 보관하지 않고 오직 브라우저 메모리 변수로만 세션을 유지합니다. 브라우저 창/탭을 닫거나 최근 방문 기록, 뒤로 가기(BFCache)로 복원 진입하더라도 항상 비밀번호를 다시 요구합니다.
* **오버레이 고유 식별키 (viewKey):** OBS 오버레이 주소는 채널 ID와 무작위 난수 키(`viewKey`)의 조합으로 검증됩니다. 관리자가 `viewKey`를 재생성하면 기존 연결된 OBS 오버레이 브라우저 소스만 즉시 연결 해제되며, 서브 오퍼레이터의 조작 권한에는 영향을 주지 않습니다.
* ⚠️ **가동 중인 세션 덮어쓰기 주의:** 이미 서버와 세션이 가동 중인 상태에서 [Open Project File]이나 [Start New Session](새 프로젝트)을 실행하면 기존 가동 중이던 세션 데이터와 자막 덱이 완전히 대체되며, 기존 세션으로는 다시 되돌아가거나 접근할 수 없습니다. 반드시 기존 작업 내용을 먼저 저장(`Save`)한 후 새 프로젝트를 열어야 합니다.

### 2.4 타이포그래피 & 방송 그래픽 엔진
* **OS 설치 시스템 폰트 자동 감지 및 렌더링 환경 주의:**  
  * 메인 호스트 PC에 설치된 시스템 폰트를 백그라운드에서 자동 감지하여 드롭다운 목록으로 제공합니다. 한국어 환경(맑은 고딕, Apple SD Gothic Neo)을 우선 탐색하며, 해당 폰트가 없는 해외 OS 환경에서는 스캔된 로컬 폰트 목록 및 웹 표준 고딕(`sans-serif`)으로 대체(폴백)됩니다. **[Custom]** 버튼을 통해 원하는 폰트명을 직접 지정할 수도 있습니다.
  * ⚠️ **송출 환경 폰트 설치 필수:** 웹 기반 브라우저 소스 특성상, 폰트는 화면을 실제로 그려내는 기기의 로컬 리소스를 참조합니다. 따라서 **메인 호스트 PC와 OBS를 구동하는 송출 PC가 서로 분리되어 있는 환경이라면, 자막에 지정된 폰트가 OBS가 실행되는 PC에도 반드시 설치되어 있어야** 의도한 서체로 정상 송출됩니다 (미설치 시 시스템 기본 고딕으로 대체 표시됨).
* **텍스트 자동 크기 맞춤 (Auto-Fit Within Box):** 텍스트 입력 시 자막이 지정된 박스 영역 밖으로 넘쳐 화면에서 잘리는 현상을 방지하기 위해, 이진 탐색 알고리즘 기반으로 폰트 크기가 박스 영역에 맞춰 실시간으로 자동 축소·조절됩니다.
* **스마트 가이드 & 자석 스냅(Snap):** 미리보기 캔버스에서 레이어 이동 시 캔버스 중심 및 외곽 가장자리에 붉은색 스마트 가이드선이 표시되며 14px 자석 스냅이 동작합니다. `Shift` 키를 누른 채 모서리를 드래그하면 원본 종횡비가 유지됩니다.
* **트랜지션 전 이미지 사전 비동기 디코딩 (`decode()`):** 그래픽 플레이트가 포함된 자막을 송출(`TAKE`)할 때, 브라우저 GPU 메모리에 이미지가 비동기 디코딩 완료될 때까지 대기한 후 디졸브를 시작하여 화면 전환 시의 깜빡임(Flicker)을 방지합니다.
* **다채널 및 전환 제어:** 다수의 독립 채널 탭을 생성하여 서로 다른 OBS 브라우저 소스로 개별 송출할 수 있으며, 0.35초 실시간 디졸브(Fade) 및 즉시 전환(Cut)을 지원합니다.

### 2.5 올인원 프로젝트 패키지 (`.bltproj`) 및 미디어 규격
* **올인원 패키징 포맷 (`.bltproj`):** 프로젝트 저장 시 자막 레이아웃 정보뿐만 아니라 등록된 모든 그래픽 플레이트(이미지) 원본을 단일 압축 파일(`.bltproj`) 내부에 함께 패키징합니다. 다른 컴퓨터로 프로젝트 파일을 옮겨 작업하더라도 파일 하나만 불러오면 모든 미디어 에셋이 로컬 세션으로 자동 압축 해제·복원되어 이미지 유실 없이 작업할 수 있습니다.
* **미디어 업로드 및 패키지 규격:**
  * **단일 이미지 업로드 제한:** 최대 **30MB** (`JPG`, `PNG`, `GIF`, `WEBP`, `SVG` 포맷 지원)
  * **프로젝트 패키지 업로드 제한:** 최대 **500MB**
* **임시 미디어 파일 수명 주기 (데이터 정리 및 디스크 보호):** 세션 중 등록된 이미지 파일들은 세션 전용 임시 디렉터리(`media_uploads`)에서 구동되며, **새 프로젝트 생성(`New`)** 또는 프로그램 **종료(`Shutdown`)** 시 디스크에 잔여 파일이 남지 않도록 자동 삭제(파기)됩니다.
* **보조 도구로서의 미디어 리링크 (Relink):** 에셋이 내장되는 `.bltproj` 특성상 일상적인 파일 이동 시에는 리링크가 필요하지 않지만, 작업 중 로컬의 다른 폴더로 이미지 에셋을 교체하거나 파일명이 동일한 새 그래픽 세트로 일괄 변경하고자 할 때 **[🔄 Relink]** 유틸리티를 활용할 수 있습니다.

---

## 3. 사용 방법

### 3.1 실행 및 프로젝트 시작
1. 운영체제에 맞는 실행 파일을 실행합니다.
   * **macOS:** 최초 실행 시 미서명 앱 경고가 나타날 수 있습니다. `시스템 설정 > 개인정보 보호 및 보안`에서 "확인 없이 열기"를 클릭하거나 우클릭 후 "열기"를 선택합니다.
   * **Windows:** Windows Defender 스마트스크린 경고가 표시될 경우 "추가 정보 > 실행"을 클릭합니다.
2. 백그라운드 서버가 구동되고 시스템 트레이(Windows) 또는 메뉴 막대(macOS)에 BLT 아이콘이 생성되며 기본 웹 브라우저가 자동 실행됩니다.
3. 브라우저 콘솔 화면에서 세션을 구성합니다:
   * **Start New Session:** 관리자 및 서브 오퍼레이터 비밀번호를 설정(미입력 시 기본값: 관리자 `admin1234` / 오퍼레이터 `title1234`)하여 신규 세션을 생성합니다.
   * **Connect to Session:** 이미 가동 중인 방송 세션에 접속할 때 비밀번호를 입력합니다.
   * **Open Project File:** 기존에 저장된 BLT 프로젝트 패키지(`.bltproj`)를 불러옵니다 (프로젝트 저장 시 설정했던 관리자 비밀번호 입력 필요).
4. ⚠️ **세션 중복 시작 주의:** 이미 방송 세션을 진행 중인 상태에서 [Open Project File]이나 [Start New Session]을 누르면 기존 가동 중이던 세션이 중단되고 새로 연 프로젝트/세션으로 대체되어 이전 세션에 다시 접근할 수 없으므로 주의하십시오.

### 3.2 OBS 브라우저 소스 연동
1. 컨트롤러 상단에서 송출할 채널 탭을 선택하고 **[Copy URL]** 버튼을 클릭하여 오버레이 주소를 복사합니다.
   * 주소 형식: `http://<호스트IP>:<포트>/overlay.html?channel=ch_xxxx&viewKey=xxxx`
   * 💡 원격 보조 기기(태블릿, 노트북 등)의 비보안 HTTP 접속 환경에서도 원활한 연동을 지원하기 위해 클립보드 API 폴백 메커니즘이 내장되어 있습니다.
2. OBS Studio의 소스 목록에서 `+`를 누르고 **브라우저(Browser)** 소스를 추가합니다.
3. 복사한 URL을 붙여넣고, 너비와 높이를 컨트롤러의 Canvas Resolution(기본값: `1920` × `1080`)과 동일하게 설정합니다.
4. 오버레이 화면은 배경이 투명하게 처리되어 있으므로 추가적인 크로마키 설정 없이 방송 화면 위에 합성됩니다.

### 3.3 서브 오퍼레이터 원격 조작
1. 메인 송출 PC와 원격 조작용 기기(노트북, 태블릿, 스마트폰 등)를 **동일한 공유기(LAN/Wi-Fi)** 환경에 연결합니다.
2. 메인 PC 관리자 화면 상단에 표시되는 사설 IP 주소(예: `[http://192.168.0.15:3000](http://192.168.0.15:3000)`)를 원격 기기의 웹 브라우저 주소창에 입력합니다.
   * 💡 **접속 불가 시 방화벽 확인:** 원격 서브 기기에서 페이지가 열리지 않는 경우, 메인 호스트 PC의 방화벽(Windows Defender 또는 macOS 방화벽) 설정에서 BLT 앱의 사설 네트워크 인바운드 통신이 허용되어 있는지 확인해 주십시오.
3. 서브 오퍼레이터 비밀번호(기본값: `title1234`)를 입력하고 로그인하면 메인 PC의 프로젝트 리셋/로드/보안 설정을 제외한 자막 편집, 리스트 관리, 실시간 송출(**TAKE / CLEAR**) 권한만 제한적으로 부여됩니다.

### 3.4 조작 팁
* **부분 서식 강조:** 텍스트 입력창에서 강조하고 싶은 단어나 글자만 마우스로 드래그하여 블록을 지정한 후, 우측 인스펙터에서 글자색이나 크기, 테두리를 변경하면 해당 글자만 독립적으로 서식이 변경됩니다.
* **비율 유지 리사이즈:** 미리보기 캔버스에서 플레이트나 텍스트 박스의 모서리 핸들을 잡고 `Shift` 키를 누른 채 드래그하면 원본 종횡비가 유지됩니다.
* **단축키 및 즉시 송출:** 편집창에서 **[⚡ Take]** 버튼을 누르면 현재 작업 내용이 덱에 자동 저장됨과 동시에 방송 화면으로 즉시 송출됩니다.
* **일체형 프로젝트 저장:** 콘솔 상단의 **[💾 Save]** 또는 **[📁 Save As...]**를 누르면 모든 자막과 사용된 이미지들이 하나의 `.bltproj` 파일로 패키징되므로, 이 파일 하나만 보관하거나 다른 PC로 전달하면 됩니다.

### 3.5 안전 종료 (Shutdown)
* **웹 콘솔에서 종료:** 상단 메뉴 막대의 **[⏻ Shutdown]** 버튼을 클릭하면 활성화되어 있던 온에어 자막이 즉시 송출 중단(Clear)된 후, 세션 임시 미디어 파일이 정리되고 백그라운드 서버 프로세스와 네이티브 런처가 함께 종료됩니다.
* **런처에서 종료:** Windows 작업표시줄 트레이 아이콘 우클릭 후 `BLT 종료`, 또는 macOS 상단 메뉴 막대 아이콘 클릭 후 `BLT 종료`를 선택하면 모든 프로세스가 정리됩니다.

---

## 4. 소스코드 직접 빌드 및 로컬 실행 (For Developers)

소스코드를 직접 수정하거나 로컬 개발 환경에서 구동하려는 경우 다음 절차를 따릅니다.

### 4.1 사전 요구사항
* [Node.js](https://nodejs.org/) v20.0 이상
* **Windows 빌드 시:** .NET Framework 4.0 이상 (`csc.exe` 기본 내장)
* **macOS 빌드 시:** Xcode Command Line Tools (`swiftc` 기본 내장)

### 4.2 로컬 개발 서버 실행
터미널을 열고 저장소를 클론한 후 다음 명령을 실행합니다:
```bash
# 의존성 패키지 설치
npm install

# 로컬 개발 서버 구동 (기본 브라우저 자동 호출)
npm start
```
> **참고:** `npm start` 실행 시에는 트레이/메뉴 막대 런처 없이 Node.js 콘솔 프로세스로 직접 구동됩니다. 웹 콘솔 제어창의 모든 기능은 동일하게 작동하며, 터미널에서 `Ctrl + C`를 누르거나 상단 `[⏻ Shutdown]`을 클릭하여 종료할 수 있습니다.

### 4.3 플랫폼별 단일 바이너리 패키징
* **Windows 단일 실행 바이너리 생성 (`dist/BLT.exe`):**
  ```bash
  node scripts-build-win.js
  ```
  *(정적 웹 에셋을 VFS로 인라인 패키징한 Node.js SEA 바이너리를 C# 트레이 런처 내부에 임베디드 리소스로 내장하여 단일 실행 파일을 생성합니다.)*
* **macOS 메뉴 막대 앱 번들 생성 (`dist/BLT.app`):**
  ```bash
  node scripts-build-mac.js
  ```
  *(Swift 기반 메뉴 막대 상주 에이전트와 내부 Node.js SEA 백그라운드 바이너리가 포함된 `.app` 번들을 생성합니다.)*

---

## 5. 네트워크 보안 및 법적 면책 고지 (중요)

### 5.1 네트워크 보안 권고
* **사설 로컬 네트워크 전용 (Private LAN Only):** BLT는 보안 인증서(HTTPS) 암호화 통신이 적용되지 않은 로컬 HTTP/WebSocket 프로토콜을 사용합니다. 반드시 비밀번호로 암호화된 신뢰할 수 있는 사설 공유기(LAN) 환경에서만 운용해야 합니다.
* **외부 인터넷 포트 개방 절대 금지:** 공유기의 포트포워딩(Port Forwarding), DMZ 설정 등을 통해 공용 인터넷에 BLT 서버 포트를 노출하거나, 비밀번호가 없는 개방형 공용 Wi-Fi 환경에서 사용하는 것을 엄격히 금지합니다.
* **주기적인 자격증명 변경:** 초기 기본 비밀번호(`admin1234`, `title1234`)는 보안에 취약하므로 실제 방송 송출 전 상단 **[🔒 Passwords]** 메뉴를 통해 비밀번호를 반드시 변경하여 운영하시기 바랍니다.

### 5.2 개발 배경 및 법적 책임의 한계 (Disclaimer of Liability)
* **바이브코딩(Vibe Coding) 기반 개발:** 본 소프트웨어는 AI 도구와의 대화형 협업을 통해 신속하게 설계 및 구현된 개인 오픈소스 프로젝트(바이브코딩 기반)입니다. 따라서 일반적인 상용 엔터프라이즈 소프트웨어 수준의 체계적인 QA 및 보안 감사를 거치지 않았으며, **특정 환경이나 예외적인 조작 상황에서 예상치 못한 버그, 런타임 오류 또는 기능 오작동이 발생할 수 있습니다.**
* **있는 그대로 제공 (AS IS):** 본 소프트웨어는 상품성, 특정 목적에의 적합성 및 비침해성에 대한 보증을 포함하여 어떠한 형태의 명시적·묵시적 보증도 없이 **"있는 그대로(AS IS)"** 제공됩니다.
* **책임의 부인:** 개발자는 본 프로그램을 사용하는 과정에서 발생하는 방송 사고, 전송 중단, 네트워크 침해, 데이터 유실, 하드웨어 손상 또는 기타 직·간접적인 손해에 대하여 어떠한 법적 책임도 지지 않습니다. 모든 운용 및 네트워크 보안 유지의 책임은 사용자 본인에게 있습니다.

---

## 6. 다국어 안내 및 라이선스

* **원문 및 번역 안내:** 본 프로젝트의 모든 기능 기획, 아키텍처 설계, UI 텍스트 및 핵심 로직은 **한국어 원문을 기준**으로 제작되었습니다. 영문 문서는 글로벌 사용자의 접근성을 돕기 위해 인공지능(AI)을 활용하여 번역되었습니다.
* **라이선스:** 본 프로젝트는 [MIT License](LICENSE)에 따라 자유롭게 수정, 복제 및 재배포가 가능합니다.
