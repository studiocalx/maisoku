import { STORES, allRecords, saveRecord, deleteRecord, getRecord, replaceAllData, exportAllData, saveImageAsset } from "./db.js";
import { FIELD_DEFS, DEFAULT_CRITERIA, AREA_ITEM_DEFS, VIEWING_CHECKLIST, CONTRACT_CHECKLIST, DEFAULT_BASIC_CONDITIONS, HOUSING_REFERENCE, DEFAULT_SETTINGS } from "./criteria.js";
import { fieldValue, evaluateProperty, evaluateArea, housingReferenceFor, buildAgencyQuestions } from "./evaluation.js";

const $ = (id) => document.getElementById(id);
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const yen = (value) => Number(value || 0).toLocaleString("ja-JP") + "円";
const dateToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const deepClone = (v) => JSON.parse(JSON.stringify(v));
const FIELD_LABEL = Object.fromEntries(FIELD_DEFS.map(d => [d.key, d.label]));
const TEXTAREA_KEYS = new Set(["notes", "special_terms", "other_initial_costs", "monthly_extra_costs", "other_equipment", "special_notes"]);
const COST_KEYS = new Set(["rent_yen", "management_fee_yen", "deposit", "key_money", "security_deposit", "brokerage_fee", "guarantor_fee_yen", "key_exchange_fee_yen", "cleaning_fee_yen", "fire_insurance_yen", "other_initial_costs", "monthly_extra_costs"]);
const CONTRACT_KEYS = new Set(["contract_period", "renewal_fee", "cancellation_notice", "early_termination_penalty", "guarantor_condition", "special_terms", "available_from"]);
const CHECK_STATES = ["未確認", "問題なし", "要確認", "対象外"];
const ORIGIN_LABEL = { ai: "AI読み取り", user: "手入力", "user-corrected": "手修正", oral: "口頭確認", onsite: "現地確認", document: "資料確認" };
const MARK_LABEL = { good: "○", fair: "△", bad: "×", na: "対象外" };

const state = {
  tab: "properties",
  properties: [], areas: [], areaEvaluations: [], agencies: [], visits: [], assets: [],
  extractions: [], aiAnalyses: [], propertyEvaluations: [], checklistRecords: [],
  settings: null,
  compareIds: new Set(),
  detailId: null, detailTab: "summary",
  assetTargetPropertyId: null,
  continuousSavedCount: 0,
  pendingDiff: null,
  checklistWork: null,
  areaDetailId: null
};

let toastTimer;
let objectUrls = [];
const batchState = { running: false, total: 0, done: 0, notice: null };
function clearObjectUrls() { for (const u of objectUrls) URL.revokeObjectURL(u); objectUrls = []; }
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2800);
}
function sortNewest(items, key = "updatedAt") {
  return [...items].sort((a, b) => String(b[key] || b.createdAt || "").localeCompare(String(a[key] || a.createdAt || "")));
}
function fv(p, key) {
  try { const v = fieldValue(p, key); return v === undefined ? null : v; }
  catch { return p?.fields?.[key]?.value ?? null; }
}
function fmtVal(def, value) {
  if (value === null || value === undefined || value === "") return "未確認";
  if (def && def.type === "yen") return yen(value);
  if (def && def.key === "area_sqm") return value + "㎡";
  if (def && def.key === "walk_minutes") return "徒歩" + value + "分";
  return String(value);
}
function fmtKey(key, value) { return fmtVal(FIELD_DEFS.find(d => d.key === key), value); }
function monthlyTotal(p) {
  const r = fv(p, "rent_yen"), f = fv(p, "management_fee_yen");
  if (r === null && f === null) return null;
  return Number(r || 0) + Number(f || 0);
}
function latestEval(propertyId) {
  const list = state.propertyEvaluations.filter(e => e.propertyId === propertyId);
  return list.length ? sortNewest(list, "createdAt")[0] : null;
}
function latestAreaEval(areaId) {
  const list = state.areaEvaluations.filter(e => e.areaId === areaId);
  return list.length ? sortNewest(list, "createdAt")[0] : null;
}
function latestAnalysis(propertyId) {
  const list = state.aiAnalyses.filter(a => a.propertyId === propertyId);
  return list.length ? sortNewest(list, "createdAt")[0] : null;
}
function areaName(id) { return state.areas.find(a => a.id === id)?.name || ""; }
function agencyName(id) { return state.agencies.find(a => a.id === id)?.name || ""; }
function cityForAreaName(name) {
  if (!name) return null;
  for (const city of Object.keys(HOUSING_REFERENCE)) if (name.includes(city)) return city;
  return null;
}
function assetUrl(asset) {
  if (!asset || !asset.blob) return null;
  const url = URL.createObjectURL(asset.blob);
  objectUrls.push(url);
  return url;
}

async function loadSettings() {
  let s = await getRecord("settings", "app");
  if (!s) {
    s = { ...deepClone(DEFAULT_SETTINGS), id: "app" };
    if (!Array.isArray(s.basicConditions) || !s.basicConditions.length) s.basicConditions = [...DEFAULT_BASIC_CONDITIONS];
    await saveRecord("settings", s);
  }
  state.settings = s;
  return s;
}
async function refresh() {
  const [properties, areas, areaEvaluations, agencies, visits, assets, extractions, aiAnalyses, propertyEvaluations, checklistRecords] = await Promise.all([
    allRecords("properties"), allRecords("areas"), allRecords("areaEvaluations"), allRecords("agencies"),
    allRecords("visits"), allRecords("assets"), allRecords("extractions"), allRecords("aiAnalyses"),
    allRecords("propertyEvaluations"), allRecords("checklistRecords")
  ]);
  Object.assign(state, { properties, areas, areaEvaluations, agencies, visits, assets, extractions, aiAnalyses, propertyEvaluations, checklistRecords });
  $("propertyCount").textContent = properties.length;
  $("areaCount").textContent = areas.length;
  $("visitCount").textContent = visits.length;
  $("assetCount").textContent = assets.filter(a => !a.propertyId && !a.visitId && !a.areaId).length;
  const unreadCount = unreadAssetList().length;
  $("assetsTabBtn").textContent = unreadCount ? `未整理資料（未読${unreadCount}）` : "未整理資料";
  render();
}
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  ["properties", "areas", "visits", "assets"].forEach(name => $(name + "Panel").classList.toggle("hidden", name !== tab));
  render();
}
function emptyState(title, sub) { return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(sub)}</span></div>`; }

function render() {
  clearObjectUrls();
  renderProperties(); renderAreas(); renderVisits(); renderAssets();
}
function renderProperties() {
  const q = $("propertySearch").value.trim().toLowerCase();
  const properties = sortNewest(state.properties).filter(p => {
    if (!q) return true;
    return [fv(p, "title"), fv(p, "address"), fv(p, "station"), areaName(p.areaId)].some(v => String(v || "").toLowerCase().includes(q));
  });
  $("propertiesList").innerHTML = properties.length ? properties.map(p => {
    const ev = latestEval(p.id);
    const total = monthlyTotal(p);
    const walk = fv(p, "walk_minutes"), station = fv(p, "station");
    return `<article class="record-card"><input class="compare-check" type="checkbox" aria-label="比較対象に選択" data-compare="${p.id}" ${state.compareIds.has(p.id) ? "checked" : ""}><button class="record-main" data-detail-property="${p.id}"><span class="record-kicker">${ev ? `評価 ${ev.totalScore === null || ev.totalScore === undefined ? "—" : ev.totalScore}点 · ${escapeHtml(ev.verdict || "")} · 充足率${ev.sufficiencyRate ?? "—"}%` : "未評価"}</span><strong>${escapeHtml(fv(p, "title") || "名称未設定の物件")}</strong><span class="record-sub">${escapeHtml(fv(p, "address") || "所在地未入力")}${station ? " / " + escapeHtml(station) : ""}${walk !== null && walk !== undefined ? " 徒歩" + walk + "分" : ""}</span><span class="record-price">${total !== null ? "家賃＋管理費 " + yen(total) + " / 月" : "家賃未確認"}</span><span class="status-chip">${escapeHtml(p.status || "検討中")}</span></button><button class="mini-button" data-edit-property="${p.id}">編集</button></article>`;
  }).join("") : emptyState("物件の記録はまだありません。", "マイソクを撮影するか、手入力で登録しましょう。");
  $("compareBar").classList.toggle("hidden", state.compareIds.size === 0);
  $("compareCount").textContent = state.compareIds.size + "件選択中";
  $("compareBtn").disabled = state.compareIds.size < 2;
}
function renderAreas() {
  const areas = sortNewest(state.areas);
  $("areasList").innerHTML = areas.length ? areas.map(a => {
    const ev = latestAreaEval(a.id);
    const pCount = state.properties.filter(p => p.areaId === a.id).length;
    const vCount = state.visits.filter(v => v.areaId === a.id).length;
    return `<article class="record-card"><button class="record-main" data-detail-area="${a.id}"><span class="record-kicker">${ev ? `地域評価 ${ev.totalScore === null || ev.totalScore === undefined ? "—" : ev.totalScore}点 · ${escapeHtml(ev.verdict || "")}` : "地域評価 未実施"}</span><strong>${escapeHtml(a.name || "地域名未設定")}</strong><span class="record-sub">${escapeHtml((a.stationNames || []).join("・") || "駅未入力")} / 物件${pCount}件・訪問${vCount}件</span></button><button class="mini-button" data-edit-area="${a.id}">編集</button></article>`;
  }).join("") : emptyState("地域の記録はまだありません。", "気になる街・エリアを登録すると、地域評価を蓄積できます。");
}
function renderVisits() {
  const visits = sortNewest(state.visits, "date");
  $("visitsList").innerHTML = visits.length ? visits.map(v => `<article class="record-card"><button class="record-main" data-detail-visit="${v.id}"><span class="record-kicker">${escapeHtml((v.date || "").replace("T", " ").slice(0, 16) || "日時未設定")}</span><strong>${escapeHtml(areaName(v.areaId) || "地域未設定")}${agencyName(v.agencyId) ? " / " + escapeHtml(agencyName(v.agencyId)) : ""}</strong><span class="record-sub">${escapeHtml(v.impression || v.conversationMemo || "メモはありません")}</span></button><button class="mini-button" data-edit-visit="${v.id}">編集</button></article>`).join("") : emptyState("訪問記録はまだありません。", "不動産会社への訪問や現地確認の記録を残せます。");
  const agencies = sortNewest(state.agencies);
  $("agenciesList").innerHTML = agencies.length ? agencies.map(a => `<article class="record-card"><button class="record-main" data-detail-agency="${a.id}"><strong>${escapeHtml(a.name || "会社名未設定")}</strong><span class="record-sub">${escapeHtml(areaName(a.areaId) || "")}${a.address ? " / " + escapeHtml(a.address) : ""}</span></button><button class="mini-button" data-edit-agency="${a.id}">編集</button></article>`).join("") : emptyState("不動産会社はまだ登録されていません。", "訪問した会社を登録すると、物件や訪問記録に紐付けられます。");
}
/* ---------- 未読み取り（保存済み・未解析）資料 ---------- */
function hasExtractionFor(assetId) { return state.extractions.some(e => e.assetId === assetId); }
function isUnreadCandidate(a) {
  // 訪問写真と現地写真（チェックリスト写真）はマイソク読み取りの対象外。それ以外の保存済み資料が対象。
  return !!a && !a.visitId && a.kind !== "現地写真";
}
function unreadAssetList() {
  const ids = new Set(state.extractions.map(e => e.assetId));
  return sortNewest(state.assets.filter(a => isUnreadCandidate(a) && !ids.has(a.id)), "createdAt");
}
function assetAnalyzeButtons(a) {
  return hasExtractionFor(a.id)
    ? `<button class="mini-button" data-review-asset="${a.id}">結果を確認</button>`
    : `<button class="mini-button" data-analyze-asset="${a.id}">AIで読み取り</button>`;
}
function renderUnreadBar() {
  const bar = $("unreadBar");
  if (!bar) return;
  if (batchState.running) {
    bar.innerHTML = `<div class="unread-box"><span class="batch-progress">読み取り中 ${batchState.done}/${batchState.total} …</span><span class="hint">保存済みの原画像を1件ずつ順番に読み取っています。</span></div>`;
    return;
  }
  if (batchState.notice) {
    const n = batchState.notice;
    bar.innerHTML = `<div class="unread-box"><span class="continuous-count">まとめて読み取りが終わりました（成功 ${n.succeeded.length} 件${n.failed.length ? `／失敗 ${n.failed.length} 件` : ""}）</span>
    ${n.succeeded.length ? `<div class="asset-actions">${n.succeeded.map(id => { const a = state.assets.find(x => x.id === id); return `<button class="mini-button" data-review-asset="${id}">結果を確認${a ? "（" + escapeHtml(a.name || a.kind || "資料") + "）" : ""}</button>`; }).join("")}</div>` : ""}
    ${n.failed.length ? `<span class="hint">読み取れなかった資料：${n.failed.map(f => escapeHtml(f.name || "資料")).join("、")}（原画像は保存済みで、未読み取りのまま残っています。通信状態を確認して再度お試しください）</span>` : ""}
    <div class="asset-actions"><button class="mini-button" data-dismiss-batch>通知を閉じる</button></div></div>`;
    return;
  }
  const unread = unreadAssetList();
  bar.innerHTML = unread.length ? `<div class="unread-box"><span class="continuous-count">未読み取り ${unread.length} 件</span><button class="mini-button" data-batch-analyze>未読み取りをまとめて読み取り</button><span class="hint">保存済みの原画像をAIで読み取ります。1件ずつ確認したい場合は、各資料の「AIで読み取り」を押してください。</span></div>` : "";
}
function renderAssets() {
  const assets = sortNewest(state.assets, "createdAt").filter(a => !a.propertyId && !a.visitId && !a.areaId);
  $("assetsList").innerHTML = assets.length ? assets.map(a => `<article class="asset-card"><img data-asset-img="${a.id}" alt=""><div class="asset-meta"><b>${escapeHtml(a.kind || "資料")}</b>${hasExtractionFor(a.id) ? "" : '<span class="status-chip">未読み取り</span>'}<span>${escapeHtml(a.name || "")}</span>${a.memo ? `<span>${escapeHtml(a.memo)}</span>` : ""}<small>${escapeHtml((a.createdAt || "").slice(0, 16).replace("T", " "))}</small><div class="asset-actions">${assetAnalyzeButtons(a)}<button class="mini-button" data-link-asset="property" data-id="${a.id}">物件に紐付け</button><button class="mini-button" data-link-asset="visit" data-id="${a.id}">訪問記録に紐付け</button><button class="mini-button danger" data-delete-asset="${a.id}">削除</button></div></div></article>`).join("") : emptyState("未整理資料はありません。", "撮影した画像は、行き先が分からなくても保存できます。");
  for (const a of assets) {
    const img = document.querySelector(`[data-asset-img="${CSS.escape(a.id)}"]`);
    if (img) { const u = assetUrl(a); if (u) img.src = u; }
  }
  renderUnreadBar();
}

/* ---------- 評価スナップショット ---------- */
function fieldSnapshotOf(p) {
  const snap = {};
  for (const def of FIELD_DEFS) snap[def.key] = fv(p, def.key);
  return snap;
}
async function createSnapshot(property, trigger, changedFields = [], changeReason = "") {
  const settings = state.settings;
  const ev = evaluateProperty(property, settings);
  let areaEvaluationId = null;
  if (property.areaId) areaEvaluationId = latestAreaEval(property.areaId)?.id || null;
  const city = cityForAreaName(areaName(property.areaId));
  let hr = null;
  if (city) { try { hr = housingReferenceFor(city, fv(property, "rent_yen"), fv(property, "area_sqm")); } catch { hr = null; } }
  if (!hr && areaName(property.areaId)) { try { hr = housingReferenceFor(areaName(property.areaId), fv(property, "rent_yen"), fv(property, "area_sqm")); } catch { hr = null; } }
  const snapshot = {
    id: uid(), propertyId: property.id, areaEvaluationId,
    criteriaVersion: settings.criteriaVersion || 1,
    items: ev.items, totalScore: ev.totalScore, sufficiencyRate: ev.sufficiencyRate,
    confidence: ev.confidence, verdict: ev.verdict, categoryScores: ev.categoryScores,
    housingReference: hr || null, fieldSnapshot: fieldSnapshotOf(property),
    trigger, changedFields, changeReason, createdAt: nowIso()
  };
  await saveRecord("propertyEvaluations", snapshot);
  return snapshot;
}
function changedFieldsVs(prevSnapshot, property) {
  if (!prevSnapshot || !prevSnapshot.fieldSnapshot) return FIELD_DEFS.filter(d => fv(property, d.key) !== null).map(d => d.key);
  const changed = [];
  for (const def of FIELD_DEFS) {
    const before = prevSnapshot.fieldSnapshot[def.key] ?? null;
    const after = fv(property, def.key);
    if (JSON.stringify(before) !== JSON.stringify(after ?? null)) changed.push(def.key);
  }
  return changed;
}

/* ---------- 物件フォーム（FIELD_DEFSから生成） ---------- */
function buildPropertyFieldGroups() {
  const groups = [];
  for (const def of FIELD_DEFS) if (!groups.includes(def.group)) groups.push(def.group);
  $("propertyFieldGroups").innerHTML = groups.map(group => {
    const defs = FIELD_DEFS.filter(d => d.group === group);
    return `<div class="field-group"><h3>${escapeHtml(group)}</h3><div class="form-grid">${defs.map(def => {
      const id = "pf_" + def.key;
      if (def.type === "select") {
        return `<label>${escapeHtml(def.label)}<select id="${id}" data-pf="${def.key}"><option value="">未確認</option>${(def.options || []).filter(o => o !== "").map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("")}</select><span class="origin-note" data-origin-note="${def.key}"></span></label>`;
      }
      if (TEXTAREA_KEYS.has(def.key)) {
        return `<label class="wide">${escapeHtml(def.label)}<textarea id="${id}" data-pf="${def.key}" rows="2"></textarea><span class="origin-note" data-origin-note="${def.key}"></span></label>`;
      }
      const inputType = (def.type === "number" || def.type === "yen") ? "number" : "text";
      const step = def.type === "yen" ? "1" : def.type === "number" ? "any" : "";
      return `<label>${escapeHtml(def.label)}<input id="${id}" data-pf="${def.key}" type="${inputType}"${step ? ` step="${step}"` : ""}><span class="origin-note" data-origin-note="${def.key}"></span></label>`;
    }).join("")}</div></div>`;
  }).join("");
}
function areaOptions(selected, includeUnset = true) {
  return (includeUnset ? '<option value="">未設定</option>' : "") + state.areas.map(a => `<option value="${a.id}" ${a.id === selected ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("");
}
function agencyOptions(selected) {
  return '<option value="">未設定</option>' + state.agencies.map(a => `<option value="${a.id}" ${a.id === selected ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("");
}
function openPropertyForm(record = null) {
  $("propertyForm").reset();
  $("propId").value = record?.id || "";
  $("propertyFormTitle").textContent = record ? "物件を編集" : "物件を登録";
  $("propertyFormEyebrow").textContent = record ? "EDIT PROPERTY" : "NEW PROPERTY";
  $("propArea").innerHTML = areaOptions(record?.areaId || "");
  $("propAgency").innerHTML = agencyOptions(record?.agencyId || "");
  $("propStatus").value = record?.status || "検討中";
  $("propMemo").value = record?.memo || "";
  const visitIds = new Set(record?.visitIds || []);
  $("propVisits").innerHTML = state.visits.length ? sortNewest(state.visits, "date").map(v => `<label><input type="checkbox" data-prop-visit="${v.id}" ${visitIds.has(v.id) ? "checked" : ""}>${escapeHtml((v.date || "").slice(0, 10))} ${escapeHtml(areaName(v.areaId) || "地域未設定")}${agencyName(v.agencyId) ? " / " + escapeHtml(agencyName(v.agencyId)) : ""}</label>`).join("") : '<p class="hint">訪問記録はまだありません。</p>';
  for (const def of FIELD_DEFS) {
    const el = document.querySelector(`[data-pf="${def.key}"]`);
    if (!el) continue;
    const val = record ? fv(record, def.key) : null;
    el.value = val === null || val === undefined ? "" : val;
    const note = document.querySelector(`[data-origin-note="${def.key}"]`);
    if (note) {
      const f = record?.fields?.[def.key];
      note.textContent = f && val !== null && val !== undefined ? "出典：" + (ORIGIN_LABEL[f.origin] || f.origin || "") : "";
    }
  }
  $("propertyDialog").showModal();
}
async function savePropertyForm(event) {
  event.preventDefault();
  const id = $("propId").value || uid();
  const now = nowIso();
  const previous = $("propId").value ? await getRecord("properties", id) : null;
  const fields = {};
  for (const def of FIELD_DEFS) {
    const el = document.querySelector(`[data-pf="${def.key}"]`);
    const raw = el ? el.value : "";
    let value = null;
    if (raw !== "" && raw !== null && raw !== undefined) {
      value = (def.type === "number" || def.type === "yen") ? Number(raw) : String(raw).trim();
      if (typeof value === "string" && value === "") value = null;
      if (typeof value === "number" && Number.isNaN(value)) value = null;
    }
    const prev = previous?.fields?.[def.key] || null;
    const prevValue = prev ? (prev.value ?? null) : null;
    if (prev && JSON.stringify(prevValue) === JSON.stringify(value)) {
      fields[def.key] = prev;
    } else if (!prev && value === null) {
      fields[def.key] = { value: null, origin: "user", aiValue: null, extractionId: null, updatedAt: now };
    } else {
      let origin = "user";
      if (prev && prev.origin === "ai") origin = "user-corrected";
      else if (prev && prev.origin) origin = prev.origin === "ai" ? "user-corrected" : "user";
      fields[def.key] = { value, origin, aiValue: prev?.aiValue ?? null, extractionId: prev?.extractionId ?? null, updatedAt: now };
    }
  }
  const visitIds = [...document.querySelectorAll("[data-prop-visit]:checked")].map(el => el.dataset.propVisit);
  const record = {
    ...(previous || {}),
    id,
    areaId: $("propArea").value || null,
    agencyId: $("propAgency").value || null,
    visitIds,
    status: $("propStatus").value || "検討中",
    memo: $("propMemo").value.trim(),
    fields,
    manualMarks: previous?.manualMarks || {},
    createdAt: previous?.createdAt || now,
    updatedAt: now
  };
  const prevSnapshot = latestEval(id);
  await saveRecord("properties", record);
  const changed = changedFieldsVs(prevSnapshot, record);
  await createSnapshot(record, previous ? "手動" : "初回登録", changed, previous ? "物件フォームから保存" : "");
  $("propertyDialog").close();
  await refresh();
  toast("物件を保存し、評価を記録しました。");
  await showProperty(id, "summary");
}

/* ---------- 地域・不動産会社・訪問フォーム ---------- */
function openAreaForm(record = null) {
  $("areaForm").reset();
  $("areaId").value = record?.id || "";
  $("areaFormTitle").textContent = record ? "地域を編集" : "地域を登録";
  $("areaName").value = record?.name || "";
  $("areaStations").value = (record?.stationNames || []).join(", ");
  $("areaNote").value = record?.note || "";
  $("areaDialog").showModal();
}
async function saveAreaForm(event) {
  event.preventDefault();
  const id = $("areaId").value || uid();
  const now = nowIso();
  const previous = $("areaId").value ? await getRecord("areas", id) : null;
  const record = {
    ...(previous || {}), id,
    name: $("areaName").value.trim(),
    stationNames: $("areaStations").value.split(/[,、]/).map(s => s.trim()).filter(Boolean),
    note: $("areaNote").value.trim(),
    createdAt: previous?.createdAt || now, updatedAt: now
  };
  if (!record.name) { toast("地域名を入力してください。"); return; }
  await saveRecord("areas", record);
  $("areaDialog").close();
  await refresh();
  toast("地域を保存しました。");
}
function openAgencyForm(record = null) {
  $("agencyForm").reset();
  $("agencyId").value = record?.id || "";
  $("agencyFormTitle").textContent = record ? "不動産会社を編集" : "不動産会社を登録";
  $("agencyName").value = record?.name || "";
  $("agencyArea").innerHTML = areaOptions(record?.areaId || "");
  $("agencyAddress").value = record?.address || "";
  $("agencyContact").value = record?.contactNote || "";
  $("agencyDialog").showModal();
}
async function saveAgencyForm(event) {
  event.preventDefault();
  const id = $("agencyId").value || uid();
  const now = nowIso();
  const previous = $("agencyId").value ? await getRecord("agencies", id) : null;
  const record = {
    ...(previous || {}), id,
    name: $("agencyName").value.trim(),
    areaId: $("agencyArea").value || null,
    address: $("agencyAddress").value.trim(),
    contactNote: $("agencyContact").value.trim(),
    createdAt: previous?.createdAt || now, updatedAt: now
  };
  if (!record.name) { toast("会社名を入力してください。"); return; }
  await saveRecord("agencies", record);
  $("agencyDialog").close();
  await refresh();
  // 呼び出し元のセレクトへ反映
  const propSel = $("propAgency"); if (propSel) propSel.innerHTML = agencyOptions(id);
  const visitSel = $("visitAgency"); if (visitSel) visitSel.innerHTML = agencyOptions(id);
  toast("不動産会社を保存しました。");
}
function localDateTimeValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function openVisitForm(record = null) {
  $("visitForm").reset();
  $("visitId").value = record?.id || "";
  $("visitFormTitle").textContent = record ? "訪問記録を編集" : "訪問記録を追加";
  $("visitDate").value = record ? localDateTimeValue(record.date) : localDateTimeValue(nowIso());
  $("visitArea").innerHTML = areaOptions(record?.areaId || "");
  $("visitAgency").innerHTML = agencyOptions(record?.agencyId || "");
  $("visitStaff").value = record?.staffName || "";
  $("visitMemo").value = record?.conversationMemo || "";
  const introduced = new Set(record?.introducedPropertyIds || []);
  $("visitProps").innerHTML = state.properties.length ? sortNewest(state.properties).map(p => `<label><input type="checkbox" data-visit-prop="${p.id}" ${introduced.has(p.id) ? "checked" : ""}>${escapeHtml(fv(p, "title") || "名称未設定")}（${escapeHtml(fv(p, "address") || "所在地未入力")}）</label>`).join("") : '<p class="hint">物件はまだありません。</p>';
  $("visitImpression").value = record?.impression || "";
  $("visitNextChecks").value = (record?.nextChecks || []).join("\n");
  $("visitDialog").showModal();
}
async function saveVisitForm(event) {
  event.preventDefault();
  const id = $("visitId").value || uid();
  const now = nowIso();
  const previous = $("visitId").value ? await getRecord("visits", id) : null;
  const dateRaw = $("visitDate").value;
  const record = {
    ...(previous || {}), id,
    areaId: $("visitArea").value || null,
    agencyId: $("visitAgency").value || null,
    date: dateRaw ? new Date(dateRaw).toISOString() : now,
    staffName: $("visitStaff").value.trim(),
    conversationMemo: $("visitMemo").value.trim(),
    introducedPropertyIds: [...document.querySelectorAll("[data-visit-prop]:checked")].map(el => el.dataset.visitProp),
    impression: $("visitImpression").value.trim(),
    nextChecks: $("visitNextChecks").value.split("\n").map(s => s.trim()).filter(Boolean),
    createdAt: previous?.createdAt || now, updatedAt: now
  };
  await saveRecord("visits", record);
  const files = [...($("visitPhotos").files || [])];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try { await saveImageAsset(file, { kind: "現地写真", memo: "", visitId: id, areaId: record.areaId }); } catch { /* 写真保存失敗は訪問記録本体に影響させない */ }
  }
  $("visitDialog").close();
  await refresh();
  toast("訪問記録を保存しました。");
}

/* ---------- 物件詳細 ---------- */
function itemMarkDisplay(item) {
  if (!item) return "—";
  if (item.state === "na") return "対象外";
  if (item.state === "insufficient") return "情報不足";
  return MARK_LABEL[item.mark] || item.mark || "—";
}
function itemTableHtml(items) {
  const cats = [];
  for (const it of items || []) if (!cats.includes(it.category)) cats.push(it.category);
  if (!cats.length) return '<p class="hint">評価項目がありません。</p>';
  return cats.map(cat => {
    const rows = (items || []).filter(i => i.category === cat);
    return `<p class="cat-heading">${escapeHtml(cat)}</p><div class="item-table-wrap"><table class="item-table"><thead><tr><th>項目</th><th>判定</th><th>重み</th><th>根拠</th></tr></thead><tbody>${rows.map(i => `<tr><td>${escapeHtml(i.label)}</td><td class="mark-cell">${escapeHtml(itemMarkDisplay(i))}</td><td>×${escapeHtml(i.weight ?? 1)}</td><td>${escapeHtml(i.rationale || "")}</td></tr>`).join("")}</tbody></table></div>`;
  }).join("");
}
function housingReferenceHtml(property) {
  const city = cityForAreaName(areaName(property.areaId));
  if (!city) return `<div class="reference-panel"><h3>住居費参考表示</h3><p class="hint">対象地域（大阪市・枚方市・門真市・八尾市・東大阪市・尼崎市）を設定すると参考値を表示します。これは参考情報であり、採点対象外です。</p></div>`;
  let hr = null;
  try { hr = housingReferenceFor(city, fv(property, "rent_yen"), fv(property, "area_sqm")); } catch { hr = null; }
  if (!hr) return `<div class="reference-panel"><h3>住居費参考表示</h3><p class="hint">参考値を算出できませんでした（家賃などの情報不足）。これは参考情報であり、採点対象外です。</p></div>`;
  return `<div class="reference-panel"><h3>住居費参考表示（参考情報・採点対象外）</h3><div class="reference-row"><b>${escapeHtml(hr.city || city)}</b><strong>${yen(hr.amount)} / 月</strong></div><p class="reference-status">${escapeHtml(hr.status || "")}${hr.difference !== null && hr.difference !== undefined ? " · 家賃との差 " + (hr.difference > 0 ? "+" : "") + yen(hr.difference) : ""}</p><p class="hint">根拠の確認状況：${escapeHtml(hr.confidence || "")}。${escapeHtml(hr.note || "")} 出典：${escapeHtml(hr.source || "")}</p><p class="hint">これは制度上の参考情報であり、個別の認定額・支給額・利用資格を判定するものではありません。</p></div>`;
}
async function showProperty(id, tab = "summary") {
  clearObjectUrls();
  const p = await getRecord("properties", id);
  if (!p) return;
  state.detailId = id; state.detailTab = tab;
  const settings = state.settings;
  const ev = evaluateProperty(p, settings);
  const snap = latestEval(id);
  const dispScore = snap ? snap.totalScore : ev.totalScore;
  const dispVerdict = snap ? snap.verdict : ev.verdict;
  const dispSuff = snap ? snap.sufficiencyRate : ev.sufficiencyRate;
  const dispConf = snap ? snap.confidence : ev.confidence;
  const analysis = latestAnalysis(id);
  const questions = buildAgencyQuestions(p, ev);
  const tabs = [["summary", "公開用サマリー"], ["internal", "内部詳細"], ["manual", "手動判定"], ["history", "評価履歴"], ["checklist", "チェックリスト"], ["materials", "関連資料"]];
  let body = "";
  if (tab === "summary") {
    const total = monthlyTotal(p);
    const overview = [
      ["名称", fv(p, "title")], ["所在地", fv(p, "address")],
      ["交通", [fv(p, "line"), fv(p, "station")].filter(Boolean).join(" ") + (fv(p, "walk_minutes") !== null && fv(p, "walk_minutes") !== undefined ? " 徒歩" + fv(p, "walk_minutes") + "分" : "")],
      ["間取り", fv(p, "layout")], ["面積", fv(p, "area_sqm") !== null && fv(p, "area_sqm") !== undefined ? fv(p, "area_sqm") + "㎡" : null],
      ["家賃", fv(p, "rent_yen") !== null && fv(p, "rent_yen") !== undefined ? yen(fv(p, "rent_yen")) : null],
      ["管理費", fv(p, "management_fee_yen") !== null && fv(p, "management_fee_yen") !== undefined ? yen(fv(p, "management_fee_yen")) : null],
      ["月額総額", total !== null ? yen(total) : null]
    ];
    const comment = analysis?.publicSummary || (ev.strengths?.length ? "確認できた長所：" + ev.strengths.slice(0, 3).join("／") + "。" : "") + (ev.insufficientItems?.length ? ` まだ情報不足の項目が${ev.insufficientItems.length}件あります。` : " 評価に必要な情報は概ね揃っています。");
    const highlights = (analysis?.highlights?.length ? analysis.highlights : (ev.strengths || [])).slice(0, 5);
    const confirmList = (analysis?.confirmationQuestions?.length ? analysis.confirmationQuestions : (questions.confirmFacts || [])).slice(0, 3);
    const areaEv = p.areaId ? latestAreaEval(p.areaId) : null;
    const budget = settings.monthlyBudgetYen;
    body = `
    <section class="score-panel"><div><p class="eyebrow">総合判定</p><span class="verdict-symbol">${escapeHtml(dispVerdict || "判定保留")}</span><p class="verdict-line">スコア ${dispScore === null || dispScore === undefined ? "—" : dispScore} / 100</p></div><div class="score-side">評価充足率<b>${dispSuff ?? "—"}%</b><p>信頼度：${escapeHtml(dispConf || "—")}</p><p>未確認項目は減点せず、採点対象外として扱います。</p></div></section>
    <h3>物件概要</h3><dl class="detail-grid">${overview.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || "未確認")}</dd>`).join("")}</dl>
    <h3>短評</h3><p class="detail-memo">${escapeHtml(comment)}</p>
    <h3>注目ポイント</h3>${highlights.length ? `<ul class="plain-list">${highlights.map(h => `<li>${escapeHtml(h)}</li>`).join("")}</ul>` : '<p class="hint">資料から確認できた注目ポイントはまだありません。</p>'}
    <h3>確認事項</h3>${confirmList.length ? `<ul class="plain-list">${confirmList.map(h => `<li>${escapeHtml(h)}</li>`).join("")}</ul>` : '<p class="hint">現時点で優先度の高い確認事項はありません。</p>'}
    <h3>地域評価サマリー</h3>${p.areaId ? `<p>${escapeHtml(areaName(p.areaId))}：${areaEv ? `最新評価 ${areaEv.totalScore ?? "—"}点 · ${escapeHtml(areaEv.verdict || "")} · 充足率${areaEv.sufficiencyRate ?? "—"}%` : "地域評価はまだ実施されていません。"} <button class="mini-button" data-open-area="${p.areaId}">地域詳細を開く</button></p>` : '<p class="hint">地域が未設定です。</p>'}
    <h3>基本条件との適合</h3><ul class="plain-list">${(settings.basicConditions || []).map((c, i) => {
      if (!c) return "";
      if (i === 0) {
        const judge = total === null ? "月額総額が未確認のため判定できません" : (budget && total <= budget ? `月額総額 ${yen(total)} は予算目安 ${yen(budget)} 以内です` : `月額総額 ${yen(total)} は予算目安 ${yen(budget || 0)} を超えています`);
        return `<li>${escapeHtml(c)}<br><span class="hint">${escapeHtml(judge)}</span></li>`;
      }
      return `<li>${escapeHtml(c)}<br><span class="hint">自動判定できない条件です。地域評価・現地確認で手動確認してください。</span></li>`;
    }).join("")}</ul>
    ${housingReferenceHtml(p)}`;
  } else if (tab === "internal") {
    const costDefs = FIELD_DEFS.filter(d => COST_KEYS.has(d.key) || /費用/.test(d.group || ""));
    const contractDefs = FIELD_DEFS.filter(d => CONTRACT_KEYS.has(d.key) || /契約/.test(d.group || ""));
    const risks = [...(analysis?.risks || []), ...((ev.insufficientItems || []).map(i => `情報不足：${typeof i === "string" ? i : (i.label || i.key || "")}`))];
    body = `
    <h3>カテゴリ別 項目判定</h3>${itemTableHtml(ev.items)}
    <h3>リスク・情報不足</h3>${risks.length ? `<ul class="plain-list">${risks.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : '<p class="hint">入力済み情報から目立つリスクは検出されていません。未確認項目がないことを意味しません。</p>'}
    <h3>費用注意（初期費用・月額費用）</h3><dl class="detail-grid">${costDefs.map(d => `<dt>${escapeHtml(d.label)}</dt><dd>${escapeHtml(fmtVal(d, fv(p, d.key)))}</dd>`).join("")}</dl>
    <h3>契約注意</h3><dl class="detail-grid">${contractDefs.map(d => `<dt>${escapeHtml(d.label)}</dt><dd>${escapeHtml(fmtVal(d, fv(p, d.key)))}</dd>`).join("")}</dl>
    <h3>追加調査事項</h3>${analysis?.unknowns?.length ? `<ul class="plain-list">${analysis.unknowns.map(u => `<li>${escapeHtml(u)}</li>`).join("")}</ul>` : '<p class="hint">AI分析による追加調査事項はまだありません。</p>'}
    <h3>不動産会社への確認事項</h3>
    <p class="cat-heading">確認すべき事実</p>${questions.confirmFacts?.length ? `<ul class="plain-list">${questions.confirmFacts.map(q2 => `<li>${escapeHtml(q2)}</li>`).join("")}</ul>` : '<p class="hint">現時点で抽出された確認事項はありません。</p>'}
    <p class="cat-heading">相談できる可能性</p>${questions.negotiable?.length ? `<ul class="plain-list">${questions.negotiable.map(q2 => `<li>${escapeHtml(q2)}</li>`).join("")}</ul>` : '<p class="hint">現時点で抽出された相談事項はありません。</p>'}
    ${analysis?.rationaleText ? `<h3>AI分析メモ</h3><p class="detail-memo">${escapeHtml(analysis.rationaleText)}</p>` : ""}`;
  } else if (tab === "manual") {
    body = `<h3>手動判定エディタ</h3><p class="hint">自動判定の項目は「対象外」のみ手動で変更できます（自動項目に○△×を付けても計算には使われません）。手動判定の項目は○△×がそのまま評価に反映されます。</p>
    ${DEFAULT_CRITERIA.map(item => {
      const saved = p.manualMarks?.[item.key] || {};
      const isAuto = item.kind === "auto";
      const opts = [["", "未設定"], ["good", "○"], ["fair", "△"], ["bad", "×"], ["na", "対象外"]];
      return `<div class="manual-row"><div class="manual-label">${escapeHtml(item.label)}<small>${escapeHtml(item.category)} · ${isAuto ? "自動判定（対象外のみ手動可）" : "手動判定"}</small></div><select data-manual-mark="${item.key}">${opts.map(([v, l]) => `<option value="${v}" ${saved.mark === v ? "selected" : ""} ${isAuto && v && v !== "na" ? "disabled" : ""}>${l}</option>`).join("")}</select><input class="manual-note" data-manual-note="${item.key}" placeholder="メモ（任意）" value="${escapeHtml(saved.note || "")}"></div>`;
    }).join("")}
    <div class="dialog-actions"><button class="button button-dark" data-save-manual="${p.id}">手動判定を保存して再評価</button></div>`;
  } else if (tab === "history") {
    const snaps = sortNewest(state.propertyEvaluations.filter(e => e.propertyId === id), "createdAt");
    body = `<h3>評価履歴</h3>` + (snaps.length ? snaps.map(s => `<details class="snapshot-card"><summary><b>${escapeHtml(s.verdict || "")} ${s.totalScore ?? "—"}点</b> · 充足率${s.sufficiencyRate ?? "—"}% · ${escapeHtml((s.createdAt || "").replace("T", " ").slice(0, 16))} · ${escapeHtml(s.trigger || "")}${s.changedFields?.length ? " · 変更：" + s.changedFields.map(k => FIELD_LABEL[k] || k).join("、") : ""}${s.changeReason ? " · " + escapeHtml(s.changeReason) : ""}（基準Ver.${escapeHtml(s.criteriaVersion ?? "")}）</summary>${itemTableHtml(s.items)}</details>`).join("") : '<p class="hint">評価履歴はまだありません。</p>');
  } else if (tab === "checklist") {
    const prog = (kind, defs) => {
      const rec = state.checklistRecords.find(r => r.propertyId === id && r.kind === kind);
      const done = defs.filter(d => rec?.items?.[d.key] && rec.items[d.key].state !== "未確認").length;
      return `確認済み ${done}/${defs.length}`;
    };
    body = `<h3>チェックリスト</h3><div class="detail-tools">
      <button class="mini-button" data-open-checklist="${p.id}" data-kind="viewing">内見チェック <span class="progress-note">${prog("viewing", VIEWING_CHECKLIST)}</span></button>
      <button class="mini-button" data-open-checklist="${p.id}" data-kind="contract">契約前チェック <span class="progress-note">${prog("contract", CONTRACT_CHECKLIST)}</span></button></div>
      <p class="hint">内見チェックは${VIEWING_CHECKLIST.length}項目、契約前チェックは${CONTRACT_CHECKLIST.length}項目です。各項目に状態・メモ・写真を残せます。</p>`;
  } else if (tab === "materials") {
    const assets = sortNewest(state.assets.filter(a => a.propertyId === id), "createdAt");
    body = `<h3>関連資料（${assets.length}件）</h3><div class="detail-tools"><button class="mini-button" data-add-material="${p.id}">追加資料を撮影（AI再読み取り可）</button></div>
    <div class="asset-grid">${assets.map(a => `<div class="asset-card"><img data-detail-img="${a.id}" alt=""><div class="asset-meta"><b>${escapeHtml(a.kind || "資料")}</b>${hasExtractionFor(a.id) ? "" : '<span class="status-chip">未読み取り</span>'}<span>${escapeHtml(a.name || "")}</span>${a.memo ? `<span>${escapeHtml(a.memo)}</span>` : ""}<small>${escapeHtml((a.createdAt || "").slice(0, 16).replace("T", " "))}</small><div class="asset-actions">${assetAnalyzeButtons(a)}<button class="mini-button danger" data-delete-asset-detail="${a.id}">削除</button></div></div></div>`).join("") || '<p class="hint">関連資料はまだありません。</p>'}</div>`;
  }
  $("detailContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">PROPERTY DETAIL · ${escapeHtml(p.status || "検討中")}</p><h2>${escapeHtml(fv(p, "title") || "名称未設定")}</h2></div><button class="icon-button" data-close>×</button></div>
  <div class="detail-tabs">${tabs.map(([k, l]) => `<button class="detail-tab ${k === tab ? "active" : ""}" data-detail-tab="${k}">${l}</button>`).join("")}</div>
  ${body}
  ${p.memo ? `<h3>メモ</h3><p class="detail-memo">${escapeHtml(p.memo)}</p>` : ""}
  <div class="dialog-actions"><button class="button button-quiet" data-delete-property="${p.id}">削除</button><button class="button button-quiet" data-reevaluate="${p.id}">再評価する</button><button class="button button-quiet" data-close>閉じる</button><button class="button button-dark" data-edit-property="${p.id}">編集</button></div>`;
  for (const a of state.assets.filter(a => a.propertyId === id)) {
    const img = document.querySelector(`[data-detail-img="${CSS.escape(a.id)}"]`);
    if (img) { const u = assetUrl(a); if (u) img.src = u; }
  }
  if (!$("detailDialog").open) $("detailDialog").showModal();
}
async function saveManualMarks(propertyId) {
  const p = await getRecord("properties", propertyId);
  if (!p) return;
  const marks = {};
  for (const item of DEFAULT_CRITERIA) {
    const sel = document.querySelector(`[data-manual-mark="${item.key}"]`);
    const note = document.querySelector(`[data-manual-note="${item.key}"]`);
    if (sel && sel.value) marks[item.key] = { mark: sel.value, note: note ? note.value.trim() : "" };
  }
  p.manualMarks = marks;
  p.updatedAt = nowIso();
  await saveRecord("properties", p);
  await createSnapshot(p, "手動再評価", [], "手動判定を更新");
  await refresh();
  toast("手動判定を保存し、再評価しました。");
  await showProperty(propertyId, "manual");
}
async function deleteProperty(propertyId) {
  const p = await getRecord("properties", propertyId);
  if (!p) return;
  if (!confirm(`物件「${fv(p, "title") || "名称未設定"}」を削除しますか？\n評価履歴・AI分析・チェックリストも削除されます。訪問記録そのものは残ります。この操作は取り消せません。`)) return;
  for (const e of state.propertyEvaluations.filter(x => x.propertyId === propertyId)) await deleteRecord("propertyEvaluations", e.id);
  for (const a of state.aiAnalyses.filter(x => x.propertyId === propertyId)) await deleteRecord("aiAnalyses", a.id);
  for (const c of state.checklistRecords.filter(x => x.propertyId === propertyId)) await deleteRecord("checklistRecords", c.id);
  for (const a of state.assets.filter(x => x.propertyId === propertyId)) { a.propertyId = null; await saveRecord("assets", a); }
  state.compareIds.delete(propertyId);
  await deleteRecord("properties", propertyId);
  $("detailDialog").close();
  await refresh();
  toast("物件を削除しました。関連資料は未整理資料に戻しました。");
}

/* ---------- チェックリスト ---------- */
async function openChecklist(propertyId, kind) {
  const p = await getRecord("properties", propertyId);
  if (!p) return;
  const defs = kind === "viewing" ? VIEWING_CHECKLIST : CONTRACT_CHECKLIST;
  let rec = state.checklistRecords.find(r => r.propertyId === propertyId && r.kind === kind) || null;
  if (!rec) rec = { id: uid(), propertyId, kind, items: {}, updatedAt: nowIso() };
  for (const d of defs) if (!rec.items[d.key]) rec.items[d.key] = { state: "未確認", note: "", photoAssetIds: [] };
  state.checklistWork = { record: rec, propertyId, kind };
  renderChecklist();
  $("checklistDialog").showModal();
}
function renderChecklist() {
  clearObjectUrls();
  const work = state.checklistWork;
  if (!work) return;
  const defs = work.kind === "viewing" ? VIEWING_CHECKLIST : CONTRACT_CHECKLIST;
  const title = work.kind === "viewing" ? "内見チェック" : "契約前チェック";
  const rec = work.record;
  $("checklistContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">${work.kind === "viewing" ? "VIEWING" : "CONTRACT"} CHECKLIST</p><h2>${title}</h2></div><button class="icon-button" data-close>×</button></div>
  <div class="checklist-rows">${defs.map(d => {
    const item = rec.items[d.key] || { state: "未確認", note: "", photoAssetIds: [] };
    const photos = (item.photoAssetIds || []).map(pid => state.assets.find(a => a.id === pid)).filter(Boolean);
    return `<div class="checklist-row"><span class="check-label">${escapeHtml(d.label)}</span>
    <select data-check-state="${d.key}">${CHECK_STATES.map(s => `<option ${item.state === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <textarea data-check-note="${d.key}" rows="1" placeholder="メモ（任意）">${escapeHtml(item.note || "")}</textarea>
    <div class="check-photos">${photos.map(a => `<img data-check-img="${a.id}" alt="">`).join("")}<label class="mini-button">写真を追加<input type="file" accept="image/*" class="visually-hidden" data-check-photo="${d.key}"></label></div></div>`;
  }).join("")}</div>
  <div class="dialog-actions"><button class="button button-quiet" data-close>閉じる</button><button class="button button-dark" data-save-checklist>チェック結果を保存</button></div>`;
  for (const d of defs) {
    for (const pid of (rec.items[d.key]?.photoAssetIds || [])) {
      const a = state.assets.find(x => x.id === pid);
      const img = document.querySelector(`[data-check-img="${CSS.escape(pid)}"]`);
      if (img && a) { const u = assetUrl(a); if (u) img.src = u; }
    }
  }
}
async function saveChecklistDialog() {
  const work = state.checklistWork;
  if (!work) return;
  const defs = work.kind === "viewing" ? VIEWING_CHECKLIST : CONTRACT_CHECKLIST;
  for (const d of defs) {
    const st = document.querySelector(`[data-check-state="${d.key}"]`);
    const nt = document.querySelector(`[data-check-note="${d.key}"]`);
    if (!work.record.items[d.key]) work.record.items[d.key] = { state: "未確認", note: "", photoAssetIds: [] };
    if (st) work.record.items[d.key].state = st.value;
    if (nt) work.record.items[d.key].note = nt.value;
  }
  work.record.updatedAt = nowIso();
  await saveRecord("checklistRecords", work.record);
  state.checklistWork = null;
  $("checklistDialog").close();
  await refresh();
  toast("チェック結果を保存しました。");
  if (state.detailId) await showProperty(state.detailId, "checklist");
}

/* ---------- 地域詳細 ---------- */
async function showArea(id) {
  clearObjectUrls();
  const a = await getRecord("areas", id);
  if (!a) return;
  state.areaDetailId = id;
  const settings = state.settings;
  const latest = latestAreaEval(id);
  const editorItems = {};
  for (const def of AREA_ITEM_DEFS) {
    const saved = latest?.items?.[def.key];
    editorItems[def.key] = saved || { mark: null, weight: settings.areaWeights?.[def.key] || 1, note: "" };
  }
  const history = sortNewest(state.areaEvaluations.filter(e => e.areaId === id), "createdAt");
  const linkedProps = state.properties.filter(p => p.areaId === id);
  const linkedVisits = sortNewest(state.visits.filter(v => v.areaId === id), "date");
  const markOpts = [["", "未確認"], ["good", "○"], ["fair", "△"], ["bad", "×"], ["na", "対象外"]];
  $("areaDetailContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">AREA DETAIL</p><h2>${escapeHtml(a.name)}</h2></div><button class="icon-button" data-close>×</button></div>
  <dl class="detail-grid"><dt>最寄り駅</dt><dd>${escapeHtml((a.stationNames || []).join("・") || "未入力")}</dd><dt>最新評価</dt><dd>${latest ? `${latest.totalScore ?? "—"}点 · ${escapeHtml(latest.verdict || "")} · 充足率${latest.sufficiencyRate ?? "—"}% · 信頼度${escapeHtml(latest.confidence || "—")}` : "未実施"}</dd></dl>
  ${a.note ? `<p class="detail-memo">${escapeHtml(a.note)}</p>` : ""}
  <h3>地域評価エディタ（${AREA_ITEM_DEFS.length}項目）</h3>
  <p class="hint">保存すると新しい評価スナップショットとして履歴に追加されます（過去の評価は上書きされません）。</p>
  ${AREA_ITEM_DEFS.map(def => {
    const it = editorItems[def.key];
    return `<div class="manual-row"><div class="manual-label">${escapeHtml(def.label)}</div><select data-area-mark="${def.key}">${markOpts.map(([v, l]) => `<option value="${v}" ${it.mark === v ? "selected" : ""}>${l}</option>`).join("")}</select><input type="number" min="1" max="3" step="1" data-area-weight="${def.key}" value="${escapeHtml(it.weight || 1)}" aria-label="重み"><input class="manual-note" data-area-note="${def.key}" placeholder="メモ（任意）" value="${escapeHtml(it.note || "")}"></div>`;
  }).join("")}
  <div class="dialog-actions"><button class="button button-dark" data-save-area-eval="${a.id}">地域評価を保存</button></div>
  <h3>評価履歴</h3>${history.length ? history.map(h => `<details class="snapshot-card"><summary><b>${escapeHtml(h.verdict || "")} ${h.totalScore ?? "—"}点</b> · 充足率${h.sufficiencyRate ?? "—"}% · ${escapeHtml((h.createdAt || "").replace("T", " ").slice(0, 16))} · ${escapeHtml(h.trigger || "")}</summary><ul class="plain-list">${AREA_ITEM_DEFS.filter(d => h.items?.[d.key]?.mark).map(d => `<li>${escapeHtml(d.label)}：${escapeHtml(MARK_LABEL[h.items[d.key].mark] || h.items[d.key].mark)}${h.items[d.key].note ? " — " + escapeHtml(h.items[d.key].note) : ""}</li>`).join("") || "<li>記録された項目はありません。</li>"}</ul></details>`).join("") : '<p class="hint">評価履歴はまだありません。</p>'}
  <h3>この地域の物件（${linkedProps.length}件）</h3>${linkedProps.length ? linkedProps.map(p => `<p>・<button class="mini-button" data-open-property="${p.id}">${escapeHtml(fv(p, "title") || "名称未設定")}</button> ${escapeHtml(fv(p, "address") || "")}</p>`).join("") : '<p class="hint">紐付いた物件はまだありません。</p>'}
  <h3>この地域の訪問記録（${linkedVisits.length}件）</h3>${linkedVisits.length ? linkedVisits.map(v => `<p>・<button class="mini-button" data-open-visit="${v.id}">${escapeHtml((v.date || "").slice(0, 10))} ${escapeHtml(agencyName(v.agencyId) || "訪問")}</button> ${escapeHtml(v.impression || "")}</p>`).join("") : '<p class="hint">紐付いた訪問記録はまだありません。</p>'}
  <div class="dialog-actions"><button class="button button-quiet" data-close>閉じる</button><button class="button button-dark" data-edit-area="${a.id}">地域情報を編集</button></div>`;
  if (!$("areaDetailDialog").open) $("areaDetailDialog").showModal();
}
async function saveAreaEvaluation(areaId) {
  const items = {};
  for (const def of AREA_ITEM_DEFS) {
    const mark = document.querySelector(`[data-area-mark="${def.key}"]`)?.value || "";
    const weightRaw = Number(document.querySelector(`[data-area-weight="${def.key}"]`)?.value || 1);
    const note = document.querySelector(`[data-area-note="${def.key}"]`)?.value.trim() || "";
    items[def.key] = { mark: mark || null, weight: Math.min(3, Math.max(1, weightRaw || 1)), note };
  }
  const result = evaluateArea(items, state.settings);
  const snapshot = {
    id: uid(), areaId, items,
    totalScore: result.totalScore, sufficiencyRate: result.sufficiencyRate,
    confidence: result.confidence, verdict: result.verdict,
    trigger: "手動", createdAt: nowIso()
  };
  await saveRecord("areaEvaluations", snapshot);
  await refresh();
  toast(`地域評価を保存しました（${result.totalScore ?? "—"}点・${result.verdict || ""}）。`);
  await showArea(areaId);
}

/* ---------- 訪問詳細・不動産会社詳細 ---------- */
async function showVisit(id) {
  clearObjectUrls();
  const v = await getRecord("visits", id);
  if (!v) return;
  const photos = sortNewest(state.assets.filter(a => a.visitId === id), "createdAt");
  const linked = (v.introducedPropertyIds || []).map(pid => state.properties.find(p => p.id === pid)).filter(Boolean);
  $("visitDetailContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">VISIT · ${escapeHtml((v.date || "").replace("T", " ").slice(0, 16))}</p><h2>${escapeHtml(areaName(v.areaId) || "地域未設定")}</h2></div><button class="icon-button" data-close>×</button></div>
  <dl class="detail-grid"><dt>不動産会社</dt><dd>${escapeHtml(agencyName(v.agencyId) || "未設定")}</dd><dt>担当者</dt><dd>${escapeHtml(v.staffName || "未記録")}</dd></dl>
  <h3>会話メモ</h3><p class="detail-memo">${escapeHtml(v.conversationMemo || "メモはありません。")}</p>
  <h3>印象</h3><p class="detail-memo">${escapeHtml(v.impression || "記録はありません。")}</p>
  <h3>次回確認事項</h3>${v.nextChecks?.length ? `<ul class="plain-list">${v.nextChecks.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : '<p class="hint">ありません。</p>'}
  <h3>紹介された物件（${linked.length}件）</h3>${linked.length ? linked.map(p => `<p>・<button class="mini-button" data-open-property="${p.id}">${escapeHtml(fv(p, "title") || "名称未設定")}</button></p>`).join("") : '<p class="hint">紐付いた物件はまだありません。</p>'}
  <h3>写真（${photos.length}件）</h3><div class="asset-grid">${photos.map(a => `<div class="asset-card"><img data-visit-img="${a.id}" alt=""><div class="asset-meta"><b>${escapeHtml(a.kind || "写真")}</b><span>${escapeHtml(a.name || "")}</span></div></div>`).join("") || '<p class="hint">写真はまだありません。</p>'}</div>
  <div class="dialog-actions"><button class="button button-quiet" data-delete-visit="${v.id}">削除</button><button class="button button-quiet" data-close>閉じる</button><button class="button button-dark" data-edit-visit="${v.id}">編集する</button></div>`;
  for (const a of photos) {
    const img = document.querySelector(`[data-visit-img="${CSS.escape(a.id)}"]`);
    if (img) { const u = assetUrl(a); if (u) img.src = u; }
  }
  if (!$("visitDetailDialog").open) $("visitDetailDialog").showModal();
}
async function showAgency(id) {
  const a = await getRecord("agencies", id);
  if (!a) return;
  const visits = sortNewest(state.visits.filter(v => v.agencyId === id), "date");
  const props = state.properties.filter(p => p.agencyId === id);
  $("visitDetailContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">AGENCY</p><h2>${escapeHtml(a.name)}</h2></div><button class="icon-button" data-close>×</button></div>
  <dl class="detail-grid"><dt>地域</dt><dd>${escapeHtml(areaName(a.areaId) || "未設定")}</dd><dt>所在地</dt><dd>${escapeHtml(a.address || "未入力")}</dd><dt>連絡先メモ</dt><dd>${escapeHtml(a.contactNote || "未入力")}</dd><dt>関連物件</dt><dd>${props.length}件</dd><dt>訪問記録</dt><dd>${visits.length}件</dd></dl>
  <div class="dialog-actions"><button class="button button-quiet" data-delete-agency="${a.id}">削除</button><button class="button button-quiet" data-close>閉じる</button><button class="button button-dark" data-edit-agency="${a.id}">編集する</button></div>`;
  if (!$("visitDetailDialog").open) $("visitDetailDialog").showModal();
}

/* ---------- 比較 ---------- */
function initialCostText(p) {
  const parts = [];
  const textKeys = [["deposit", "敷金"], ["key_money", "礼金"], ["security_deposit", "保証金"], ["brokerage_fee", "仲介手数料"]];
  for (const [k, l] of textKeys) { const v = fv(p, k); if (v !== null && v !== undefined && v !== "") parts.push(`${l} ${v}`); }
  let sum = 0, hasNum = false;
  for (const k of ["guarantor_fee_yen", "key_exchange_fee_yen", "cleaning_fee_yen", "fire_insurance_yen"]) {
    const v = fv(p, k);
    if (v !== null && v !== undefined && v !== "") { sum += Number(v) || 0; hasNum = true; }
  }
  if (hasNum) parts.push(`その他費用 ${yen(sum)}`);
  const other = fv(p, "other_initial_costs");
  if (other) parts.push(String(other));
  return parts.length ? parts.join(" / ") : "未確認";
}
function compareProperties() {
  const items = state.properties.filter(p => state.compareIds.has(p.id));
  if (items.length < 2) return toast("比較する物件を2件以上選んでください。");
  const rows = [
    ["家賃", p => { const v = fv(p, "rent_yen"); return v === null || v === undefined ? "未確認" : yen(v); }],
    ["管理費", p => { const v = fv(p, "management_fee_yen"); return v === null || v === undefined ? "未確認" : yen(v); }],
    ["家賃＋管理費", p => { const t = monthlyTotal(p); return t === null ? "未確認" : yen(t); }],
    ["初期費用目安", p => initialCostText(p)],
    ["間取り", p => fv(p, "layout") || "未確認"],
    ["面積", p => { const v = fv(p, "area_sqm"); return v === null || v === undefined ? "未確認" : v + "㎡"; }],
    ["築年", p => fv(p, "built_year") || "未確認"],
    ["構造", p => fv(p, "structure") || "未確認"],
    ["駅徒歩", p => { const s = fv(p, "station"), w = fv(p, "walk_minutes"); return s || w !== null && w !== undefined ? `${s || "駅未確認"}${w !== null && w !== undefined ? " 徒歩" + w + "分" : ""}` : "未確認"; }],
    ["最新スコア", p => { const e = latestEval(p.id); return e ? (e.totalScore ?? "—") + "点" : "未評価"; }],
    ["充足率", p => { const e = latestEval(p.id); return e ? (e.sufficiencyRate ?? "—") + "%" : "未評価"; }],
    ["判定", p => { const e = latestEval(p.id); return e ? (e.verdict || "—") : "未評価"; }]
  ];
  $("compareContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">SIDE BY SIDE</p><h2>物件比較</h2></div><button class="icon-button" data-close>×</button></div><div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>比較項目</th>${items.map(p => `<th>${escapeHtml(fv(p, "title") || "名称未設定")}</th>`).join("")}</tr></thead><tbody>${rows.map(([label, fn]) => `<tr><th>${label}</th>${items.map(p => `<td>${escapeHtml(fn(p))}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="hint">未確認項目は推測で補わず、そのまま表示しています。点数による自動順位付けは行いません。</p><div class="dialog-actions"><button class="button button-quiet" data-close>閉じる</button></div>`;
  $("compareDialog").showModal();
}

/* ---------- 資料・AI読み取り ---------- */
function assetTargetInfoText() {
  const target = state.assetTargetPropertyId ? state.properties.find(p => p.id === state.assetTargetPropertyId) : null;
  return target
    ? `対象物件：${fv(target, "title") || "名称未設定"}。画像はまず原画像として保存されます。AI読み取り結果は、既存の入力内容と並べて確認してから反映します。`
    : "画像を選ぶと、まず原画像をこのブラウザ内に保存します。AI読み取りは先頭の1枚を使います。読み取り結果を確認してから物件として登録します。";
}
function openAssetDialog(targetPropertyId = null) {
  state.assetTargetPropertyId = targetPropertyId;
  $("assetForm").reset();
  $("assetSaveStatus").textContent = "";
  state.continuousSavedCount = 0;
  updateContinuousUi();
  $("assetDialog").showModal();
}
function updateContinuousUi() {
  const on = $("assetContinuous").checked;
  $("continuousArea").classList.toggle("hidden", !on);
  $("analyzeFlyerBtn").classList.toggle("hidden", on);
  $("continuousCount").textContent = `この連続撮影で ${state.continuousSavedCount} 件保存しました`;
  $("assetTargetInfo").textContent = on
    ? "連続撮影モード：撮影・選択した画像は、その場で原画像だけを保存します（AI読み取りはしません）。読み取りはあとから「未整理資料」でまとめて実行できます。"
    : assetTargetInfoText();
}
function selectedAssetFiles() {
  return [...($("assetFileCamera").files || []), ...($("assetFilePick").files || [])];
}
async function saveFilesAsAssets(files) {
  let saved = 0;
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    await saveImageAsset(file, { kind: $("assetKind").value, memo: $("assetMemo").value.trim(), propertyId: state.assetTargetPropertyId || null });
    saved++;
  }
  return saved;
}
async function saveSelectedImages() {
  const files = selectedAssetFiles();
  if (!files.length) { toast("画像を選択してください。"); return; }
  $("assetSaveStatus").textContent = "原画像を保存しています…";
  const saved = await saveFilesAsAssets(files);
  $("assetSaveStatus").textContent = saved ? `${saved}件の原画像を保存しました。` : "画像ファイルが選択されていません。";
  if (saved) {
    const target = state.assetTargetPropertyId;
    $("assetDialog").close();
    state.assetTargetPropertyId = null;
    await refresh();
    toast(`${saved}件の画像を保存しました。`);
    if (target) await showProperty(target, "materials");
  }
}
async function saveContinuousSelection() {
  const files = selectedAssetFiles();
  if (!files.length) return;
  $("assetSaveStatus").textContent = "原画像を保存しています…";
  try {
    const saved = await saveFilesAsAssets(files);
    state.continuousSavedCount += saved;
    $("assetFileCamera").value = "";
    $("assetFilePick").value = "";
    updateContinuousUi();
    $("assetSaveStatus").textContent = saved ? `${saved}件を保存しました（連続撮影：合計${state.continuousSavedCount}件）。次のマイソクを撮影できます。` : "画像ファイルが選択されていません。";
  } catch (err) {
    $("assetSaveStatus").textContent = "保存できませんでした: " + err.message;
  }
}
async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2500 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("画像処理を開始できませんでした。");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("画像の圧縮に失敗しました。")), "image/jpeg", 0.86));
  } finally { bitmap.close(); }
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.readAsDataURL(blob);
  });
}
function buildDiffRows(data, target) {
  const rows = [];
  for (const def of FIELD_DEFS) {
    const aiVal = data[def.key];
    if (aiVal === null || aiVal === undefined || aiVal === "") continue;
    const curField = target?.fields?.[def.key] || null;
    const curVal = target ? fv(target, def.key) : null;
    const same = JSON.stringify(curVal ?? null) === JSON.stringify(aiVal);
    let adopt = false;
    if (!target) adopt = true;
    else if (curVal === null || curVal === undefined) adopt = true;
    else if (curField && curField.origin === "ai") adopt = true;
    else if (same) adopt = true;
    rows.push({ key: def.key, label: def.label, current: curVal, ai: aiVal, origin: curField?.origin || null, adopt, same });
  }
  return rows;
}
/* 保存済み asset の Blob を解析し、extraction（と対象物件がある場合は aiAnalysis）を保存する共通コア。
   新規保存は行わない。失敗時は例外を投げ、原画像には一切触れない。 */
async function analyzeAssetCore(blob, asset, targetId) {
  const type = blob.type || asset?.mimeType || "";
  if (!/^image\/(jpeg|png|webp)$/i.test(type)) throw new Error("JPEG・PNG・WebPの画像のみ読み取れます。");
  if (blob.size > 20 * 1024 * 1024) throw new Error("画像が20MBを超えています。");
  const compressed = await compressImage(blob);
  if (compressed.size > 12 * 1024 * 1024) throw new Error("圧縮後も12MBを超えています。画像を小さくしてください。");
  const base64 = await blobToBase64(compressed);
  let propertyContext = null;
  if (targetId) {
    const target = await getRecord("properties", targetId);
    if (target) {
      const adopted = {};
      for (const def of FIELD_DEFS) adopted[def.key] = fv(target, def.key);
      propertyContext = { fields: adopted };
    }
  }
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: base64, mimeType: "image/jpeg", propertyContext })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true || !result.data) throw new Error(result.error || "AI読み取りに失敗しました。");
  const data = result.data;
  const extraction = {
    id: uid(), assetId: asset.id, propertyId: targetId || null,
    model: result.model || "", promptVersion: result.promptVersion || "",
    rawJson: data, fields: data,
    uncertainFields: Array.isArray(data.uncertain_fields) ? data.uncertain_fields : [],
    createdAt: nowIso()
  };
  await saveRecord("extractions", extraction);
  const review = data.review && typeof data.review === "object" ? data.review : null;
  let analysis = null;
  if (review && targetId) {
    analysis = {
      id: uid(), propertyId: targetId, extractionIds: [extraction.id],
      publicSummary: review.public_summary || "", highlights: review.highlights || [],
      risks: review.risks || [], unknowns: review.unknowns || [],
      confirmationQuestions: review.confirmation_questions || [],
      rationaleText: review.rationale_text || "", model: result.model || "", createdAt: nowIso()
    };
    await saveRecord("aiAnalyses", analysis);
  }
  return { extraction, review, analysis, model: result.model || "" };
}
async function presentDiff({ assetId, extraction, review, model, targetId }) {
  const target = targetId ? await getRecord("properties", targetId) : null;
  const rows = buildDiffRows(extraction.fields || {}, target);
  state.pendingDiff = { assetId, extraction, review: review || null, analysis: null, model: model || "", targetId: targetId || null, rows };
  openDiffDialog();
}
async function analyzeFlyer(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type || "")) { toast("JPEG・PNG・WebPの画像を選択してください。"); return; }
  if (file.size > 20 * 1024 * 1024) { toast("画像が20MBを超えています。"); return; }
  const button = $("analyzeFlyerBtn");
  const status = $("assetSaveStatus");
  button.disabled = true;
  button.textContent = "原画像を保存しています…";
  let asset = null;
  let waitTimer = null;
  const targetId = state.assetTargetPropertyId;
  try {
    asset = await saveImageAsset(file, { kind: $("assetKind").value || "マイソク", memo: $("assetMemo").value.trim(), propertyId: targetId || null });
    status.textContent = "原画像を保存しました。AIで項目を読み取っています…";
    button.textContent = "AIで読み取っています…";
    const waitStartedAt = Date.now();
    waitTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - waitStartedAt) / 1000);
      if (sec >= 45) {
        status.textContent = `AIで項目を読み取っています…（${sec}秒経過）混雑しています。サーバー側で再試行中です。混雑時は1〜2分かかることがあります。そのままお待ちください。`;
      } else if (sec >= 15) {
        status.textContent = `AIで項目を読み取っています…（${sec}秒経過）混雑時は時間がかかることがあります。`;
      }
    }, 5000);
    const { extraction, review, model } = await analyzeAssetCore(file, asset, targetId || null);
    $("assetDialog").close();
    await refresh();
    await presentDiff({ assetId: asset.id, extraction, review, model, targetId: targetId || null });
  } catch (error) {
    if (asset) await refresh();
    status.textContent = (error.message || "AI読み取りに失敗しました。") + "\n原画像は保存済みです。AI読み取りはオンライン時のみ利用できます。";
    toast("AI読み取りは完了しませんでした。原画像は保存済みです。");
  } finally {
    if (waitTimer) clearInterval(waitTimer);
    button.disabled = false;
    button.textContent = "AIで読み取り";
  }
}
/* 保存済み資料をあとから読み取る（単体）。成功したら差分確認ダイアログを開く。 */
async function analyzeStoredAsset(assetId) {
  const asset = await getRecord("assets", assetId);
  if (!asset || !asset.blob) { toast("保存済みの画像が見つかりません。"); return; }
  if ($("detailDialog").open) $("detailDialog").close();
  const btn = document.querySelector(`[data-analyze-asset="${CSS.escape(assetId)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "読み取り中…"; }
  toast("AIで読み取っています…（混雑時は1〜2分かかることがあります）");
  try {
    const { extraction, review, model } = await analyzeAssetCore(asset.blob, asset, asset.propertyId || null);
    await refresh();
    await presentDiff({ assetId, extraction, review, model, targetId: extraction.propertyId || asset.propertyId || null });
  } catch (err) {
    toast("AI読み取りに失敗しました：" + (err.message || err) + "（原画像は保存済みです）");
    render();
  }
}
/* 保存済みの読み取り結果から差分確認ダイアログを再構築する（バッチ結果の確認用）。 */
async function openDiffForExtraction(assetId) {
  const list = state.extractions.filter(e => e.assetId === assetId);
  if (!list.length) { toast("読み取り結果がまだありません。先にAI読み取りを実行してください。"); return; }
  const extraction = sortNewest(list, "createdAt")[0];
  const asset = state.assets.find(a => a.id === assetId) || await getRecord("assets", assetId);
  if ($("detailDialog").open) $("detailDialog").close();
  const data = extraction.fields || {};
  const review = data.review && typeof data.review === "object" ? data.review : null;
  await presentDiff({ assetId, extraction, review, model: extraction.model || "", targetId: extraction.propertyId || asset?.propertyId || null });
}
/* 未読み取りをまとめて読み取る。途中で差分ダイアログは開かず、結果は通知から個別に確認する。 */
async function runBatchAnalyze() {
  if (batchState.running) return;
  const targets = unreadAssetList();
  if (!targets.length) { toast("未読み取りの資料はありません。"); return; }
  batchState.running = true;
  batchState.total = targets.length;
  batchState.done = 0;
  batchState.notice = null;
  renderUnreadBar();
  const succeeded = [];
  const failed = [];
  for (const item of targets) {
    try {
      const asset = await getRecord("assets", item.id);
      if (!asset || !asset.blob) throw new Error("保存済みの画像が見つかりません。");
      if (!hasExtractionFor(asset.id)) await analyzeAssetCore(asset.blob, asset, asset.propertyId || null);
      succeeded.push(asset.id);
    } catch (err) {
      failed.push({ id: item.id, name: item.name || item.kind || "資料", error: err.message || String(err) });
    }
    batchState.done++;
    renderUnreadBar();
  }
  batchState.running = false;
  batchState.notice = { succeeded, failed };
  await refresh();
  toast(`まとめて読み取りが終わりました（成功 ${succeeded.length} 件${failed.length ? `／失敗 ${failed.length} 件` : ""}）。`);
}
function openDiffDialog() {
  const d = state.pendingDiff;
  if (!d) return;
  const target = d.targetId ? state.properties.find(p => p.id === d.targetId) : null;
  $("diffContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">AI EXTRACTION REVIEW</p><h2>読み取り結果の確認</h2><p class="hint">${target ? `対象物件：${escapeHtml(fv(target, "title") || "名称未設定")}。手入力した値は自動では上書きされません。` : "新規物件として登録します。採用する項目を選んでください。"}</p></div><button class="icon-button" data-close>×</button></div>
  ${d.extraction.uncertainFields.length ? `<p class="hint">読み取り要確認：${d.extraction.uncertainFields.map(k => escapeHtml(FIELD_LABEL[k] || k)).join("、")}</p>` : ""}
  ${d.rows.length ? `<div class="diff-table-wrap"><table class="diff-table"><thead><tr><th>項目</th><th>現在の値</th><th>AI読み取り値</th><th>採用</th></tr></thead><tbody>${d.rows.map(r => `<tr><td>${escapeHtml(r.label)}${r.origin ? `<br><span class="origin-note">出典：${escapeHtml(ORIGIN_LABEL[r.origin] || r.origin)}</span>` : ""}</td><td>${target ? escapeHtml(fmtKey(r.key, r.current)) : "（新規）"}</td><td>${escapeHtml(fmtKey(r.key, r.ai))}${r.same ? ' <span class="origin-note">（同じ値）</span>' : ""}</td><td><input type="checkbox" data-diff-adopt="${r.key}" ${r.adopt ? "checked" : ""} aria-label="採用"></td></tr>`).join("")}</tbody></table></div>` : '<p class="hint">抽出できた項目はありませんでした。原画像は保存済みです。</p>'}
  <div class="dialog-actions"><button class="button button-quiet" data-close>反映しない</button>${d.rows.length ? '<button class="button button-dark" data-apply-diff>選択した項目を反映</button>' : ""}</div>`;
  $("diffDialog").showModal();
}
async function applyDiff() {
  const d = state.pendingDiff;
  if (!d) return;
  const now = nowIso();
  const adoptedKeys = [];
  const adopted = {};
  for (const row of d.rows) {
    const cb = document.querySelector(`[data-diff-adopt="${row.key}"]`);
    if (cb && cb.checked) { adoptedKeys.push(row.key); adopted[row.key] = row.ai; }
  }
  if (d.targetId) {
    const property = await getRecord("properties", d.targetId);
    if (!property) { toast("対象物件が見つかりません。"); return; }
    property.fields = property.fields || {};
    for (const row of d.rows) {
      const prev = property.fields[row.key] || null;
      if (adoptedKeys.includes(row.key)) {
        property.fields[row.key] = { value: row.ai, origin: "ai", aiValue: row.ai, extractionId: d.extraction.id, updatedAt: now };
      } else if (prev && JSON.stringify(prev.value ?? null) !== JSON.stringify(row.ai)) {
        property.fields[row.key] = { ...prev, aiValue: row.ai, extractionId: d.extraction.id };
      } else if (!prev) {
        property.fields[row.key] = { value: null, origin: "user", aiValue: row.ai, extractionId: d.extraction.id, updatedAt: now };
      }
    }
    property.updatedAt = now;
    await saveRecord("properties", property);
    await createSnapshot(property, "資料追加", adoptedKeys, "AI読み取り結果を反映");
    state.pendingDiff = null;
    $("diffDialog").close();
    await refresh();
    toast("AI読み取り結果を反映しました。");
    await showProperty(property.id, "summary");
  } else {
    const fields = {};
    for (const def of FIELD_DEFS) {
      if (Object.prototype.hasOwnProperty.call(adopted, def.key)) {
        fields[def.key] = { value: adopted[def.key], origin: "ai", aiValue: adopted[def.key], extractionId: d.extraction.id, updatedAt: now };
      } else {
        fields[def.key] = { value: null, origin: "user", aiValue: null, extractionId: null, updatedAt: now };
      }
    }
    const property = {
      id: uid(), areaId: null, agencyId: null, visitIds: [], status: "検討中", memo: "",
      fields, manualMarks: {}, createdAt: now, updatedAt: now
    };
    await saveRecord("properties", property);
    const asset = await getRecord("assets", d.assetId);
    if (asset) { asset.propertyId = property.id; await saveRecord("assets", asset); }
    d.extraction.propertyId = property.id;
    await saveRecord("extractions", d.extraction);
    if (d.review) {
      await saveRecord("aiAnalyses", {
        id: uid(), propertyId: property.id, extractionIds: [d.extraction.id],
        publicSummary: d.review.public_summary || "", highlights: d.review.highlights || [],
        risks: d.review.risks || [], unknowns: d.review.unknowns || [],
        confirmationQuestions: d.review.confirmation_questions || [],
        rationaleText: d.review.rationale_text || "", model: d.model, createdAt: nowIso()
      });
    }
    await createSnapshot(property, "初回登録", adoptedKeys, "AI読み取り結果を反映");
    state.pendingDiff = null;
    $("diffDialog").close();
    await refresh();
    toast("AI読み取り結果から物件を登録しました。");
    await showProperty(property.id, "summary");
  }
}

/* ---------- 資料の紐付け ---------- */
function openLinkDialog(assetId, kind) {
  const targets = kind === "property" ? state.properties : state.visits;
  if (!targets.length) { toast(kind === "property" ? "先に物件を登録してください。" : "先に訪問記録を追加してください。"); return; }
  $("linkAssetId").value = assetId;
  $("linkKind").value = kind;
  $("linkTitle").textContent = kind === "property" ? "資料を物件に紐付け" : "資料を訪問記録に紐付け";
  $("linkLabel").textContent = kind === "property" ? "紐付ける物件" : "紐付ける訪問記録";
  $("linkTarget").innerHTML = targets.map(t => kind === "property"
    ? `<option value="${t.id}">${escapeHtml(fv(t, "title") || "名称未設定")} — ${escapeHtml(fv(t, "address") || "所在地未入力")}</option>`
    : `<option value="${t.id}">${escapeHtml((t.date || "").slice(0, 10))} ${escapeHtml(areaName(t.areaId) || "地域未設定")}</option>`).join("");
  $("linkDialog").showModal();
}
async function saveLink(event) {
  event.preventDefault();
  const asset = await getRecord("assets", $("linkAssetId").value);
  if (!asset) { toast("資料が見つかりません。"); return; }
  if ($("linkKind").value === "property") asset.propertyId = $("linkTarget").value;
  else asset.visitId = $("linkTarget").value;
  await saveRecord("assets", asset);
  $("linkDialog").close();
  await refresh();
  toast("資料を紐付けました。");
}

/* ---------- バックアップ ---------- */
function blobToDataUrl(blob) {
  if (!(blob instanceof Blob)) return Promise.resolve(null);
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
}
function dataUrlToBlob(dataUrl) {
  const [meta, data] = dataUrl.split(",");
  const mime = (meta.match(/data:([^;]+)/) || [, "application/octet-stream"])[1];
  const binary = atob(data), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
async function exportBackup() {
  const data = await exportAllData();
  const assets = await Promise.all((data.assets || []).map(async a => {
    const copy = { ...a, blobData: await blobToDataUrl(a.blob) };
    delete copy.blob;
    return copy;
  }));
  const enriched = { ...data, assets };
  const blob = new Blob([JSON.stringify(enriched)], { type: "application/json" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url;
  a.download = `maisoku-ai-2-backup-${dateToday()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (state.settings) {
    state.settings.lastBackupAt = nowIso();
    await saveRecord("settings", state.settings);
    updateLastBackupInfo();
  }
  $("backupStatus").textContent = "バックアップを書き出しました。";
}
function updateLastBackupInfo() {
  $("lastBackupInfo").textContent = "最終バックアップ：" + (state.settings?.lastBackupAt ? state.settings.lastBackupAt.replace("T", " ").slice(0, 16) : "未実施");
}
function validateIds(records, label) {
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record !== "object" || typeof record.id !== "string" || !record.id.trim()) throw new Error(label + "にIDのないデータがあります。復元を中止しました。");
    if (ids.has(record.id)) throw new Error(label + "に重複したIDがあります。復元を中止しました。");
    ids.add(record.id);
  }
  return ids;
}
function migrateV1Property(p) {
  const now = p.updatedAt || nowIso();
  const src = {
    title: p.title, address: p.address, station: p.station,
    walk_minutes: p.walkMinutes, area_sqm: p.area, built_year: p.builtYear,
    structure: p.structureText || p.structure, rent_yen: p.rent,
    management_fee_yen: p.fee, deposit: p.deposit, key_money: p.keyMoney, layout: p.layout
  };
  const fields = {};
  for (const def of FIELD_DEFS) fields[def.key] = { value: null, origin: "user", aiValue: null, extractionId: null, updatedAt: now };
  for (const [k, v] of Object.entries(src)) {
    if (v !== undefined && v !== null && v !== "" && fields[k]) fields[k] = { value: v, origin: "user", aiValue: null, extractionId: null, updatedAt: now };
  }
  const allowedStatus = ["検討中", "保留", "候補外", "募集終了", "契約"];
  return {
    id: p.id, areaId: null, agencyId: null, visitIds: [],
    status: allowedStatus.includes(p.status) ? p.status : "検討中",
    memo: p.memo || "", fields, manualMarks: {},
    createdAt: p.createdAt || now, updatedAt: now
  };
}
function migrateV1Visit(v) {
  const now = v.updatedAt || nowIso();
  return {
    id: v.id, areaId: null, agencyId: null,
    date: v.date ? (String(v.date).includes("T") ? v.date : new Date(v.date + "T00:00:00").toISOString()) : now,
    staffName: "", conversationMemo: v.memo || "", introducedPropertyIds: [],
    impression: "", nextChecks: [], createdAt: v.createdAt || now, updatedAt: now
  };
}
async function importBackup(file) {
  const parsed = JSON.parse(await file.text());
  if (!parsed || parsed.app !== "maisoku-ai-2") throw new Error("マイソクAI 2.0のバックアップ形式ではありません。");
  let data;
  if (parsed.version === 2) {
    for (const store of STORES) {
      if (!Array.isArray(parsed[store])) throw new Error(`バックアップに ${store} のデータがありません。復元を中止しました。`);
    }
    data = {};
    for (const store of STORES) data[store] = parsed[store];
  } else if (parsed.version === 1) {
    if (!Array.isArray(parsed.properties) || !Array.isArray(parsed.visits) || !Array.isArray(parsed.assets)) throw new Error("旧バージョンのバックアップ形式が壊れています。");
    data = {
      areas: [], areaEvaluations: [], agencies: [],
      visits: parsed.visits.map(migrateV1Visit),
      properties: parsed.properties.map(migrateV1Property),
      assets: parsed.assets.map(a => ({ ...a, propertyId: a.propertyId || null, visitId: a.visitId || null, areaId: a.areaId || null })),
      extractions: [], aiAnalyses: [], propertyEvaluations: [], checklistRecords: [],
      settings: [{ ...deepClone(DEFAULT_SETTINGS), id: "app" }]
    };
  } else {
    throw new Error("対応していないバックアップバージョンです。");
  }
  const idSets = {};
  for (const store of STORES) idSets[store] = validateIds(data[store], store);
  for (const asset of data.assets) {
    if (typeof asset.blobData !== "string" || !/^data:[^;,]+;base64,/.test(asset.blobData)) throw new Error("画像データが不足しているか、形式が壊れています。現在のデータは変更していません。");
  }
  const warnings = [];
  const checkRef = (store, record, field, targetStore) => {
    const v = record?.[field];
    if (v && !idSets[targetStore].has(v)) warnings.push(`${store}.${field}`);
  };
  for (const a of data.assets) { checkRef("assets", a, "propertyId", "properties"); checkRef("assets", a, "visitId", "visits"); checkRef("assets", a, "areaId", "areas"); }
  for (const p of data.properties) { checkRef("properties", p, "areaId", "areas"); checkRef("properties", p, "agencyId", "agencies"); }
  for (const v of data.visits) { checkRef("visits", v, "areaId", "areas"); checkRef("visits", v, "agencyId", "agencies"); }
  for (const e of data.propertyEvaluations) checkRef("propertyEvaluations", e, "propertyId", "properties");
  for (const e of data.areaEvaluations) checkRef("areaEvaluations", e, "areaId", "areas");
  for (const e of data.aiAnalyses) checkRef("aiAnalyses", e, "propertyId", "properties");
  for (const e of data.extractions) { checkRef("extractions", e, "propertyId", "properties"); checkRef("extractions", e, "assetId", "assets"); }
  for (const c of data.checklistRecords) checkRef("checklistRecords", c, "propertyId", "properties");
  const summary = STORES.map(s => `${s}: ${data[s].length}件`).join(" / ");
  const warnText = warnings.length ? `\n参照先が見つからない項目が ${warnings.length} 件あります（警告のみで、復元は可能です）。` : "";
  if (!confirm(`バックアップ内容で現在のデータを置き換えます。\n${summary}${warnText}\n\n現在のデータをバックアップ内容で置き換えます。よろしいですか？`)) return;
  const restoredAssets = data.assets.map(asset => {
    const copy = { ...asset, blob: dataUrlToBlob(asset.blobData) };
    delete copy.blobData;
    return copy;
  });
  await replaceAllData({ ...data, assets: restoredAssets });
  await loadSettings();
  state.compareIds.clear();
  await refresh();
  updateLastBackupInfo();
  $("backupStatus").textContent = "バックアップを読み込みました。";
  toast("データを復元しました。");
}

/* ---------- 設定 ---------- */
function openSettings() {
  const s = state.settings;
  $("settingsWeights").innerHTML = DEFAULT_CRITERIA.map(item => `<div class="weight-row"><span>${escapeHtml(item.label)}（${escapeHtml(item.category)}）</span><input type="number" min="1" max="3" step="1" data-weight="${item.key}" value="${escapeHtml(s.criteriaWeights?.[item.key] ?? item.weight ?? 1)}"></div>`).join("");
  $("settingsBudget").value = s.monthlyBudgetYen ?? 40000;
  const conditions = [...(s.basicConditions || [])];
  while (conditions.length < 6) conditions.push(DEFAULT_BASIC_CONDITIONS[conditions.length] || "");
  $("settingsConditions").innerHTML = conditions.slice(0, 6).map((c, i) => `<label>基本条件${i + 1}<input type="text" data-condition="${i}" value="${escapeHtml(c || "")}"></label>`).join("");
  $("settingsDialog").showModal();
}
async function saveSettings(event) {
  event.preventDefault();
  const s = state.settings;
  const weights = {};
  let changed = false;
  for (const item of DEFAULT_CRITERIA) {
    const el = document.querySelector(`[data-weight="${item.key}"]`);
    const v = Math.min(3, Math.max(1, Number(el?.value || item.weight || 1)));
    weights[item.key] = v;
    const prev = s.criteriaWeights?.[item.key] ?? item.weight ?? 1;
    if (v !== prev) changed = true;
  }
  s.criteriaWeights = weights;
  s.monthlyBudgetYen = Number($("settingsBudget").value || 0);
  s.basicConditions = [...document.querySelectorAll("[data-condition]")].map(el => el.value);
  if (changed) s.criteriaVersion = (s.criteriaVersion || 1) + 1;
  await saveRecord("settings", s);
  $("settingsDialog").close();
  await refresh();
  toast(changed ? "設定を保存しました。新しい基準（Ver." + s.criteriaVersion + "）は次回評価から適用されます。" : "設定を保存しました。");
}

/* ---------- イベント配線 ---------- */
document.addEventListener("change", async (event) => {
  const el = event.target;
  if (el.matches("[data-compare]")) {
    if (el.checked) state.compareIds.add(el.dataset.compare); else state.compareIds.delete(el.dataset.compare);
    render();
  }
  if (el.matches("[data-check-photo]")) {
    const file = el.files?.[0];
    const work = state.checklistWork;
    if (file && work) {
      try {
        const asset = await saveImageAsset(file, { kind: "現地写真", memo: "", propertyId: work.propertyId });
        const key = el.dataset.checkPhoto;
        if (!work.record.items[key]) work.record.items[key] = { state: "未確認", note: "", photoAssetIds: [] };
        work.record.items[key].photoAssetIds = [...(work.record.items[key].photoAssetIds || []), asset.id];
        // 入力途中の状態・メモを作業コピーへ取り込んでから再描画
        const defs = work.kind === "viewing" ? VIEWING_CHECKLIST : CONTRACT_CHECKLIST;
        for (const d of defs) {
          const st = document.querySelector(`[data-check-state="${d.key}"]`);
          const nt = document.querySelector(`[data-check-note="${d.key}"]`);
          if (st && work.record.items[d.key]) work.record.items[d.key].state = st.value;
          if (nt && work.record.items[d.key]) work.record.items[d.key].note = nt.value;
        }
        await refresh();
        renderChecklist();
        toast("写真を追加しました。保存ボタンで確定します。");
      } catch (err) { toast("写真を保存できませんでした: " + err.message); }
    }
  }
});
document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  try {
    if (target.hasAttribute("data-close")) { target.closest("dialog")?.close(); return; }
    if (target.dataset.tab) { setTab(target.dataset.tab); return; }
    if (target.id === "captureBtn") { openAssetDialog(null); return; }
    if (target.id === "propertyBtn") { openPropertyForm(); return; }
    if (target.id === "areaBtn" || target.id === "areaBtn2") { openAreaForm(); return; }
    if (target.id === "visitBtn" || target.id === "visitBtn2") { openVisitForm(); return; }
    if (target.id === "agencyBtn") { openAgencyForm(); return; }
    if (target.hasAttribute("data-open-agency")) { openAgencyForm(); return; }
    if (target.id === "backupBtn") { updateLastBackupInfo(); $("backupDialog").showModal(); return; }
    if (target.id === "settingsBtn") { openSettings(); return; }
    if (target.id === "exportBtn") { await exportBackup(); return; }
    if (target.id === "compareBtn") { compareProperties(); return; }
    if (target.id === "clearCompareBtn") { state.compareIds.clear(); render(); return; }
    if (target.id === "analyzeFlyerBtn") {
      const file = selectedAssetFiles()[0];
      if (!file) toast("先にマイソクを撮影するか、画像を選択してください。");
      else await analyzeFlyer(file);
      return;
    }
    if (target.id === "nextShotBtn") { $("assetFileCamera").click(); return; }
    if (target.id === "continuousEndBtn") { $("assetDialog").close(); return; }
    if (target.dataset.analyzeAsset) { await analyzeStoredAsset(target.dataset.analyzeAsset); return; }
    if (target.dataset.reviewAsset) { await openDiffForExtraction(target.dataset.reviewAsset); return; }
    if (target.hasAttribute("data-batch-analyze")) {
      runBatchAnalyze().catch(err => { batchState.running = false; renderUnreadBar(); toast("まとめて読み取りに失敗しました: " + (err.message || err)); });
      return;
    }
    if (target.hasAttribute("data-dismiss-batch")) { batchState.notice = null; renderUnreadBar(); return; }
    if (target.dataset.detailProperty) { await showProperty(target.dataset.detailProperty, "summary"); return; }
    if (target.dataset.editProperty) { $("detailDialog").close(); openPropertyForm(state.properties.find(p => p.id === target.dataset.editProperty) || null); return; }
    if (target.dataset.detailTab && state.detailId) { await showProperty(state.detailId, target.dataset.detailTab); return; }
    if (target.dataset.saveManual) { await saveManualMarks(target.dataset.saveManual); return; }
    if (target.dataset.reevaluate) {
      const reason = prompt("再評価の理由（任意）", "");
      if (reason === null) return;
      const p = await getRecord("properties", target.dataset.reevaluate);
      if (p) {
        const prev = latestEval(p.id);
        await createSnapshot(p, "手動", changedFieldsVs(prev, p), reason);
        await refresh();
        toast("再評価を記録しました。");
        await showProperty(p.id, "history");
      }
      return;
    }
    if (target.dataset.deleteProperty) { await deleteProperty(target.dataset.deleteProperty); return; }
    if (target.dataset.openChecklist) { await openChecklist(target.dataset.openChecklist, target.dataset.kind); return; }
    if (target.hasAttribute("data-save-checklist")) { await saveChecklistDialog(); return; }
    if (target.dataset.addMaterial) { $("detailDialog").close(); openAssetDialog(target.dataset.addMaterial); return; }
    if (target.dataset.deleteAssetDetail) {
      if (confirm("この資料画像を削除しますか？")) {
        await deleteRecord("assets", target.dataset.deleteAssetDetail);
        await refresh();
        toast("資料を削除しました。");
        if (state.detailId) await showProperty(state.detailId, "materials");
      }
      return;
    }
    if (target.hasAttribute("data-apply-diff")) { await applyDiff(); return; }
    if (target.dataset.detailArea) { await showArea(target.dataset.detailArea); return; }
    if (target.dataset.editArea) { $("areaDetailDialog").close(); openAreaForm(state.areas.find(a => a.id === target.dataset.editArea) || null); return; }
    if (target.dataset.saveAreaEval) { await saveAreaEvaluation(target.dataset.saveAreaEval); return; }
    if (target.dataset.openArea) { $("detailDialog").close(); await showArea(target.dataset.openArea); return; }
    if (target.dataset.openProperty) { $("areaDetailDialog").close(); $("visitDetailDialog").close(); await showProperty(target.dataset.openProperty, "summary"); return; }
    if (target.dataset.openVisit) { $("areaDetailDialog").close(); await showVisit(target.dataset.openVisit); return; }
    if (target.dataset.detailVisit) { await showVisit(target.dataset.detailVisit); return; }
    if (target.dataset.editVisit) { $("visitDetailDialog").close(); openVisitForm(state.visits.find(v => v.id === target.dataset.editVisit) || null); return; }
    if (target.dataset.deleteVisit) {
      if (confirm("この訪問記録を削除しますか？紹介された物件そのものは削除されません。")) {
        await deleteRecord("visits", target.dataset.deleteVisit);
        $("visitDetailDialog").close();
        await refresh();
        toast("訪問記録を削除しました。");
      }
      return;
    }
    if (target.dataset.detailAgency) { await showAgency(target.dataset.detailAgency); return; }
    if (target.dataset.editAgency) { $("visitDetailDialog").close(); openAgencyForm(state.agencies.find(a => a.id === target.dataset.editAgency) || null); return; }
    if (target.dataset.deleteAgency) {
      if (confirm("この不動産会社を削除しますか？物件・訪問記録そのものは残ります。")) {
        await deleteRecord("agencies", target.dataset.deleteAgency);
        $("visitDetailDialog").close();
        await refresh();
        toast("不動産会社を削除しました。");
      }
      return;
    }
    if (target.dataset.linkAsset) { openLinkDialog(target.dataset.id, target.dataset.linkAsset); return; }
    if (target.dataset.deleteAsset) {
      if (confirm("この資料画像を削除しますか？")) { await deleteRecord("assets", target.dataset.deleteAsset); await refresh(); toast("資料を削除しました。"); }
      return;
    }
  } catch (err) {
    toast("処理に失敗しました: " + (err.message || err));
  }
});
$("propertyForm").addEventListener("submit", savePropertyForm);
$("areaForm").addEventListener("submit", saveAreaForm);
$("agencyForm").addEventListener("submit", saveAgencyForm);
$("visitForm").addEventListener("submit", saveVisitForm);
$("settingsForm").addEventListener("submit", saveSettings);
$("linkForm").addEventListener("submit", saveLink);
$("assetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("assetContinuous").checked) {
    if (selectedAssetFiles().length) await saveContinuousSelection();
    else $("assetSaveStatus").textContent = `選択中の画像はありません。撮影済みの画像はすべて保存されています（連続撮影：合計${state.continuousSavedCount}件）。`;
    return;
  }
  try { await saveSelectedImages(); } catch (err) { $("assetSaveStatus").textContent = "保存できませんでした: " + err.message; }
});
function updateAssetSelectionStatus() {
  const count = selectedAssetFiles().length;
  $("assetSaveStatus").textContent = count ? `${count}件を選択中。AI読み取りは先頭の1枚を使います。` : "";
}
async function onAssetFilesChanged() {
  if ($("assetContinuous").checked) await saveContinuousSelection();
  else updateAssetSelectionStatus();
}
$("assetFileCamera").addEventListener("change", onAssetFilesChanged);
$("assetFilePick").addEventListener("change", onAssetFilesChanged);
$("assetContinuous").addEventListener("change", updateContinuousUi);
$("assetDialog").addEventListener("close", async () => {
  const count = state.continuousSavedCount;
  if (!count) return;
  state.continuousSavedCount = 0;
  const target = state.assetTargetPropertyId;
  state.assetTargetPropertyId = null;
  await refresh();
  toast(`${count}件の画像を保存しました。読み取りは「未整理資料」から実行できます。`);
  if (target) await showProperty(target, "materials");
});
$("propertySearch").addEventListener("input", render);
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try { await importBackup(file); } catch (err) { $("backupStatus").textContent = "読み込み失敗: " + err.message; }
  e.target.value = "";
});
$("detailDialog").addEventListener("close", () => clearObjectUrls());
$("checklistDialog").addEventListener("close", () => { state.checklistWork = null; });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

buildPropertyFieldGroups();
try {
  await loadSettings();
  await refresh();
} catch (error) {
  toast("保存領域を開けません: " + error.message);
}
