const DB_NAME = "maisoku-ai-2";
const DB_VERSION = 2;

export const STORES = [
  "areas",
  "areaEvaluations",
  "agencies",
  "visits",
  "properties",
  "assets",
  "extractions",
  "aiAnalyses",
  "propertyEvaluations",
  "checklistRecords",
  "settings"
];

const INDEXES = {
  areas: ["updatedAt"],
  areaEvaluations: ["areaId", "createdAt"],
  agencies: ["updatedAt"],
  visits: ["date", "areaId"],
  properties: ["updatedAt", "areaId"],
  assets: ["propertyId", "visitId", "areaId", "createdAt"],
  extractions: ["propertyId", "assetId", "createdAt"],
  aiAnalyses: ["propertyId", "createdAt"],
  propertyEvaluations: ["propertyId", "createdAt"],
  checklistRecords: ["propertyId"],
  settings: []
};

function assertStore(storeName) {
  if (!STORES.includes(storeName)) throw new Error("不正な保存先です。");
}

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
      for (const name of STORES) {
        let store;
        if (!db.objectStoreNames.contains(name)) {
          store = db.createObjectStore(name, { keyPath: "id" });
        } else if (tx) {
          store = tx.objectStore(name);
        } else {
          continue;
        }
        for (const indexName of INDEXES[name] || []) {
          if (!store.indexNames.contains(indexName)) {
            store.createIndex(indexName, indexName);
          }
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("データベースを開けませんでした。"));
    request.onblocked = () => reject(new Error("別のタブが更新を妨げています。ほかのタブを閉じて再読み込みしてください。"));
  });
}

export async function allRecords(storeName) {
  assertStore(storeName);
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
  assertStore(storeName);
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
  assertStore(storeName);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const error = tx.error; db.close(); reject(error); };
    tx.onabort = () => { const error = tx.error; db.close(); reject(error); };
  });
}

export async function getRecord(storeName, id) {
  assertStore(storeName);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => { const error = req.error; db.close(); reject(error); };
    tx.oncomplete = () => db.close();
    tx.onerror = () => { const error = tx.error; db.close(); reject(error); };
    tx.onabort = () => { const error = tx.error; db.close(); reject(error); };
  });
}

export async function replaceAllData(data) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, "readwrite");
    for (const name of STORES) {
      const store = tx.objectStore(name);
      store.clear();
      for (const item of (data && Array.isArray(data[name]) ? data[name] : [])) store.put(item);
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const error = tx.error; db.close(); reject(error); };
    tx.onabort = () => { const error = tx.error; db.close(); reject(error); };
  });
}

export async function exportAllData() {
  const data = {};
  for (const name of STORES) data[name] = await allRecords(name);
  return { app: "maisoku-ai-2", version: 2, exportedAt: new Date().toISOString(), ...data };
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
    visitId: metadata.visitId || null,
    areaId: metadata.areaId || null,
    createdAt: new Date().toISOString()
  };
  await saveRecord("assets", record);
  return record;
}
