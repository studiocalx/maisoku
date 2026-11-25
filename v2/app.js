import { allRecords, saveRecord, deleteRecord, getRecord, replaceAllData, exportAllData, saveImageAsset } from "./db.js";

const $ = (id) => document.getElementById(id);
const state = { tab: "properties", properties: [], visits: [], assets: [] };
const uid = () => crypto.randomUUID();
const dateToday = () => new Date().toISOString().slice(0, 10);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const yen = (value) => Number(value || 0).toLocaleString("ja-JP") + "円";
let toastTimer;

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
}
function sortNewest(items, key = "updatedAt") {
  return [...items].sort((a,b) => String(b[key] || b.createdAt || "").localeCompare(String(a[key] || a.createdAt || "")));
}
async function refresh() {
  [state.properties, state.visits, state.assets] = await Promise.all([
    allRecords("properties"), allRecords("visits"), allRecords("assets")
  ]);
  $("propertyCount").textContent = state.properties.length;
  $("visitCount").textContent = state.visits.length;
  $("assetCount").textContent = state.assets.filter(x => !x.propertyId).length;
  render();
}
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  ["properties","visits","assets"].forEach(name => $(name + "Panel").classList.toggle("hidden", name !== tab));
  render();
}
function render() {
  const q = $("propertySearch").value.trim().toLowerCase();
  const properties = sortNewest(state.properties).filter(p => !q || [p.title,p.address,p.station].some(v => String(v || "").toLowerCase().includes(q)));
  $("propertiesList").innerHTML = properties.length ? properties.map(p => {
    const total = Number(p.rent || 0) + Number(p.fee || 0);
    return `<article class="record-card"><button class="record-main" data-detail-property="${p.id}"><span class="record-kicker">${escapeHtml(p.status || "未整理")} · ${escapeHtml((p.updatedAt || "").slice(0,10))}</span><strong>${escapeHtml(p.title || "名称未設定の物件")}</strong><span class="record-sub">${escapeHtml(p.address || "所在地未入力")}${p.station ? " / " + escapeHtml(p.station) : ""}</span><span class="record-price">${total ? yen(total) + " / 月" : "賃料未確認"}</span></button><button class="mini-button" data-edit-property="${p.id}">編集</button></article>`;
  }).join("") : emptyState("物件の記録はまだありません。","気になる物件を、まず一件残してみましょう。");
  const visits = sortNewest(state.visits, "date");
  $("visitsList").innerHTML = visits.length ? visits.map(v => `<article class="record-card"><button class="record-main" data-detail-visit="${v.id}"><span class="record-kicker">${escapeHtml(v.date || "日付未設定")}</span><strong>${escapeHtml(v.place || "地域名未設定")}</strong><span class="record-sub">${escapeHtml(v.memo || "メモはありません")}</span></button><button class="mini-button" data-edit-visit="${v.id}">編集</button></article>`).join("") : emptyState("街の記録はまだありません。","物件がなくても、歩いた街の印象を残せます。");
  const assets = sortNewest(state.assets, "createdAt").filter(a => !a.propertyId);
  $("assetsList").innerHTML = assets.length ? assets.map(a => `<article class="asset-card"><img data-asset-image="${a.id}" alt=""><div class="asset-meta"><b>${escapeHtml(a.kind)}</b><span>${escapeHtml(a.name)}</span><small>${escapeHtml((a.createdAt || "").slice(0,16).replace("T"," "))}</small><div class="asset-actions"><button class="mini-button" data-link-asset="${a.id}">物件に紐付け</button><button class="mini-button danger" data-delete-asset="${a.id}">削除</button></div></div></article>`).join("") : emptyState("未整理資料はありません。","撮影した画像は、物件名が分からなくても保存できます。");
  for (const asset of assets) {
    const img = document.querySelector(`[data-asset-image="${asset.id}"]`);
    if (img && asset.blob) img.src = URL.createObjectURL(asset.blob);
  }
}
function emptyState(title, sub) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(sub)}</span></div>`;
}
function fillVisitOptions(selected = "") {
  $("pVisit").innerHTML = '<option value="">紐付けなし</option>' + sortNewest(state.visits, "date").map(v => `<option value="${v.id}">${escapeHtml(v.place || "地域名未設定")}（${escapeHtml(v.date || "")}）</option>`).join("");
  $("pVisit").value = selected;
}
function openPropertyForm(record = null) {
  $("recordForm").reset();
  $("recordType").value = "property";
  $("recordId").value = record?.id || "";
  $("formTitle").textContent = record ? "物件を編集" : "物件を登録";
  $("formEyebrow").textContent = record ? "EDIT PROPERTY" : "NEW PROPERTY";
  $("propertyFields").classList.remove("hidden");
  $("visitFields").classList.add("hidden");
  fillVisitOptions(record?.visitId || "");
  $("pTitle").value = record?.title || "";
  $("pAddress").value = record?.address || "";
  $("pRent").value = record?.rent ?? "";
  $("pFee").value = record?.fee ?? "";
  $("pStation").value = record?.station || "";
  $("pWalk").value = record?.walkMinutes ?? "";
  $("pLayout").value = record?.layout || "";
  $("pArea").value = record?.area ?? "";
  $("pStatus").value = record?.status || "未整理";
  $("pMemo").value = record?.memo || "";
  $("recordDialog").showModal();
}
function openVisitForm(record = null) {
  $("recordForm").reset();
  $("recordType").value = "visit";
  $("recordId").value = record?.id || "";
  $("formTitle").textContent = record ? "街の記録を編集" : "街の訪問記録";
  $("formEyebrow").textContent = record ? "EDIT TOWN NOTE" : "NEW TOWN NOTE";
  $("propertyFields").classList.add("hidden");
  $("visitFields").classList.remove("hidden");
  $("vDate").value = record?.date || dateToday();
  $("vPlace").value = record?.place || "";
  $("vMemo").value = record?.memo || "";
  $("recordDialog").showModal();
}
async function showProperty(id) {
  const p = await getRecord("properties", id);
  if (!p) return;
  const assets = state.assets.filter(a => a.propertyId === id);
  $("detailContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">PROPERTY NOTE</p><h2>${escapeHtml(p.title || "名称未設定")}</h2></div><button class="icon-button" data-close>×</button></div><dl class="detail-grid"><dt>所在地</dt><dd>${escapeHtml(p.address || "未確認")}</dd><dt>賃料</dt><dd>${p.rent ? yen(p.rent) : "未確認"}</dd><dt>管理費等</dt><dd>${p.fee ? yen(p.fee) : "未確認"}</dd><dt>月額合計</dt><dd>${p.rent || p.fee ? yen(Number(p.rent||0)+Number(p.fee||0)) : "未確認"}</dd><dt>最寄駅</dt><dd>${escapeHtml(p.station || "未確認")}</dd><dt>徒歩</dt><dd>${p.walkMinutes ? escapeHtml(p.walkMinutes) + "分" : "未確認"}</dd><dt>間取り</dt><dd>${escapeHtml(p.layout || "未確認")}</dd><dt>面積</dt><dd>${p.area ? escapeHtml(p.area) + "㎡" : "未確認"}</dd><dt>状態</dt><dd>${escapeHtml(p.status || "未整理")}</dd></dl><p class="detail-memo">${escapeHtml(p.memo || "メモはありません。")}</p><h3>関連資料（${assets.length}件）</h3><div class="asset-grid">${assets.map(a=>`<div class="asset-card"><img data-detail-image="${a.id}" alt=""><div class="asset-meta"><b>${escapeHtml(a.kind)}</b><span>${escapeHtml(a.name)}</span></div></div>`).join("")}</div><div class="dialog-actions"><button class="button button-quiet" data-close>閉じる</button><button class="button button-dark" data-edit-property="${p.id}">編集する</button></div>`;
  for (const a of assets) {
    const img = document.querySelector(`[data-detail-image="${a.id}"]`);
    if (img && a.blob) img.src = URL.createObjectURL(a.blob);
  }
  $("detailDialog").showModal();
}
async function showVisit(id) {
  const v = await getRecord("visits", id);
  if (!v) return;
  const linked = state.properties.filter(p => p.visitId === id);
  $("detailContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">TOWN JOURNAL · ${escapeHtml(v.date || "")}</p><h2>${escapeHtml(v.place || "地域名未設定")}</h2></div><button class="icon-button" data-close>×</button></div><p class="detail-memo">${escapeHtml(v.memo || "メモはありません。")}</p><h3>関連する物件（${linked.length}件）</h3>${linked.map(p=>`<p>・${escapeHtml(p.title || "名称未設定")}</p>`).join("") || '<p class="hint">まだ物件は紐付いていません。</p>'}<div class="dialog-actions"><button class="button button-quiet" data-close>閉じる</button><button class="button button-dark" data-edit-visit="${v.id}">編集する</button></div>`;
  $("detailDialog").showModal();
}
async function saveForm(event) {
  event.preventDefault();
  const type = $("recordType").value, id = $("recordId").value || uid(), now = new Date().toISOString();
  if (type === "property") {
    const previous = await getRecord("properties", id);
    const record = { ...previous, id, title: $("pTitle").value.trim(), address: $("pAddress").value.trim(), rent: $("pRent").value === "" ? null : Number($("pRent").value), fee: $("pFee").value === "" ? null : Number($("pFee").value), station: $("pStation").value.trim(), walkMinutes: $("pWalk").value === "" ? null : Number($("pWalk").value), layout: $("pLayout").value.trim(), area: $("pArea").value === "" ? null : Number($("pArea").value), status: $("pStatus").value, visitId: $("pVisit").value || null, memo: $("pMemo").value.trim(), createdAt: previous?.createdAt || now, updatedAt: now };
    await saveRecord("properties", record);
  } else {
    const previous = await getRecord("visits", id);
    await saveRecord("visits", { ...previous, id, date: $("vDate").value, place: $("vPlace").value.trim(), memo: $("vMemo").value.trim(), createdAt: previous?.createdAt || now, updatedAt: now });
  }
  $("recordDialog").close(); await refresh(); toast("記録を保存しました。");
}
async function saveSelectedImages(files) {
  if (!files.length) return;
  $("assetSaveStatus").textContent = "原画像を保存しています…";
  let saved = 0;
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    await saveImageAsset(file, { kind: $("assetKind").value, memo: $("assetMemo").value.trim() });
    saved++;
  }
  $("assetSaveStatus").textContent = saved ? `${saved}件の原画像を保存しました。` : "画像ファイルが選択されていません。";
  if (saved) { $("assetFile").value = ""; $("quickFile").value = ""; await refresh(); toast(`${saved}件の画像を保存しました。`); }
}
async function linkAsset(id) {
  if (!state.properties.length) { toast("先に物件を登録してください。"); return; }
  const choices = state.properties.map((p,i)=>`${i+1}. ${p.title || "名称未設定"} — ${p.address || "所在地未入力"}`).join("\n");
  const answer = prompt("紐付ける物件の番号を入力してください。\n" + choices);
  const index = Number(answer) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= state.properties.length) return;
  const asset = await getRecord("assets", id);
  asset.propertyId = state.properties[index].id;
  await saveRecord("assets", asset); await refresh(); toast("物件に資料を紐付けました。");
}
async function exportBackup() {
  const data = await exportAllData();
  const serialized = JSON.stringify(data, (key,value) => value instanceof Blob ? { __blob: true, type: value.type, data: null } : value);
  const enriched = { ...data, assets: await Promise.all(data.assets.map(async a => ({ ...a, blobData: await blobToDataUrl(a.blob), blob: undefined }))) };
  const blob = new Blob([JSON.stringify(enriched)], {type:"application/json"});
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = `maisoku-ai-backup-${dateToday()}.json`; a.click(); URL.revokeObjectURL(url);
  $("backupStatus").textContent = "バックアップを書き出しました。";
}
function blobToDataUrl(blob) {
  return new Promise((resolve,reject) => { const r = new FileReader(); r.onload=()=>resolve(r.result); r.onerror=()=>reject(r.error); r.readAsDataURL(blob); });
}
function dataUrlToBlob(dataUrl) {
  const [meta, data] = dataUrl.split(",");
  const mime = (meta.match(/data:([^;]+)/) || [,"application/octet-stream"])[1];
  const binary = atob(data), bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}
async function importBackup(file) {
  const parsed = JSON.parse(await file.text());
  if (parsed.app !== "maisoku-ai-2" || !Array.isArray(parsed.properties) || !Array.isArray(parsed.visits) || !Array.isArray(parsed.assets)) throw new Error("マイソクAI 2.0のバックアップ形式ではありません。");
  const confirmed = confirm("現在の記録をバックアップ内容で置き換えます。事前に現在のデータも書き出しましたか？");
  if (!confirmed) return;
  parsed.assets = parsed.assets.map(a => { const copy={...a}; if(copy.blobData){copy.blob=dataUrlToBlob(copy.blobData);delete copy.blobData;} return copy; });
  await replaceAllData(parsed); await refresh(); $("backupStatus").textContent="バックアップを読み込みました。"; toast("データを復元しました。");
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.tab) setTab(target.dataset.tab);
  if (target.hasAttribute("data-close")) { target.closest("dialog")?.close(); }
  if (target.id === "visitBtn") openVisitForm();
  if (target.id === "propertyBtn") openPropertyForm();
  if (target.id === "captureBtn") $("assetDialog").showModal();
  if (target.id === "backupBtn") $("backupDialog").showModal();
  if (target.id === "exportBtn") { try { await exportBackup(); } catch(e) { $("backupStatus").textContent=e.message; } }
  if (target.dataset.editProperty) { $("detailDialog").close(); openPropertyForm(state.properties.find(p=>p.id===target.dataset.editProperty)); }
  if (target.dataset.editVisit) { $("detailDialog").close(); openVisitForm(state.visits.find(v=>v.id===target.dataset.editVisit)); }
  if (target.dataset.detailProperty) await showProperty(target.dataset.detailProperty);
  if (target.dataset.detailVisit) await showVisit(target.dataset.detailVisit);
  if (target.dataset.linkAsset) await linkAsset(target.dataset.linkAsset);
  if (target.dataset.deleteAsset) {
    if (confirm("この資料画像を削除しますか？")) { await deleteRecord("assets",target.dataset.deleteAsset); await refresh(); toast("資料を削除しました。"); }
  }
});
$("recordForm").addEventListener("submit", saveForm);
$("assetForm").addEventListener("submit", async e => { e.preventDefault(); try { await saveSelectedImages([...$("assetFile").files]); } catch(err) { $("assetSaveStatus").textContent = "保存できませんでした: " + err.message; } });
$("assetFile").addEventListener("change", () => { $("assetSaveStatus").textContent = $("assetFile").files.length ? `${$("assetFile").files.length}件を選択中。保存ボタンで原画像を保存します。` : ""; });
$("quickFile").addEventListener("change", async () => { try { await saveSelectedImages([...$("quickFile").files]); } catch(e) { toast("保存失敗: " + e.message); } });
$("propertySearch").addEventListener("input", render);
$("importFile").addEventListener("change", async e => { const file=e.target.files?.[0]; if(!file)return; try{await importBackup(file);}catch(err){$("backupStatus").textContent="読み込み失敗: "+err.message;} e.target.value=""; });
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>b.closest("dialog")?.close()));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

try { await refresh(); } catch (error) { toast("保存領域を開けません: " + error.message); }
