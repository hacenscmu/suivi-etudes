/**
 * HAC refonte — relation client et cadence de facturation.
 *
 * La durée de la relation commerciale et la périodicité de facturation
 * sont deux notions distinctes. Une relation longue durée (type CDI) ne
 * signifie pas automatiquement une facturation mensuelle ou récurrente.
 * Rien n'est déduit du nombre d'études passées.
 */
const TYPES_RELATION = new Set(["ponctuelle", "longue_duree"]);
const CADENCES = new Set(["mensuelle", "trimestrielle", "semestrielle", "annuelle"]);

function resoudreRelation(client, etude = null) {
  const type = etude?.relationType ?? client?.relationType ?? "ponctuelle";
  const cadenceFacturation = etude?.cadenceFacturation ?? client?.cadenceFacturation ?? null;

  if (!TYPES_RELATION.has(type)) {
    return { type: "invalide", cadenceFacturation: null, anomalie: "Type de relation absent ou inconnu" };
  }
  if (cadenceFacturation !== null && !CADENCES.has(cadenceFacturation)) {
    return { type, cadenceFacturation: null, anomalie: "Cadence de facturation inconnue" };
  }
  return { type, cadenceFacturation, anomalie: null };
}

function calculerProchaineEcheance({ dateReference, cadence }) {
  if (!CADENCES.has(cadence)) return null;
  if (typeof dateReference !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateReference)) return null;

  const [year, month, day] = dateReference.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  const monthsToAdd = { mensuelle: 1, trimestrielle: 3, semestrielle: 6, annuelle: 12 }[cadence];
  const targetMonthIndex = month - 1 + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);

  return [
    String(targetYear).padStart(4, "0"),
    String(targetMonth + 1).padStart(2, "0"),
    String(targetDay).padStart(2, "0"),
  ].join("-");
}

function analyserAlerteClient(client, etude = null) {
  const relation = resoudreRelation(client, etude);
  if (relation.anomalie) {
    return { alerteActivable: false, prochaineEcheance: null, anomalie: relation.anomalie };
  }
  if (relation.type !== "longue_duree" || relation.cadenceFacturation === null) {
    return { alerteActivable: false, prochaineEcheance: null, anomalie: null };
  }

  const dateReference = etude?.dateProchaineFacture ?? client?.dateProchaineFacture;
  const prochaineEcheance = calculerProchaineEcheance({
    dateReference,
    cadence: relation.cadenceFacturation,
  });
  if (!prochaineEcheance) {
    return {
      alerteActivable: false,
      prochaineEcheance: null,
      anomalie: "Date de référence de facturation manquante ou invalide",
    };
  }
  return { alerteActivable: true, prochaineEcheance, anomalie: null };
}

module.exports = {
  TYPES_RELATION,
  CADENCES,
  resoudreRelation,
  calculerProchaineEcheance,
  analyserAlerteClient,
};
