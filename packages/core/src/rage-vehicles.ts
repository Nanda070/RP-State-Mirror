/**
 * Vehicle models of GTA V as RAGE Multiplayer spawns them, by class.
 * Source: https://wiki.rage.mp/wiki/Vehicles (copied 2026-10-03). The list is
 * data, not logic: when the game gets new vehicles, regenerate it from the same page.
 */
const MODELS_BY_CLASS: Record<string, readonly string[]> = {
  "Суперкары": [
    "adder", "autarch", "bullet", "champion", "cheetah", "cyclone", "emerus", "entity2", "entity3", "entityxf", "fmj",
    "furia", "gp1", "ignus", "infernus", "italigtb", "italigtb2", "krieger", "le7b", "lm87", "nero", "nero2",
    "osiris", "penetrator", "pfister811", "prototipo", "reaper", "s80", "sc1", "scramjet", "sheava", "sultanrs",
    "t20", "taipan", "tempesta", "tezeract", "thrax", "tigon", "torero2", "turismor", "tyrant", "tyrus", "vacca",
    "vagner", "vigilante", "virtue", "visione", "voltic", "voltic2", "xa21", "zeno", "zentorno", "zorrusso",
  ],
  "Служебные": [
    "airbus", "brickade", "bus", "coach", "pbus2", "rallytruck", "rentalbus", "taxi", "tourbus", "trash", "trash2",
    "wastelander",
  ],
  "Вспомогательные": [
    "airtug", "caddy", "caddy2", "caddy3", "docktug", "forklift", "mower", "ripley", "sadler", "sadler2", "scrap",
    "slamtruck", "towtruck", "towtruck2", "tractor", "tractor2", "tractor3", "utillitruck", "utillitruck2",
    "utillitruck3",
  ],
  "Вертолёты": [
    "akula", "annihilator", "annihilator2", "buzzard", "buzzard2", "cargobob", "cargobob2", "cargobob3", "cargobob4",
    "conada", "frogger", "frogger2", "havok", "hunter", "maverick", "savage", "seasparrow", "seasparrow2",
    "seasparrow3", "skylift", "supervolito", "supervolito2", "swift", "swift2", "valkyrie", "valkyrie2", "volatus",
  ],
  "Мотоциклы": [
    "akuma", "avarus", "bagger", "bati", "bati2", "bf400", "carbonrs", "chimera", "cliffhanger", "daemon", "daemon2",
    "deathbike", "deathbike2", "deathbike3", "defiler", "diablous", "diablous2", "double", "enduro", "esskey",
    "faggio", "faggio2", "faggio3", "fcr", "fcr2", "gargoyle", "hakuchou", "hakuchou2", "hexer", "innovation",
    "lectro", "manchez", "manchez2", "manchez3", "nemesis", "nightblade", "oppressor", "oppressor2", "pcj",
    "powersurge", "ratbike", "reever", "rrocket", "ruffian", "sanchez", "sanchez2", "sanctus", "shinobi", "shotaro",
    "sovereign", "stryder", "thrust", "vader", "vindicator", "vortex", "wolfsbane", "zombiea", "zombieb",
  ],
  "Внедорожники": [
    "aleutian", "astron", "baller", "baller2", "baller3", "baller4", "baller5", "baller6", "baller7", "bjxl",
    "cavalcade", "cavalcade2", "contender", "dubsta", "dubsta2", "fq2", "granger", "granger2", "gresley", "habanero",
    "huntley", "issi8", "iwagen", "jubilee", "landstalker", "landstalker2", "mesa", "mesa2", "novak", "patriot",
    "patriot2", "radi", "rebla", "rocoto", "seminole", "seminole2", "serrano", "squaddie", "toros", "xls", "xls2",
  ],
  "Самолёты": [
    "alkonost", "alphaz1", "avenger", "avenger2", "besra", "blimp", "blimp2", "blimp3", "bombushka", "cargoplane",
    "cargoplane2", "cuban800", "dodo", "duster", "howard", "hydra", "jet", "lazer", "luxor", "luxor2", "mammatus",
    "microlight", "miljet", "mogul", "molotok", "nimbus", "nokota", "pyro", "rogue", "seabreeze", "shamal",
    "starling", "strikeforce", "stunt", "titan", "tula", "velum", "velum2", "vestra", "volatol",
  ],
  "Спортивные": [
    "alpha", "banshee", "banshee2", "bestiagts", "blista2", "blista3", "buffalo", "buffalo2", "buffalo3", "buffalo4",
    "calico", "carbonizzare", "comet2", "comet3", "comet4", "comet5", "comet6", "comet7", "coquette", "coquette4",
    "corsita", "cypher", "deveste", "drafter", "elegy", "elegy2", "euros", "everon2", "feltzer2", "flashgt",
    "furoregt", "fusilade", "futo", "futo2", "gb200", "growler", "hotring", "imorgon", "issi7", "italigto",
    "italirsx", "jester", "jester2", "jester3", "jester4", "jugular", "khamelion", "komoda", "kuruma", "kuruma2",
    "locust", "lynx", "massacro", "massacro2", "neo", "neon", "ninef", "ninef2", "omnis", "omnisegt", "panthere",
    "paragon", "paragon2", "pariah", "penumbra", "penumbra2", "r300", "raiden", "rapidgt", "rapidgt2", "raptor",
    "remus", "revolter", "rt3000", "ruston", "schafter2", "schafter3", "schafter4", "schafter5", "schafter6",
    "schlagen", "schwarzer", "sentinel3", "sentinel4", "seven70", "sm722", "specter", "specter2", "streiter", "sugoi",
    "sultan", "sultan2", "sultan3", "surano", "tampa2", "tenf", "tenf2", "tropos", "vectre", "verlierer2", "veto",
    "veto2", "vstr", "zr350", "zr380", "zr3802", "zr3803",
  ],
  "Экстренные службы": [
    "ambulance", "fbi", "fbi2", "firetruk", "lguard", "pbus", "police", "police2", "police3", "police4", "policeb",
    "policeold1", "policeold2", "policet", "polmav", "pranger", "predator", "riot", "riot2", "sheriff", "sheriff2",
  ],
  "Военные": [
    "apc", "barracks", "barracks2", "barracks3", "barrage", "chernobog", "crusader", "halftrack", "khanjali",
    "minitank", "rhino", "scarab", "scarab2", "scarab3", "thruster", "trailersmall2", "vetir",
  ],
  "Спортивная классика": [
    "ardent", "btype", "btype2", "btype3", "casco", "cheburek", "cheetah2", "coquette2", "deluxo", "dynasty",
    "fagaloa", "feltzer3", "gt500", "infernus2", "jb700", "jb7002", "mamba", "manana", "manana2", "michelli",
    "monroe", "nebula", "peyote", "peyote3", "pigalle", "rapidgt3", "retinue", "retinue2", "savestra", "stinger",
    "stingergt", "stromberg", "swinger", "toreador", "torero", "tornado", "tornado2", "tornado3", "tornado4",
    "tornado5", "tornado6", "turismo2", "viseris", "z190", "zion3", "ztype",
  ],
  "Прицепы": [
    "armytanker", "armytrailer", "armytrailer2", "baletrailer", "boattrailer", "docktrailer", "freighttrailer",
    "graintrailer", "proptrailer", "raketrailer", "tanker", "tanker2", "tr2", "tr3", "tr4", "trailerlarge",
    "trailerlogs", "trailers", "trailers2", "trailers3", "trailers4", "trailersmall", "trflat", "tvtrailer",
  ],
  "Компактные": [
    "asbo", "blista", "brioso", "brioso2", "brioso3", "club", "dilettante", "dilettante2", "issi2", "issi3", "issi4",
    "issi5", "issi6", "kanjo", "panto", "prairie", "rhapsody", "weevil",
  ],
  "Седаны": [
    "asea", "asea2", "asterope", "asterope2", "cinquemila", "cog55", "cog552", "cognoscenti", "cognoscenti2", "deity",
    "emperor", "emperor2", "emperor3", "fugitive", "glendale", "glendale2", "ingot", "intruder", "limo2", "premier",
    "primo", "primo2", "regina", "rhinehart", "romero", "stafford", "stanier", "stratum", "stretch", "superd",
    "surge", "tailgater", "tailgater2", "warrener", "washington",
  ],
  "Лодки": [
    "avisa", "dinghy", "dinghy2", "dinghy3", "dinghy4", "dinghy5", "jetmax", "kosatka", "longfin", "marquis",
    "patrolboat", "seashark", "seashark2", "seashark3", "speeder", "speeder2", "squalo", "submersible",
    "submersible2", "suntrap", "toro", "toro2", "tropic", "tropic2", "tug",
  ],
  "Грузовые": [
    "benson", "benson2", "biff", "cerberus", "cerberus2", "cerberus3", "hauler", "hauler2", "mule", "mule2", "mule3",
    "mule4", "mule5", "packer", "phantom", "phantom2", "phantom3", "phantom4", "pounder", "pounder2", "stockade",
    "stockade3", "terbyte",
  ],
  "Внедорожные": [
    "bfinjection", "bifta", "blazer", "blazer2", "blazer3", "blazer4", "blazer5", "bodhi2", "brawler", "bruiser",
    "bruiser2", "bruiser3", "brutus", "brutus2", "brutus3", "caracara", "caracara2", "dloader", "draugur", "dubsta3",
    "dune", "dune2", "dune3", "dune4", "dune5", "everon", "freecrawler", "hellion", "insurgent", "insurgent2",
    "insurgent3", "kalahari", "kamacho", "marshall", "menacer", "mesa3", "monster", "monster3", "monster4",
    "monster5", "nightshark", "outlaw", "patriot3", "rancherxl", "rancherxl2", "rcbandito", "rebel", "rebel2",
    "riata", "sandking", "sandking2", "technical", "technical2", "technical3", "trophytruck", "trophytruck2",
    "vagrant", "verus", "winky", "zhaba",
  ],
  "Фургоны": [
    "bison", "bison2", "bison3", "bobcatxl", "boxville", "boxville2", "boxville3", "boxville4", "boxville5",
    "burrito", "burrito2", "burrito3", "burrito4", "burrito5", "camper", "gburrito", "gburrito2", "journey",
    "journey2", "minivan", "minivan2", "paradise", "pony", "pony2", "rumpo", "rumpo2", "rumpo3", "speedo", "speedo2",
    "speedo4", "surfer", "surfer2", "surfer3", "taco", "youga", "youga2", "youga3", "youga4",
  ],
  "Маслкары": [
    "blade", "broadway", "buccaneer", "buccaneer2", "chino", "chino2", "clique", "coquette3", "deviant", "dominator",
    "dominator2", "dominator3", "dominator4", "dominator5", "dominator6", "dominator7", "dukes", "dukes2", "dukes3",
    "ellie", "eudora", "faction", "faction2", "faction3", "gauntlet", "gauntlet2", "gauntlet3", "gauntlet4",
    "gauntlet5", "greenwood", "hermes", "hotknife", "hustler", "impaler", "impaler2", "impaler3", "impaler4",
    "imperator", "imperator2", "imperator3", "lurcher", "moonbeam", "moonbeam2", "nightshade", "peyote2", "phoenix",
    "picador", "ratloader", "ratloader2", "ruiner", "ruiner2", "ruiner3", "ruiner4", "sabregt", "sabregt2", "slamvan",
    "slamvan2", "slamvan3", "slamvan4", "slamvan5", "slamvan6", "stalion", "stalion2", "tahoma", "tampa", "tampa3",
    "tulip", "tulip2", "vamos", "vigero", "vigero2", "virgo", "virgo2", "virgo3", "voodoo", "voodoo2", "weevil2",
    "yosemite", "yosemite2", "yosemite3",
  ],
  "Велосипеды": [
    "bmx", "cruiser", "fixter", "scorcher", "tribike", "tribike2", "tribike3",
  ],
  "Промышленные": [
    "bulldozer", "cutter", "dump", "flatbed", "guardian", "handler", "mixer", "mixer2", "rubble", "tiptruck",
    "tiptruck2",
  ],
  "Поезда": [
    "cablecar", "freight", "freight2", "freightcar", "freightcar3", "freightcont1", "freightcont2", "freightgrain",
    "metrotrain", "tankercar",
  ],
  "Купе": [
    "cogcabrio", "exemplar", "f620", "felon", "felon2", "jackal", "kanjosj", "oracle", "oracle2", "postlude",
    "previon", "sentinel", "sentinel2", "windsor", "windsor2", "zion", "zion2",
  ],
  "Болиды": [
    "formula", "formula2", "openwheel1", "openwheel2",
  ],
};

export type RageVehicle = { model: string; category: string };

export const RAGE_VEHICLES: readonly RageVehicle[] = Object.entries(MODELS_BY_CLASS)
  .flatMap(([category, models]) => models.map((model) => ({ model, category })))
  .sort((a, b) => a.model.localeCompare(b.model));

const BY_MODEL = new Map(RAGE_VEHICLES.map((vehicle) => [vehicle.model, vehicle]));

/** The vehicle with exactly this spawn name (case does not matter), or null. */
export function findRageVehicle(model: string): RageVehicle | null {
  return BY_MODEL.get(model.trim().toLowerCase()) ?? null;
}

/**
 * Up to `limit` vehicles for what the person typed: names that start with it first, then names
 * that contain it. Empty input gives the start of the list.
 */
export function searchRageVehicles(query: string, limit = 25): RageVehicle[] {
  const q = query.trim().toLowerCase();
  if (!q) return RAGE_VEHICLES.slice(0, limit);
  const starts = RAGE_VEHICLES.filter((vehicle) => vehicle.model.startsWith(q));
  const contains = RAGE_VEHICLES.filter((vehicle) => !vehicle.model.startsWith(q) && vehicle.model.includes(q));
  return [...starts, ...contains].slice(0, limit);
}
