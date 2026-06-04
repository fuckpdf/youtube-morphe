const { execSync } = require("child_process");
const fs = require("fs");

function patchApk(cli, patches, apk) {
  console.log("\n🛠️ Patching APK...\n");

  try {
    const output = execSync(
      `
      java -jar "${cli}" patch \
        --patches "${patches}" \
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
