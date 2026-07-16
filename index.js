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

  const appDisplayName = DISPLAY_NAMES[config.name] || config.name;
  const finalName = `${appDisplayName}-${selectedVersion}.apk`;
  const finalPath = path.join(process.cwd(), finalName);
  
  fs.copyFileSync(actualPatched, finalPath);

  return { 
    appName: config.name, 
    displayName: appDisplayName,
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
    let morpheNotes = "";
    let pikoNotes = "";

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
      
      morpheNotes = `
<details>
<summary>🟢 <b>Morphe Release Notes (${morpheMpp.tag})</b></summary>
<br>

${morpheMpp.body}

</details>
`;
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
      
      pikoNotes = `
<details>
<summary>✖️ <b>Piko Release Notes (${pikoMpp.tag})</b></summary>
<br>

${pikoMpp.body}

</details>
`;
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
      for (const apk of patchedApksList) {
        const releaseTag = `${apk.displayName}-${apk.version}`;
        const releaseName = `${apk.displayName} v${apk.version}`;
        
        let customReleaseBody = `### 📦 ${apk.displayName} Update\n\n`;
        customReleaseBody += `* <img src="${apk.icon}" width="16" height="16"> **${apk.displayName}** (${apk.version})\n\n`;
        customReleaseBody += `---\n`;

        if (apk.patchSource === "morphe" && morpheNotes) {
          customReleaseBody += morpheNotes;
        } else if (apk.patchSource === "piko" && pikoNotes) {
          customReleaseBody += pikoNotes;
        }

        const release = await ensureRelease(releaseTag, releaseName, customReleaseBody);
        
        await uploadPatchedApk(release, apk.path);

        if (apk.appName === "youtube" || apk.appName === "youtube-music") {
          await uploadMicroGOnce(release);
        }

        console.log(`✅ Release published for ${apk.displayName}: ${releaseTag}`);
      }
    }
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  }
})();
