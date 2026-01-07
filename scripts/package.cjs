const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const appDir = path.join(distDir, "app");

const copyDir = (source, target) => {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing build output at ${source}`);
  }
  fs.cpSync(source, target, { recursive: true });
};

fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });

copyDir(path.join(distDir, "electron"), path.join(appDir, "electron"));
copyDir(path.join(distDir, "renderer"), path.join(appDir, "renderer"));

const rootPackage = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
);
const appPackage = {
  name: rootPackage.name,
  version: rootPackage.version,
  private: true,
  main: "electron/main.js"
};

fs.writeFileSync(
  path.join(appDir, "package.json"),
  `${JSON.stringify(appPackage, null, 2)}\n`
);

console.log("Staged Electron app at dist/app");
