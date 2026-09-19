const { test } = require("node:test");
const assert = require("node:assert/strict");

function buildUncompressedPsd({ width, height, colorMode, planes }) {
  const plane = width * height;
  const buffer = Buffer.alloc(40 + plane * planes.length);
  buffer.write("8BPS", 0);
  buffer.writeUInt16BE(1, 4);
  buffer.writeUInt16BE(planes.length, 12);
  buffer.writeUInt32BE(height, 14);
  buffer.writeUInt32BE(width, 18);
  buffer.writeUInt16BE(8, 22);
  buffer.writeUInt16BE(colorMode, 24);
  buffer.writeUInt16BE(0, 38);
  let offset = 40;
  for (const data of planes) {
    Buffer.from(data).copy(buffer, offset);
    offset += plane;
  }
  return buffer;
}

test("decodes an uncompressed CMYK Photoshop composite to white RGB", async () => {
  const { decodePsdComposite, isPsdFileName } = await import(
    "../electron/psd-decode.mjs"
  );
  assert.equal(isPsdFileName("Badshahi Masjid Lahore 03.psd"), true);
  assert.equal(isPsdFileName("photo.PSB"), true);
  assert.equal(isPsdFileName("photo.jpg"), false);

  const white = Buffer.alloc(1, 255);
  const image = decodePsdComposite(
    buildUncompressedPsd({
      width: 1,
      height: 1,
      colorMode: 4,
      planes: [white, white, white, white],
    }),
  );
  assert.deepEqual(
    { width: image.width, height: image.height, rgba: [...image.rgba] },
    { width: 1, height: 1, rgba: [255, 255, 255, 255] },
  );
});

test("decodes an uncompressed RGB Photoshop composite", async () => {
  const { decodePsdComposite } = await import("../electron/psd-decode.mjs");
  const image = decodePsdComposite(
    buildUncompressedPsd({
      width: 1,
      height: 1,
      colorMode: 3,
      planes: [Buffer.from([12]), Buffer.from([34]), Buffer.from([56])],
    }),
  );
  assert.deepEqual([...image.rgba], [12, 34, 56, 255]);
});
