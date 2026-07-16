const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { toApkMirrorVersion } = require("./versions");

const APP_SITES = {
  "youtube": { org: "google-inc", slug: "youtube" },
  "youtube-music": { org: "google-inc", slug: "youtube-music" },
  "reddit": { org: "reddit-inc", slug: "reddit" },
  "twitter": { org: "x-corp", slug: "twitter", releaseSlug: "x" },
  "instagram": { org: "instagram", slug: "instagram" }
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const BOT_BLOCK_MARKERS = [
  "just a moment",
  "attention required",
  "access denied",
  "checking your browser",
  "cf-challenge",
  "captcha"
];

async function pageExists(page, url) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => null);
  if (!res) {
    console.log("   ↳ navigation failed (network error)");
    return false;
  }
  if (res.status() === 404) {
    console.log("   ↳ 404 Not Found");
    return false;
  }

  const hasRows = await page.$(".table-row").catch(() => null);
  if (hasRows) return true;

  const title = await page.title().catch(() => "");
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 200) || "").catch(() => "");
  const combined = `${title} ${bodyText}`.toLowerCase();
  const looksBlocked = BOT_BLOCK_MARKERS.some(marker => combined.includes(marker));

  if (looksBlocked) {
    console.log(`   ↳ ⚠️ Possible bot-protection page detected (status ${res.status()}, title: "${title}")`);
  } else {
    console.log(`   ↳ No .table-row found (status ${res.status()}, title: "${title}")`);
  }

  return false;
}

async function resolveListUrl(page, appConfig, version) {
  const versionSlug = toApkMirrorVersion(version);
  const namePart = appConfig.releaseSlug || appConfig.slug;
  const folderUrl = `https://www.apkmirror.com/apk/${appConfig.org}/${appConfig.slug}`;

  const candidates = [
    `${folderUrl}/${namePart}-${versionSlug}-release/`,
    `${folderUrl}/${namePart}-${versionSlug}-release-0-release/`,
    `${folderUrl}/${namePart}-${versionSlug}-beta-0-release/`,
    `${folderUrl}/${namePart}-${versionSlug}-beta-1-release/`
  ];

  for (const candidate of candidates) {
    console.log("🔎 TRY:", candidate);
    if (await pageExists(page, candidate)) return candidate;
    await sleep(1500);
  }

  console.log("⚠️ No direct match, scanning app listing page...");
  const listingUrl = `${folderUrl}/`;
  await page.goto(listingUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  // First pass: match by URL slug (works for apps like YouTube/Twitter where
  // the version number appears cleanly in the release page URL)
  const slugMatch = await page.evaluate((slugPart) => {
    const links = Array.from(document.querySelectorAll("a[href*='-release/']"));
    const match = links.find(a => a.getAttribute("href").includes(slugPart));
    return match ? match.href : null;
  }, `-${versionSlug}-`);

  if (slugMatch) return slugMatch;

  // Second pass: some apps (e.g. Instagram) reuse the same visible version
  // number across many separate uploads/builds, and the release page URL is
  // NOT based on the version number at all. In that case, match by the
  // VISIBLE version text on the listing page instead of the URL, and among
  // matches prefer the entry with the most splits (the full multi-arch
  // bundle), since that's what Morphe recommends by default.
  console.log("⚠️ Slug match failed, scanning by visible version text...");

  const textCandidates = await page.evaluate((versionText) => {
    const anchors = Array.from(document.querySelectorAll("a[href*='-release/']"));
    const seen = new Set();
    const results = [];

    for (const a of anchors) {
      const row = a.closest("div, li, tr") || a.parentElement;
      const text = row ? row.innerText : a.innerText;
      if (!text || !text.includes(versionText)) continue;
      if (seen.has(a.href)) continue;
      seen.add(a.href);

      const splitMatch = text.match(/(\d+)\s*S\b/);
      const splits = splitMatch ? parseInt(splitMatch[1], 10) : 1;
      results.push({ href: a.href, splits, snippet: text.replace(/\s+/g, " ").slice(0, 80) });
    }

    return results;
  }, version);

  if (textCandidates.length > 0) {
    textCandidates.sort((a, b) => b.splits - a.splits);
    console.log(`   ↳ Found ${textCandidates.length} candidate(s) for version ${version}:`);
    textCandidates.forEach(c => console.log(`      - splits=${c.splits} | ${c.snippet} | ${c.href}`));
    console.log(`   ↳ Picking highest-split entry: ${textCandidates[0].href}`);
    return textCandidates[0].href;
  }

  throw new Error(`No APKMirror release page found for version ${version}`);
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
