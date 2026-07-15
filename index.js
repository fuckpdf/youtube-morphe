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

async function processApp(appKey, desktop, patches) {
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
    return null;
  }

  console.log(`📋 ALL VERSIONS FOR ${config.name.toUpperCase()}:`);
  versions.forEach((v) => console.log(" -", v));

  const selectedVersion = pickLatestVersion(versions);
  if (!selectedVersion) {
    console.error(`⚠️ Failed to pick latest version for ${config.name}`);
    return null;
  }

  console.log(`\n➡️ TARGET VERSION: ${selectedVersion}`);

  let apkPath;
  try {
    console.log("🌐 SOURCE: APKMirror");
    apkPath = await downloadApk(selectedVersion, config.name);
  } catch (apkMirrorError) {
    console.log("❌ APKMIRROR FAIL:", apkMirrorError.message);
    console.log("🔁 FALLBACK: Uptodown");
    try {
      apkPath = await downloadFromUptodown(selectedVersion, config.name);
    } catch (uptodownError) {
      console.log("❌ UPTODOWN FAIL:", uptodownError.message);
      console.error(`❌ All sources failed for ${config.name}`);
      return null;
    }
  }

  console.log("📦 APK DOWNLOADED:", apkPath);
  console.log("⬇ -> PATCHING STARTED...");

  const actualPatched = patchApk(desktop, patches, apkPath);
  console.log("📦 PATCHED APK PATH:", actualPatched);

  if (!fs.existsSync(actualPatched)) {
    console.error(`❌ Patched APK not found: ${actualPatched}`);
    return null;
  }

  const finalName = `${config.name}-${selectedVersion}-morphe.apk`;
  const finalPath = path.join(process.cwd(), finalName);
  fs.copyFileSync(actualPatched, finalPath);

  console.log("📝 FINAL OUTPUT PREPARED:", finalPath);
  return {
    name: finalName,
    path: finalPath,
    version: selectedVersion
  };
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

    const targetApp = process.env.TARGET_APP || "all";
    let appsToProcess = [];

    if (targetApp === "all") {
      appsToProcess = Object.keys(APPS_CONFIG);
    } else if (APPS_CONFIG[targetApp]) {
      appsToProcess = [targetApp];
    } else {
      throw new Error(`Unknown target app: ${targetApp}`);
    }

    const patchedApksList = [];

    // 1. AŞAMAMIZ: Tüm uygulamaları sırayla sunucu üzerinde yamayıp listeye ekliyoruz
    for (const appKey of appsToProcess) {
      const result = await processApp(appKey, desktop, patches);
      if (result) {
        patchedApksList.push(result);
      }
    }

    // 2. AŞAMAMIZ: Eğer başarılı derlenen uygulama varsa tek bir ortak sürüm altında toplu yayınlıyoruz
    if (patchedApksList.length > 0) {
      console.log("\n🚀 ALL APKS PATCHED SUCCESSFULLY. STARTING BATCH UPLOAD...");

      // Sürüm notlarının açıklamasına derlenen uygulamaların isimlerini ve versiyonlarını dinamik ekliyoruz
      let customReleaseBody = `### 📦 Derlenen Uygulama Sürümleri\n`;
      patchedApksList.forEach(apk => {
        customReleaseBody += `* **${apk.name.split('-')[0].toUpperCase()}**: v${apk.version}\n`;
      });
      customReleaseBody += `\n---\n### Morphe Temel Sürüm Notları (${patchesObj.tag})\n\n${patchesObj.body}`;

      // Ortak etiket (tag) olarak Morphe'nin kendi yama sürümünü kullanıyoruz (Örn: 1.35.0-dev.5)
      const commonTag = patchesObj.tag;

      // Kütüphanemizin yapısını bozmamak için döngüyle dosyaları tek tek aynı sürümün içine gönderiyoruz
      for (const apk of patchedApksList) {
        console.log(`📤 Uploading ${apk.name} to shared release ${commonTag}...`);
        await uploadApkRelease({
          version: commonTag,
          apkPath: apk.path,
          releaseBody: customReleaseBody
        });
      }

      console.log("\n🎉 ALL PROCESSES FINISHED SUCCESSFULLY. SINGLE CATEGORY RELEASE DONE!");
    } else {
      console.error("\n❌ No APKs were successfully patched. Skipping upload.");
    }

  } catch (err) {
    console.error("\n❌ GLOBAL ERROR:", err.message);
    process.exit(1);
  }
})();
