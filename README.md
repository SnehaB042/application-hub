# Application Hub

Desktop app for managing university applications (Electron + vanilla JS, no bundler).

## Run on Windows
1. Install Node.js LTS from https://nodejs.org (includes npm).
2. Unzip this folder, open it in File Explorer, click the address bar, type `powershell`, press Enter.
3. Run:
       npm install
       npm start

## Build an installer
    npm run dist:win     (creates dist\Application Hub Setup x.y.z.exe)
    npm run dist:mac     (run on a Mac; creates a .dmg)

## Where your data lives
%APPDATA%\uni-application-hub\university-data.json  (macOS: ~/Library/Application Support/uni-application-hub/)
Passwords inside it are encrypted with Windows DPAPI / macOS Keychain and only readable by your OS user account.

## Using it
1. Click "Sign in once" in the sidebar and log in to Google. Every Doc and Sheet then opens signed in, even after restarting. Use "Switch account" only to change accounts.
2. Add a university. The app then offers to build its requirements checklist (SoP, LoRs, GRE, IELTS, marksheet, resume, video essay, personal details), or to copy one from an application you already set up.
3. Open an application to see its requirements. "Work through it in the workspace" opens the portal with the checklist beside it.
4. Marksheet, resume and test scores can be applied to every other university with one checkbox.
