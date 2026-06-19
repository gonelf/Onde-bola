/*
 * lib/country-flags — map a national-team name to a flag emoji.
 *
 * The fixtures feed gives a team's name but no per-team country code, so for the
 * text digest (lib/digest-text) we resolve a flag from the name itself. National
 * teams *are* countries, so this works for international tournaments (World Cup,
 * Euro, Nations League, …); club sides don't resolve and simply render with no
 * flag, which the caller treats as graceful degradation.
 *
 * Names are matched accent- and case-insensitively, and both the English names
 * FotMob usually returns ("Czech Republic", "South Africa") and the Portuguese
 * ones shown in the app ("República Checa", "África do Sul") are registered, so
 * the lookup works whichever the feed carries.
 */

const norm = (s) => String(s == null ? "" : s)
  .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// ISO 3166-1 alpha-2 → 🇽🇾 via the regional-indicator block.
function flagFromIso(cc) {
  const c = String(cc || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

const FLAG = Object.create(null);
function add(emoji, names) {
  if (!emoji) return;
  names.forEach((n) => { const k = norm(n); if (k) FLAG[k] = emoji; });
}
// Register a country from its ISO2 code plus any English/Portuguese names/aliases.
function iso(cc, names) { add(flagFromIso(cc), names); }

// Europe
iso("PT", ["Portugal"]);
iso("ES", ["Spain", "Espanha"]);
iso("FR", ["France", "França"]);
iso("DE", ["Germany", "Alemanha"]);
iso("IT", ["Italy", "Itália"]);
iso("NL", ["Netherlands", "Holanda", "Países Baixos", "Holland"]);
iso("BE", ["Belgium", "Bélgica"]);
iso("CH", ["Switzerland", "Suíça"]);
iso("AT", ["Austria", "Áustria"]);
iso("PL", ["Poland", "Polónia", "Polonia"]);
iso("CZ", ["Czech Republic", "Czechia", "República Checa", "Chéquia"]);
iso("SK", ["Slovakia", "Eslováquia"]);
iso("HU", ["Hungary", "Hungria"]);
iso("HR", ["Croatia", "Croácia"]);
iso("RS", ["Serbia", "Sérvia"]);
iso("SI", ["Slovenia", "Eslovénia", "Eslovenia"]);
iso("BA", ["Bosnia & Herzegovina", "Bosnia and Herzegovina", "Bosnia", "Bósnia", "Bósnia e Herzegovina"]);
iso("ME", ["Montenegro"]);
iso("MK", ["North Macedonia", "Macedonia", "Macedónia do Norte", "Macedonia do Norte"]);
iso("AL", ["Albania", "Albânia"]);
iso("XK", ["Kosovo", "Kosovo"]);
iso("BG", ["Bulgaria", "Bulgária"]);
iso("RO", ["Romania", "Roménia", "Romenia"]);
iso("GR", ["Greece", "Grécia"]);
iso("TR", ["Turkey", "Türkiye", "Turquia"]);
iso("UA", ["Ukraine", "Ucrânia"]);
iso("RU", ["Russia", "Rússia"]);
iso("DK", ["Denmark", "Dinamarca"]);
iso("SE", ["Sweden", "Suécia"]);
iso("NO", ["Norway", "Noruega"]);
iso("FI", ["Finland", "Finlândia"]);
iso("IS", ["Iceland", "Islândia"]);
iso("IE", ["Ireland", "Republic of Ireland", "Irlanda"]);
iso("LU", ["Luxembourg", "Luxemburgo"]);
iso("LT", ["Lithuania", "Lituânia"]);
iso("LV", ["Latvia", "Letónia", "Letonia"]);
iso("EE", ["Estonia", "Estónia"]);
iso("MD", ["Moldova", "Moldávia"]);
iso("BY", ["Belarus", "Bielorrússia"]);
iso("GE", ["Georgia", "Geórgia"]);
iso("AM", ["Armenia", "Arménia"]);
iso("AZ", ["Azerbaijan", "Azerbaijão"]);
iso("CY", ["Cyprus", "Chipre"]);
iso("MT", ["Malta"]);
iso("AD", ["Andorra"]);
iso("FO", ["Faroe Islands", "Ilhas Faroé", "Ilhas Faroe"]);
// UK home nations use subdivision flag emojis (regional indicators don't cover them).
add("\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", ["England", "Inglaterra"]);
add("\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}", ["Scotland", "Escócia", "Escocia"]);
add("\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}", ["Wales", "País de Gales", "Pais de Gales"]);
iso("GB", ["Great Britain", "United Kingdom", "Reino Unido"]);

// South America
iso("BR", ["Brazil", "Brasil"]);
iso("AR", ["Argentina"]);
iso("UY", ["Uruguay", "Uruguai"]);
iso("CL", ["Chile"]);
iso("CO", ["Colombia", "Colômbia"]);
iso("PE", ["Peru"]);
iso("EC", ["Ecuador", "Equador"]);
iso("PY", ["Paraguay", "Paraguai"]);
iso("BO", ["Bolivia", "Bolívia"]);
iso("VE", ["Venezuela"]);

// North & Central America, Caribbean
iso("US", ["USA", "United States", "United States of America", "Estados Unidos", "EUA"]);
iso("CA", ["Canada", "Canadá"]);
iso("MX", ["Mexico", "México"]);
iso("CR", ["Costa Rica"]);
iso("PA", ["Panama", "Panamá"]);
iso("HN", ["Honduras"]);
iso("JM", ["Jamaica"]);
iso("SV", ["El Salvador"]);
iso("GT", ["Guatemala"]);
iso("HT", ["Haiti", "Haiti"]);
iso("TT", ["Trinidad & Tobago", "Trinidad and Tobago", "Trindade e Tobago"]);
iso("CU", ["Cuba"]);
iso("CW", ["Curaçao", "Curacao"]);

// Africa
iso("ZA", ["South Africa", "África do Sul", "Africa do Sul"]);
iso("MA", ["Morocco", "Marrocos"]);
iso("TN", ["Tunisia", "Tunísia"]);
iso("DZ", ["Algeria", "Argélia"]);
iso("EG", ["Egypt", "Egito", "Egipto"]);
iso("NG", ["Nigeria", "Nigéria"]);
iso("GH", ["Ghana", "Gana"]);
iso("SN", ["Senegal"]);
iso("CI", ["Ivory Coast", "Côte d'Ivoire", "Cote d Ivoire", "Costa do Marfim"]);
iso("CM", ["Cameroon", "Camarões", "Camaroes"]);
iso("ML", ["Mali"]);
iso("BF", ["Burkina Faso"]);
iso("CV", ["Cape Verde", "Cabo Verde"]);
iso("CD", ["DR Congo", "Congo DR", "Democratic Republic of Congo", "RD Congo"]);
iso("CG", ["Congo", "Congo"]);
iso("AO", ["Angola"]);
iso("MZ", ["Mozambique", "Moçambique", "Mocambique"]);
iso("GN", ["Guinea", "Guiné"]);
iso("GW", ["Guinea-Bissau", "Guinea Bissau", "Guiné-Bissau", "Guine Bissau"]);
iso("GA", ["Gabon", "Gabão"]);
iso("ZM", ["Zambia", "Zâmbia"]);
iso("ZW", ["Zimbabwe", "Zimbábue", "Zimbabue"]);
iso("KE", ["Kenya", "Quénia", "Quenia"]);
iso("UG", ["Uganda", "Uganda"]);
iso("TZ", ["Tanzania", "Tanzânia"]);
iso("ET", ["Ethiopia", "Etiópia"]);
iso("SD", ["Sudan", "Sudão"]);
iso("LY", ["Libya", "Líbia"]);
iso("TG", ["Togo"]);
iso("BJ", ["Benin", "Benim"]);
iso("MR", ["Mauritania", "Mauritânia"]);
iso("MW", ["Malawi", "Maláui"]);
iso("NA", ["Namibia", "Namíbia"]);
iso("GQ", ["Equatorial Guinea", "Guiné Equatorial"]);
iso("MG", ["Madagascar", "Madagáscar"]);

// Asia & Middle East
iso("JP", ["Japan", "Japão"]);
iso("KR", ["South Korea", "Korea Republic", "Coreia do Sul"]);
iso("KP", ["North Korea", "Korea DPR", "Coreia do Norte"]);
iso("CN", ["China", "China PR"]);
iso("AU", ["Australia", "Austrália"]);
iso("SA", ["Saudi Arabia", "Arábia Saudita"]);
iso("QA", ["Qatar", "Catar"]);
iso("IR", ["Iran", "Irã", "Irão"]);
iso("IQ", ["Iraq", "Iraque"]);
iso("AE", ["United Arab Emirates", "UAE", "Emirados Árabes Unidos"]);
iso("UZ", ["Uzbekistan", "Uzbequistão"]);
iso("JO", ["Jordan", "Jordânia"]);
iso("OM", ["Oman", "Omã"]);
iso("BH", ["Bahrain", "Barém", "Barein"]);
iso("KW", ["Kuwait", "Koweit", "Coveite"]);
iso("SY", ["Syria", "Síria"]);
iso("LB", ["Lebanon", "Líbano"]);
iso("PS", ["Palestine", "Palestina"]);
iso("IN", ["India", "Índia"]);
iso("ID", ["Indonesia", "Indonésia"]);
iso("TH", ["Thailand", "Tailândia"]);
iso("VN", ["Vietnam", "Vietname", "Vietnã"]);
iso("MY", ["Malaysia", "Malásia"]);
iso("IL", ["Israel"]);
iso("NZ", ["New Zealand", "Nova Zelândia"]);

/**
 * Flag emoji for a national-team name, or "" when it doesn't resolve to a known
 * country (e.g. a club side). Accent- and case-insensitive.
 */
export function flagForTeam(name) {
  return FLAG[norm(name)] || "";
}

/**
 * The full normalized-name → flag-emoji map. Serialized into the /image page so
 * the client text builder resolves flags without re-deriving the table.
 */
export function flagMap() {
  return Object.assign({}, FLAG);
}
