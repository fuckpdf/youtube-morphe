const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { toApkMirrorVersion } = require("./versions");

const APP_SITES = {
  "youtube": { org: "google-inc", slug: "youtube" },
  "youtube-music": { org: "google-inc", slug: "youtube-music" },
  "reddit": { org: "reddit-inc", slug: "reddit" }
};

async function downloadApk(version, appName = "youtube") {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"]
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36"
  });

  const page = await context.newPage();

  try {
    const appConfig = APP_SITES[appName] || APP_SITES["youtube"];
    const versionSlug = toApkMirrorVersion(version);

    // Reddit için de filtreyi kaldırıp ana listeye temiz gidiyoruz
    const listUrl = `https://www.apkmirror.com/apk/${appConfig.org}/${appConfig.slug}/${appConfig.slug}-${versionSlug}-release/`;
    console.log("🌐 LIST:", listUrl);

    await page.goto(listUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".table-row");

    const variantUrl = await page.evaluate(() => {
      const rows = document.querySelectorAll(".table-row");
      let standaloneNodpi = null;
      let standaloneAnyDpi = null;
      let bundleNodpi = null;
      let bundleAnyDpi = null;

      for (const row of rows) {
        const cells = row.querySelectorAll(".table-cell");
        if (cells.length < 5) continue;

        const arch = cells[1].innerText.toLowerCase();
        const dpi = cells[3].innerText.toLowerCase();
        const isBundle = row.innerText.toLowerCase().includes("bundle") || 
                         row.innerText.toLowerCase().includes("paket");

        const isTargetArch = arch === "" ||
                             arch.includes("universal") || 
                             arch.includes("evrensel") || 
                             arch.includes("noarch") || 
                             arch.includes("arm64-v8a");

        if (isTargetArch) {
          const a = cells[0].querySelector("a.accent_color");
          if (a) {
            if (!isBundle) {
              // Öncelik 1: Düz APK + nodpi
              if (dpi.includes("nodpi")) {
                standaloneNodpi = a.href;
              } else {
                standaloneAnyDpi = a.href;
              }
            } else {
              // Öncelik 2: Eğer düz APK yoksa Bundle (Paket) havuzuna ekle
              if (dpi.includes("nodpi")) {
                bundleNodpi = a.href;
              } else {
                bundleAnyDpi = a.href;
              }
            }
          }
        }
      }

      // En kaliteliden en çaresize doğru hiyerarşik seçim yapıyoruz
      return standaloneNodpi || standaloneAnyDpi || bundleNodpi || bundleAnyDpi;
    });

    if (!variantUrl) throw new Error("No variant found on APKMirror");

    console.log("➡️ VARIANT:", variantUrl);

    await page.goto(variantUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.downloadButton");

    const outDir = path.resolve(__dirname, "..", "downloads");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const downloadPromise = page.waitForEvent("download").catch(() => null);

    console.log("⬇️ Clicking main download...");
    await page.click("a.downloadButton");

    let download = await downloadPromise;

    if (!download) {
      console.log("⚠️ Main download failed → fallback link");
      const fallbackUrl = await page.$eval("#download-link", (el) => el.href);
      const page2 = await context.newPage();
      const downloadPromise2 = page2.waitForEvent("download");
      await page2.goto(fallbackUrl, { waitUntil: "domcontentloaded" });
      download = await downloadPromise2;
      await page2.close();
    }

    const fileName = download.suggestedFilename();
    const filePath = path.join(outDir, fileName);
    await download.saveAs(filePath);

    console.log("📦 DONE:", filePath);
    return filePath;

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    throw err;
  } finally {
    await browser.close();
  }
}

module.exports = { downloadApk };
