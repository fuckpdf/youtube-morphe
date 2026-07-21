const fs = require("fs");
const path = require("path");
const { request } = require("./http");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function jitter(ms) {
  return ms + Math.floor(Math.random() * 300);
}

async function withRetry(fn, retries = 5, baseDelay = 1000) {
  let lastErr;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      const delay = jitter(baseDelay * Math.pow(2, i));
      console.log(`🔁 Retry ${i + 1}/${retries} in ${delay}ms - ${err.message}`);
      await sleep(delay);
    }
  }

  throw lastErr;
}

async function fetchLatestRelease(owner, repo, prerelease = false) {
  const url = prerelease 
    ? `https://api.github.com/repos/${owner}/${repo}/releases`
    : `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

  return withRetry(async () => {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "node",
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`
      }
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const data = await res.json();

    if (prerelease) {
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("No releases found");
      }
      return data[0];
    }

    return data;
  });
}

function downloadFilePro(url, outputPath, expectedSize = null) {
  return new Promise((resolve, reject) => {
    const filePath = path.resolve(outputPath);
    const tempPath = filePath + ".part";

    let downloaded = 0;

    if (fs.existsSync(tempPath)) {
      downloaded = fs.statSync(tempPath).size;
    }

    const headers = {
      "User-Agent": "node",
      "Accept": "*/*"
    };

    if (downloaded > 0) {
      headers["Range"] = `bytes=${downloaded}-`;
      console.log(`↩️ Resume at ${downloaded} bytes`);
    }

    request(url, headers)
      .then(res => {
        const file = fs.createWriteStream(tempPath, {
          flags: downloaded > 0 ? "a" : "w"
        });

        let failed = false;

        res.on("response", r => {
          if (r.statusCode >= 400) {
            failed = true;
            reject(new Error(`HTTP ${r.statusCode}`));
            res.destroy();
          }
        });

        res.on("data", chunk => {
          downloaded += chunk.length;
        });

        res.pipe(file);

        file.on("finish", () => {
          file.close();

          if (failed) return;

          if (expectedSize && downloaded !== expectedSize) {
            fs.unlinkSync(tempPath);
            return reject(
              new Error(`Size mismatch: ${downloaded}/${expectedSize}`)
            );
          }

          fs.renameSync(tempPath, filePath);
          resolve(filePath);
        });

        file.on("error", err => {
          fs.unlinkSync(tempPath);
          reject(err);
        });
      })
      .catch(reject);
  });
}

async function downloadLatestGithubAsset({ owner, repo, prerelease = false, match }) {
  console.log(`\n📦 Fetch release: ${owner}/${repo}`);

  const release = await fetchLatestRelease(owner, repo, prerelease);

  if (!release.assets?.length) {
    throw new Error(`Repo ${owner}/${repo} không có assets`);
  }

  const asset = release.assets.find(a => match(a.name));
  if (!asset) throw new Error(`❌ Không tìm thấy asset`);

  console.log("🎯 Selected:", asset.name);

  if (fs.existsSync(asset.name)) {
    const size = fs.statSync(asset.name).size;

    if (size < 1024) {
      console.log("🧹 Corrupt cache removed");
      fs.unlinkSync(asset.name);
    } else {
      console.log("⚡ Skip cached:", asset.name);
      return {
        name: asset.name,
        body: release.body || "",
        tag: release.tag_name || ""
      };
    }
  }

  await withRetry(async () => {
    await downloadFilePro(
      asset.browser_download_url,
      asset.name,
      asset.size
    );
  });

  console.log("✅ Done:", asset.name);
  
  return {
    name: asset.name,
    body: release.body || "",
    tag: release.tag_name || ""
  };
}

module.exports = { downloadLatestGithubAsset };
