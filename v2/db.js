const DB_NAME = "maisoku-ai-2";
const DB_VERSION = 1;
const STORES = ["properties", "visits", "assets"];

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("properties")) {
        const store = db.createObjectStore("properties", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("visitId", "visitId");
      }
      if (!db.objectStoreNames.contains("visits")) {
        const store = db.createObjectStore("visits", { keyPath: "id" });
        store.createIndex("date", "date");
      }
      if (!db.objectStoreNames.contains("assets")) {
        const store = db.createObjectStore("assets", { keyPath: "id" });
        store.createIndex("propertyId", "propertyId");
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("データベースを開けませんでした。"));
    request.onblocked = () => reject(new Error("別のタブが更新を妨げています。ほかのタブを閉じて再読み込みしてください。"));
  });
}

export async function allRecords(storeName) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function saveRecord(storeName, record) {
  if (!STORES.includes(storeName)) throw new Error("不正な保存先です。");
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(record);
    tx.oncomplete = () => { db.close(); resolve(record); };
    tx.onerror = () => { const error = tx.error; db.close(); reject(error); };
    tx.onabort = () => { const error = tx.error; db.close(); reject(error); };
  });
}

export async function deleteRecord(storeName, id) {
  if (!STORES.includes(storeName)) throw new Error("不正な削除先です。");
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const error = tx.error; db.close(); reject(error); };
  });
}

export async function getRecord(storeName, id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function replaceAllData(data) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, "readwrite");
    for (const name of STORES) {
      const store = tx.objectStore(name);
      store.clear();
      for (const item of (Array.isArray(data[name]) ? data[name] : [])) store.put(item);
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const error = tx.error; db.close(); reject(error); };
    tx.onabort = () => { const error = tx.error; db.close(); reject(error); };
  });
}

export async function exportAllData() {
  const data = {};
  for (const name of STORES) data[name] = await allRecords(name);
  return { app: "maisoku-ai-2", version: 1, exportedAt: new Date().toISOString(), ...data };
}

export async function saveImageAsset(file, metadata = {}) {
  if (!(file instanceof Blob)) throw new Error("画像ファイルを読み込めません。");
  const record = {
    id: crypto.randomUUID(),
    name: file.name || "撮影画像",
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    blob: file,
    kind: metadata.kind || "マイソク",
    memo: metadata.memo || "",
    propertyId: metadata.propertyId || null,
    createdAt: new Date().toISOString()
  };
  await saveRecord("assets", record);
  return record;
}
