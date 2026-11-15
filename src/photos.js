// Photos of the walker's own landmarks, kept on this phone only (IndexedDB, per profile).
// Never uploaded anywhere except to the guide's brain while it looks at them.
const DB = 'local-photos';
let opening;

function db() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

const key = (profile, id) => `${profile}/${id}`;

export async function savePhoto(profile, id, blob) {
  const d = await db();
  await new Promise((resolve, reject) => {
    const tx = d.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(blob, key(profile, id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

const urls = new Map();
export async function photoURL(profile, id) {
  const k = key(profile, id);
  if (urls.has(k)) return urls.get(k);
  const d = await db();
  const blob = await new Promise(resolve => {
    const req = d.transaction('photos').objectStore('photos').get(k);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  const url = blob ? URL.createObjectURL(blob) : null;
  urls.set(k, url);
  return url;
}

// A photo from the camera, made small enough to keep and to show the guide: a JPEG blob to
// store and its base64 for the brain.
export async function shrinkPhoto(file, max = 1024) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  return { blob, base64 };
}
