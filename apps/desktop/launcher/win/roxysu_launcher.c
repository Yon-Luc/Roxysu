/*
 * Roxysu Win32 bootstrap (headless).
 * Launches RoxysuApp.exe and waits until it exits. No splash UI — Electron owns
 * the first visible window.
 *
 * Must stay alive for the full Electron lifetime: electron-builder portable
 * NSIS ExecWaits on Roxysu.exe, then RMDir's the unpack dir when it returns.
 *
 * Build (Developer Command Prompt / CI):
 *   cl /nologo /O2 /Fe:Roxysu.exe roxysu_launcher.c user32.lib shell32.lib shlwapi.lib
 */
#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <stdio.h>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shlwapi.lib")

static const wchar_t kAppTitle[] = L"Roxysu";
static PROCESS_INFORMATION gChild = {0};

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

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrev, PWSTR cmdLine, int nShow) {
  (void)hInstance;
  (void)hPrev;
  (void)cmdLine;
  (void)nShow;

  if (!LaunchApp()) {
    return 1;
  }

  WaitForSingleObject(gChild.hProcess, INFINITE);

  DWORD exitCode = 1;
  GetExitCodeProcess(gChild.hProcess, &exitCode);
  CloseHandle(gChild.hProcess);
  if (gChild.hThread) CloseHandle(gChild.hThread);
  return (int)exitCode;
}
