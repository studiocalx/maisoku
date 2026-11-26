// マイソクAI 2.0（賃貸版）: 項目定義・評価基準・参考データ（純粋データ）

export const FIELD_DEFS = [
  // 基本情報
  { key: "title", label: "物件名・タイトル", group: "基本情報", type: "text" },
  { key: "address", label: "所在地", group: "基本情報", type: "text" },
  { key: "structure", label: "建物構造", group: "基本情報", type: "text" },
  { key: "built_year", label: "築年（西暦）", group: "基本情報", type: "number" },
  { key: "built_month", label: "築月", group: "基本情報", type: "number" },
  { key: "total_floors", label: "総階数", group: "基本情報", type: "number" },
  { key: "unit_floor", label: "所在階", group: "基本情報", type: "number" },
  { key: "layout", label: "間取り", group: "基本情報", type: "text" },
  { key: "area_sqm", label: "専有面積（㎡）", group: "基本情報", type: "number" },
  { key: "direction", label: "向き・採光方向", group: "基本情報", type: "text" },
  { key: "available_from", label: "入居可能時期", group: "基本情報", type: "text" },
  // 賃料・初期費用
  { key: "rent_yen", label: "家賃（円）", group: "賃料・初期費用", type: "yen" },
  { key: "management_fee_yen", label: "管理費・共益費（円）", group: "賃料・初期費用", type: "yen" },
  { key: "parking_fee_yen", label: "駐車場代（円）", group: "賃料・初期費用", type: "yen" },
  { key: "deposit", label: "敷金", group: "賃料・初期費用", type: "text" },
  { key: "key_money", label: "礼金", group: "賃料・初期費用", type: "text" },
  { key: "security_deposit", label: "保証金・敷引き", group: "賃料・初期費用", type: "text" },
  { key: "brokerage_fee", label: "仲介手数料", group: "賃料・初期費用", type: "text" },
  { key: "guarantor_fee_yen", label: "保証会社費用（円）", group: "賃料・初期費用", type: "yen" },
  { key: "key_exchange_fee_yen", label: "鍵交換費用（円）", group: "賃料・初期費用", type: "yen" },
  { key: "cleaning_fee_yen", label: "クリーニング費用（円）", group: "賃料・初期費用", type: "yen" },
  { key: "fire_insurance_yen", label: "火災保険料（円）", group: "賃料・初期費用", type: "yen" },
  { key: "other_initial_costs", label: "その他の初期費用", group: "賃料・初期費用", type: "text" },
  { key: "monthly_extra_costs", label: "毎月の追加費用", group: "賃料・初期費用", type: "text" },
  // 交通
  { key: "station", label: "最寄駅", group: "交通", type: "text" },
  { key: "line", label: "路線", group: "交通", type: "text" },
  { key: "walk_minutes", label: "駅徒歩（分）", group: "交通", type: "number" },
  { key: "bus_available", label: "バス便の有無", group: "交通", type: "text" },
  { key: "stop_type", label: "停車種別", group: "交通", type: "select", options: ["", "普通", "準急・区間急行", "快速", "急行・特急・新快速"] },
  { key: "hub_type", label: "路線ハブ状況", group: "交通", type: "select", options: ["", "単一路線", "近隣別路線あり", "複数路線ハブ"] },
  // 契約条件
  { key: "contract_period", label: "契約期間", group: "契約条件", type: "text" },
  { key: "renewal_fee", label: "更新料", group: "契約条件", type: "text" },
  { key: "cancellation_notice", label: "解約予告期間", group: "契約条件", type: "text" },
  { key: "early_termination_penalty", label: "短期解約違約金", group: "契約条件", type: "text" },
  { key: "guarantor_condition", label: "保証会社の条件", group: "契約条件", type: "text" },
  { key: "special_terms", label: "特約事項", group: "契約条件", type: "text" },
  // 設備・住戸条件
  { key: "elevator", label: "エレベーター", group: "設備・住戸条件", type: "text" },
  { key: "bath_toilet", label: "風呂・トイレ", group: "設備・住戸条件", type: "text" },
  { key: "washstand", label: "洗面台", group: "設備・住戸条件", type: "text" },
  { key: "laundry_placement", label: "洗濯機置場", group: "設備・住戸条件", type: "text" },
  { key: "air_conditioner", label: "エアコン", group: "設備・住戸条件", type: "text" },
  { key: "kitchen", label: "キッチン", group: "設備・住戸条件", type: "text" },
  { key: "storage", label: "収納", group: "設備・住戸条件", type: "text" },
  { key: "balcony", label: "バルコニー", group: "設備・住戸条件", type: "text" },
  { key: "internet", label: "インターネット", group: "設備・住戸条件", type: "text" },
  { key: "other_equipment", label: "その他の設備", group: "設備・住戸条件", type: "text" },
  // 現地確認・管理
  { key: "bike_parking", label: "駐輪場", group: "現地確認・管理", type: "select", options: ["", "あり（無料）", "あり（有料）", "なし"] },
  { key: "gas_type", label: "ガス種別", group: "現地確認・管理", type: "select", options: ["", "都市ガス", "プロパン", "オール電化", "不明"] },
  { key: "management_status", label: "管理状態", group: "現地確認・管理", type: "select", options: ["", "良好", "概ね良好", "要確認", "問題あり"] }
];

export const DEFAULT_CRITERIA = [
  // アクセス
  { key: "walk_minutes", category: "アクセス", label: "駅までの徒歩時間", weight: 3, kind: "auto" },
  { key: "stop_type", category: "アクセス", label: "停車種別（急行停車など）", weight: 2, kind: "auto" },
  { key: "hub_type", category: "アクセス", label: "複数路線・ハブ性", weight: 3, kind: "auto" },
  { key: "commute", category: "アクセス", label: "主要ターミナルへの所要時間・乗換", weight: 2, kind: "manual" },
  // 生活導線
  { key: "supermarket", category: "生活導線", label: "スーパーまでの距離", weight: 3, kind: "manual" },
  { key: "daily_facilities", category: "生活導線", label: "ドラッグストア・大きめの郵便局", weight: 2, kind: "manual" },
  { key: "medical_access", category: "生活導線", label: "病院・クリニックへのアクセス", weight: 2, kind: "manual" },
  { key: "bike_parking", category: "生活導線", label: "駐輪場", weight: 3, kind: "auto" },
  { key: "mall_access", category: "生活導線", label: "大型商業施設へのアクセス", weight: 2, kind: "manual" },
  { key: "flat_terrain", category: "生活導線", label: "坂の有無・平坦さ", weight: 3, kind: "manual" },
  { key: "local_life", category: "生活導線", label: "銭湯・健康ランド・チョコザップ・図書館・商店街", weight: 2, kind: "manual" },
  // 住戸
  { key: "sunlight", category: "住戸", label: "日当たり", weight: 2, kind: "manual" },
  { key: "view", category: "住戸", label: "眺望", weight: 1, kind: "manual" },
  { key: "noise_unit", category: "住戸", label: "騒音（幹線道路・線路・近隣）", weight: 2, kind: "manual" },
  { key: "damp", category: "住戸", label: "湿気・カビ対策", weight: 2, kind: "manual" },
  { key: "water_heater", category: "住戸", label: "給湯器の方式・状態", weight: 2, kind: "manual" },
  { key: "electric", category: "住戸", label: "電気容量", weight: 2, kind: "manual" },
  { key: "interior_state", category: "住戸", label: "室内の清潔感・リフォーム状態", weight: 2, kind: "manual" },
  { key: "bath_toilet", category: "住戸", label: "風呂・トイレ別", weight: 2, kind: "auto" },
  { key: "laundry", category: "住戸", label: "洗濯機置場", weight: 2, kind: "auto" },
  { key: "elevator_item", category: "住戸", label: "エレベーター", weight: 1, kind: "auto" },
  // 費用
  { key: "budget_fit", category: "費用", label: "月額予算への適合", weight: 3, kind: "auto" },
  { key: "initial_costs", category: "費用", label: "初期費用（敷金・礼金）", weight: 2, kind: "auto" },
  { key: "renewal", category: "費用", label: "更新料", weight: 2, kind: "auto" },
  { key: "gas_utilities", category: "費用", label: "ガス・光熱費条件", weight: 2, kind: "auto" },
  // 建物・管理
  { key: "structure_seismic", category: "建物・管理", label: "構造・耐震（築年）", weight: 3, kind: "auto" },
  { key: "management", category: "建物・管理", label: "管理状態", weight: 2, kind: "auto" },
  { key: "delivery_internet", category: "建物・管理", label: "インターネット・宅配環境", weight: 2, kind: "auto" },
  // 要確認事項
  { key: "early_termination", category: "要確認事項", label: "短期解約違約金", weight: 2, kind: "auto" },
  { key: "moveout_terms", category: "要確認事項", label: "退去時クリーニング代・原状回復特約の明確さ", weight: 2, kind: "manual" },
  { key: "rules_check", category: "要確認事項", label: "自転車・生活ルール・管理規約上の制限", weight: 2, kind: "manual" }
];

export const AREA_ITEM_DEFS = [
  { key: "area01", label: "駅前の賑わい" },
  { key: "area02", label: "大型商業施設の有無" },
  { key: "area03", label: "医療機関へのアクセス" },
  { key: "area04", label: "生活完結性" },
  { key: "area05", label: "生活保護対策" },
  { key: "area06", label: "図書館" },
  { key: "area07", label: "複数の沿線" },
  { key: "area08", label: "ニュータウン感・コンパクトシティ感" },
  { key: "area09", label: "幹線道路・高速道路からの距離感" },
  { key: "area10", label: "チョコザップ" },
  { key: "area11", label: "健康ランド・銭湯" },
  { key: "area12", label: "商店街" },
  { key: "area13", label: "治安" },
  { key: "area14", label: "気候・災害（暑さ・寒さ・地震・津波・台風・雷）" },
  { key: "area15", label: "害虫" },
  { key: "area16", label: "自転車での利便性" },
  { key: "area17", label: "平地" },
  { key: "area18", label: "大きめの郵便局" },
  { key: "area19", label: "独特なコミュニティ" },
  { key: "area20", label: "自治体の受け入れ態勢" }
];

export const VIEWING_CHECKLIST = [
  { key: "v1", label: "室内の状態・傷・汚れ" },
  { key: "v2", label: "日当たり・風通し" },
  { key: "v3", label: "水回り・設備" },
  { key: "v4", label: "洗濯機置場・収納" },
  { key: "v5", label: "騒音・防音性" },
  { key: "v6", label: "湿気・臭い・カビ" },
  { key: "v7", label: "建物共用部・管理状態" }
];

export const CONTRACT_CHECKLIST = [
  { key: "c1", label: "初期費用の内訳" },
  { key: "c2", label: "毎月の必須費用" },
  { key: "c3", label: "更新料" },
  { key: "c4", label: "解約予告期間" },
  { key: "c5", label: "短期解約違約金" },
  { key: "c6", label: "保証会社の条件" },
  { key: "c7", label: "退去時の費用負担" },
  { key: "c8", label: "特約事項" },
  { key: "c9", label: "その他の不明点" }
];

export const DEFAULT_BASIC_CONDITIONS = [
  "家賃・共益費込み月4万円以下が目安",
  "商業施設・商店街が利用しやすい",
  "医療機関へのアクセスが良い",
  "複数路線など交通の利便性",
  "自転車で移動しやすく平坦",
  "郵便局・図書館・銭湯など生活施設が近い"
];

// 住居費の参考目安（制度上の参考情報。評価スコアには使わない）
// 出典: v2/app.js の HOUSING_REFERENCE（調査基準日: 2026年11月25日）
export const HOUSING_REFERENCE = {
  "大阪市": { amount: 40000, confidence: "公式直接確認", areaRule: true, source: "https://www.city.osaka.lg.jp/fukushi/page/0000086902.html" },
  "枚方市": { amount: 38000, confidence: "公式制度資料との対応確認", areaRule: "可能性あり・金額未確認", source: "https://www.city.hirakata.osaka.jp/0000029011.html" },
  "門真市": { amount: 39000, confidence: "間接確認・要再確認", areaRule: "可能性あり・金額未確認", source: "https://www.city.kadoma.osaka.jp/kenko_fukushi/chiiki_fukushi/23396.html" },
  "八尾市": { amount: 39000, confidence: "公式制度資料との対応確認", areaRule: "可能性あり・金額未確認", source: "https://www.city.yao.osaka.jp/kurashi_tetsuzuki/soudan/1003616/1019981.html" },
  "東大阪市": { amount: 38000, confidence: "公式制度資料との対応確認", areaRule: "可能性あり・金額未確認", source: "https://www.city.higashiosaka.lg.jp/0000002896.html" },
  "尼崎市": { amount: 42500, confidence: "公式制度資料との対応確認", areaRule: "可能性あり・金額未確認", source: "https://www.city.amagasaki.hyogo.jp/kurashi/seikatusien/1001977/132juutakushien.html" }
};

// 大阪市: 専有面積15㎡以下の場合の面積区分による参考額（単身）
export const OSAKA_AREA_TIERS = {
  city: "大阪市",
  baseAmount: 40000,
  tiers: [
    { minSqmExclusive: 10, maxSqm: 15, amount: 36000 },
    { minSqmExclusive: 6, maxSqm: 10, amount: 32000 },
    { minSqmExclusive: null, maxSqm: 6, amount: 28000 }
  ],
  note: "大阪市では専有面積15㎡以下の場合、面積区分による減額がある（単身・調査時点）。他市では15㎡以下で減額の可能性があるが金額は未確認。"
};

export const DEFAULT_SETTINGS = {
  id: "app",
  criteriaWeights: {},
  areaWeights: {},
  monthlyBudgetYen: 40000,
  basicConditions: [...DEFAULT_BASIC_CONDITIONS],
  criteriaVersion: 1,
  lastBackupAt: null
};
