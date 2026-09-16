using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace BLTLauncher
{
    static class Program
    {
        private static NotifyIcon trayIcon;
        private static Process serverProcess;
        private static int currentPort = 3000;
        private static string extractedBinaryPath;

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            ExtractAndStartServer();
            SetupTrayIcon();

            Application.Run();
        }

        private static void ExtractAndStartServer()
        {
            try
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string binDir = Path.Combine(localAppData, "browser-lite-titles", "bin");
                Directory.CreateDirectory(binDir);

                extractedBinaryPath = Path.Combine(binDir, "BLT_engine.exe");

                // 임베디드 리소스에서 백그라운드 엔진 추출 (BLT_bin.exe)
                var assembly = Assembly.GetExecutingAssembly();
                using (Stream stream = assembly.GetManifestResourceStream("BLT_bin.exe"))
                {
                    if (stream == null)
                    {
                        MessageBox.Show("내장된 백그라운드 서버 엔진 리소스를 찾을 수 없습니다.", "오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        Environment.Exit(1);
                        return;
                    }

                    using (FileStream fileStream = new FileStream(extractedBinaryPath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
                    {
                        stream.CopyTo(fileStream);
                    }
                }

                serverProcess = new Process();
                serverProcess.StartInfo.FileName = extractedBinaryPath;
                serverProcess.StartInfo.UseShellExecute = false;
                serverProcess.StartInfo.CreateNoWindow = true; // 콘솔 창 숨김
                serverProcess.StartInfo.RedirectStandardInput = true; // 표준 입력 파이프 활성화
                serverProcess.EnableRaisingEvents = true;

                // 웹 콘솔(console.html)에서 Shutdown 시 트레이 런처도 함께 종료
                serverProcess.Exited += (s, e) =>
                {
                    CleanupAndExit();
                };

                serverProcess.Start();
            }
            catch (Exception ex)
            {
                MessageBox.Show("백그라운드 서버 구동 실패: " + ex.Message, "오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Environment.Exit(1);
            }
        }

        private static void SetupTrayIcon()
        {
            ReadCurrentPort();

            ContextMenu contextMenu = new ContextMenu();

            // 1. 컨트롤러 열기
            MenuItem openItem = new MenuItem("Open Web Console", (s, e) => OpenBrowser());
            openItem.DefaultItem = true;
            contextMenu.MenuItems.Add(openItem);

            contextMenu.MenuItems.Add("-");

            // 2. 앱 종료 (포트 모니터링 메뉴 제거)
            MenuItem quitItem = new MenuItem("Exit BLT", (s, e) => CleanupAndExit());
            contextMenu.MenuItems.Add(quitItem);

            trayIcon = new NotifyIcon();
            trayIcon.Text = "BLT Server";
            trayIcon.ContextMenu = contextMenu;
            trayIcon.Visible = true;

            // 실행 파일 자체에 내장된 메인 아이콘을 트레이 아이콘으로 사용
            try
            {
                trayIcon.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
                trayIcon.Icon = SystemIcons.Application;
            }

            trayIcon.DoubleClick += (s, e) => OpenBrowser();
        }

        private static void OpenBrowser()
        {
            ReadCurrentPort();

            string url = "http://127.0.0.1:" + currentPort;
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch {}
        }

        private static void ReadCurrentPort()
        {
            try
            {
                string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                string portFilePath = Path.Combine(appData, "browser-lite-titles", "current_port.json");

                if (File.Exists(portFilePath))
                {
                    string json = File.ReadAllText(portFilePath);
                    Match match = Regex.Match(json, "\"port\"\\s*:\\s*(\\d+)");
                    if (match.Success)
                    {
                        currentPort = int.Parse(match.Groups[1].Value);
                    }
                }
            }
            catch {}
        }

        private static void CleanupAndExit()
        {
            if (trayIcon != null)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
            }

            // 표준 입력을 통해 백엔드 엔진으로 shutdown 명령 전송
            if (serverProcess != null && !serverProcess.HasExited)
            {
                try
                {
                    serverProcess.StandardInput.WriteLine("shutdown");
                    // 백엔드가 온에어 자막 클리어(400ms) 및 임시 파일 삭제를 완료할 수 있도록 최대 1.5초 대기
                    serverProcess.WaitForExit(1500);
                }
                catch {}
            }

            Environment.Exit(0);
        }
    }
}