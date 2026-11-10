/**
 * HAC refonte — interventions individuelles.
 *
 * Le nouveau modèle enregistre explicitement les minutes attribuées à
 * chaque membre. Il ne devine pas si les anciennes minutes étaient
 * individuelles ou collectives : cette conversion exige un arbitrage
 * dans l'adaptateur historique.
 */
const STATUTS_INTERVENTION = Object.freeze(["Pas payé", "Payé", "A venir", "Non effectué"]);
const STATUTS_TRAVAILLE = new Set(["Pas payé", "Payé"]);

function dateValide(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function analyserIntervention(intervention) {
  const anomalies = [];
  if (!intervention || typeof intervention !== "object" || Array.isArray(intervention)) {
    return { valide: false, anomalies: ["Intervention invalide"] };
  }
  for (const champ of ["id", "etudeId", "membreId"]) {
    if (typeof intervention[champ] !== "string" || !intervention[champ].trim()) {
      anomalies.push("Identifiant " + champ + " absent ou invalide");
    }
  }
  if (!dateValide(intervention.date)) anomalies.push("Date d'intervention absente ou invalide");
  if (!STATUTS_INTERVENTION.includes(intervention.statut)) anomalies.push("Statut d'intervention absent ou inconnu");

  const minutes = intervention.minutesIndividuelles === "" || intervention.minutesIndividuelles == null
    ? null : Number(intervention.minutesIndividuelles);
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
    anomalies.push("Durée individuelle absente ou invalide");
  }

  const prixJehHt = intervention.prixJehHt === "" || intervention.prixJehHt == null
    ? null : Number(intervention.prixJehHt);
  if (prixJehHt !== null && (!Number.isFinite(prixJehHt) || prixJehHt < 0)) {
    anomalies.push("Prix HT/JEH invalide");
  }

  const jeh = minutes !== null && Number.isFinite(minutes) && minutes > 0 ? minutes / 480 : null;
  const travaille = STATUTS_TRAVAILLE.has(intervention.statut);
  return {
    valide: anomalies.length === 0,
    anomalies,
    minutesIndividuelles: minutes,
    jeh,
    jehTravaillees: travaille && jeh !== null ? jeh : 0,
    statutTravaille: travaille,
    montantClientHt: jeh !== null && prixJehHt !== null ? jeh * prixJehHt : null,
  };
}

function agregerInterventions(interventions) {
  if (!Array.isArray(interventions)) {
    return { valide: false, totalJehTravaillees: null, parMembre: [], parEtude: [], anomalies: ["La liste des interventions doit être un tableau"] };
  }
  const parMembre = new Map();
  const parEtude = new Map();
  let totalJehTravaillees = 0;
  const anomalies = [];
  interventions.forEach((intervention, index) => {
    const analyse = analyserIntervention(intervention);
    analyse.anomalies.forEach(raison => anomalies.push({ index, raison }));
    if (!analyse.valide) return;
    totalJehTravaillees += analyse.jehTravaillees;
    parMembre.set(intervention.membreId, (parMembre.get(intervention.membreId) || 0) + analyse.jehTravaillees);
    parEtude.set(intervention.etudeId, (parEtude.get(intervention.etudeId) || 0) + analyse.jehTravaillees);
  });
  return {
    valide: anomalies.length === 0,
    totalJehTravaillees: anomalies.length ? null : totalJehTravaillees,
    parMembre: [...parMembre].map(([membreId, jeh]) => ({ membreId, jeh })),
    parEtude: [...parEtude].map(([etudeId, jeh]) => ({ etudeId, jeh })),
    anomalies,
  };
}

module.exports = { STATUTS_INTERVENTION, STATUTS_TRAVAILLE, analyserIntervention, agregerInterventions, dateValide };
