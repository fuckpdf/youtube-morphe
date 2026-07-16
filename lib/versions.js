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
      const match = trimmed.match(/^(\d+(?:\.\d+)+(?:-[a-zA-Z]+\.\d+)?)\s+\((\d+)\s+patches\)/);

      if (match) {
        results.push({
          version: match[1],
          patches: Number(match[2]),
        });
      }
    }
  }

  if (!results.length) {
    const fallback = [...output.matchAll(/\d+(?:\.\d+)+(?:-[a-zA-Z]+\.\d+)?/g)].map(m => m[0]);
    return fallback.map(v => ({ version: v, patches: 0 }));
  }

  return results;
}

function versionCore(version) {
  return version.split("-")[0];
}

function comparePartsDesc(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (b[i] || 0) - (a[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function pickLatestVersion(list) {
  if (!list.length) return null;

  const sorted = list.sort((a, b) => {
    if (b.patches !== a.patches) {
      return b.patches - a.patches;
    }

    const pa = versionCore(a.version).split(".").map(Number);
    const pb = versionCore(b.version).split(".").map(Number);

    return comparePartsDesc(pa, pb);
  });

  return sorted[0].version;
}

function toApkMirrorVersion(version) {
  return version.replace(/\./g, "-");
}

module.exports = {
  extractYoutubeVersions,
  pickLatestVersion,
  toApkMirrorVersion,
};
