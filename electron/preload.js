const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getDefaultOutput: () => ipcRenderer.invoke("get-default-output"),
  pickImages: () => ipcRenderer.invoke("pick-images"),
  inspectPaths: (filePaths) => ipcRenderer.invoke("inspect-paths", filePaths),
  getImagePreview: (filePath) => ipcRenderer.invoke("get-image-preview", filePath),
  pickOutputFolder: () => ipcRenderer.invoke("pick-output-folder"),
  revealItem: (filePath) => ipcRenderer.invoke("reveal-item", filePath),
  revealFolder: (folderPath) => ipcRenderer.invoke("reveal-folder", folderPath),
  resizeImages: (payload) => ipcRenderer.invoke("resize-images", payload),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onResizeProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("resize-progress", listener);
    return () => ipcRenderer.removeListener("resize-progress", listener);
  },
});
