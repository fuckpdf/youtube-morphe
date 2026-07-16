const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const { downloadLatestGithubAsset } = require("./lib/github");
const { extractYoutubeVersions, pickLatestVersion } = require("./lib/versions");
const { downloadApk } = require("./lib/apkmirror");
const { downloadFromUptodown } = require("./lib/uptodown");
const { patchApk } = require("./lib/patcher");
const { ensureRelease, uploadPatchedApk, uploadMicroGOnce } = require("./lib/release");

const APPS_CONFIG = {
  "youtube": {
    pkg: "com.google.android.youtube",
    name: "youtube",
    patchSource: "morphe",
    exclude: []
  },
  "youtube-music": {
    pkg: "com.google.android.apps.youtube.music",
    name: "youtube-music",
    patchSource: "morphe",
    exclude: []
  },
  "reddit": {
    pkg: "com.reddit.frontpage",
    name: "reddit",
    patchSource: "morphe",
    exclude: []
  },
  "twitter": {
    pkg: "com.twitter.android",
    name: "twitter",
    patchSource: "piko",
    exclude: ["Dynamic color"],
    enable: ["Bring back twitter", "Disunify xchat system", "Export all activities"]
  },
  "instagram": {
    pkg: "com.instagram.android",
    name: "instagram",
    patchSource: "piko",
    exclude: ["Clone"]
  }
};

async function processApp(appKey, desktop, patches) {
  const config = APPS_CONFIG[appKey];
  console.log(`\n📦 PROCESSING: ${config.name.toUpperCase()}`);

  const output = execSync(
    `java -jar "${desktop}" list-versions -f ${config.pkg} --patches="${patches}" --include-experimental`,
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 }
  );

  const versions = extractYoutubeVersions(output);
  if (!versions.length) return null;

  const selectedVersion = pickLatestVersion(versions);
  if (!selectedVersion) return null;

  let apkPath;
  try {
    apkPath = await downloadApk(selectedVersion, config.name);
  } catch (e) {
    apkPath = await downloadFromUptodown(selectedVersion, config.name);
  }

  let extraArgs = "";
  const argParts = [];
  if (config.exclude && config.exclude.length > 0) {
    argParts.push(...config.exclude.map(p => `--disable "${p}"`));
  }
  if (config.enable && config.enable.length > 0) {
    argParts.push(...config.enable.map(p => `--enable "${p}"`));
  }
  extraArgs = argParts.join(" ");

  const actualPatched = patchApk(desktop, patches, apkPath, extraArgs);

  if (!fs.existsSync(actualPatched)) return null;

  const finalName = `${config.name}-${selectedVersion}-patched.apk`;
  const finalPath = path.join(process.cwd(), finalName);
  fs.copyFileSync(actualPatched, finalPath);

  return { name: finalName, path: finalPath, version: selectedVersion };
}

(async () => {
  try {
    const desktopObj = await downloadLatestGithubAsset({
      owner: "MorpheApp",
      repo: "morphe-desktop",
      match: (n) => n.includes("desktop") && n.endsWith(".jar"),
    });
    const desktop = desktopObj.name;

    const patchesPool = { morphe: null, piko: null };
    let releaseTag = "";
    let releaseBody = "";

    const morpheMpp = await downloadLatestGithubAsset({
      owner: "MorpheApp",
      repo: "morphe-patches",
      prerelease: true,
      match: (n) => n.endsWith(".mpp"),
    });
    patchesPool.morphe = morpheMpp.name;
    releaseTag = morpheMpp.tag;
    releaseBody = morpheMpp.body;

    const pikoMpp = await downloadLatestGithubAsset({
      owner: "crimera",
      repo: "piko",
      prerelease: true,
      match: (n) => n.endsWith(".mpp"),
    });
    patchesPool.piko = pikoMpp.name;

    const targetApp = process.env.TARGET_APP || "all";
    const appsToProcess = targetApp === "all" ? Object.keys(APPS_CONFIG) : [targetApp];
    const patchedApksList = [];

    for (const appKey of appsToProcess) {
      try {
        const result = await processApp(appKey, desktop, patchesPool[APPS_CONFIG[appKey].patchSource]);
        if (result) patchedApksList.push(result);
      } catch (err) {
        console.error(`❌ ${appKey.toUpperCase()} failed, skipping: ${err.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 12000));
    }

    if (patchedApksList.length > 0) {
      let customReleaseBody = `### 📦 Derlenen Uygulamalar\n`;
      patchedApksList.forEach(apk => {
        customReleaseBody += `* **${apk.name.split('-')[0].toUpperCase()}**: v${apk.version}\n`;
      });
      customReleaseBody += `\n---\n### Sürüm Detayları (${releaseTag})\n\n${releaseBody}`;

      const release = await ensureRelease(releaseTag, customReleaseBody);

      for (const apk of patchedApksList) {
        await uploadPatchedApk(release, apk.path);
      }

      await uploadMicroGOnce(release);
      console.log("✅ Release done");
    }
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  }
})();
