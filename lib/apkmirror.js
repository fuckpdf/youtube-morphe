const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { toApkMirrorVersion } = require("./versions");

const APP_SITES = {
  "youtube": { org: "google-inc", slug: "youtube" },
  "youtube-music": { org: "google-inc", slug: "youtube-music" },
  "reddit": { org: "reddit-inc", slug: "reddit" },
  "twitter": { org: "x-corp", slug: "twitter" }
};

async function pageExists(page, url) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => null);
  if (!res || res.status() === 404) return false;
  const hasRows = await page.$(".table-row").catch(() => null);
  return !!hasRows;
}

async function resolveListUrl(page, appConfig, version) {
  const versionSlug = toApkMirrorVersion(version);
  const baseCandidate = `https://www.apkmirror.com/apk/${appConfig.org}/${appConfig.slug}/${appConfig.slug}-${versionSlug}-release/`;

  const candidates = [
    baseCandidate,
    `https://www.apkmirror.com/apk/${appConfig.org}/${appConfig.slug}/${appConfig.slug}-${versionSlug}-release-0-release/`,
    `https://www.apkmirror.com/apk/${appConfig.org}/${appConfig.slug}/${appConfig.slug}-${versionSlug}-beta-0-release/`,
    `https://www.apkmirror.com/apk/${appConfig.org}/${appConfig.slug}/${appConfig.slug}-${versionSlug}-beta-1-release/`
  ];

  for (const candidate of candidates) {
    console.log("🔎 TRY:", candidate);
    if (await pageExists(page, candidate)) return candidate;
  }

  console.log("⚠️ No direct match, scanning app listing page...");
  const listingUrl = `https://www.apkmirror.com/apk/${appConfig.org}/${appConfig.slug}/`;
  await page.goto(listingUrl, { waitUntil: "domcontentloaded" });

  const foundUrl = await page.evaluate((slugPart) => {
    const links = Array.from(document.querySelectorAll("a[href*='-release/']"));
    const match = links.find(a => a.getAttribute("href").includes(slugPart));
    return match ? match.href : null;
  }, `-${versionSlug}-`);

  if (!foundUrl) {
    throw new Error(`No APKMirror release page found for version ${version}`);
  }

  return foundUrl;
}

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
    const appConfig = APP_SITES[appName];
    if (!appConfig) {
      throw new Error(`Unknown appName "${appName}" - not found in APP_SITES`);
    }

    const listUrl = await resolveListUrl(page, appConfig, version);
    console.log("🌐 LIST:", listUrl);

    await page.goto(listUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".table-row");

    const variantUrl = await page.evaluate(() => {
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

        const badge = cells[0].querySelector(".apkm-badge");
        const isBundle = badge ? (badge.innerText.toUpperCase().includes("BUNDLE") || badge.innerText.toUpperCase().includes("PAKET")) : false;

        const archText = cells[1].innerText.trim().toLowerCase();
        const dpiText = cells[3].innerText.trim().toLowerCase();

        const isTargetArch = archText === "" || allowedArchs.some(arch => archText.includes(arch));

        const isTargetDpi = dpiText === "" ||
                            dpiText.includes("nodpi") ||
                            dpiText.includes("anydpi") ||
                            /\d+-640dpi/.test(dpiText);

        if (isTargetArch && isTargetDpi) {
          if (!isBundle) {
            if (dpiText.includes("nodpi")) {
              standaloneNodpi = link.href;
            } else {
              standaloneAnyDpi = link.href;
            }
          } else {
            if (dpiText.includes("nodpi")) {
              bundleNodpi = link.href;
            } else {
              bundleAnyDpi = link.href;
            }
          }
        }
      }

      return standaloneNodpi || standaloneAnyDpi || bundleNodpi || bundleAnyDpi;
    });

    if (!variantUrl) throw new Error("No matching variant found on APKMirror");

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
