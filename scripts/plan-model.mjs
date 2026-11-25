// Unmaad 2027 sponsorship model (Slide 1). Every rate is tagged: source (2025 dataset), simulated, or assumption.
// Run: node scripts/plan-model.mjs  → prints the base and stretch arithmetic used in the strategy doc.
const R = {
  avgCashDeal: 100000,          // source: ₹20,00,000 cash ÷ 20 cash deals (2025)
  cashShare: 20 / 24,           // source: 20 of 24 confirmed deals were cash
  warmAttemptWin: 24 / 48,      // source: warm channels, 48 attempts → 24 confirmed
  warmQualifiedWin: 24 / 36,    // source: 36 warm-qualified brands → 24 confirmed
  coldAttemptWin: 0 / 321,      // source: cold channels, 321 attempts → 0 confirmed
  collected2025: 1682500 / 2000000, // simulated: 2025 cash collected before the fest ÷ cash confirmed
};
const pools = { sponsors2025: 24, warmQualifiedNoDeal: 12, coldQualifiedNoDeal: 6, stalledCold: 26 }; // source
const cases = {
  base:    { renew: 0.45, upsell: 1.00, leakWarmHaircut: 0.5, leakCold: 0.10, newWarm: 30, coldTests: 100, coldWin: 0,    titleDeals: 0, titleValue: 1200000, collect: 0.90 },
  stretch: { renew: 0.65, upsell: 1.15, leakWarmHaircut: 0.75, leakCold: 0.25, newWarm: 40, coldTests: 100, coldWin: 0.01, titleDeals: 1, titleValue: 1200000, collect: 0.92 },
};
const L = n => "₹" + (n / 100000).toFixed(1) + "L";
for (const [name, c] of Object.entries(cases)) {
  const renewals = pools.sponsors2025 * c.renew;
  const leakWarm = pools.warmQualifiedNoDeal * R.warmQualifiedWin * c.leakWarmHaircut;
  const leakCold = (pools.stalledCold + pools.coldQualifiedNoDeal) * c.leakCold;
  const newWarm = c.newWarm * R.warmAttemptWin;
  const cold = c.coldTests * c.coldWin;
  const streams = {
    "1 Renew and upsell 2025 sponsors": { deals: renewals, cash: renewals * R.cashShare * R.avgCashDeal * c.upsell },
    "2 Warm-intro engine": { deals: newWarm, cash: newWarm * R.cashShare * R.avgCashDeal },
    "3 Leak recovery and stalled revival": { deals: leakWarm + leakCold, cash: (leakWarm + leakCold) * R.cashShare * R.avgCashDeal },
    "5 Anchor (title) sponsor": { deals: c.titleDeals, cash: c.titleDeals * c.titleValue },
    "Capped cold test": { deals: cold, cash: cold * R.cashShare * R.avgCashDeal },
  };
  const deals = Object.values(streams).reduce((n, s) => n + s.deals, 0), signed = Object.values(streams).reduce((n, s) => n + s.cash, 0);
  const at2025 = signed * R.collected2025, collected = signed * c.collect;
  console.log(`\n${name.toUpperCase()}`);
  for (const [k, s] of Object.entries(streams)) console.log("  " + k.padEnd(40), s.deals.toFixed(1).padStart(5), "deals", L(s.cash).padStart(7), "cash signed");
  console.log("  Total deals", deals.toFixed(1), "| cash signed", L(signed), "| collected at 2025 rate", L(at2025), "| 4 Collections push →", (c.collect * 100) + "%", "=", L(collected), "(+" + L(collected - at2025) + ")");
}
console.log("\n2025 baseline: 24 confirmed, ₹20.0L cash confirmed, ₹16.8L collected (simulated), target ₹25L (assumed)");
