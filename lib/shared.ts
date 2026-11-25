export const stages=["prospecting","contacted","proposal_sent","negotiating","partner_confirmed","lost","withdrawn"];
export const labels:Record<string,string>={partner_confirmed:"Confirmed",proposal_sent:"Proposal sent",in_kind:"In-kind",prospecting:"Prospecting",contacted:"Contacted",negotiating:"Negotiating",lost:"Lost",withdrawn:"Withdrawn"};
export const title=(v:unknown)=>labels[String(v)]||String(v??"").replace(/[_-]/g," ").replace(/^./,m=>m.toUpperCase());
export const rupees=(v:number)=>"₹"+Math.round(v||0).toLocaleString("en-IN");
export const shortMoney=(v:number)=>Math.abs(v)>=100000?"₹"+(v/100000).toLocaleString("en-IN",{maximumFractionDigits:2})+"L":Math.abs(v)>=1000?"₹"+(v/1000).toLocaleString("en-IN",{maximumFractionDigits:1})+"K":rupees(v);
export const pct=(v:number)=>Math.round((v||0)*100)+"%";
export function niceDate(v:string,year=false){if(!v)return "—";return new Date(v.slice(0,10)+"T12:00:00+05:30").toLocaleDateString("en-GB",{day:"numeric",month:"short",...(year?{year:"numeric"}:{}),timeZone:"Asia/Kolkata"})}
export function dateAdd(v:string,days:number){return new Date(Date.parse(v.slice(0,10)+"T12:00:00Z")+days*86400000).toISOString().slice(0,10)}
export const initials=(v:string)=>(v||"Team").split(/\s+/).slice(0,2).map(s=>s[0]).join("").toUpperCase();
export const packagesSeed=[{id:"PK1",name:"Sampling booth",tier:"Starter",price:25000,quantity:12},{id:"PK2",name:"Social feature",tier:"Digital",price:40000,quantity:8},{id:"PK3",name:"Campus activation",tier:"Partner",price:55000,quantity:6},{id:"PK4",name:"Stage partnership",tier:"Premium",price:90000,quantity:3},{id:"PK5",name:"Title sponsorship",tier:"Exclusive",price:110000,quantity:1}];
export const actionsDate=(season:string)=>season==="2025"?"2025-03-20":"2026-11-25";
/** Triggers the rule builder can listen to. Each fires after a successful save. */
export const RULE_TRIGGERS:Record<string,string>={deal_confirmed:"Deal confirmed",stage_changed:"Deal changes stage",deal_lost:"Deal lost",positive_reply:"Positive reply logged",payment_recorded:"Payment recorded"};
