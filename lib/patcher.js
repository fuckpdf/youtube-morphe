const { execSync } = require("child_process");
const fs = require("fs");

function patchApk(desktop, patches, apk) {
  console.log("\n🛠️ Patching APK & Stripping unused architectures (arm64-v8a only)...\n");

  const ksPath = process.env.KS_PATH;
  const ksPassword = process.env.KS_PASSWORD;
  const ksAlias = process.env.KS_ALIAS;
  const keyPassword = process.env.KEY_PASSWORD;

  let signArgs = "";

  if (ksPath && fs.existsSync(ksPath) && ksPassword && ksAlias && keyPassword) {
    console.log("🔑 Custom keystore detected! Signing with your private key...");
    signArgs = `\\
        --keystore "${ksPath}" \\
        --keystore-password "${ksPassword}" \\
        --keystore-entry-alias "${ksAlias}" \\
        --keystore-entry-password "${keyPassword}"`;
  } else {
    console.log("⚠️ Custom keystore credentials missing or file not found. Falling back to default Morphe testkey.");
  }

  try {
    const output = execSync(
      `
      java -jar "${desktop}" patch \
        --patches "${patches}" \
        --striplibs arm64-v8a ${signArgs} \
        "${apk}"
      `,
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 20,
      }
    );

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
