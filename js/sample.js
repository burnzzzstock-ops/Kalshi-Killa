// Example book for the ?demo preview. Invented bets; never shown to a signed-in user.
const H = 3600e3;
const D = 24 * H;

export function samplePositions(now = Date.now()) {
  const at = (msAgo) => new Date(now - msAgo).toISOString();
  let n = 0;
  const id = () => "sample" + ++n;
  const buy = (ago, contracts, price, fees = 0) => ({ id: id(), kind: "buy", at: at(ago), contracts, price, amount: Math.round(contracts * price + fees), fees, source: "shot" });
  const sell = (ago, contracts, price, fees = 0) => ({ id: id(), kind: "sell", at: at(ago), contracts, price, amount: Math.round(contracts * price - fees), fees, source: "shot" });
  const pos = (market, outcome, side, category, fills, settlement = null) => ({
    id: id(),
    market,
    outcome,
    side,
    category,
    fills,
    settlement,
    createdAt: fills[0].at,
    updatedAt: fills[fills.length - 1].at,
  });
  const won = (ago) => ({ result: "win", at: at(ago), payout: null, source: "tap" });
  const lost = (ago) => ({ result: "loss", at: at(ago), payout: null, source: "tap" });

  return [
    pos("Saints vs Falcons", "Saints", "yes", "Sports", [buy(38 * D, 40, 48, 70)], won(37 * D)),
    pos("Fed rate cut in September?", "", "no", "Economics", [buy(34 * D, 25, 31, 38)], lost(30 * D)),
    pos("Astros vs Mariners", "Over 8.5 runs", "yes", "Sports", [buy(27 * D, 30, 55, 52), sell(26.8 * D, 30, 71, 43)]),
    pos("Bitcoin above $120k on Friday?", "", "yes", "Crypto", [buy(24 * D, 50, 22, 60)], lost(21 * D)),
    pos("LSU vs Alabama", "LSU", "yes", "Sports", [buy(19 * D, 20, 41, 34)], won(18.6 * D)),
    pos("Highest temp in Miami today", "90° or above", "no", "Weather", [buy(16 * D, 30, 62, 50)], won(15.7 * D)),
    pos("Cowboys vs Eagles", "Eagles", "yes", "Sports", [buy(12 * D, 25, 64, 40), buy(11.5 * D, 15, 58, 26)], lost(11 * D)),
    pos("Top song on Billboard Hot 100", "Current No. 1 holds", "yes", "Culture", [buy(9 * D, 40, 35, 63), sell(7 * D, 20, 52, 35)], won(6 * D)),
    pos("Ole Miss vs Georgia", "Georgia -6.5", "no", "Sports", [buy(4 * D, 30, 47, 52)], won(3.6 * D)),
    pos("Packers vs Bears", "Packers", "yes", "Sports", [buy(2 * D, 35, 58, 60), sell(1.8 * D, 35, 44, 50)]),
    pos("Saints vs Buccaneers", "Saints", "yes", "Sports", [buy(20 * H, 30, 46, 52)]),
    pos("CPI above 3.0% in October?", "", "no", "Economics", [buy(3 * D, 40, 66, 60)]),
    pos("Rams vs 49ers", "Total over 44.5", "yes", "Sports", [buy(5 * H, 20, 52, 35)]),
  ];
}
