const { database } = await import('../../src/lib/database.ts');
const { uploadPrivateImage } = await import('../../src/lib/media.ts');

const bytes = Buffer.from(process.env.TEST_IMAGE_BASE64, 'base64');
let failure;
try {
  await uploadPrivateImage({
    kind: 'listing', slug: 'my-listing', actorId: 'owner', actorRole: 'user',
    bytes, mimeType: 'image/png', alt: 'Restart attempt',
  });
} catch (error) {
  failure = error;
}

const result = {
  status: failure?.status,
  message: failure?.message,
  assets: database.prepare('SELECT COUNT(*) AS count FROM media_assets').get().count,
  pendingCleanup: database.prepare('SELECT COUNT(*) AS count FROM media_cleanup_queue').get().count,
  accepted: database.prepare(`SELECT accepted_count AS count FROM media_upload_windows
    WHERE user_id = 'owner'`).get().count,
};
database.close();
console.log(JSON.stringify(result));
if (!failure) process.exitCode = 1;
