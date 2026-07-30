/*
 * Roxysu Win32 bootstrap splash.
 * Shows a window immediately, launches RoxysuApp.exe, exits when Electron
 * writes %APPDATA%\\Roxysu\\logs\\electron-window-ready (or after timeout).
 *
 * Build (Developer Command Prompt / CI):
 *   cl /nologo /O2 /Fe:Roxysu.exe roxysu_launcher.c user32.lib gdi32.lib shell32.lib shlwapi.lib
 */
#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <stdio.h>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shlwapi.lib")

static const wchar_t kClassName[] = L"RoxysuBootstrapSplash";
static const wchar_t kAppTitle[] = L"Roxysu";
static const wchar_t kStatus[] = L"Starting Roxysu\u2026";
static const COLORREF kBg = RGB(0x12, 0x14, 0x1a);
static const COLORREF kFg = RGB(0xe8, 0xea, 0xef);
static const COLORREF kMuted = RGB(0x9a, 0xa3, 0xb5);

static HWND gHwnd = NULL;
static PROCESS_INFORMATION gChild = {0};
static UINT_PTR gTimer = 0;
static DWORD gStartedTick = 0;

static void GetMarkerPath(wchar_t *out, size_t cch) {
  wchar_t appdata[MAX_PATH];
  if (FAILED(SHGetFolderPathW(NULL, CSIDL_APPDATA, NULL, 0, appdata))) {
    out[0] = 0;
    return;
  }
  _snwprintf_s(out, cch, _TRUNCATE, L"%s\\Roxysu\\logs\\electron-window-ready", appdata);
}

static int MarkerExists(void) {
  wchar_t path[MAX_PATH];
  GetMarkerPath(path, MAX_PATH);
  if (!path[0]) return 0;
  return PathFileExistsW(path) ? 1 : 0;
}

static void ClearStaleMarker(void) {
  wchar_t path[MAX_PATH];
  GetMarkerPath(path, MAX_PATH);
  if (path[0]) DeleteFileW(path);
}

static int LaunchApp(void) {
  wchar_t module[MAX_PATH];
  wchar_t dir[MAX_PATH];
  wchar_t appPath[MAX_PATH];
  wchar_t cmd[MAX_PATH * 2];
  STARTUPINFOW si;

  if (!GetModuleFileNameW(NULL, module, MAX_PATH)) return 0;
  lstrcpyW(dir, module);
  PathRemoveFileSpecW(dir);
  _snwprintf_s(appPath, MAX_PATH, _TRUNCATE, L"%s\\RoxysuApp.exe", dir);
  if (!PathFileExistsW(appPath)) {
    MessageBoxW(NULL, L"RoxysuApp.exe was not found next to the launcher.", kAppTitle,
                MB_OK | MB_ICONERROR);
    return 0;
  }

  _snwprintf_s(cmd, MAX_PATH * 2, _TRUNCATE, L"\"%s\"", appPath);
  ZeroMemory(&si, sizeof(si));
  si.cb = sizeof(si);
  ZeroMemory(&gChild, sizeof(gChild));

  if (!CreateProcessW(appPath, cmd, NULL, NULL, FALSE, 0, NULL, dir, &si, &gChild)) {
    MessageBoxW(NULL, L"Failed to start RoxysuApp.exe.", kAppTitle, MB_OK | MB_ICONERROR);
    return 0;
  }
  return 1;
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  switch (msg) {
    case WM_PAINT: {
      PAINTSTRUCT ps;
      HDC hdc = BeginPaint(hwnd, &ps);
      RECT rc;
      GetClientRect(hwnd, &rc);
      HBRUSH brush = CreateSolidBrush(kBg);
      FillRect(hdc, &rc, brush);
      DeleteObject(brush);

      SetBkMode(hdc, TRANSPARENT);
      SetTextColor(hdc, kFg);
      HFONT titleFont = CreateFontW(28, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE,
                                    DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                    CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
      HFONT old = (HFONT)SelectObject(hdc, titleFont);
      RECT titleRc = rc;
      titleRc.top = rc.bottom / 2 - 40;
      DrawTextW(hdc, kAppTitle, -1, &titleRc, DT_CENTER | DT_SINGLELINE);

      SetTextColor(hdc, kMuted);
      HFONT statusFont = CreateFontW(16, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                                     DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                     CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
      SelectObject(hdc, statusFont);
      RECT statusRc = rc;
      statusRc.top = rc.bottom / 2 + 8;
      DrawTextW(hdc, kStatus, -1, &statusRc, DT_CENTER | DT_SINGLELINE);

      SelectObject(hdc, old);
      DeleteObject(titleFont);
      DeleteObject(statusFont);
      EndPaint(hwnd, &ps);
      return 0;
    }
    case WM_TIMER:
      if (MarkerExists()) {
        KillTimer(hwnd, gTimer);
        PostQuitMessage(0);
      } else if (GetTickCount() - gStartedTick > 10 * 60 * 1000) {
        /* 10 min safety — do not hang forever if Electron never signals. */
        KillTimer(hwnd, gTimer);
        PostQuitMessage(0);
      } else if (gChild.hProcess) {
        DWORD code = 0;
        if (GetExitCodeProcess(gChild.hProcess, &code) && code != STILL_ACTIVE) {
          KillTimer(hwnd, gTimer);
          PostQuitMessage(code == 0 ? 0 : 1);
        }
      }
      return 0;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrev, PWSTR cmdLine, int nShow) {
  (void)hPrev;
  (void)cmdLine;
  (void)nShow;

  /* Single-instance for the stub itself is unnecessary; Electron owns the lock. */
  ClearStaleMarker();
  gStartedTick = GetTickCount();

  WNDCLASSEXW wc;
  ZeroMemory(&wc, sizeof(wc));
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = WndProc;
  wc.hInstance = hInstance;
  wc.hCursor = LoadCursor(NULL, IDC_ARROW);
  wc.hbrBackground = CreateSolidBrush(kBg);
  wc.lpszClassName = kClassName;
  RegisterClassExW(&wc);

  int width = 420;
  int height = 220;
  int x = (GetSystemMetrics(SM_CXSCREEN) - width) / 2;
  int y = (GetSystemMetrics(SM_CYSCREEN) - height) / 2;

  gHwnd = CreateWindowExW(
      WS_EX_APPWINDOW,
      kClassName,
      kAppTitle,
      WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
      x, y, width, height,
      NULL, NULL, hInstance, NULL);

  ShowWindow(gHwnd, SW_SHOW);
  UpdateWindow(gHwnd);

  if (!LaunchApp()) {
    return 1;
  }

  gTimer = SetTimer(gHwnd, 1, 200, NULL);

  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  if (gChild.hThread) CloseHandle(gChild.hThread);
  if (gChild.hProcess) CloseHandle(gChild.hProcess);
  return (int)msg.wParam;
}
