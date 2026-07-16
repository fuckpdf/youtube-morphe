const fs = require("fs");
const path = require("path");
const https = require("https");

const { downloadLatestGithubAsset } = require("./github");

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const headers = {
  "User-Agent": "node",
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
};

async function getOrCreateRelease(tag, releaseName, releaseBody = "") {
  let res = await request({
    hostname: "api.github.com",
    path: `/repos/${REPO}/releases/tags/${tag}`,
    method: "GET",
    headers,
  });

  if (res.message === "Not Found") {
    console.log("🆕 Creating release:", tag);

    res = await request(
      {
        hostname: "api.github.com",
        path: `/repos/${REPO}/releases`,
        method: "POST",
        headers,
      },
      JSON.stringify({
        tag_name: tag,
        name: releaseName,
        body: releaseBody,
        draft: false,
        prerelease: false,
      })
    );
  } else {
    console.log("♻️ Updating existing release...");
    await request(
      {
        hostname: "api.github.com",
        path: `/repos/${REPO}/releases/${res.id}`,
        method: "PATCH",
        headers,
      },
      JSON.stringify({
        name: releaseName,
        body: releaseBody,
      })
    );
  }

  return res;
}

async function getAssets(releaseId) {
  return request({
    hostname: "api.github.com",
    path: `/repos/${REPO}/releases/${releaseId}/assets`,
    method: "GET",
    headers,
  });
}

async function deleteAsset(id) {
  return request({
    hostname: "api.github.com",
    path: `/repos/${REPO}/releases/assets/${id}`,
    method: "DELETE",
    headers,
  });
}

async function upload(uploadUrl, filePath) {
  const fileName = path.basename(filePath);
  const data = fs.readFileSync(filePath);

  const url = new URL(
    uploadUrl.replace("{?name,label}", `?name=${encodeURIComponent(fileName)}`)
  );

  return request(
    {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Length": data.length,
      },
    },
    data
  );
}

async function uploadWithReplace(release, filePath) {
  const fileName = path.basename(filePath);

  const assets = await getAssets(release.id);
  const exist = assets.find(a => a.name === fileName);

  if (exist) {
    console.log("♻️ Replace:", fileName);
    await deleteAsset(exist.id);
  }

  console.log("📤 Upload:", fileName);
  return upload(release.upload_url, filePath);
}

function assertConfigured() {
  if (!TOKEN) throw new Error("Missing GITHUB_TOKEN");
  if (!REPO) throw new Error("Missing GITHUB_REPOSITORY");
}

async function ensureRelease(tag, releaseName, releaseBody) {
  assertConfigured();
  return getOrCreateRelease(tag, releaseName, releaseBody);
}

async function uploadPatchedApk(release, apkPath) {
  assertConfigured();
  await uploadWithReplace(release, apkPath);
}

async function uploadMicroGOnce(release) {
  assertConfigured();

  console.log("📦 Fetch MicroG...");
  const microgResult = await downloadLatestGithubAsset({
    owner: "MorpheApp",
    repo: "MicroG-RE",
    match: (n) => n.endsWith(".apk"),
  });

  const originalPath = path.resolve(process.cwd(), microgResult.name);
  const newPath = path.resolve(process.cwd(), "MicroG.apk");

  if (fs.existsSync(originalPath) && originalPath !== newPath) {
    fs.renameSync(originalPath, newPath);
  }

  const assets = await getAssets(release.id);
  const alreadyUploaded = assets.find(a => a.name === "MicroG.apk");

  if (alreadyUploaded) {
    console.log("✅ MicroG already up to date on this release, skipping upload");
    return;
  }

  await uploadWithReplace(release, newPath);
}

module.exports = {
  ensureRelease,
  uploadPatchedApk,
  uploadMicroGOnce,
};
