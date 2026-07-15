const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const { downloadLatestGithubAsset } = require("./lib/github");
const { extractYoutubeVersions, pickLatestVersion } = require("./lib/versions");
const { downloadApk } = require("./lib/apkmirror");
const { downloadFromUptodown } = require("./lib/uptodown");
const { patchApk } = require("./lib/patcher");
const { uploadApkRelease } = require("./lib/release");

const APPS_CONFIG = {
  "youtube": {
    pkg: "com.google.android.youtube",
    name: "youtube"
  },
  "youtube-music": {
    pkg: "com.google.android.apps.youtube.music",
    name: "youtube-music"
  },
  "reddit": {
    pkg: "com.reddit.frontpage",
    name: "reddit"
  }
};

async function processApp(appKey, desktop, patches, patchReleaseBody) {
  const config = APPS_CONFIG[appKey];
  console.log(`\n📦 PROCESSING APP: ${config.name.toUpperCase()} (${config.pkg})`);

  console.log(`⬇️ Extracting versions for ${config.name}...`);
  const output = execSync(
    `java -jar "${desktop}" list-versions -f ${config.pkg} --patches="${patches}" --include-experimental`,
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10,
    }
  );

  const versions = extractYoutubeVersions(output);

  if (!versions.length) {
    console.error(`⚠️ No versions found for ${config.name}`);
    return;
  }

  console.log(`📋 ALL VERSIONS FOR ${config.name.toUpperCase()}:`);
  versions.forEach((v) => console.log(" -", v));

  const selectedVersion = pickLatestVersion(versions);
  if (!selectedVersion) {
    console.error(`⚠️ Failed to pick latest version for ${config.name}`);
    return;
  }

  console.log(`\n➡️ TARGET VERSION: ${selectedVersion}`);

  let apkPath;
  try {
    console.log("🌐 SOURCE: APKMirror");
    // İndirme fonksiyonuna config.name değerini açıkça ikinci parametre olarak gönderiyoruz
    apkPath = await downloadApk(selectedVersion, config.name);
  } catch (apkMirrorError) {
    console.log("❌ APKMIRROR FAIL:", apkMirrorError.message);
    console.log("🔁 FALLBACK: Uptodown");
    try {
      apkPath = await downloadFromUptodown(selectedVersion, config.name);
    } catch (uptodownError) {
      console.log("❌ UPTODOWN FAIL:", uptodownError.message);
      console.error(`❌ All sources failed for ${config.name}`);
      return;
    }
  }

  console.log("📦 APK DOWNLOADED:", apkPath);
  console.log("⬇ -> PATCHING STARTED...");

  const actualPatched = patchApk(desktop, patches, apkPath);
  console.log("📦 PATCHED APK PATH:", actualPatched);

  if (!fs.existsSync(actualPatched)) {
    console.error(`❌ Patched APK not found: ${actualPatched}`);
    return;
  }

  const finalName = `${config.name}-${selectedVersion}-morphe.apk`;
  const finalPath = path.join(process.cwd(), finalName);
  fs.copyFileSync(actualPatched, finalPath);

  console.log("📝 FINAL OUTPUT PATH:", finalPath);
  console.log("🚀 UPLOADING TO GITHUB RELEASE...");

  await uploadApkRelease({
    version: `${config.name}-${selectedVersion}`,
    apkPath: finalPath,
    releaseBody: patchReleaseBody
  });

  console.log(`🎉 COMPLETED: ${config.name.toUpperCase()}\n`);
}

(async () => {
  try {
    console.log("🚀 START MULTI-APP PATCHER\n");

    console.log("🌐 FETCH: morphe-desktop");
    const desktopObj = await downloadLatestGithubAsset({
      owner: "MorpheApp",
      repo: "morphe-desktop",
      match: (n) => n.includes("desktop") && n.endsWith(".jar"),
    });
    const desktop = desktopObj.name;

    console.log("🌐 FETCH: morphe-patches");
    const patchesObj = await downloadLatestGithubAsset({
      owner: "MorpheApp",
      repo: "morphe-patches",
      prerelease: true,
      match: (n) => n.endsWith(".mpp"),
    });
    const patches = patchesObj.name;

    const patchReleaseBody = `### Morphe Yaması Sürüm Notları (${patchesObj.tag})\n\n${patchesObj.body}`;

    const targetApp = process.env.TARGET_APP || "all";
    let appsToProcess = [];

    if (targetApp === "all") {
      appsToProcess = Object.keys(APPS_CONFIG);
    } else if (APPS_CONFIG[targetApp]) {
      appsToProcess = [targetApp];
    } else {
      throw new Error(`Unknown target app: ${targetApp}`);
    }

    for (const appKey of appsToProcess) {
      await processApp(appKey, desktop, patches, patchReleaseBody);
    }

    console.log("🏁 ALL PROCESSES FINISHED SUCCESSFULLY");
  } catch (err) {
    console.error("\n❌ GLOBAL ERROR:", err.message);
    process.exit(1);
  }
})();
