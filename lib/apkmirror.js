const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { toApkMirrorVersion } = require("./versions");

const APP_SITES = {
  "youtube": { org: "google-inc", slug: "youtube" },
  "youtube-music": { org: "google-inc", slug: "youtube-music" },
  "reddit": { org: "reddit-inc", slug: "reddit" },
  "twitter": { org: "x-corp", slug: "twitter", releaseSlug: "x" },
  "instagram": { org: "instagram", slug: "instagram" },
  "github": { org: "github", slug: "github-2" },
  "niagara": { org: "mellowdrop-studio", slug: "niagara-launcher-%f0%9f%94%b9-fresh-clean" },
  "pydroid": { org: "lider-soft-kz", slug: "pydroid-3-ide-for-python-3" },
  "smartlauncher": { org: "smart-launcher-team", slug: "smart-launcher" },
  "wps": { org: "wps-software-pte-ltd", slug: "wps-office-pdf" },
  "gboard": { org: "google-inc", slug: "gboard" },
  "speedtest": { org: "ookla", slug: "speedtest" },
  "solidexplorer": { org: "neatbytes", slug: "solid-explorer-file-manager" }
};

async function pageExists(page, url) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => null);
  if (!res || res.status() >= 400) return false;
  // Bazen bot koruması sadece metin olan sayfalar çıkarıyor, .table-row beklemek yerine body var mı bakıyoruz
  const body = await page.$("body").catch(() => null);
  return !!body;
}

async function resolveListUrl(page, appConfig, version) {
  const folderUrl = `https://www.apkmirror.com/apk/${appConfig.org}/${appConfig.slug}`;

  if (version === "latest") {
    await page.goto(folderUrl + "/", { waitUntil: "domcontentloaded" });
    
    // Cloudflare bekleme (Basit bekleme, sayfa tamamen yüklenmemişse)
    await page.waitForTimeout(3000);

    const latestData = await page.evaluate(() => {
      // APKMirror arayüzü bazen farklı div'ler kullanıyor. Genel bir Arama yapalım.
      const links = Array.from(document.querySelectorAll("a.fontBlack"));
      for(let link of links) {
         if (link.href.includes("-release/")) {
            const text = link.innerText;
            const match = text.match(/([\d\.]+)/);
            const actualVer = match ? match[1] : "latest";
            return { url: link.href, version: actualVer };
         }
      }
      return null;
    });
    
    if (latestData) return latestData;
    throw new Error("No latest version found on listing page");
  }

  const versionSlug = toApkMirrorVersion(version);
  const namePart = appConfig.releaseSlug || appConfig.slug;

  const candidates = [
    `${folderUrl}/${namePart}-${versionSlug}-release/`,
    `${folderUrl}/${namePart}-${versionSlug}-release-0-release/`,
    `${folderUrl}/${namePart}-${versionSlug}-beta-0-release/`,
    `${folderUrl}/${namePart}-${versionSlug}-beta-1-release/`
  ];

  for (const candidate of candidates) {
    if (await pageExists(page, candidate)) return { url: candidate, version: version };
  }

  throw new Error(`No APKMirror release page found for version ${version}`);
}

async function downloadApk(version, appName, forceBuild = null) {
  // Headless mode "new" (eğer destekliyorsa) bot algılamasını daha iyi atlatır, şimdilik args ile idare edelim.
  const browser = await chromium.launch({
    headless: true,
    args: [
        "--no-sandbox", 
        "--disable-setuid-sandbox", 
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage"
    ]
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.navigator.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  });

  const page = await context.newPage();
  let actualVersion = version;

  try {
    const appConfig = APP_SITES[appName];
    if (!appConfig) throw new Error(`Unknown appName ${appName}`);

    console.log(`🔍 Resolving APKMirror URL for ${appName} (${version})...`);
    const listData = await resolveListUrl(page, appConfig, version);
    actualVersion = listData.version;

    console.log(`🌐 Navigating to release page: ${listData.url}`);
    await page.goto(listData.url, { waitUntil: "domcontentloaded" });
    
    // Sabit bekleme süresi eklendi (Cloudflare/JS Yüklenmesi için)
    await page.waitForTimeout(5000); 

    // Timeout hatasını önlemek için elementi beklemek yerine sayfayı sorguluyoruz
    const variantUrl = await page.evaluate(({ targetBuild, app }) => {
      const rows = document.querySelectorAll(".table-row");
      if(!rows || rows.length === 0) return null;

      let standaloneNodpi = null;
      let standaloneAnyDpi = null;
      let bundleNodpi = null;
      let bundleAnyDpi = null;
      const allowedArchs = ["universal", "evrensel", "noarch", "arm64-v8a", "arm64-v8a + armeabi-v7a", "arm64-v8a + armeabi"];

      for (const row of rows) {
        const cells = row.querySelectorAll(".table-cell");
        if (cells.length < 4) continue;
        const link = cells[0].querySelector("a.accent_color");
        if (!link) continue;
        if (targetBuild && !cells[0].innerText.includes(targetBuild)) continue;

        const badge = cells[0].querySelector(".apkm-badge");
        const isBundle = badge ? (badge.innerText.toUpperCase().includes("BUNDLE") || badge.innerText.toUpperCase().includes("PAKET")) : false;
        
        if (app === "instagram" && !isBundle) continue;

        const archText = cells[1].innerText.trim().toLowerCase();
        const dpiText = cells[3].innerText.trim().toLowerCase();

        const isTargetArch = archText === "" || allowedArchs.some(arch => archText.includes(arch));
        const isTargetDpi = dpiText === "" || dpiText.includes("nodpi") || dpiText.includes("anydpi") || /\d+-640dpi/.test(dpiText);

        if (isTargetArch && isTargetDpi) {
          if (!isBundle) {
            if (dpiText.includes("nodpi")) standaloneNodpi = link.href;
            else standaloneAnyDpi = link.href;
          } else {
            if (dpiText.includes("nodpi")) bundleNodpi = link.href;
            else bundleAnyDpi = link.href;
          }
        }
      }
      return standaloneNodpi || standaloneAnyDpi || bundleNodpi || bundleAnyDpi;
    }, { targetBuild: forceBuild, app: appName });

    if (!variantUrl) throw new Error("No matching variant found on APKMirror (Timeout or no matching arch/dpi)");

    console.log(`➡️ Found Variant URL: ${variantUrl}`);
    await page.goto(variantUrl, { waitUntil: "domcontentloaded" });
    
    await page.waitForTimeout(4000); // İndirme butonunun render olmasını bekle
    
    // a.downloadButton beklemek yerine sayfa içinde arayalım
    const downloadButtonExists = await page.$("a.downloadButton").catch(() => null);
    if(!downloadButtonExists) throw new Error("Download button not found on variant page");

    const outDir = path.resolve(__dirname, "..", "downloads");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const downloadPromise = page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
    await page.click("a.downloadButton");

    let download = await downloadPromise;

    if (!download) {
      console.log("⚠️ Main download button click failed, trying fallback link...");
      const fallbackUrl = await page.$eval("#download-link", (el) => el.href).catch(() => null);
      if (!fallbackUrl) throw new Error("Fallback download link could not be resolved.");
      
      const page2 = await context.newPage();
      const downloadPromise2 = page2.waitForEvent("download", { timeout: 60000 });
      await page2.goto(fallbackUrl, { waitUntil: "domcontentloaded" });
      download = await downloadPromise2;
      await page2.close();
    }

    const fileName = download.suggestedFilename();
    const filePath = path.join(outDir, fileName);
    await download.saveAs(filePath);

    return { filePath: filePath, actualVersion: actualVersion };

  } finally {
    await browser.close();
  }
}

module.exports = { downloadApk };
