// GEM Ver.2.1 — deterministic condominium assessment core.
// Weights are an explicit first implementation proposal; Ver.2.1 itself does not specify numeric weights.
export const GEM_CRITERIA = [
  { key:"structure", label:"構造（RC/SRC）", weight:10, score:v => v==="SRC造"?10:v==="RC造"?9:v==="その他"?4:null, reason:v=>v==="SRC造"?"SRC造として記載":v==="RC造"?"RC造として記載":"構造を確認" },
  { key:"elevatorAccess", label:"昇降機・フロア段差", weight:5, score:v=>({ "EV完結・段差なし":5,"EVあり・一部段差":3,"EVなし":1,"問題あり":0 }[v]??null) },
  { key:"walkMinutes", label:"駅徒歩10分以内", weight:10, score:v=>has(v)&&Number.isFinite(Number(v))?(Number(v)<=5?10:Number(v)<=10?8:Number(v)<=15?5:2):null },
  { key:"infrastructure", label:"周辺インフラ（食料・医療）", weight:10, score:v=>({ "充実":10,"概ね充実":8,"どちらか不足":5,"不足":1 }[v]??null) },
  { key:"managementStatus", label:"管理体制・共用部", weight:15, score:v=>({ "良好":15,"概ね良好":12,"要確認":7,"問題あり":0 }[v]??null) },
  { key:"noiseStatus", label:"遮音・外部騒音", weight:8, score:v=>({ "良好":8,"許容範囲":6,"要確認":3,"問題あり":0 }[v]??null) },
  { key:"laundryPlacement", label:"洗濯機置場", weight:4, score:v=>({ "室内":4,"バルコニー":3,"なし・要工事":0 }[v]??null) },
  { key:"livingEnvironment", label:"採光・通風", weight:8, score:v=>({ "良好":8,"概ね良好":6,"要確認":3,"問題あり":0 }[v]??null) },
  { key:"pipeRenewal", label:"専有部配管の更新・更新可否", weight:10, score:v=>({ "更新済み":10,"更新可能":8,"一部確認":5,"未確認":null,"更新困難":0 }[v]??null) },
  { key:"marketLiquidity", label:"市場流動性（再販・賃貸）", weight:6, score:v=>({ "高い":6,"標準":4,"低い":1,"未確認":null }[v]??null) },
  { key:"repairCost", label:"修繕・清算コスト（目標30万円）", weight:5, score:v=>has(v)&&Number.isFinite(Number(v))?(Number(v)<=300000?5:Number(v)<=500000?3:0):null },
  { key:"maintenanceCostStatus", label:"管理費・修繕積立金の長期負担", weight:5, score:v=>({ "軽い":5,"標準":4,"重い":1,"要確認":null }[v]??null) },
  { key:"assetRetention", label:"長期居住・将来規格への適合", weight:4, score:v=>({ "適合":4,"概ね適合":3,"要確認":1,"不適合":0 }[v]??null) }
];

const has = v => v !== null && v !== undefined && v !== "";
export function assessCondominium(property={}) {
  const items = GEM_CRITERIA.map(c => {
    const value = property[c.key];
    const points = has(value) ? c.score(value) : null;
    return { key:c.key, label:c.label, weight:c.weight, value:has(value)?value:"未確認", points, status:points===null?"未確認":points===c.weight?"充足":points===0?"不適合":"一部充足" };
  });
  const availableWeight = items.reduce((n,x)=>n+(x.points===null?0:x.weight),0);
  const earned = items.reduce((n,x)=>n+(x.points===null?0:x.points),0);
  const coverage = Math.round(availableWeight);
  const score = availableWeight ? Math.round(earned/availableWeight*100) : null;
  const coreMissing = ["structure","managementStatus","repairCost"].some(k=>!has(property[k]));
  let verdict = "判定保留";
  if (coverage>=60 && !coreMissing) verdict = score>=80?"◎":score>=65?"◯":score>=45?"△":"☓";
  let strategy = "継続検討";
  if (verdict==="◎" || verdict==="◯") strategy="採用候補";
  if (verdict==="☓") strategy="却下候補";
  const missing = items.filter(x=>x.points===null).map(x=>x.label);
  const risks = [];
  if (Number(property.arrearsYen)>0) risks.push("管理費・修繕積立金等の滞納額が記載されています。金額と承継関係を確認してください。");
  if (Number(property.repairCost)>300000) risks.push("修繕・清算コストが目標30万円を超えています。");
  if (property.managementStatus==="問題あり") risks.push("管理体制・共用部に問題ありの評価です。");
  if (property.pipeRenewal==="更新困難") risks.push("専有部配管の更新が困難とされています。");
  const strengths = items.filter(x=>x.points!==null&&x.points>=x.weight*0.8).map(x=>x.label);
  return { score, coverage, verdict, strategy, items, missing, risks, strengths, coreMissing, provisional:coverage<80||coreMissing };
}

export function buildGemReport(property={}) {
  const a=assessCondominium(property);
  const yen=v=>has(v)?Number(v).toLocaleString("ja-JP")+"円":"未確認";
  return {
    overview:[
      ["名称",property.title],["所在地",property.address],["交通",property.station?property.station+(has(property.walkMinutes)?" 徒歩"+property.walkMinutes+"分":""):"未確認"],
      ["構造",property.structure],["専有面積",has(property.area) ? property.area+"㎡":"未確認"],["価格",yen(property.priceYen)],
      ["最低買受価格",yen(property.minimumBidYen)],["管理費",yen(property.condoManagementFeeYen)],["修繕積立金",yen(property.repairReserveYen)],
      ["滞納額",yen(property.arrearsYen)],["占有状況",property.occupancy||"未確認"]
    ],
    assessment:a
  };
}
