function extractYoutubeVersions(output) {
  const results = [];
  const lines = output.split("\n");

  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("Most common compatible versions")) {
      inSection = true;
      continue;
    }

    if (inSection && !trimmed) break;

    if (inSection) {
      const match = trimmed.match(/^(\d+\.\d+\.\d+(?:-[a-zA-Z]+\.\d+)?)\s+\((\d+)\s+patches\)/);
      if (match) {
        results.push({ version: match[1], patches: Number(match[2]) });
      }
    }
  }

  if (!results.length) {
    const fallback = [...output.matchAll(/\d+\.\d+\.\d+(?:-[a-zA-Z]+\.\d+)?/g)].map(m => m[0]);
    return fallback.map(v => ({ version: v, patches: 0 }));
  }

  return results;
}

// Instagram için özel ayrıştırıcı
function extractInstagramVersions(output) {
  const lines = output.split("\n");
  const results = [];
  
  // Instagram çıktı satırları genellikle sürüm numarasını ve build bilgisini içerir
  for (const line of lines) {
    const match = line.trim().match(/(\d+\.\d+\.\d+\.\d+\.\d+)\s+Build\s+(\d+)/);
    if (match) {
      results.push({ version: match[1], build: match[2] });
    }
  }
  return results;
}

function versionCore(version) {
  return version.split("-")[0];
}

function pickLatestVersion(list, isInstagram = false) {
  if (!list.length) return null;

  // Instagram ise build numarasına göre en büyüğü seç
  if (isInstagram) {
    const sorted = list.sort((a, b) => Number(b.build) - Number(a.build));
    return sorted[0].version;
  }

  // YouTube ise mevcut patch/sürüm mantığıyla seç
  const sorted = list.sort((a, b) => {
    if (b.patches !== a.patches) return b.patches - a.patches;
    const pa = versionCore(a.version).split(".").map(Number);
    const pb = versionCore(b.version).split(".").map(Number);
    return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
  });

  return sorted[0].version;
}

function toApkMirrorVersion(version) {
  return version.replace(/\./g, "-");
}

module.exports = {
  extractYoutubeVersions,
  extractInstagramVersions,
  pickLatestVersion,
  toApkMirrorVersion,
};
