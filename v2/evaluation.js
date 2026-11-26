// マイソクAI 2.0（賃貸版）: 評価エンジン（純粋JS / DOM不使用 / Nodeでテスト可能）
// 方針: 情報不足は減点しない。充足率・信頼度だけを下げる。AIはスコアを決めない（ここは固定ルール）。
import { DEFAULT_CRITERIA, AREA_ITEM_DEFS, HOUSING_REFERENCE } from "./criteria.js";

export function fieldValue(property, key) {
  return property?.fields?.[key]?.value ?? null;
}

// 内部用: 空文字は未確認として扱う
function v(property, key) {
  const value = fieldValue(property, key);
  return value === "" || value === undefined ? null : value;
}

function text(property, key) {
  const value = v(property, key);
  return value === null ? null : String(value);
}

const POINTS = { good: 1, fair: 0.5, bad: 0 };

function computeScore(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const naWeight = items.filter(i => i.state === "na").reduce((sum, i) => sum + i.weight, 0);
  const scoredItems = items.filter(i => i.state === "scored");
  const scoredWeight = scoredItems.reduce((sum, i) => sum + i.weight, 0);
  const applicableWeight = totalWeight - naWeight;
  const sufficiencyRate = applicableWeight > 0 ? Math.round((scoredWeight / applicableWeight) * 100) : null;
  const totalScore = scoredWeight > 0
    ? Math.round((scoredItems.reduce((sum, i) => sum + POINTS[i.mark] * i.weight, 0) / scoredWeight) * 100)
    : null;
  const confidence = sufficiencyRate === null ? "低" : sufficiencyRate >= 80 ? "高" : sufficiencyRate >= 50 ? "中" : "低";
  const verdict = (sufficiencyRate === null || sufficiencyRate < 50 || totalScore === null)
    ? "判定保留"
    : totalScore >= 80 ? "◎" : totalScore >= 65 ? "○" : totalScore >= 45 ? "△" : "×";
  return { totalScore, scoredWeight, applicableWeight, totalWeight, sufficiencyRate, confidence, verdict };
}

// ---- 自動ルール: {mark, rationale} | {na:true, rationale} | null（情報不足）を返す ----

function parseMonths(raw) {
  if (raw === null || raw === undefined) return null;
  const original = String(raw).trim();
  if (original === "") return null;
  if (original.includes("なし") || original.includes("無") || original.includes("0")) return 0;
  const normalized = original.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const monthMatch = normalized.match(/([0-9.]+)\s*(ヶ月|か月|ヵ月)/);
  if (monthMatch) {
    const n = Number(monthMatch[1]);
    return Number.isFinite(n) ? n : null;
  }
  if (/^[0-9]+(\.[0-9]+)?$/.test(normalized)) return Number(normalized);
  if (original.includes("円")) return null;
  return null;
}

const AUTO_RULES = {
  walk_minutes(property) {
    const value = v(property, "walk_minutes");
    if (value === null || !Number.isFinite(Number(value))) return null;
    const n = Number(value);
    const rationale = `最寄駅まで徒歩${n}分`;
    if (n <= 5) return { mark: "good", rationale };
    if (n <= 12) return { mark: "fair", rationale };
    return { mark: "bad", rationale };
  },
  stop_type(property) {
    const value = text(property, "stop_type");
    if (!value) return null;
    const rationale = `停車種別は「${value}」`;
    // 「準急・区間急行」は「急行」を、「新快速」は「快速」を含むため、具体的な種別から判定する
    if (value.includes("準急") || value.includes("区間急行")) return { mark: "fair", rationale };
    if (value.includes("新快速") || value.includes("特急") || value.includes("急行")) return { mark: "good", rationale };
    if (value.includes("快速")) return { mark: "fair", rationale };
    if (value.includes("普通")) return { mark: "fair", rationale };
    return { mark: "fair", rationale };
  },
  hub_type(property) {
    const value = text(property, "hub_type");
    if (!value) return null;
    const rationale = `路線状況は「${value}」`;
    if (value.includes("複数路線ハブ")) return { mark: "good", rationale };
    if (value.includes("近隣別路線あり")) return { mark: "fair", rationale };
    if (value.includes("単一路線")) return { mark: "fair", rationale };
    return { mark: "fair", rationale };
  },
  bike_parking(property) {
    const value = text(property, "bike_parking");
    if (!value) return null;
    const rationale = `駐輪場は「${value}」`;
    if (value.includes("無料")) return { mark: "good", rationale };
    if (value.includes("有料")) return { mark: "fair", rationale };
    if (value.includes("なし")) return { mark: "bad", rationale };
    return { mark: "fair", rationale };
  },
  bath_toilet(property) {
    const value = text(property, "bath_toilet");
    if (!value) return null;
    if (value.includes("別")) return { mark: "good", rationale: `風呂・トイレは「${value}」（別）` };
    if (value.includes("ユニット") || value.includes("一体")) return { mark: "fair", rationale: `風呂・トイレは「${value}」` };
    return { mark: "fair", rationale: `風呂・トイレは「${value}」` };
  },
  laundry(property) {
    const value = text(property, "laundry_placement");
    if (!value) return null;
    const rationale = `洗濯機置場は「${value}」`;
    if (value.includes("室内")) return { mark: "good", rationale };
    if (value.includes("なし")) return { mark: "bad", rationale };
    if (value.includes("バルコニー") || value.includes("室外") || value.includes("共用")) return { mark: "fair", rationale };
    return { mark: "fair", rationale };
  },
  elevator_item(property) {
    const floorRaw = v(property, "unit_floor");
    const floor = floorRaw === null ? null : Number(floorRaw);
    if (floor !== null && Number.isFinite(floor) && floor <= 2) {
      return { na: true, rationale: "所在階が2階以下のため対象外" };
    }
    const value = text(property, "elevator");
    if (!value) return null;
    if (value.includes("あり")) return { mark: "good", rationale: `エレベーターは「${value}」` };
    if (value.includes("なし")) {
      return { mark: floor !== null && floor >= 3 ? "bad" : "fair", rationale: `エレベーターは「${value}」${floor !== null ? `（所在階${floor}階）` : ""}` };
    }
    return { mark: "fair", rationale: `エレベーターは「${value}」` };
  },
  budget_fit(property, settings) {
    const rentRaw = v(property, "rent_yen");
    if (rentRaw === null || !Number.isFinite(Number(rentRaw))) return null;
    const rent = Number(rentRaw);
    const feeRaw = v(property, "management_fee_yen");
    const fee = feeRaw === null || !Number.isFinite(Number(feeRaw)) ? 0 : Number(feeRaw);
    const total = rent + fee;
    const budget = Number(settings?.monthlyBudgetYen) || 40000;
    const rationale = `家賃${rent.toLocaleString("ja-JP")}円＋管理費・共益費${fee.toLocaleString("ja-JP")}円＝月額${total.toLocaleString("ja-JP")}円（目安予算${budget.toLocaleString("ja-JP")}円）`;
    if (total <= budget) return { mark: "good", rationale };
    if (total <= Math.round(budget * 1.15)) return { mark: "fair", rationale };
    return { mark: "bad", rationale };
  },
  initial_costs(property) {
    const depositRaw = text(property, "deposit");
    const keyRaw = text(property, "key_money");
    const depositMonths = parseMonths(depositRaw);
    const keyMonths = parseMonths(keyRaw);
    if (depositMonths === null && keyMonths === null) return null;
    const sum = (depositMonths ?? 0) + (keyMonths ?? 0);
    const rationale = `敷金「${depositRaw ?? "不明"}」${depositMonths === null ? "（月数不明）" : `（${depositMonths}ヶ月）`}・礼金「${keyRaw ?? "不明"}」${keyMonths === null ? "（月数不明）" : `（${keyMonths}ヶ月）`}、合計${sum}ヶ月`;
    if (sum <= 1) return { mark: "good", rationale };
    if (sum <= 2) return { mark: "fair", rationale };
    return { mark: "bad", rationale };
  },
  renewal(property) {
    const value = text(property, "renewal_fee");
    if (!value) return null;
    if (value.includes("なし") || value.includes("無") || value.includes("0円")) {
      return { mark: "good", rationale: `更新料は「${value}」` };
    }
    if (value.includes("2ヶ月") || value.includes("2か月") || value.includes("2ヵ月")) {
      return { mark: "bad", rationale: `更新料は「${value}」` };
    }
    return { mark: "fair", rationale: `更新料は「${value}」（記載あり）` };
  },
  gas_utilities(property) {
    const value = text(property, "gas_type");
    if (!value || value.includes("不明")) return null;
    const rationale = `ガス種別は「${value}」`;
    if (value.includes("都市ガス")) return { mark: "good", rationale };
    if (value.includes("プロパン") || value.includes("オール電化")) return { mark: "fair", rationale };
    return null;
  },
  structure_seismic(property) {
    const s = text(property, "structure");
    if (!s) return null;
    const yearRaw = v(property, "built_year");
    const year = yearRaw === null ? null : Number(yearRaw);
    const yearText = year !== null && Number.isFinite(year) ? `${year}年` : "築年不明";
    const rationale = `構造「${s}」・${yearText}。新耐震基準の目安は1982年以降`;
    const strong = /SRC|鉄骨鉄筋|鉄筋コンクリート|RC/.test(s);
    if (strong && year !== null && year >= 1982) return { mark: "good", rationale: `${rationale}（堅牢な構造かつ新耐震以降）` };
    if (strong && (year === null || year < 1982)) return { mark: "fair", rationale: `${rationale}（堅牢な構造だが新耐震以前または築年不明）` };
    if (/鉄骨/.test(s)) return { mark: "fair", rationale };
    if (/木造/.test(s)) return { mark: "fair", rationale };
    return { mark: "fair", rationale };
  },
  management(property) {
    const value = text(property, "management_status");
    if (!value) return null;
    const rationale = `管理状態は「${value}」`;
    if (value.includes("問題あり")) return { mark: "bad", rationale };
    if (value.includes("要確認")) return { mark: "fair", rationale };
    if (value.includes("良好")) return { mark: "good", rationale };
    return { mark: "fair", rationale };
  },
  delivery_internet(property) {
    const value = text(property, "internet");
    const note = "宅配ボックス・オートロックは現地確認";
    if (!value) return null;
    if (value.includes("無料")) return { mark: "good", rationale: `インターネットは「${value}」。${note}` };
    if (value.includes("なし")) return { mark: "fair", rationale: `インターネットは「${value}」。${note}` };
    return { mark: "fair", rationale: `インターネットは「${value}」。${note}` };
  },
  early_termination(property) {
    const value = text(property, "early_termination_penalty");
    if (!value) return null;
    if (value.includes("なし") || value.includes("無")) {
      return { mark: "good", rationale: `短期解約違約金は「${value}」` };
    }
    return { mark: "fair", rationale: `短期解約違約金は「${value}」（条件明記・要確認）` };
  }
};

const ITEM_REFS = {
  walk_minutes: ["walk_minutes"],
  stop_type: ["stop_type"],
  hub_type: ["hub_type"],
  commute: ["station", "line"],
  supermarket: [],
  daily_facilities: [],
  medical_access: [],
  bike_parking: ["bike_parking"],
  mall_access: [],
  flat_terrain: [],
  local_life: [],
  sunlight: ["direction"],
  view: ["unit_floor", "direction"],
  noise_unit: [],
  damp: [],
  water_heater: ["other_equipment"],
  electric: [],
  interior_state: [],
  bath_toilet: ["bath_toilet"],
  laundry: ["laundry_placement"],
  elevator_item: ["elevator", "unit_floor"],
  budget_fit: ["rent_yen", "management_fee_yen"],
  initial_costs: ["deposit", "key_money"],
  renewal: ["renewal_fee"],
  gas_utilities: ["gas_type"],
  structure_seismic: ["structure", "built_year"],
  management: ["management_status"],
  delivery_internet: ["internet"],
  early_termination: ["early_termination_penalty"],
  moveout_terms: ["cleaning_fee_yen", "special_terms"],
  rules_check: ["special_terms", "bike_parking"]
};

export function evaluateProperty(property, settings = {}) {
  const safeSettings = settings || {};
  const items = DEFAULT_CRITERIA.map(def => {
    const override = safeSettings.criteriaWeights?.[def.key];
    const weight = Number.isFinite(Number(override)) && override !== null && override !== undefined ? Number(override) : def.weight;
    const base = { key: def.key, category: def.category, label: def.label, weight, kind: def.kind, refs: [...(ITEM_REFS[def.key] || [])] };
    const manual = property?.manualMarks?.[def.key];
    if (manual?.mark === "na") {
      return { ...base, state: "na", mark: null, rationale: manual.note ? `対象外（手動判定）：${manual.note}` : "対象外（手動判定）" };
    }
    if (def.kind === "manual") {
      if (manual && ["good", "fair", "bad"].includes(manual.mark)) {
        return { ...base, state: "scored", mark: manual.mark, rationale: manual.note ? `現地・手動判定：${manual.note}` : "現地・手動判定" };
      }
      return { ...base, state: "insufficient", mark: null, rationale: "未確認（現地・手動判定が必要）" };
    }
    const rule = AUTO_RULES[def.key];
    const result = rule ? rule(property, safeSettings) : null;
    if (!result) {
      return { ...base, state: "insufficient", mark: null, rationale: "情報不足のため判定できません" };
    }
    if (result.na) {
      return { ...base, state: "na", mark: null, rationale: result.rationale };
    }
    return { ...base, state: "scored", mark: result.mark, rationale: result.rationale };
  });

  const summary = computeScore(items);
  const categories = [...new Set(DEFAULT_CRITERIA.map(d => d.category))];
  const categoryScores = {};
  for (const category of categories) {
    const catItems = items.filter(i => i.category === category);
    const cat = computeScore(catItems);
    categoryScores[category] = { score: cat.totalScore, sufficiencyRate: cat.sufficiencyRate };
  }
  return {
    items,
    totalScore: summary.totalScore,
    scoredWeight: summary.scoredWeight,
    applicableWeight: summary.applicableWeight,
    totalWeight: summary.totalWeight,
    sufficiencyRate: summary.sufficiencyRate,
    confidence: summary.confidence,
    verdict: summary.verdict,
    categoryScores,
    strengths: items.filter(i => i.state === "scored" && i.mark === "good").map(i => i.label),
    insufficientItems: items.filter(i => i.state === "insufficient").map(i => i.label),
    naItems: items.filter(i => i.state === "na").map(i => i.label)
  };
}

export function evaluateArea(itemsMap = {}, settings = {}) {
  const safeSettings = settings || {};
  const map = itemsMap || {};
  const items = AREA_ITEM_DEFS.map(def => {
    const entry = map[def.key] || {};
    const override = entry.weight ?? safeSettings.areaWeights?.[def.key];
    const weight = Number.isFinite(Number(override)) && override !== null && override !== undefined ? Number(override) : 1;
    const base = { key: def.key, category: "地域評価", label: def.label, weight, kind: "manual", refs: [] };
    if (entry.mark === "na") {
      return { ...base, state: "na", mark: null, rationale: entry.note ? `対象外：${entry.note}` : "対象外" };
    }
    if (["good", "fair", "bad"].includes(entry.mark)) {
      return { ...base, state: "scored", mark: entry.mark, rationale: entry.note ? `手動判定：${entry.note}` : "手動判定" };
    }
    return { ...base, state: "insufficient", mark: null, rationale: "未確認（現地・手動判定が必要）" };
  });
  const summary = computeScore(items);
  return {
    items,
    totalScore: summary.totalScore,
    scoredWeight: summary.scoredWeight,
    applicableWeight: summary.applicableWeight,
    totalWeight: summary.totalWeight,
    sufficiencyRate: summary.sufficiencyRate,
    confidence: summary.confidence,
    verdict: summary.verdict,
    categoryScores: { "地域評価": { score: summary.totalScore, sufficiencyRate: summary.sufficiencyRate } },
    strengths: items.filter(i => i.state === "scored" && i.mark === "good").map(i => i.label),
    insufficientItems: items.filter(i => i.state === "insufficient").map(i => i.label),
    naItems: items.filter(i => i.state === "na").map(i => i.label)
  };
}

export function housingReferenceFor(areaName, rentYen, areaSqm) {
  const ref = HOUSING_REFERENCE[areaName];
  if (!ref) return null;
  let amount = ref.amount;
  let note = "単身世帯・家賃のみの調査時点参考値（管理費・共益費等は対象外）。制度上の参考情報であり、個別の認定額・支給額を判定するものではありません。";
  const sqm = areaSqm === null || areaSqm === undefined || areaSqm === "" ? null : Number(areaSqm);
  if (areaName === "大阪市" && sqm !== null && Number.isFinite(sqm) && sqm <= 15) {
    if (sqm > 10) amount = 36000;
    else if (sqm > 6) amount = 32000;
    else amount = 28000;
    note = `大阪市の面積別参考額を適用（専有面積${sqm}㎡・単身・調査時点）。${note}`;
  } else if (sqm !== null && Number.isFinite(sqm) && sqm <= 15) {
    note = `専有面積が15㎡以下のため、面積条件による減額の可能性がありますが、この地域の具体額は未確認のため参考額は補正していません。${note}`;
  }
  const rent = rentYen === null || rentYen === undefined || rentYen === "" ? null : Number(rentYen);
  const rentValue = rent !== null && Number.isFinite(rent) ? rent : null;
  return {
    city: areaName,
    amount,
    status: rentValue === null ? null : (rentValue <= amount ? "目安内" : "超過"),
    difference: rentValue === null ? null : rentValue - amount,
    confidence: ref.confidence,
    source: ref.source,
    note
  };
}

const FACT_QUESTIONS = [
  ["rent_yen", "家賃の金額と、家賃に含まれるものを確認したい"],
  ["management_fee_yen", "管理費・共益費の金額と内訳"],
  ["monthly_extra_costs", "毎月必須の追加費用（町内会費・駐輪場代など）の有無と金額"],
  ["deposit", "敷金の金額（月数・円）と償却の有無"],
  ["key_money", "礼金の金額"],
  ["security_deposit", "保証金・敷引きの金額と条件"],
  ["brokerage_fee", "仲介手数料の金額"],
  ["guarantor_fee_yen", "保証会社費用（初回・更新）の金額"],
  ["key_exchange_fee_yen", "鍵交換費用の金額"],
  ["cleaning_fee_yen", "クリーニング費用の金額と、退去時精算か前払いか"],
  ["fire_insurance_yen", "火災保険料の金額と契約期間"],
  ["renewal_fee", "更新料と更新事務手数料の有無・金額"],
  ["cancellation_notice", "解約予告期間"],
  ["early_termination_penalty", "短期解約違約金の条件（期間・金額）"],
  ["guarantor_condition", "保証会社の利用条件と費用"],
  ["special_terms", "特約事項の内容"],
  ["available_from", "入居可能時期と契約開始日の相談可否"]
];

export function buildAgencyQuestions(property, evaluation) {
  const confirmFacts = [];
  for (const [key, question] of FACT_QUESTIONS) {
    if (fieldValue(property, key) === null || fieldValue(property, key) === "") {
      confirmFacts.push(question);
    }
  }
  confirmFacts.push("設備（エアコン・給湯器など）が故障した際の修理負担はどちらか");
  confirmFacts.push("退去時のクリーニング費用は固定額か、原状回復の範囲");
  const insufficient = Array.isArray(evaluation?.insufficientItems) ? evaluation.insufficientItems.slice(0, 5) : [];
  for (const label of insufficient) {
    confirmFacts.push(`評価に必要な情報が不足している項目（${label}）について確認したい`);
  }
  const negotiable = [
    "契約開始日・入居時期の調整が可能か相談したい",
    "初期費用の内訳で、任意のオプション費用が含まれていないか確認し、不要なものは外せるか相談したい",
    "契約条件で相談の余地がある項目があれば教えてほしい"
  ];
  return { confirmFacts, negotiable };
}
