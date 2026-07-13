const { app, BrowserWindow, net, protocol, session, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

protocol.registerSchemesAsPrivileged([{
  scheme: 'jizhang',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
  },
}])

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    title: '截图记账',
    backgroundColor: '#eee9de',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadURL('jizhang://app/index.html')
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  const distRoot = path.resolve(__dirname, '../dist')
  protocol.handle('jizhang', (request) => {
    const url = new URL(request.url)
    const relativePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '') || 'index.html'
    const filePath = path.resolve(distRoot, relativePath)
    if (!filePath.startsWith(`${distRoot}${path.sep}`) && filePath !== distRoot) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
  const isLocalApp = (url = '') => url.startsWith('jizhang://app') || url.startsWith('http://127.0.0.1:5173')
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    permission === 'clipboard-read' && isLocalApp(requestingOrigin),
  )
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL()
    callback(permission === 'clipboard-read' && isLocalApp(requestingUrl))
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
