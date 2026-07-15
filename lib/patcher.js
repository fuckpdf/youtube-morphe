const { execSync } = require("child_process");
const fs = require("fs");

/**
 * APK dosyalarını güvenli bir şekilde yamalar, arm64-v8a dışındaki mimarileri temizler ve imzalar.
 * @param {string} desktop - Morphe CLI JAR dosyasının yolu
 * @param {string} patches - .mpp yama dosyasının yolu
 * @param {string} apk - Orijinal APK dosyasının yolu
 * @param {string} extraArgs - Hariç tutulacak yamalar veya ekstra CLI argümanları (--exclude "Dynamic color")
 */
function patchApk(desktop, patches, apk, extraArgs = "") {
  console.log("\n🛠️ Patching APK & Stripping unused architectures (arm64-v8a only)...\n");

  const ksPath = process.env.KS_PATH;
  const ksPassword = process.env.KS_PASSWORD;
  const ksAlias = process.env.KS_ALIAS;
  const keyPassword = process.env.KEY_PASSWORD;

  // Komut argümanlarını temiz bir dizi olarak topluyoruz
  const cmdParts = [
    "java",
    "-jar",
    `"${desktop}"`,
    "patch",
    "--patches",
    `"${patches}"`,
    "--striplibs",
    "arm64-v8a"
  ];

  // Keystore bilgileri varsa tırnak işaretleriyle güvenli bir şekilde ekliyoruz
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

  // Eğer Twitter için --exclude "Dynamic color" gibi ekstra argümanlar geldiyse ekle
  if (extraArgs && extraArgs.trim()) {
    cmdParts.push(extraArgs.trim());
  }

  // Son olarak hedef APK dosyasını ekliyoruz
  cmdParts.push(`"${apk}"`);

  // Dizideki tüm elemanları tek bir boşlukla birleştirerek kusursuz bir tek satır komut elde ediyoruz
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

    console.log("\n✅ Patch done");
    console.log("📦 Output:", patchedApk);

    return patchedApk;
  } catch (err) {
    throw new Error(
      `Patch failed: ${err.message}`
    );
  }
}

module.exports = { patchApk };
