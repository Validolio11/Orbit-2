// Raster exports are reproducible from the editable vector. No image API needed.
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');
const assets = path.resolve(__dirname, '..', 'assets');
const source = fs.readFileSync(path.join(assets, 'orbit.svg'), 'utf8');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function raster(size) {
  // Strengthen the small mark optically rather than scaling a hairline down.
  const svg = size <= 24
    ? source.replace('stroke-width="3.2"', 'stroke-width="4"').replace('r="4.5"','r="5"')
    : source;
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

const images = sizes.map(size => ({ size, png: raster(size) }));
const directory = Buffer.alloc(6 + 16 * images.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(images.length, 4);
let offset = directory.length;
for (let index = 0; index < images.length; index++) {
  const { size, png } = images[index];
  const record = 6 + index * 16;
  directory[record] = size === 256 ? 0 : size;
  directory[record + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, record + 4);
  directory.writeUInt16LE(32, record + 6);
  directory.writeUInt32LE(png.length, record + 8);
  directory.writeUInt32LE(offset, record + 12);
  offset += png.length;
}
fs.writeFileSync(path.join(assets, 'orbit.ico'), Buffer.concat([directory, ...images.map(image => image.png)]));
fs.writeFileSync(path.join(assets, 'orbit.png'), raster(512));
for (const image of images) fs.writeFileSync(path.join(assets, `orbit-${image.size}.png`), image.png);
console.log(`Orbit 2 icon built: ${sizes.join(', ')}px ICO + 512px PNG`);
