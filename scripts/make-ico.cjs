const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const inputPath = path.resolve(__dirname, '../build/icon.png');
const outputPath = path.resolve(__dirname, '../build/icon.ico');

const sizes = [16, 24, 32, 48, 64, 128, 256];

async function createIco() {
  const buffers = await Promise.all(
    sizes.map((size) =>
      sharp(inputPath)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );

  const numImages = buffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;
  let dataOffset = headerSize + dirSize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(numImages, 4);

  const dirEntries = [];
  const imageDataParts = [];

  for (let i = 0; i < numImages; i++) {
    const size = sizes[i];
    const pngData = buffers[i];

    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size < 256 ? size : 0, 0);
    entry.writeUInt8(size < 256 ? size : 0, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(pngData.length, 8);
    entry.writeUInt32LE(dataOffset, 12);

    dirEntries.push(entry);
    imageDataParts.push(pngData);
    dataOffset += pngData.length;
  }

  const ico = Buffer.concat([header, ...dirEntries, ...imageDataParts]);
  fs.writeFileSync(outputPath, ico);
  console.log(`icon.ico created: ${ico.length} bytes (${numImages} sizes: ${sizes.join(', ')})`);
}

createIco().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
