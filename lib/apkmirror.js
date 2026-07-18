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
  if (!res || res.status() === 404) return false;
  const hasRows = await page.$(".table-row").catch(() => null);
  return !!hasRows;
}

async function resolveListUrl(page, appConfig, version) {
  const folderUrl = `https://www.apkmirror.com/apk/${appConfig.org}/${appConfig.slug}`;

  if (version === "latest") {
    await page.goto(folderUrl + "/", { waitUntil: "domcontentloaded" });
    const latestData = await page.evaluate(() => {
      const link = document.querySelector(".listWidget .appRow a.fontBlack");
      if (link && link.href.includes("-release/")) {
        const text = link.innerText;
        const match = text.match(/([\d\.]+)/);
        const actualVer = match ? match[1] : "latest";
        return { url: link.href, version: actualVer };
      }
      return null;
    });
    
    if (latestData) return latestData;
    throw new Error("No latest version found");
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

  const listingUrl = `${folderUrl}/`;
  await page.goto(listingUrl, { waitUntil: "domcontentloaded" });

  const foundUrl = await page.evaluate((slugPart) => {
    const links = Array.from(document.querySelectorAll("a[href*='-release/']"));
    const match = links.find(a => a.getAttribute("href").includes(slugPart));
    return match ? match.href : null;
  }, `-${versionSlug}-`);

  if (!foundUrl) {
    throw new Error(`No APKMirror release page found for version ${version}`);
  }

  return { url: foundUrl, version: version };
}

async function downloadApk(version, appName, forceBuild = null) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
  });

  const page = await context.newPage();
  let actualVersion = version;

  try {
    const appConfig = APP_SITES[appName];
    if (!appConfig) throw new Error(`Unknown appName ${appName}`);

    const listData = await resolveListUrl(page, appConfig, version);
    actualVersion = listData.version;

    await page.goto(listData.url, { waitUntil: "domcontentloaded" });
    
    await page.waitForSelector(".table-row", { timeout: 45000 }); 

    const variantUrl = await page.evaluate(({ targetBuild, app }) => {
      const rows = document.querySelectorAll(".table-row");
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
        
        if (app === "instagram" && !isBundle) {
          continue;
        }

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

    if (!variantUrl) throw new Error("No matching variant found on APKMirror");

    await page.goto(variantUrl, { waitUntil: "domcontentloaded" });
    
    await page.waitForSelector("a.downloadButton", { timeout: 45000 });

    const outDir = path.resolve(__dirname, "..", "downloads");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const downloadPromise = page.waitForEvent("download").catch(() => null);
    await page.click("a.downloadButton");

    let download = await downloadPromise;

    if (!download) {
      const fallbackUrl = await page.$eval("#download-link", (el) => el.href).catch(() => null);
      if (!fallbackUrl) throw new Error("Download link could not be resolved.");
      
      const page2 = await context.newPage();
      const downloadPromise2 = page2.waitForEvent("download");
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
