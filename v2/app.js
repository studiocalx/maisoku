import { allRecords, saveRecord, deleteRecord, getRecord, replaceAllData, exportAllData, saveImageAsset } from "./db.js";
import { assessCondominium } from "./assessment.js";

const $ = (id) => document.getElementById(id);
const state = { tab: "properties", properties: [], visits: [], assets: [], compareIds: new Set(), pendingAssetId: null, assessmentTargetPropertyId: null, pendingGemReview: null };
const HOUSING_REFERENCE = {
  "大阪市": { amount: 40000, confidence: "公式直接確認", areaRule: true, source: "https://www.city.osaka.lg.jp/fukushi/page/0000086902.html" },
  "枚方市": { amount: 38000, confidence: "公式制度資料との対応確認", areaRule: "可能性あり・金額未確認", source: "https://www.city.hirakata.osaka.jp/0000029011.html" },
  "門真市": { amount: 39000, confidence: "間接確認・要再確認", areaRule: "可能性あり・金額未確認", source: "https://www.city.kadoma.osaka.jp/kenko_fukushi/chiiki_fukushi/23396.html" },
  "八尾市": { amount: 39000, confidence: "公式制度資料との対応確認", areaRule: "可能性あり・金額未確認", source: "https://www.city.yao.osaka.jp/kurashi_tetsuzuki/soudan/1003616/1019981.html" },
  "東大阪市": { amount: 38000, confidence: "公式制度資料との対応確認", areaRule: "可能性あり・金額未確認", source: "https://www.city.higashiosaka.lg.jp/0000002896.html" },
  "尼崎市": { amount: 42500, confidence: "公式制度資料との対応確認", areaRule: "可能性あり・金額未確認", source: "https://www.city.amagasaki.hyogo.jp/kurashi/seikatusien/1001977/132juutakushien.html" }
};
const CHECKLISTS = {
  viewing: ["室内の携帯電波（4G/5G）","窓を閉めた時・開けた時の騒音","水回りの排水・臭い・水勢・給湯","壁・天井・窓周辺のシミ・結露・カビ","コンセントの位置と数","共用部・ゴミ置場・駐輪場の管理","駅からの道・街灯・坂・買い物導線"],
  contract: ["賃料・管理費・駐輪場等の月額総額","初期費用の明細と不要オプション","短期解約違約金の期間・金額","退去時精算・清掃・原状回復特約","更新料・保証会社更新料・引落手数料","重要事項説明書（35条書面）の確認"]
};
const CHECK_STATES = ["未確認","確認済み","問題あり","対象外"];
const uid = () => crypto.randomUUID();
const dateToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const yen = (value) => Number(value || 0).toLocaleString("ja-JP") + "円";
let toastTimer;
let listObjectUrls = [];
let detailObjectUrls = [];
function clearObjectUrls(urls) { for (const url of urls) URL.revokeObjectURL(url); urls.length = 0; }

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
  clearObjectUrls(listObjectUrls);
  const q = $("propertySearch").value.trim().toLowerCase();
  const properties = sortNewest(state.properties).filter(p => !q || [p.title,p.address,p.station].some(v => String(v || "").toLowerCase().includes(q)));
  $("propertiesList").innerHTML = properties.length ? properties.map(p => {
    const price = Number(p.priceYen || p.minimumBidYen || 0);
    const gem = assessCondominium(p);
    return `<article class="record-card"><input class="compare-check" type="checkbox" aria-label="比較対象に選択" data-compare="${p.id}" ${state.compareIds.has(p.id) ? "checked" : ""}><button class="record-main" data-detail-property="${p.id}"><span class="record-kicker">GEM ${gem.score === null ? "未採点" : gem.score + " / 100"} · ${escapeHtml(gem.verdict)}</span><strong>${escapeHtml(p.title || "名称未設定の物件")}</strong><span class="record-sub">${escapeHtml(p.address || "所在地未入力")}${p.station ? " / " + escapeHtml(p.station) : ""}</span><span class="record-price">${price ? yen(price) : "販売価格未確認"}</span></button><button class="mini-button" data-edit-property="${p.id}">編集</button></article>`;
  }).join("") : emptyState("物件の記録はまだありません。","気になる物件を、まず一件残してみましょう。");
  $("compareBar").classList.toggle("hidden", state.compareIds.size === 0);
  $("compareCount").textContent = state.compareIds.size + "件選択中";
  $("compareBtn").disabled = state.compareIds.size < 2;
  const visits = sortNewest(state.visits, "date");
  $("visitsList").innerHTML = visits.length ? visits.map(v => `<article class="record-card"><button class="record-main" data-detail-visit="${v.id}"><span class="record-kicker">${escapeHtml(v.date || "日付未設定")}</span><strong>${escapeHtml(v.place || "地域名未設定")}</strong><span class="record-sub">${escapeHtml(v.memo || "メモはありません")}</span></button><button class="mini-button" data-edit-visit="${v.id}">編集</button></article>`).join("") : emptyState("街の記録はまだありません。","物件がなくても、歩いた街の印象を残せます。");
  const assets = sortNewest(state.assets, "createdAt").filter(a => !a.propertyId);
  $("assetsList").innerHTML = assets.length ? assets.map(a => `<article class="asset-card"><img data-asset-image="${a.id}" alt=""><div class="asset-meta"><b>${escapeHtml(a.kind)}</b><span>${escapeHtml(a.name)}</span><small>${escapeHtml((a.createdAt || "").slice(0,16).replace("T"," "))}</small><div class="asset-actions"><button class="mini-button" data-link-asset="${a.id}">物件に紐付け</button><button class="mini-button danger" data-delete-asset="${a.id}">削除</button></div></div></article>`).join("") : emptyState("未整理資料はありません。","撮影した画像は、物件名が分からなくても保存できます。");
  for (const asset of assets) {
    const img = document.querySelector(`[data-asset-image="${asset.id}"]`);
    if (img && asset.blob) { const url = URL.createObjectURL(asset.blob); listObjectUrls.push(url); img.src = url; }
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
  $("formTitle").textContent = record?.isOcrDraft ? "AI読み取り結果を確認" : record ? "物件を編集" : "物件を登録";
  $("formEyebrow").textContent = record ? "EDIT PROPERTY" : "NEW PROPERTY";
  $("propertyFields").classList.remove("hidden");
  $("visitFields").classList.add("hidden");
  fillVisitOptions(record?.visitId || "");
  $("pTitle").value = record?.title || "";
  $("pStructureText").value = record?.structureText || record?.structure || "";
  $("pStructureGrade").value = record?.structureGrade || "";
  $("pPrice").value = record?.priceYen ?? "";
  $("pMinimumBid").value = record?.minimumBidYen ?? "";
  $("pCondoManagementFee").value = record?.condoManagementFeeYen ?? "";
  $("pRepairReserve").value = record?.repairReserveYen ?? "";
  $("pArrears").value = record?.arrearsYen ?? "";
  $("pOccupancy").value = record?.occupancy || "";
  $("pTotalFloors").value = record?.totalFloors ?? "";
  $("pUnitFloor").value = record?.unitFloor ?? "";
  $("pElevatorAccess").value = record?.elevatorAccess || "";
  $("pInfrastructure").value = record?.infrastructure || "";
  $("pManagementStatus").value = record?.managementStatus || "";
  $("pMaintenanceCostStatus").value = record?.maintenanceCostStatus || "";
  $("pNoiseStatus").value = record?.noiseStatus || "";
  $("pLaundryPlacement").value = record?.laundryPlacement || "";
  $("pLivingEnvironment").value = record?.livingEnvironment || "";
  $("pPipeRenewal").value = record?.pipeRenewal || "";
  $("pMarketLiquidity").value = record?.marketLiquidity || "";
  $("pRepairCost").value = record?.repairCost ?? "";
  $("pAssetRetention").value = record?.assetRetention || "";
  $("pRepairPlan").value = record?.repairPlan || "";
  $("pManagementCompany").value = record?.managementCompany || "";
  $("pElevatorText").value = record?.elevatorText || "";
  $("pMajorRepairHistory").value = record?.majorRepairHistory || "";
  $("pPipeUpdateHistory").value = record?.pipeUpdateHistory || "";
  $("pRegion").value = record?.region || "";
  $("pParking").value = record?.parkingFee ?? "";
  $("pAddress").value = record?.address || "";
  $("pRent").value = record?.rent ?? "";
  $("pFee").value = record?.fee ?? "";
  $("pStation").value = record?.station || "";
  $("pWalk").value = record?.walkMinutes ?? "";
  $("pLayout").value = record?.layout || "";
  $("pArea").value = record?.area ?? "";
  $("pDeposit").value = record?.deposit || "";
  $("pKeyMoney").value = record?.keyMoney || "";
  $("pBuiltYear").value = record?.builtYear ?? "";
  $("pStructure").value = record?.structure || "";
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
function housingReferenceHtml(p) {
  if (!p.region || !HOUSING_REFERENCE[p.region]) return '<h3>地域別の住居費参考目安</h3><p class="hint">対象地域を設定すると、調査済み6市の参考値を表示します。地域が対象外の場合は金額を推測しません。</p>';
  const ref = HOUSING_REFERENCE[p.region], rent = Number(p.rent || 0);
  let amount = ref.amount, areaNote = "";
  if (p.region === "大阪市" && Number(p.area) > 0 && Number(p.area) <= 15) {
    if (p.area > 10) amount = 36000;
    else if (p.area > 6) amount = 32000;
    else amount = 28000;
    areaNote = "大阪市の面積別参考額を適用（単身・調査時点）。";
  } else if (Number(p.area) > 0 && Number(p.area) <= 15) {
    areaNote = "15㎡以下では面積条件による減額の可能性がありますが、この地域の具体額は未確認のため補正していません。";
  }
  const difference = rent - amount;
  return `<h3>地域別の住居費参考目安</h3><div class="reference-row"><b>${escapeHtml(p.region)}</b><strong>${yen(amount)} / 月</strong></div><p class="hint">単身世帯・家賃のみの調査時点参考値。根拠の確認状況：${escapeHtml(ref.confidence)}。</p><p class="reference-status">${rent ? (difference <= 0 ? "参考目安内" : "参考目安超過") + " · 家賃との差 " + (difference > 0 ? "+" : "") + yen(difference) : "家賃未入力のため比較できません"}</p><p class="hint">${areaNote || (ref.areaRule === true ? "専有面積15㎡以下の場合は面積区分による減額に注意してください。" : "面積条件の詳細：" + ref.areaRule + "。")} 管理費・共益費・駐輪場代は参考上限の対象外で、実際の月額負担には別途加算します。</p><p class="hint">これは制度上の参考情報であり、個別の認定額・支給額・利用資格を判定するものではありません。調査基準日：2026年11月25日。<a href="${ref.source}" target="_blank" rel="noopener">自治体の参照ページを確認</a></p>`;
}
function compareProperties() {
  const items = state.properties.filter(p => state.compareIds.has(p.id));
  if (items.length < 2) return toast("比較する物件を2件以上選んでください。");
  const rows = [
    ["所在地", p => p.address || "未確認"],
    ["販売価格", p => p.priceYen == null ? "未確認" : yen(p.priceYen)],
    ["最低買受価格", p => p.minimumBidYen == null ? "未確認" : yen(p.minimumBidYen)],
    ["構造", p => p.structureText || "未確認"],
    ["築年", p => p.builtYear || "未確認"],
    ["専有面積", p => p.area == null ? "未確認" : p.area+"㎡"],
    ["最寄駅・徒歩", p => (p.station || "未確認") + (p.walkMinutes != null ? "・徒歩"+p.walkMinutes+"分" : "")],
    ["管理費（月額）", p => p.condoManagementFeeYen == null ? "未確認" : yen(p.condoManagementFeeYen)],
    ["修繕積立金（月額）", p => p.repairReserveYen == null ? "未確認" : yen(p.repairReserveYen)],
    ["滞納額", p => p.arrearsYen == null ? "未確認" : yen(p.arrearsYen)],
    ["占有状況", p => p.occupancy || "未確認"],
    ["管理・共用部", p => p.managementStatus || "未確認"],
    ["専有部配管", p => p.pipeRenewal || "未確認"],
    ["修繕・清算コスト", p => p.repairCost == null ? "未確認" : yen(p.repairCost)],
    ["GEM適合スコア", p => { const a=assessCondominium(p); return a.score == null ? "未採点" : a.score+"/100（充足率"+a.coverage+"%）"; }],
    ["GEM総合判定", p => assessCondominium(p).verdict]
  ];
  $("compareContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">SIDE BY SIDE</p><h2>物件比較</h2></div><button class="icon-button" data-close>×</button></div><div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>比較項目</th>${items.map(p=>`<th>${escapeHtml(p.title || "名称未設定")}</th>`).join("")}</tr></thead><tbody>${rows.map(([label,fn])=>`<tr><th>${label}</th>${items.map(p=>`<td>${escapeHtml(fn(p))}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="hint">未確認項目は空欄や推測で補わず、そのまま比較表示しています。点数による自動順位付けは行いません。</p><div class="dialog-actions"><button class="button button-quiet" data-close>閉じる</button></div>`;
  $("compareDialog").showModal();
}
async function openChecklist(propertyId, kind) {
  const p = await getRecord("properties", propertyId);
  if (!p) return;
  const title = kind === "viewing" ? "内見チェック" : "契約チェック";
  const items = CHECKLISTS[kind];
  const saved = p.checklists?.[kind] || {};
  $("checklistContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">${kind === "viewing" ? "VIEWING" : "CONTRACT"} CHECKLIST</p><h2>${title}</h2><p class="hint">${escapeHtml(p.title || "名称未設定の物件")}</p></div><button class="icon-button" data-close>×</button></div><div class="checklist-rows">${items.map((item,i)=>`<label class="checklist-row"><span>${escapeHtml(item)}</span><select data-check-status="${i}">${CHECK_STATES.map(s=>`<option ${(saved[i] || "未確認")===s?"selected":""}>${s}</option>`).join("")}</select><textarea data-check-note="${i}" rows="1" placeholder="メモ（任意）">${escapeHtml(saved[i+"_note"] || "")}</textarea></label>`).join("")}</div><div class="dialog-actions"><button class="button button-quiet" data-close>閉じる</button><button class="button button-dark" data-save-checklist="${propertyId}" data-kind="${kind}">チェック結果を保存</button></div>`;
  $("checklistDialog").showModal();
}
async function saveChecklist(propertyId, kind) {
  const p = await getRecord("properties", propertyId);
  if (!p) return;
  const values = {};
  for (let i=0;i<CHECKLISTS[kind].length;i++) {
    values[i] = $("checklistContent").querySelector(`[data-check-status="${i}"]`).value;
    values[i+"_note"] = $("checklistContent").querySelector(`[data-check-note="${i}"]`).value;
  }
  p.checklists = { ...(p.checklists || {}), [kind]: values };
  p.updatedAt = new Date().toISOString();
  await saveRecord("properties",p); await refresh(); $("checklistDialog").close(); toast("チェック結果を保存しました。");
}
async function showProperty(id) {
  clearObjectUrls(detailObjectUrls);
  const p = await getRecord("properties", id);
  if (!p) return;
  const assets = state.assets.filter(a => a.propertyId === id);
  const appraisal = assessCondominium(p);
  const review = p.gemReview && typeof p.gemReview === "object" ? p.gemReview : {};
  const scoreText = appraisal.score === null ? "—" : appraisal.score;
  const verdictText = appraisal.verdict === "判定保留" ? "判定保留" : appraisal.verdict;
  const itemRows = appraisal.items.map(item => `<tr><th>${escapeHtml(item.label)}</th><td>${escapeHtml(String(item.value))}</td><td>${item.points === null ? "未採点" : item.points + " / " + item.weight}</td><td>${escapeHtml(item.status)}</td></tr>`).join("");
  const overview = [
    ["所在地",p.address],["交通",p.station ? p.station + (p.walkMinutes != null ? " 徒歩"+p.walkMinutes+"分":"") : ""],
    ["構造",p.structureText || p.structure],["専有面積",p.area != null ? p.area+"㎡":""],
    ["販売価格",p.priceYen != null ? yen(p.priceYen):""],["最低買受価格",p.minimumBidYen != null ? yen(p.minimumBidYen):""],
    ["管理費",p.condoManagementFeeYen != null ? yen(p.condoManagementFeeYen):""],["修繕積立金",p.repairReserveYen != null ? yen(p.repairReserveYen):""],
    ["滞納額",p.arrearsYen != null ? yen(p.arrearsYen):""],["占有状況",p.occupancy],["築年",p.builtYear || ""],["所在階・総階数",p.unitFloor ? p.unitFloor + "階 / " + (p.totalFloors || "未確認") + "階建" : ""],["管理会社",p.managementCompany],["エレベーター",p.elevatorText],["長期修繕計画",p.repairPlan],["大規模修繕履歴",p.majorRepairHistory],["専有部配管履歴",p.pipeUpdateHistory]
  ];
  $("detailContent").innerHTML = `<div class="dialog-head"><div><p class="eyebrow">GEM · CONDOMINIUM MONITOR</p><h2>${escapeHtml(p.title || "名称未設定")}</h2></div><button class="icon-button" data-close>×</button></div>
  <section class="gem-score-panel"><div><p class="eyebrow">適合スコア · 仮配点による暫定評価</p><strong class="gem-score">${scoreText}<small> / 100</small></strong><p class="gem-verdict">総合判定：${verdictText}　／　個別戦略：${escapeHtml(appraisal.strategy)}</p></div><div class="gem-coverage">評価充足率 <b>${appraisal.coverage}%</b><p>未確認項目は減点せず、採点対象外として表示</p></div></section>
  ${appraisal.provisional ? '<p class="hint">暫定評価です。評価充足率80%未満、または必須確認項目が未入力です。点数だけで購入判断をしないでください。</p>' : ""}
  <h3>物件基本概要</h3><dl class="detail-grid">${overview.map(([k,v])=>`<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || "未確認")}</dd>`).join("")}</dl>
  <h3>物件査定要約（検討用）</h3><p class="detail-memo">${escapeHtml(review.public_summary || (appraisal.score===null?"評価に必要な情報が不足しています。":appraisal.score>=80?"主要な評価項目に良好な情報があります。未確認事項を解消しながら検討を進めます。":appraisal.score>=60?"一定の適合項目があります。未確認事項と懸念点を確認して継続判断します。":"現時点では懸念点が残ります。条件・管理資料を確認してから判断します。"))}</p>
  <h3>注目ポイント</h3><p>${Array.isArray(review.highlights) && review.highlights.length ? review.highlights.slice(0,3).map(escapeHtml).join(" ／ ") : appraisal.strengths.length ? appraisal.strengths.slice(0,3).map(escapeHtml).join(" ／ ") : "資料から確認できた注目ポイントはまだありません。"}</p><h3>詳細確認事項（不動産会社への質問）</h3><p>${escapeHtml(review.expert_question || (!p.repairPlan ? "長期修繕計画の進捗と、次回大規模修繕の実施時期・資金計画を確認してください。" : !p.pipeUpdateHistory ? "専有部配管の更新履歴と、今後の更新可否・費用負担区分を確認してください。" : "管理費・修繕積立金の改定予定と、長期修繕計画との整合性を確認してください。"))}</p>
  <details class="gem-private"><summary>個別戦略資産監査（内部用メモ）</summary><div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>評価指標</th><th>確認内容</th><th>得点</th><th>状況</th></tr></thead><tbody>${itemRows}</tbody></table></div>
  <h3>未確認項目</h3><ul>${appraisal.missing.map(x=>`<li>${escapeHtml(x)}</li>`).join("") || "<li>採点対象の必須項目は入力済みです。資料原本との照合は続けてください。</li>"}</ul>
  <h3>リスク・注意事項</h3><ul>${[...(Array.isArray(review.internal_findings)?review.internal_findings:[]),...appraisal.risks].map(x=>`<li>${escapeHtml(x)}</li>`).join("") || "<li>入力済み項目から重大な警告は検出されていません。未確認項目がないことを意味しません。</li>"}</ul>
  <p class="hint">配点はGEM Ver.2.1に数値指定がないため、現段階の実装用仮配点です。AIは資料の事実抽出を担当し、採点は固定ルールで計算します。これは購入適合性の検討補助であり、不動産鑑定評価や売買価格の査定ではありません。最終判断には管理規約・重要事項調査報告書・長期修繕計画・現地確認が必要です。</p></details>
  <div class="detail-tools"><button class="mini-button" data-add-material="${p.id}">追加資料を撮影して再評価</button><button class="mini-button" data-checklist="${p.id}" data-kind="viewing">現地確認チェック</button></div>
  <p class="detail-memo">${escapeHtml(p.memo || "メモはありません。")}</p><h3>関連資料（${assets.length}件）</h3><div class="asset-grid">${assets.map(a=>`<div class="asset-card"><img data-detail-image="${a.id}" alt=""><div class="asset-meta"><b>${escapeHtml(a.kind)}</b><span>${escapeHtml(a.name)}</span></div></div>`).join("")}</div>
  <div class="dialog-actions"><button class="button button-quiet" data-close>閉じる</button><button class="button button-dark" data-edit-property="${p.id}">査定情報を編集・再評価</button></div>`;
  for (const a of assets) {
    const img = document.querySelector(`[data-detail-image="${a.id}"]`);
    if (img && a.blob) { const url = URL.createObjectURL(a.blob); detailObjectUrls.push(url); img.src = url; }
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
    const record = {
      ...previous, id, gemReview: state.pendingGemReview || previous?.gemReview || null, title: $("pTitle").value.trim(), address: $("pAddress").value.trim(),
      station: $("pStation").value.trim(), walkMinutes: $("pWalk").value === "" ? null : Number($("pWalk").value),
      structureText: $("pStructureText").value.trim(), structureGrade: $("pStructureGrade").value || null,
      structure: $("pStructureGrade").value || null, area: $("pArea").value === "" ? null : Number($("pArea").value),
      priceYen: $("pPrice").value === "" ? null : Number($("pPrice").value),
      minimumBidYen: $("pMinimumBid").value === "" ? null : Number($("pMinimumBid").value),
      condoManagementFeeYen: $("pCondoManagementFee").value === "" ? null : Number($("pCondoManagementFee").value),
      repairReserveYen: $("pRepairReserve").value === "" ? null : Number($("pRepairReserve").value),
      arrearsYen: $("pArrears").value === "" ? null : Number($("pArrears").value),
      builtYear: $("pBuiltYear").value === "" ? null : Number($("pBuiltYear").value),
      totalFloors: $("pTotalFloors").value === "" ? null : Number($("pTotalFloors").value),
      unitFloor: $("pUnitFloor").value === "" ? null : Number($("pUnitFloor").value),
      occupancy: $("pOccupancy").value.trim(), elevatorAccess: $("pElevatorAccess").value || null,
      infrastructure: $("pInfrastructure").value || null, managementStatus: $("pManagementStatus").value || null,
      maintenanceCostStatus: $("pMaintenanceCostStatus").value || null,
      noiseStatus: $("pNoiseStatus").value || null, laundryPlacement: $("pLaundryPlacement").value || null,
      livingEnvironment: $("pLivingEnvironment").value || null, pipeRenewal: $("pPipeRenewal").value || null,
      marketLiquidity: $("pMarketLiquidity").value || null,
      repairCost: $("pRepairCost").value === "" ? null : Number($("pRepairCost").value),
      assetRetention: $("pAssetRetention").value || null,
      repairPlan: $("pRepairPlan").value.trim(), pipeUpdateHistory: $("pPipeUpdateHistory").value.trim(),
      managementCompany: $("pManagementCompany").value.trim(), elevatorText: $("pElevatorText").value.trim(),
      majorRepairHistory: $("pMajorRepairHistory").value.trim(),
      memo: $("pMemo").value.trim(), createdAt: previous?.createdAt || now, updatedAt: now
    };
    await saveRecord("properties", record);
    if (state.pendingAssetId) {
      const asset = await getRecord("assets", state.pendingAssetId);
      if (asset) { asset.propertyId = id; await saveRecord("assets", asset); }
      state.pendingAssetId = null;
    }
    state.pendingGemReview = null;
  } else {
    const previous = await getRecord("visits", id);
    await saveRecord("visits", { ...previous, id, date: $("vDate").value, place: $("vPlace").value.trim(), memo: $("vMemo").value.trim(), createdAt: previous?.createdAt || now, updatedAt: now });
  }
  $("recordDialog").close(); await refresh(); toast("査定情報を保存しました。");
  if (type === "property") await showProperty(id);
}
async function analyzeFlyer(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type || "")) {
    toast("JPEG・PNG・WebPのマイソク画像を選択してください。");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast("画像が20MBを超えています。サイズを下げてください。");
    return;
  }
  const button = $("analyzeFlyerBtn");
  const status = $("assetSaveStatus");
  button.disabled = true;
  button.textContent = "原画像を保存しています…";
  let asset;
  try {
    // 原本を先に保存。AI通信に失敗しても撮影資料は失われない。
    asset = await saveImageAsset(file, { kind: "マイソク", memo: $("assetMemo").value.trim() });
    status.textContent = "原画像を保存しました。AIで項目を読み取っています…";
    const bitmap = await createImageBitmap(file);
    let compressed;
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
      compressed = await new Promise((resolve, reject) =>
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("画像の圧縮に失敗しました。")), "image/jpeg", 0.86)
      );
    } finally {
      bitmap.close();
    }
    if (compressed.size > 12 * 1024 * 1024) throw new Error("圧縮後も12MBを超えています。画像を小さくしてください。");
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
      reader.readAsDataURL(compressed);
    });
    const reviewTarget = state.assessmentTargetPropertyId ? await getRecord("properties", state.assessmentTargetPropertyId) : null;
    const propertyContext = reviewTarget ? {
      title: reviewTarget.title, address: reviewTarget.address, station: reviewTarget.station,
      walkMinutes: reviewTarget.walkMinutes, structureText: reviewTarget.structureText,
      structure: reviewTarget.structure, area: reviewTarget.area, priceYen: reviewTarget.priceYen,
      minimumBidYen: reviewTarget.minimumBidYen, condoManagementFeeYen: reviewTarget.condoManagementFeeYen,
      repairReserveYen: reviewTarget.repairReserveYen, arrearsYen: reviewTarget.arrearsYen,
      occupancy: reviewTarget.occupancy, builtYear: reviewTarget.builtYear,
      repairPlan: reviewTarget.repairPlan, majorRepairHistory: reviewTarget.majorRepairHistory,
      pipeUpdateHistory: reviewTarget.pipeUpdateHistory
    } : null;
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, mimeType: "image/jpeg", propertyContext })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true || !result.data) {
      throw new Error(result.error || "AI読み取りに失敗しました。");
    }
    const data = result.data;
    const numberOrNull = value => Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null;
    const extracted = {
      title: data.title || "", address: data.address || "", station: data.station || "",
      walkMinutes: numberOrNull(data.walk_minutes), structureText: data.structure_text || "",
      structure: data.structure_grade || null, structureGrade: data.structure_grade || null,
      area: numberOrNull(data.area_sqm), priceYen: numberOrNull(data.price_yen),
      minimumBidYen: numberOrNull(data.minimum_bid_yen),
      condoManagementFeeYen: numberOrNull(data.condo_management_fee_yen),
      repairReserveYen: numberOrNull(data.repair_reserve_yen), arrearsYen: numberOrNull(data.arrears_yen),
      occupancy: data.occupancy || "", builtYear: numberOrNull(data.built_year),
      totalFloors: numberOrNull(data.total_floors), unitFloor: numberOrNull(data.unit_floor),
      managementCompany: data.management_company || "", elevatorText: data.elevator || "",
      repairPlan: data.repair_plan || "", majorRepairHistory: data.major_repair_history || "",
      pipeUpdateHistory: data.pipe_update_history || "",
      gemReview: data.review && typeof data.review === "object" ? data.review : null,
      memo: [data.notes, Array.isArray(data.uncertain_fields) && data.uncertain_fields.length ? "AI読み取り要確認: " + data.uncertain_fields.join("、") : ""].filter(Boolean).join("\n")
    };
    if (state.assessmentTargetPropertyId) {
      const existing = await getRecord("properties", state.assessmentTargetPropertyId);
      if (!existing) throw new Error("再評価する物件が見つかりません。");
      const merged = { ...existing };
      for (const [key,value] of Object.entries(extracted)) {
        if (value !== null && value !== undefined && value !== "") merged[key] = value;
      }
      merged.gemReview = extracted.gemReview || existing.gemReview || null;
      merged.updatedAt = new Date().toISOString();
      await saveRecord("properties", merged);
      asset.propertyId = existing.id;
      await saveRecord("assets", asset);
      state.assessmentTargetPropertyId = null;
      $("assetDialog").close();
      $("assetFile").value = "";
      $("assetMemo").value = "";
      await refresh();
      await showProperty(existing.id);
      status.textContent = "追加資料を反映し、GEM評価を更新しました。";
      toast("追加資料を統合して再評価しました。");
      return;
    }
    const draft = { isOcrDraft: true, ...extracted };
    state.pendingAssetId = asset.id;
    $("assetDialog").close();
    setTab("properties");
    openPropertyForm(draft);
    $("assetFile").value = "";
    $("assetMemo").value = "";
    status.textContent = "読み取り完了。原本と照合してから査定情報を保存してください。";
    toast("分譲マンション情報を読み取りました。確認して保存してください。");
  } catch (error) {
    status.textContent = asset
      ? "AI読み取りは完了しませんでした。原画像は保存済みです。未整理資料から後で確認できます。"
      : "原画像を保存できませんでした。保存領域の空き容量やブラウザ設定を確認してください。";
    if (asset) await refresh();
    toast(error.message || "AI読み取りに失敗しました。");
  } finally {
    button.disabled = false;
    button.textContent = "分譲資料をAIで読み取り、GEM査定";
  }
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
function openAssetLink(id) {
  if (!state.properties.length) { toast("先に物件を登録してください。"); return; }
  const asset = state.assets.find(a => a.id === id);
  if (!asset) { toast("資料が見つかりません。"); return; }
  $("assetLinkId").value = id;
  $("assetLinkProperty").innerHTML = state.properties.map(p =>
    `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title || "名称未設定")} — ${escapeHtml(p.address || "所在地未入力")}</option>`
  ).join("");
  $("assetLinkDialog").showModal();
}
async function saveAssetLink(event) {
  event.preventDefault();
  const id = $("assetLinkId").value;
  const propertyId = $("assetLinkProperty").value;
  const asset = await getRecord("assets", id);
  if (!asset || !state.properties.some(p => p.id === propertyId)) {
    toast("資料または物件を確認できませんでした。");
    return;
  }
  asset.propertyId = propertyId;
  await saveRecord("assets", asset);
  $("assetLinkDialog").close();
  await refresh();
  toast("物件に資料を紐付けました。");
}
async function exportBackup() {
  const data = await exportAllData();
  const enriched = { ...data, assets: await Promise.all(data.assets.map(async a => ({ ...a, blobData: await blobToDataUrl(a.blob), blob: undefined }))) };
  const blob = new Blob([JSON.stringify(enriched)], {type:"application/json"});
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = `maisoku-ai-backup-${dateToday()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
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
function validateBackupRecords(records, label) {
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record !== "object" || typeof record.id !== "string" || !record.id.trim()) {
      throw new Error(label + "にIDのないデータがあります。復元を中止しました。");
    }
    if (ids.has(record.id)) throw new Error(label + "に重複したIDがあります。復元を中止しました。");
    ids.add(record.id);
  }
}
async function importBackup(file) {
  const parsed = JSON.parse(await file.text());
  if (parsed.app !== "maisoku-ai-2" || parsed.version !== 1 ||
      !Array.isArray(parsed.properties) || !Array.isArray(parsed.visits) || !Array.isArray(parsed.assets)) {
    throw new Error("マイソクAI 2.0のバックアップ形式ではありません。");
  }
  validateBackupRecords(parsed.properties, "物件データ");
  validateBackupRecords(parsed.visits, "街の記録");
  validateBackupRecords(parsed.assets, "資料データ");
  for (const asset of parsed.assets) {
    if (typeof asset.blobData !== "string" ||
        !/^data:[^;,]+;base64,[A-Za-z0-9+/]*={0,2}$/.test(asset.blobData)) {
      throw new Error("画像データが不足しているか、形式が壊れています。現在のデータは変更していません。");
    }
  }
  const confirmed = confirm("現在の記録をバックアップ内容で置き換えます。事前に現在のデータも書き出しましたか？");
  if (!confirmed) return;
  const restoredAssets = parsed.assets.map(asset => {
    const copy = { ...asset, blob: dataUrlToBlob(asset.blobData) };
    delete copy.blobData;
    return copy;
  });
  await replaceAllData({ ...parsed, assets: restoredAssets });
  await refresh();
  $("backupStatus").textContent = "バックアップを読み込みました。";
  toast("データを復元しました。");
}

document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.matches("[data-compare]")) {
    if (el.checked) state.compareIds.add(el.dataset.compare);
    else state.compareIds.delete(el.dataset.compare);
    render();
  }
});
document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.tab) setTab(target.dataset.tab);
  if (target.hasAttribute("data-close")) { target.closest("dialog")?.close(); }
  if (target.id === "visitBtn") openVisitForm();
  if (target.id === "propertyBtn") openPropertyForm();
  if (target.id === "captureBtn") { state.assessmentTargetPropertyId = null; $("assetDialog").showModal(); }
  if (target.dataset.addMaterial) { $("detailDialog").close(); state.assessmentTargetPropertyId = target.dataset.addMaterial; $("assetFile").value = ""; $("assetSaveStatus").textContent = "この物件の追加資料を撮影してください。"; $("assetDialog").showModal(); }
  if (target.id === "analyzeFlyerBtn") {
    const file = $("assetFile").files?.[0];
    if (!file) toast("先に分譲マンション資料を撮影するか、画像を選択してください。");
    else await analyzeFlyer(file);
  }
  if (target.id === "backupBtn") $("backupDialog").showModal();
  if (target.id === "compareBtn") compareProperties();
  if (target.id === "clearCompareBtn") { state.compareIds.clear(); render(); }
  if (target.dataset.checklist) await openChecklist(target.dataset.checklist,target.dataset.kind);
  if (target.dataset.saveChecklist) await saveChecklist(target.dataset.saveChecklist,target.dataset.kind);
  if (target.id === "exportBtn") { try { await exportBackup(); } catch(e) { $("backupStatus").textContent=e.message; } }
  if (target.dataset.editProperty) { $("detailDialog").close(); openPropertyForm(state.properties.find(p=>p.id===target.dataset.editProperty)); }
  if (target.dataset.editVisit) { $("detailDialog").close(); openVisitForm(state.visits.find(v=>v.id===target.dataset.editVisit)); }
  if (target.dataset.detailProperty) await showProperty(target.dataset.detailProperty);
  if (target.dataset.detailVisit) await showVisit(target.dataset.detailVisit);
  if (target.dataset.linkAsset) openAssetLink(target.dataset.linkAsset);
  if (target.dataset.deleteAsset) {
    if (confirm("この資料画像を削除しますか？")) { await deleteRecord("assets",target.dataset.deleteAsset); await refresh(); toast("資料を削除しました。"); }
  }
});
$("detailDialog").addEventListener("close", () => clearObjectUrls(detailObjectUrls));
$("recordDialog").addEventListener("close", () => {
  if (state.pendingAssetId) {
    state.pendingAssetId = null;
    state.pendingGemReview = null;
    toast("物件登録を中止しました。原画像は未整理資料に保存されています。");
  }
});
$("recordForm").addEventListener("submit", saveForm);
$("assetLinkForm").addEventListener("submit", async e => { try { await saveAssetLink(e); } catch (err) { toast("紐付けに失敗しました: " + err.message); } });
$("assetForm").addEventListener("submit", async e => { e.preventDefault(); try { await saveSelectedImages([...$("assetFile").files]); } catch(err) { $("assetSaveStatus").textContent = "保存できませんでした: " + err.message; } });
$("assetFile").addEventListener("change", () => { $("assetSaveStatus").textContent = $("assetFile").files.length ? `${$("assetFile").files.length}件を選択中。AI読み取りは先頭の1枚を使います。` : ""; });
$("quickFile").addEventListener("change", async () => { try { await saveSelectedImages([...$("quickFile").files]); } catch(e) { toast("保存失敗: " + e.message); } });
$("propertySearch").addEventListener("input", render);
$("importFile").addEventListener("change", async e => { const file=e.target.files?.[0]; if(!file)return; try{await importBackup(file);}catch(err){$("backupStatus").textContent="読み込み失敗: "+err.message;} e.target.value=""; });
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>b.closest("dialog")?.close()));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

try { await refresh(); } catch (error) { toast("保存領域を開けません: " + error.message); }
