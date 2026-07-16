const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * APK dosyalarını güvenli bir şekilde yamalar, gereksiz mimarileri temizler ve imzalar.
 * @param {string} desktop - Morphe CLI JAR dosyasının yolu
 * @param {string} patches - .mpp yama dosyasının yolu
 * @param {string} apk - Orijinal APK dosyasının yolu
 * @param {string} extraArgs - Hariç tutulacak yamalar veya ekstra CLI argümanları
 * @param {string} arch - Tutulacak mimari (Örn: "arm64-v8a")
 */
function patchApk(desktop, patches, apk, extraArgs = "", arch = "arm64-v8a") {
  console.log(`\n🛠️ Patching APK & Stripping unused architectures (${arch} only)...\n`);

  const ksPath = process.env.KS_PATH;
  const ksPassword = process.env.KS_PASSWORD;
  const ksAlias = process.env.KS_ALIAS;
  const keyPassword = process.env.KEY_PASSWORD;

  const cmdParts = [
    "java",
    "-jar",
    `"${desktop}"`,
    "patch",
    "--patches",
    `"${patches}"`
  ];

  // Config üzerinden gelen mimari bilgisi işleniyor
  if (arch) {
    cmdParts.push("--striplibs", arch);
  }

  if (ksPath && fs.existsSync(ksPath) && ksPassword && ksAlias && keyPassword) {
    console.log("🔑 Custom keystore detected! Signing with your private key...");
    cmdParts.push(
      "--keystore", `"${ksPath}"`,
      "--keystore-password", `"${ksPassword}"`,
      "--keystore-entry-alias", `"${ksAlias}"`,
      "--keystore-entry-password", `"${keyPassword}"`
    );
  } else {
    console.log("⚠️ Custom keystore credentials missing or file not found. Falling back to default Morphe testkey.");
  }

  if (extraArgs && extraArgs.trim()) {
    cmdParts.push(extraArgs.trim());
  }

  cmdParts.push(`"${apk}"`);

  const command = cmdParts.join(" ");

  try {
    console.log(`🖥️ EXECUTING COMMAND: ${command}`);

    const output = execSync(command, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    });

    console.log(output);

    const match = output.match(
      /INFO:\s+Saved to\s+([^\r\n]+\.apk)/i
    );

    if (!match) {
      throw new Error(
        `Cannot find patched APK path in output:\n${output}`
      );
    }

    const patchedApk = match[1].trim();

    if (!fs.existsSync(patchedApk)) {
      throw new Error(
        `Patched APK does not exist:\n${patchedApk}`
      );
    }

    // --- ÖZEL İSİMLENDİRME (RENAME) KISMI ---
    const dir = path.dirname(patchedApk);
    const oldFileName = path.basename(patchedApk);
    let finalApkPath = patchedApk;

    // Dosya adından uygulamayı ve sürümü yakalayan Regex
    const nameMatch = oldFileName.match(/^(youtube-music|youtube|reddit|twitter|instagram)-(.+?)(?:-patched|-patlanmış)?\.apk$/i);

    if (nameMatch) {
      const appMap = {
        "youtube": "YouTube",
        "youtube-music": "YT.Music",
        "reddit": "Reddit",
        "twitter": "Twitter",
        "instagram": "Instagram"
      };

      const newAppPrefix = appMap[nameMatch[1].toLowerCase()];
      const versionStr = nameMatch[2]; // Örn: 9.26.51 veya 12.7.1-release.0
      
      const newFileName = `${newAppPrefix}-${versionStr}.apk`;
      finalApkPath = path.join(dir, newFileName);
      
      fs.renameSync(patchedApk, finalApkPath);
      console.log(`\n🏷️ Dosya yeniden adlandırıldı: ${newFileName}`);
    } else {
      console.log(`\n⚠️ Özel isimlendirme eşleşmedi, orijinal isim kullanılıyor: ${oldFileName}`);
    }
    // ----------------------------------------

    console.log("\n✅ Patch done");
    console.log("📦 Output:", finalApkPath);

    return finalApkPath;
  } catch (err) {
    throw new Error(
      `Patch failed: ${err.message}`
    );
  }
}

module.exports = { patchApk };
