const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const { downloadLatestGithubAsset } = require("./lib/github");
const { extractYoutubeVersions, pickLatestVersion } = require("./lib/versions");
const { downloadApk } = require("./lib/apkmirror");
const { patchApk } = require("./lib/patcher");
const { ensureRelease, uploadPatchedApk, uploadMicroGOnce } = require("./lib/release");

const DISPLAY_NAMES = {
  "youtube": "YouTube",
  "youtube-music": "YT.Music",
  "reddit": "Reddit",
  "twitter": "Twitter",
  "instagram": "Instagram"
};

const PATCH_SOURCE_NAMES = {
  "morphe": "Morphe",
  "piko": "Piko"
};

function cleanVersionTag(tag) {
  return (tag || "").replace(/^v/i, "");
}

const APPS_CONFIG = {
  "youtube": {
    pkg: "com.google.android.youtube",
    name: "youtube",
    patchSource: "morphe",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/youtube/FF0000",
    exclude: []
  },
  "youtube-music": {
    pkg: "com.google.android.apps.youtube.music",
    name: "youtube-music",
    patchSource: "morphe",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/youtubemusic/FF0000",
    exclude: []
  },
  "reddit": {
    pkg: "com.reddit.frontpage",
    name: "reddit",
    patchSource: "morphe",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/reddit/FF4500",
    exclude: []
  },
  "twitter": {
    pkg: "com.twitter.android",
    name: "twitter",
    patchSource: "piko",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/x/000000",
    exclude: ["Dynamic color"],
    enable: ["Bring back twitter", "Disunify xchat system", "Export all activities"]
  },
  "instagram": {
    pkg: "com.instagram.android",
    name: "instagram",
    patchSource: "piko",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/instagram/E4405F",
    exclude: [],
    enable: [],
    forceVersion: "435.0.0.37.76",
    forceBuild: "384109456"
  }
};

async function processApp(appKey, desktop, patches) {
  const config = APPS_CONFIG[appKey];
  console.log(`\n📦 PROCESSING: ${config.name.toUpperCase()}`);

  let selectedVersion = config.forceVersion;

  if (!selectedVersion) {
    const output = execSync(
      `java -jar "${desktop}" list-versions -f ${config.pkg} --patches="${patches}" --include-experimental`,
      { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 }
    );

    const versions = extractYoutubeVersions(output);
    if (!versions.length) return null;

    selectedVersion = pickLatestVersion(versions);
  }

  if (!selectedVersion) return null;

  let apkPath;
  try {
    apkPath = await downloadApk(selectedVersion, config.name, config.forceBuild);
  } catch (e) {
    if (appKey === "instagram") {
      console.log(`⚠️ APKMirror failed (${e.message}). Downloading from custom GitHub repo...`);
      const customUrl = "https://github.com/fuckpdf/Depo/releases/download/instagram/instagram.apkm";
      const destPath = path.resolve(process.cwd(), "instagram-base.apkm");
      
      execSync(`curl -L -o "${destPath}" "${customUrl}"`, { stdio: 'inherit' });
      
      if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 1000) {
        throw new Error("Downloaded file from custom repo is invalid.");
      }
      apkPath = destPath;
      console.log(`✅ Instagram base downloaded: ${apkPath}`);
    } else {
      throw e;
    }
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

  const actualPatched = patchApk(desktop, patches, apkPath, extraArgs, config.arch);

  if (!fs.existsSync(actualPatched)) return null;

  const finalName = `${config.name}-${selectedVersion}-patched.apk`;
  const finalPath = path.join(process.cwd(), finalName);
  fs.copyFileSync(actualPatched, finalPath);

  return { 
    appName: config.name, 
    icon: config.icon, 
    patchSource: config.patchSource,
    name: finalName, 
    path: finalPath, 
    version: selectedVersion 
  };
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
    const patchVersions = { morphe: null, piko: null };
    let combinedReleaseNotes = "";
    let mainReleaseTag = "";

    const targetApp = process.env.TARGET_APP || "all";
    const appsToProcess = targetApp === "all" ? Object.keys(APPS_CONFIG) : [targetApp];

    const needsMorphe = appsToProcess.some(k => APPS_CONFIG[k].patchSource === "morphe");
    if (needsMorphe) {
      const morpheMpp = await downloadLatestGithubAsset({
        owner: "MorpheApp",
        repo: "morphe-patches",
        prerelease: true,
        match: (n) => n.endsWith(".mpp"),
      });
      patchesPool.morphe = morpheMpp.name;
      patchVersions.morphe = cleanVersionTag(morpheMpp.tag);
      mainReleaseTag = morpheMpp.tag; 
      combinedReleaseNotes += `\n---\n### 🟢 Morphe Release Notes (${morpheMpp.tag})\n\n${morpheMpp.body}\n`;
    }

    const needsPiko = appsToProcess.some(k => APPS_CONFIG[k].patchSource === "piko");
    if (needsPiko) {
      const pikoMpp = await downloadLatestGithubAsset({
        owner: "crimera",
        repo: "piko",
        prerelease: true,
        match: (n) => n.endsWith(".mpp"),
      });
      patchesPool.piko = pikoMpp.name;
      patchVersions.piko = cleanVersionTag(pikoMpp.tag);
      if (!mainReleaseTag) mainReleaseTag = pikoMpp.tag; 
      combinedReleaseNotes += `\n---\n### ✖️ Piko Release Notes (${pikoMpp.tag})\n\n${pikoMpp.body}\n`;
    }

    const patchedApksList = [];

    for (const appKey of appsToProcess) {
      try {
        const result = await processApp(appKey, desktop, patchesPool[APPS_CONFIG[appKey].patchSource]);
        if (result) patchedApksList.push(result);
      } catch (err) {
        console.error(`❌ ${appKey.toUpperCase()} failed, skipping: ${err.message}`);
      }
    }

    if (patchedApksList.length > 0) {
      let customReleaseBody = `### 📦 Built Applications\n\n`;

      patchedApksList.forEach(apk => {
        const displayName = DISPLAY_NAMES[apk.appName] || apk.appName;
        const patchName = PATCH_SOURCE_NAMES[apk.patchSource] || apk.patchSource;
        const patchVersion = patchVersions[apk.patchSource] || "";
        const fullLabel = `${displayName}-${apk.version}-${patchName}-${patchVersion}`;
        customReleaseBody += `* <img src="${apk.icon}" width="16" height="16"> **${fullLabel}**  \n`;
      });

      customReleaseBody += `\n${combinedReleaseNotes}`;

      const customReleaseName = "Patched APKs Bundle";

      const release = await ensureRelease(mainReleaseTag, customReleaseName, customReleaseBody);

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
