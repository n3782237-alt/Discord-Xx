const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("discordX", {
  platform: process.platform,
  appVersion: "1.0.0"
});
