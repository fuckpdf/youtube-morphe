const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const origExecSync = cp.execSync;
cp.execSync = function (cmd, opts) {
  if (typeof cmd === "string" && cmd.includes(" patch ") && cmd.includes(".jar")) {
    try {
      const res = origExecSync(cmd, { ...opts, stdio: "pipe" });
      const out = res ? res.toString() : "";
      process.stdout.write(out);
      if (out.includes("Applying 0 patches")) throw new Error("0 patches applied");
      return res;
    } catch (e) {
      const out = e.stdout ? e.stdout.toString() : "";
      const err = e.stderr ? e.stderr.toString() : "";
      process.stdout.write(out);
      process.stderr.write(err);
      if (out.includes("Applying 0 patches") || err.includes("Applying 0 patches")) {
        throw new Error("0 patches applied");
      }
      throw e;
    }
  }
  return origExecSync(cmd, opts);
};

const origSpawnSync = cp.spawnSync;
cp.spawnSync = function (cmd, args, opts) {
  const full = [cmd, ...(args || [])].join(" ");
  if (full.includes(" patch ") && full.includes(".jar")) {
    const res = origSpawnSync(cmd, args, { ...opts, stdio: "pipe" });
    const out = res.stdout ? res.stdout.toString() : "";
    const err = res.stderr ? res.stderr.toString() : "";
    process.stdout.write(out);
    process.stderr.write(err);
    if (out.includes("Applying 0 patches") || err.includes("Applying 0 patches")) {
      throw new Error("0 patches applied");
    }
    return res;
  }
  return origSpawnSync(cmd, args, opts);
};

const { execSync } = cp;

const { downloadLatestGithubAsset } = require("./lib/github");
const { extractYoutubeVersions, pickLatestVersion } = require("./lib/versions");
const { patchApk } = require("./lib/patcher");
const { ensureRelease, uploadPatchedApk, uploadMicroGOnce } = require("./lib/release");
const apkmirror = require("./lib/apkmirror");
const githubdl = require("./lib/githubdl");

const DISPLAY_NAMES = {
  "youtube": "YouTube",
  "youtube-music": "YT.Music",
  "reddit": "Reddit",
  "twitter": "Twitter",
  "instagram": "Instagram",
  "github": "GitHub",
  "niagara-launcher": "Niagara Launcher",
  "pydroid3": "PyDroid3",
  "smart-launcher": "Smart Launcher",
  "wps-office": "WPS Office",
  "gboard": "Gboard",
  "speedtest": "Speedtest",
  "solid-explorer": "Solid Explorer",
  "brave": "Brave"
};

const APKMIRROR_APPS = [
  "youtube",
  "youtube-music",
  "reddit",
  "twitter"
];

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
  },
  "github": {
    pkg: "com.github.android",
    name: "github",
    patchSource: "hoodles",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/github/ffffff",
    exclude: []
  },
  "niagara-launcher": {
    pkg: "bitpit.launcher",
    name: "niagara-launcher",
    patchSource: "hoodles",
    arch: "arm64-v8a",
    icon: "https://www.google.com/s2/favicons?sz=128&domain=niagaralauncher.app",
    exclude: [],
    forceVersion : "1.16.8"
  },
  "pydroid3": {
    pkg: "ru.iiec.pydroid3",
    name: "pydroid3",
    patchSource: "hoodles",
    arch: "arm64-v8a",
    icon: "https://www.google.com/s2/favicons?sz=128&domain=pydroid3.com",
    exclude: []
  },
  "smart-launcher": {
    pkg: "ginlemon.flowerfree",
    name: "smart-launcher",
    patchSource: "hoodles",
    arch: "arm64-v8a",
    icon: "https://www.google.com/s2/favicons?sz=128&domain=smartlauncher.net",
    exclude: []
  },
  "wps-office": {
    pkg: "cn.wps.moffice_eng",
    name: "wps-office",
    patchSource: "hoodles",
    arch: "arm64-v8a",
    icon: "https://www.google.com/s2/favicons?sz=128&domain=wps.com",
    exclude: []
  },
  "gboard": {
    pkg: "com.google.android.inputmethod.latin",
    name: "gboard",
    patchSource: "adobo",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/google/4285F4",
    exclude: [],
    enable: ["Enable voice typing in incognito", "Enable key shape selection", "Enable clipboard in incognito", "Enable access points menu redesign", "Enable Undo feature", "Enable OCR feature", "Always-incognito mode"]
  },
  "speedtest": {
    pkg: "org.zwanoo.android.speedtest",
    name: "speedtest",
    patchSource: "rushi",
    arch: "arm64-v8a",
    icon: "https://www.google.com/s2/favicons?sz=128&domain=speedtest.net",
    exclude: [],
    forceVersion: "7.0.7"
  },
  "solid-explorer": {
    pkg: "pl.solidexplorer2",
    name: "solid-explorer",
    patchSource: "rushi",
    arch: "arm64-v8a",
    icon: "https://www.google.com/s2/favicons?sz=128&domain=solidexplorer.com",
    exclude: []
  },
  "brave": {
    pkg: "com.brave.browser",
    name: "brave",
    patchSource: "bufferk",
    arch: "arm64-v8a",
    icon: "https://cdn.simpleicons.org/brave/FB542B",
    exclude: []
  }
};

const PROCESS_ORDER = [
  "youtube",
  "youtube-music",
  "reddit",
  "twitter",
  "instagram",
  "github",
  "niagara-launcher",
  "pydroid3",
  "smart-launcher",
  "wps-office",
  "gboard",
  "speedtest",
  "solid-explorer",
  "brave"
];

async function processApp(appKey, desktop, patches) {
  const config = APPS_CONFIG[appKey];
  console.log(`\n📦 PROCESSING: ${config.name.toUpperCase()}`);
  
  const isApkMirrorApp = APKMIRROR_APPS.includes(config.name);

  let selectedVersion = config.forceVersion;

  if (!selectedVersion) {
    try {
      const output = execSync(
        `java -jar "${desktop}" list-versions -f ${config.pkg} --patches="${patches}" --include-experimental`,
        { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 }
      );

      const versions = extractYoutubeVersions(output);
      if (versions && versions.length > 0) {
        selectedVersion = pickLatestVersion(versions);
      }
    } catch (e) {
      console.log(`⚠️ Sürüm listesi alınamadı: ${e.message}`);
    }
  }

  if (!selectedVersion) {
    if (!isApkMirrorApp) {
      selectedVersion = "latest";
    } else {
      const latest = await apkmirror.getLatestListing(config.name);
      if (latest && latest.version) {
        selectedVersion = latest.version;
      }
    }
  }

  if (!selectedVersion) {
    throw new Error("Uygun bir sürüm numarası belirlenemedi.");
  }

  const downloadFunc = isApkMirrorApp ? apkmirror.downloadApk : githubdl.downloadApk;
  const apkPath = await downloadFunc(selectedVersion, config.name, config.forceBuild);

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

    const patchesPool = { morphe: null, piko: null, hoodles: null, adobo: null, rushi: null, bufferk: null };
    let morpheNotes = "";
    let pikoNotes = "";
    let hoodlesNotes = "";
    let adoboNotes = "";
    let rushiNotes = "";
    let bufferkNotes = "";

    const targetApp = process.env.TARGET_APP || "all";
    const appsToProcess = targetApp === "all" ? PROCESS_ORDER : [targetApp];

    const needsMorphe = appsToProcess.some(k => APPS_CONFIG[k].patchSource === "morphe");
    if (needsMorphe) {
      const morpheMpp = await downloadLatestGithubAsset({
        owner: "MorpheApp",
        repo: "morphe-patches",
        prerelease: true,
        match: (n) => n.endsWith(".mpp"),
      });
      patchesPool.morphe = morpheMpp.name;
      morpheNotes = `\n<details>\n<summary>🟢 <b>Morphe Release Notes (${morpheMpp.tag})</b></summary>\n<br>\n\n${morpheMpp.body}\n\n</details>\n`;
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
      pikoNotes = `\n<details>\n<summary>✖️ <b>Piko Release Notes (${pikoMpp.tag})</b></summary>\n<br>\n\n${pikoMpp.body}\n\n</details>\n`;
    }

    const needsHoodles = appsToProcess.some(k => APPS_CONFIG[k].patchSource === "hoodles");
    if (needsHoodles) {
      const hoodlesMpp = await downloadLatestGithubAsset({
        owner: "hoo-dles",
        repo: "morphe-patches",
        prerelease: true,
        match: (n) => n.endsWith(".mpp"),
      });
      patchesPool.hoodles = hoodlesMpp.name;
      hoodlesNotes = `\n<details>\n<summary>🍃 <b>hoo-dles Release Notes (${hoodlesMpp.tag})</b></summary>\n<br>\n\n${hoodlesMpp.body}\n\n</details>\n`;
    }

    const needsAdobo = appsToProcess.some(k => APPS_CONFIG[k].patchSource === "adobo");
    if (needsAdobo) {
      const adoboMpp = await downloadLatestGithubAsset({
        owner: "jkennethcarino",
        repo: "adobo",
        prerelease: true,
        match: (n) => n.endsWith(".mpp"),
      });
      patchesPool.adobo = adoboMpp.name;
      adoboNotes = `\n<details>\n<summary>🥘 <b>Adobo Release Notes (${adoboMpp.tag})</b></summary>\n<br>\n\n${adoboMpp.body}\n\n</details>\n`;
    }

    const needsRushi = appsToProcess.some(k => APPS_CONFIG[k].patchSource === "rushi");
    if (needsRushi) {
      const rushiMpp = await downloadLatestGithubAsset({
        owner: "rushiranpise",
        repo: "morphe-patches",
        prerelease: true,
        match: (n) => n.endsWith(".mpp"),
      });
      patchesPool.rushi = rushiMpp.name;
      rushiNotes = `\n<details>\n<summary>⚡ <b>Rushiranpise Release Notes (${rushiMpp.tag})</b></summary>\n<br>\n\n${rushiMpp.body}\n\n</details>\n`;
    }

    const needsBufferk = appsToProcess.some(k => APPS_CONFIG[k].patchSource === "bufferk");
    if (needsBufferk) {
      const bufferkMpp = await downloadLatestGithubAsset({
        owner: "bufferk",
        repo: "morphe-patches",
        prerelease: true,
        match: (n) => n.endsWith(".mpp"),
      });
      patchesPool.bufferk = bufferkMpp.name;
      bufferkNotes = `\n<details>\n<summary>🟣 <b>Bufferk Release Notes (${bufferkMpp.tag})</b></summary>\n<br>\n\n${bufferkMpp.body}\n\n</details>\n`;
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
      const date = new Date();
      const tagDateStr = date.toISOString().replace(/[:.]/g, "-").split("T")[0];
      const releaseName = `Morphe & Piko Builds (${tagDateStr})`;

      let unifiedReleaseBody = `### 📦 Latest Patched APKs\n\n`;

      for (const apk of patchedApksList) {
        unifiedReleaseBody += `* <img src="${apk.icon}" width="16" height="16"> **${apk.displayName}**\n`;
      }

      unifiedReleaseBody += `\n---\n\n`;

      if (needsMorphe && morpheNotes) unifiedReleaseBody += morpheNotes;
      if (needsPiko && pikoNotes) unifiedReleaseBody += pikoNotes;
      if (needsHoodles && hoodlesNotes) unifiedReleaseBody += hoodlesNotes;
      if (needsAdobo && adoboNotes) unifiedReleaseBody += adoboNotes;
      if (needsRushi && rushiNotes) unifiedReleaseBody += rushiNotes;
      if (needsBufferk && bufferkNotes) unifiedReleaseBody += bufferkNotes;

      console.log(`\n📢 Creating Unified Release: latest`);
      const release = await ensureRelease("latest", releaseName, unifiedReleaseBody);

      let microgUploaded = false;
      for (const apk of patchedApksList) {
        await uploadPatchedApk(release, apk.path);

        if (!microgUploaded && (apk.appName === "youtube" || apk.appName === "youtube-music")) {
          await uploadMicroGOnce(release);
          microgUploaded = true;
        }
      }

      console.log(`\n🎉 All apps successfully published under one release!`);
    }
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  }
})();
