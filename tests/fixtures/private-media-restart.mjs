import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const { database } = await import('../../src/lib/database.ts');
const { mediaFilePath, privateMediaAsset } = await import('../../src/lib/media.ts');

const asset = privateMediaAsset(process.env.TEST_ASSET_ID, 'owner', 'user');
const metadata = await sharp(readFileSync(mediaFilePath(asset.id))).metadata();
console.log(JSON.stringify({
  id: asset.id,
  kind: asset.kind,
  slug: asset.slug,
  format: metadata.format,
  width: metadata.width,
  height: metadata.height,
}));
database.close();
