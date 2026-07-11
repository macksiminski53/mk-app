const { app, BrowserWindow, Tray, Menu, session, nativeImage, Notification } = require('electron');
const path = require('path');

// Points at the deployed frontend, not a bundled copy -- so the desktop
// app always shows the same accounts/friends/messages as the web version,
// with zero duplicate deployment/update logic to maintain here.
const APP_URL = 'https://mk-app-1.onrender.com';

let mainWindow = null;
let tray = null;
let isQuitting = false;
// Assigned inside app.whenReady() below -- session.fromPartition() throws
// if called before Electron's app module is ready, so it can't be a
// top-level const like it originally was.
let persistentSession = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 720,
    minHeight: 480,
    title: 'MK',
    backgroundColor: '#1a0d0d',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: persistentSession,
    },
  });

  mainWindow.loadURL(APP_URL);

  // Close ("X") minimizes to tray instead of quitting -- this is what
  // makes background notifications actually useful; a chat app that fully
  // quits every time you click the corner X would never be around to
  // notify you of anything.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  // Tray icons look better small; resize down if we loaded a full-size one.
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('MK');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open MK',
      click: () => {
        if (!mainWindow) createWindow();
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

app.whenReady().then(() => {
  // A named, "persist:"-prefixed partition is stored on disk under this
  // app's userData folder and reused across launches by Electron -- unlike
  // the anonymous default session, this guarantees login (localStorage/
  // cookies) survives a full quit-and-reopen instead of only surviving a
  // hide-to-tray. This is what makes "stay logged in" actually work here.
  persistentSession = session.fromPartition('persist:mkapp');

  // A frameless-ish desktop shell has no browser permission bar for the
  // page to fall back on, so without this the web app's Notification
  // (see client/src/App.jsx) and getUserMedia (voice calls) requests would
  // just hang forever waiting on a prompt the user can never see. We only
  // ever point this window at our own APP_URL, so auto-granting is safe.
  persistentSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(['notifications', 'media'].includes(permission));
  });

  createWindow();
  createTray();

  app.on('activate', () => {
    if (!mainWindow) createWindow();
    else mainWindow.show();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

// Keep running in the tray after the last window closes (Windows/Linux) --
// intentionally not calling app.quit() here, unlike most Electron
// boilerplate, so notifications keep working while "closed".
app.on('window-all-closed', () => {});

// Belt-and-suspenders: if the renderer's own Notification calls ever fail
// to produce a native popup for some reason, this exposes the same API to
// scripts running in the main process (unused today, but keeps the door
// open without adding IPC plumbing prematurely).
module.exports = { Notification };
