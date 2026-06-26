/*
 * clubAliases.js — canonical club identities for cross-source matching.
 *
 * The fuzzy name matcher in ingest.js can both miss (short vs long names, e.g.
 * "Wolves" vs "Wolverhampton Wanderers") and over-match (two distinct clubs that
 * share a token, e.g. "Sheffield United" vs "Sheffield Wednesday", or
 * "Sporting CP" vs "Sporting Clube de Braga"). This table resolves a name to a
 * canonical id; when BOTH names resolve, equality is authoritative — which fixes
 * the misses AND blocks the false merges. Names that match no entry fall back to
 * the fuzzy matcher.
 *
 * Patterns are tested as normalized substrings (see canonicalOf), so a short
 * distinctive fragment is enough. Add entries as you spot mismatches.
 */

// { canon, patterns:[normalized substrings] } — order matters only for overlap;
// keep the more specific pattern lists distinct so two clubs never share one.
export const CLUB_ALIASES = [
  // --- England: Premier League / Championship (ambiguous or short/long) ---
  { canon: "manutd", patterns: ["manchester united", "man united", "man utd"] },
  { canon: "mancity", patterns: ["manchester city", "man city"] },
  { canon: "wolves", patterns: ["wolverhampton", "wolves"] },
  { canon: "tottenham", patterns: ["tottenham", "spurs"] },
  { canon: "westham", patterns: ["west ham"] },
  { canon: "westbrom", patterns: ["west bromwich", "west brom", "albion west"] },
  { canon: "brighton", patterns: ["brighton"] },
  { canon: "nottmforest", patterns: ["nottingham forest", "nott m forest", "notts forest"] },
  { canon: "sheffutd", patterns: ["sheffield united", "sheffield utd"] },
  { canon: "sheffwed", patterns: ["sheffield wednesday"] },
  { canon: "bristolcity", patterns: ["bristol city"] },
  { canon: "bristolrovers", patterns: ["bristol rovers"] },
  { canon: "qpr", patterns: ["queens park rangers", "q p r"] },
  { canon: "newcastle", patterns: ["newcastle"] },
  { canon: "leeds", patterns: ["leeds"] },
  { canon: "leicester", patterns: ["leicester"] },

  // --- Portugal: Primeira Liga (token "sporting"/"vitoria" are ambiguous) ---
  { canon: "benfica", patterns: ["benfica"] },
  { canon: "porto", patterns: ["fc porto", "futebol clube do porto", "porto"] },
  { canon: "sportingcp", patterns: ["sporting cp", "sporting clube de portugal", "sporting lisbon", "sporting c p"] },
  { canon: "scbraga", patterns: ["braga"] },
  { canon: "vitoriasc", patterns: ["vitoria sc", "vitoria guimaraes", "guimaraes", "vitoria s c"] },
  { canon: "boavista", patterns: ["boavista"] },
  { canon: "rioave", patterns: ["rio ave"] },
  { canon: "famalicao", patterns: ["famalicao"] },
  { canon: "gilvicente", patterns: ["gil vicente"] },
  { canon: "moreirense", patterns: ["moreirense"] },
  { canon: "arouca", patterns: ["arouca"] },
  { canon: "estoril", patterns: ["estoril"] },
  { canon: "chaves", patterns: ["chaves", "desportivo de chaves"] },
  { canon: "casapia", patterns: ["casa pia"] },
  { canon: "farense", patterns: ["farense"] },
  { canon: "estrela", patterns: ["estrela amadora", "estrela da amadora"] },
  { canon: "portimonense", patterns: ["portimonense"] },
  { canon: "pacosferreira", patterns: ["pacos de ferreira", "pacos ferreira"] },
  { canon: "santaclara", patterns: ["santa clara"] },
  { canon: "nacional", patterns: ["nacional"] },
  { canon: "tondela", patterns: ["tondela"] },
  { canon: "avs", patterns: ["avs", "vizela"] },
];

// Normalize a name the same loose way ingest does, but WITHOUT stopword removal
// (patterns may contain words like "united"/"city" we must keep).
function norm(name) {
  return String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Resolve a club name to its canonical id, or null when no alias applies.
export function canonicalOf(name) {
  const n = norm(name);
  if (!n) return null;
  for (const entry of CLUB_ALIASES) {
    for (const p of entry.patterns) {
      if (!p) continue;
      if (n === p || n.includes(p) || p.includes(n)) return entry.canon;
    }
  }
  return null;
}
