const fs = require("fs");
const path = require("path");

const APP_TAGS = {
  "instagram": "instagram",
  "speedtest": "Speedtest",
  "pydroid3": "Pydroid3",
  "github": "github",
  "niagara-launcher": "NiagaraLauncher",
  "solid-explorer": "SolidExplorer",
  "gboard": "Gboard",
  "wps-office": "WPSOffice"
};

async function downloadApk(version, appName, forceBuild = null) {
  const tag = APP_TAGS[appName];
  if (!tag) {
    throw new Error(`"${appName}" için GitHub tag'i bulunamadı.`);
  }

  console.log(`\n🌐 GitHub'dan bilgi alınıyor: ${appName.toUpperCase()} (Tag: ${tag})`);
  
  const apiUrl = `https://api.github.com/repos/fuckpdf/Depo/releases/tags/${tag}`;
  const response = await fetch(apiUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Node.js)" }
  });

  if (!response.ok) {
    throw new Error(`GitHub API Hatası: ${response.status} ${response.statusText}`);
  }

  const releaseData = await response.json();
  
  const asset = releaseData.assets.find(a => a.name.endsWith(".apk") || a.name.endsWith(".apkm"));
  
  if (!asset) {
    throw new Error(`"${tag}" etiketli GitHub sürümünde .apk veya .apkm dosyası bulunamadı.`);
  }

  const fileSizeMB = (asset.size / (1024 * 1024)).toFixed(2);
  console.log(`➡️ İndirilecek dosya bulundu: ${asset.name} (${fileSizeMB} MB)`);

  const outDir = path.resolve(__dirname, "..", "downloads");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filePath = path.join(outDir, asset.name);
  
  console.log(`⬇️ İndiriliyor...`);
  
  const fileRes = await fetch(asset.browser_download_url);
  if (!fileRes.ok) throw new Error("Dosya GitHub'dan indirilemedi!");
  
  const arrayBuffer = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(filePath, buffer);

  console.log(`📦 BAŞARILI: ${filePath}`);
  return filePath;
}

async function getLatestListing(appName) {
  const tag = APP_TAGS[appName];
  if (!tag) {
    throw new Error(`"${appName}" için GitHub tag'i bulunamadı.`);
  }

  return {
    version: "latest", 
    href: `https://github.com/fuckpdf/Depo/releases/tag/${tag}`
  };
}

module.exports = { 
  downloadApk, 
  getLatestListing
};
