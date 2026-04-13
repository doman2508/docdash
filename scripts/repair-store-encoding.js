const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");

const storePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "..", "data", "store.json");

const windows1250Decoder = new TextDecoder("windows-1250");
const utf8Decoder = new TextDecoder("utf-8");
const windows1250BytesByChar = new Map();

for (let byte = 0; byte <= 255; byte += 1) {
  const char = windows1250Decoder.decode(Uint8Array.of(byte));

  if (!windows1250BytesByChar.has(char)) {
    windows1250BytesByChar.set(char, byte);
  }
}

// Characters commonly left behind when UTF-8 text is decoded as Windows-1250.
const suspiciousPattern = /[\u00c2\u00c4\u00cb\u00e2\u0102\u0139\u20ac\ufffd]/u;

function suspiciousScore(value) {
  return [...value].filter((char) => suspiciousPattern.test(char)).length;
}

function encodeWindows1250(value) {
  const bytes = [];

  for (const char of value) {
    const codePoint = char.codePointAt(0);

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
      continue;
    }

    if (!windows1250BytesByChar.has(char)) {
      return null;
    }

    bytes.push(windows1250BytesByChar.get(char));
  }

  return Uint8Array.from(bytes);
}

function repairMojibake(value) {
  let current = value;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!suspiciousPattern.test(current)) {
      break;
    }

    const currentScore = suspiciousScore(current);
    const bytes = encodeWindows1250(current);

    if (!bytes) {
      break;
    }

    const candidate = utf8Decoder.decode(bytes);
    const candidateScore = suspiciousScore(candidate);

    if (!candidate || candidate === current || candidateScore > currentScore) {
      break;
    }

    current = candidate;
  }

  return current;
}

function repairValue(value, stats) {
  if (typeof value === "string") {
    const repaired = repairMojibake(value);

    if (repaired !== value) {
      stats.changed += 1;
    }

    return repaired;
  }

  if (Array.isArray(value)) {
    return value.map((item) => repairValue(item, stats));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, repairValue(entryValue, stats)])
    );
  }

  return value;
}

const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
const stats = { changed: 0 };
const repairedStore = repairValue(store, stats);

if (repairedStore.meta) {
  repairedStore.meta.lastUpdated = new Date().toISOString().slice(0, 16).replace("T", " ");
}

fs.writeFileSync(storePath, `${JSON.stringify(repairedStore, null, 2)}\n`, "utf8");

console.log(`Repaired strings: ${stats.changed}`);
