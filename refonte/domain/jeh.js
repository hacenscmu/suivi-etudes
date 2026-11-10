/**
 * HAC refonte — règles métier isolées pour les JEH réellement travaillées.
 *
 * Une intervention compte comme réalisée si son statut est "Payé" ou
 * "Pas payé". Les interventions à venir et non effectuées sont exclues.
 * Une donnée absente ou incohérente est signalée, jamais transformée
 * silencieusement en travail réalisé ou impayé.
 *
 * Entrée attendue : lignes d'intervention avec { statut, jeh }.
 */

const STATUTS_TRAVAILLE = new Set(["Payé", "Pas payé"]);
const STATUTS_NON_TRAVAILLE = new Set(["A venir", "Non effectué"]);

function calculerJehTravaillees(interventions = []) {
  let total = 0;
  const anomalies = [];

  for (const [index, ligne] of interventions.entries()) {
    if (!ligne || typeof ligne !== "object") {
      anomalies.push({ index, raison: "Ligne d'intervention invalide" });
      continue;
    }

    const statut = ligne.statut;
    if (STATUTS_NON_TRAVAILLE.has(statut)) continue;

    if (!STATUTS_TRAVAILLE.has(statut)) {
      anomalies.push({ index, raison: "Statut absent ou inconnu", statut: statut ?? null });
      continue;
    }

    const jeh = Number(ligne.jeh);
    if (ligne.jeh === "" || ligne.jeh == null || !Number.isFinite(jeh) || jeh < 0) {
      anomalies.push({ index, raison: "Nombre de JEH absent ou invalide" });
      continue;
    }

    total += jeh;
  }

  return { total, anomalies };
}

module.exports = {
  calculerJehTravaillees,
  STATUTS_TRAVAILLE,
  STATUTS_NON_TRAVAILLE,
};
