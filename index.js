const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const { downloadLatestGithubAsset } = require("./lib/github");
const { extractYoutubeVersions, pickLatestVersion } = require("./lib/versions");
const { downloadApk } = require("./lib/apkmirror");
const { patchApk } = require("./lib/patcher");
const { ensureRelease, uploadPatchedApk } = require("./lib/release");

const DISPLAY_NAMES = {
  "github": "GitHub",
  "niagara": "Niagara Launcher",
  "pydroid": "PyDroid3",
  "smartlauncher": "Smart Launcher",
  "wps": "WPS Office",
  "gboard": "Gboard",
  "speedtest": "Speedtest",
  "solidexplorer": "Solid Explorer"
};

const APPS_CONFIG = {
  "github": {
    pkg: "com.github.android",
    name: "github",
    patchSource: "morphe",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/github/ffffff",
    exclude: [],
    enable: []
  },
  "niagara": {
    pkg: "bitpit.launcher",
    name: "niagara",
    patchSource: "morphe",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/android/3DDC84",
    exclude: [],
    enable: []
  },
  "pydroid": {
    pkg: "ru.iiec.pydroid3",
    name: "pydroid",
    patchSource: "morphe",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/python/3776AB",
    exclude: [],
    enable: []
  },
  "smartlauncher": {
    pkg: "ginlemon.flowerfree",
    name: "smartlauncher",
    patchSource: "morphe",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/android/3DDC84",
    exclude: [],
    enable: []
  },
  "wps": {
    pkg: "cn.wps.moffice_eng",
    name: "wps",
    patchSource: "morphe",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/wps/FF0000",
    exclude: [],
    enable: []
  },
  "gboard": {
    pkg: "com.google.android.inputmethod.latin",
    name: "gboard",
    patchSource: "adobo",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/gboard/4285F4",
    exclude: [],
    enable: [
      "Enable voice typing in incognito",
      "Enable key shape selection",
      "Enable clipboard in incognito",
      "Enable access points menu redesign",
      "Enable Undo feature",
      "Enable OCR feature",
      "Always-incognito mode"
    ]
  },
  "speedtest": {
    pkg: "org.zwanoo.android.speedtest",
    name: "speedtest",
    patchSource: "xtra",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/speedtest/000000",
    exclude: [],
    enable: [],
    forceLatest: true
  },
  "solidexplorer": {
    pkg: "pl.solidexplorer2",
    name: "solidexplorer",
    patchSource: "xtra",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/android/3DDC84",
    exclude: [],
    enable: []
  }
};

async function processApp(appKey, desktop, patches) {
  const config = APPS_CONFIG[appKey];
  let selectedVersion = config.forceVersion;

  if (!selectedVersion && config.forceLatest) {
    selectedVersion = "latest";
  } else if (!selectedVersion) {
    const output = execSync(
      `java -jar "${desktop}" list-versions -f ${config.pkg} --patches="${patches}" --include-experimental`,
      { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 }
    );

    const versions = extractYoutubeVersions(output);
    if (!versions.length) return null;
    selectedVersion = pickLatestVersion(versions);
  }

  if (!selectedVersion) return null;

  let apkPath = await downloadApk(selectedVersion, config.name, config.forceBuild);

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

  const appDisplayName = DISPLAY_NAMES[appKey] || config.name;
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

    const patchesPool = { morphe: null, adobo: null, xtra: null };
    let notes = { morphe: "", adobo: "", xtra: "" };

    const targetApp = process.env.TARGET_APP || "all";
    const appsToProcess = targetApp === "all" ? Object.keys(APPS_CONFIG) : [targetApp];

    if (appsToProcess.some(k => APPS_CONFIG[k].patchSource === "morphe")) {
      const mpp = await downloadLatestGithubAsset({
        owner: "hoo-dles",
        repo: "morphe-patches",
        prerelease: true,
        match: (n) => n.endsWith(".mpp"),
      });
      patchesPool.morphe = mpp.name;
      notes.morphe = `<details><summary><b>hoo-dles Release Notes</b></summary><br>${mpp.body}</details>`;
    }

    if (appsToProcess.some(k => APPS_CONFIG[k].patchSource === "adobo")) {
      const mpp = await downloadLatestGithubAsset({
        owner: "jkennethcarino",
        repo: "adobo",
        prerelease: true,
        match: (n) => n.endsWith(".mpp"),
      });
      patchesPool.adobo = mpp.name;
      notes.adobo = `<details><summary><b>Adobo Release Notes</b></summary><br>${mpp.body}</details>`;
    }

    if (appsToProcess.some(k => APPS_CONFIG[k].patchSource === "xtra")) {
      const mpp = await downloadLatestGithubAsset({
        owner: "BholeyKaBhakt",
        repo: "android-patches-xtra",
        prerelease: false,
        match: (n) => n.endsWith(".mpp"),
      });
      patchesPool.xtra = mpp.name;
      notes.xtra = `<details><summary><b>Xtra Release Notes</b></summary><br>${mpp.body}</details>`;
    }

    const patchedApksList = [];

    for (const appKey of appsToProcess) {
      try {
        console.log(`\n⏳ Isleniyor: ${APPS_CONFIG[appKey].name.toUpperCase()}`);
        const result = await processApp(appKey, desktop, patchesPool[APPS_CONFIG[appKey].patchSource]);
        
        if (result) {
          patchedApksList.push(result);
          console.log(`✅ Basarili: ${APPS_CONFIG[appKey].name}`);
        } else {
          console.log(`⚠️ Atlandi: ${APPS_CONFIG[appKey].name}`);
        }
      } catch (err) {
        console.error(`❌ BASARISIZ (${APPS_CONFIG[appKey].name}): ${err.message}`);
      }
    }

    if (patchedApksList.length > 0) {
      const date = new Date();
      const tagDateStr = date.toISOString().replace(/[:.]/g, "-").split("T")[0];
      const releaseTag = `build-${tagDateStr}`;
      const releaseName = `Custom Builds (${tagDateStr})`;

      let unifiedReleaseBody = `### Latest Patched APKs\n\n`;
      for (const apk of patchedApksList) {
        unifiedReleaseBody += `* <img src="${apk.icon}" width="16" height="16"> **${apk.displayName}** (${apk.version})\n`;
      }
      unifiedReleaseBody += `\n---\n\n`;
      if (notes.morphe) unifiedReleaseBody += notes.morphe;
      if (notes.adobo) unifiedReleaseBody += notes.adobo;
      if (notes.xtra) unifiedReleaseBody += notes.xtra;

      const release = await ensureRelease("latest", releaseName, unifiedReleaseBody);

      for (const apk of patchedApksList) {
        await uploadPatchedApk(release, apk.path);
      }
    }
  } catch (err) {
    process.exit(1);
  }
})();
