export function isPsdFileName(name) {
  return /\.(psd|psb)$/i.test(name || "");
}

function readU16(view, offset) {
  return view.getUint16(offset, false);
}

function readU32(view, offset) {
  return view.getUint32(offset, false);
}

function skipBlock(view, offset, wide) {
  const size = wide ? Number(view.getBigUint64(offset, false)) : readU32(view, offset);
  const header = wide ? 8 : 4;
  return offset + header + size;
}

function decodePackBits(input, expected) {
  const output = new Uint8Array(expected);
  let src = 0;
  let dst = 0;

  while (src < input.length && dst < expected) {
    const flag = input[src++];
    const n = flag > 127 ? flag - 256 : flag;

    if (n >= 0) {
      const count = n + 1;
      for (let i = 0; i < count && src < input.length && dst < expected; i += 1) {
        output[dst++] = input[src++];
      }
    } else if (n !== -128) {
      const count = 1 - n;
      const value = input[src++];
      for (let i = 0; i < count && dst < expected; i += 1) {
        output[dst++] = value;
      }
    }
  }

  return output;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}

function cmykToRgba(cStored, mStored, yStored, kStored, a) {
  const c = 255 - cStored;
  const m = 255 - mStored;
  const y = 255 - yStored;
  const k = 255 - kStored;
  return [
    clampByte((65535 - (c * (255 - k) + (k << 8))) >> 8),
    clampByte((65535 - (m * (255 - k) + (k << 8))) >> 8),
    clampByte((65535 - (y * (255 - k) + (k << 8))) >> 8),
    a,
  ];
}

function channelsToRgba(channels, width, height, colorMode) {
  const count = width * height;
  const rgba = new Uint8ClampedArray(count * 4);
  const c0 = channels[0];
  const c1 = channels[1];
  const c2 = channels[2];
  const c3 = channels[3];
  const c4 = channels[4];

  if (colorMode === 4) {
    for (let i = 0; i < count; i += 1) {
      const [r, g, b, a] = cmykToRgba(
        c0[i],
        c1[i],
        c2[i],
        c3[i],
        c4 ? c4[i] : 255
      );
      const o = i * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    }
    return rgba;
  }

  if (colorMode === 3) {
    for (let i = 0; i < count; i += 1) {
      const o = i * 4;
      rgba[o] = c0[i];
      rgba[o + 1] = c1 ? c1[i] : 0;
      rgba[o + 2] = c2 ? c2[i] : 0;
      rgba[o + 3] = c3 ? c3[i] : 255;
    }
    return rgba;
  }

  if (colorMode === 1) {
    for (let i = 0; i < count; i += 1) {
      const o = i * 4;
      const gray = c0[i];
      rgba[o] = gray;
      rgba[o + 1] = gray;
      rgba[o + 2] = gray;
      rgba[o + 3] = c1 ? c1[i] : 255;
    }
    return rgba;
  }

  throw new Error("This PSD color mode is not supported");
}

export function decodePsdComposite(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (signature !== "8BPS") {
    throw new Error("Not a Photoshop file");
  }

  const version = readU16(view, 4);
  if (version !== 1 && version !== 2) {
    throw new Error("Unsupported Photoshop file version");
  }

  const wide = version === 2;
  const channelCount = readU16(view, 12);
  const height = readU32(view, 14);
  const width = readU32(view, 18);
  const depth = readU16(view, 22);
  const colorMode = readU16(view, 24);

  if (depth !== 8) {
    throw new Error("Only 8-bit Photoshop files are supported");
  }
  if (!width || !height) {
    throw new Error("Could not read Photoshop image size");
  }

  let offset = 26;
  offset = skipBlock(view, offset, false);
  offset = skipBlock(view, offset, false);
  offset = skipBlock(view, offset, wide);

  const compression = readU16(view, offset);
  offset += 2;

  const plane = width * height;
  const planes = [];

  if (compression === 0) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      planes.push(bytes.subarray(offset, offset + plane));
      offset += plane;
    }
  } else if (compression === 1) {
    const rowSizeBytes = wide ? 4 : 2;
    const rowCount = height * channelCount;
    const rowLengths = new Array(rowCount);
    for (let i = 0; i < rowCount; i += 1) {
      rowLengths[i] = wide ? readU32(view, offset) : readU16(view, offset);
      offset += rowSizeBytes;
    }

    for (let channel = 0; channel < channelCount; channel += 1) {
      const planeBytes = new Uint8Array(plane);
      for (let row = 0; row < height; row += 1) {
        const length = rowLengths[channel * height + row];
        const encoded = bytes.subarray(offset, offset + length);
        offset += length;
        planeBytes.set(decodePackBits(encoded, width), row * width);
      }
      planes.push(planeBytes);
    }
  } else {
    throw new Error("This Photoshop compression is not supported");
  }

  return {
    width,
    height,
    rgba: channelsToRgba(planes, width, height, colorMode),
  };
}
