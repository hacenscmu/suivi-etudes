/**
 * HAC refonte — audit sans écriture des données historiques.
 * Les clés textuelles sont des indices, jamais des identifiants garantis uniques.
 * Aucun identifiant n'est créé et aucune donnée n'est modifiée.
 */
function regrouperParValeur(lignes = [], champ) {
  const groupes = new Map();
  lignes.forEach((ligne, index) => {
    const valeur = ligne?.[champ];
    if (typeof valeur !== "string" || valeur.trim() === "") return;
    if (!groupes.has(valeur)) groupes.set(valeur, []);
    groupes.get(valeur).push(index);
  });
  return [...groupes.entries()]
    .filter(([, indices]) => indices.length > 1)
    .map(([valeur, indices]) => ({ valeur, nombre: indices.length, indices }));
}

function auditerDonneesHistoriques({ etudes = [], factures = [], temps = [] } = {}) {
  const anomalies = [];
  const doublonsNumerosEtude = regrouperParValeur(etudes, "num");
  const doublonsClients = regrouperParValeur(etudes, "client");
  const homonymesPossibles = regrouperParValeur(temps, "prenom");

  doublonsNumerosEtude.forEach(g => anomalies.push({ type: "numero_etude_duplique", valeur: g.valeur, indices: g.indices, gravite: "bloquante" }));
  doublonsClients.forEach(g => anomalies.push({ type: "nom_client_reutilise", valeur: g.valeur, indices: g.indices, gravite: "a_verifier" }));
  homonymesPossibles.forEach(g => anomalies.push({ type: "prenom_reutilise", valeur: g.valeur, indices: g.indices, gravite: "a_verifier" }));

  const etudesParNumero = new Map();
  etudes.forEach((etude, index) => {
    const numero = etude?.num;
    if (typeof numero !== "string" || numero.trim() === "") return;
    if (!etudesParNumero.has(numero)) etudesParNumero.set(numero, []);
    etudesParNumero.get(numero).push(index);
  });

  factures.forEach((facture, index) => {
    const numero = facture?.etude;
    const candidats = typeof numero === "string" ? (etudesParNumero.get(numero) || []) : [];
    if (candidats.length !== 1) anomalies.push({
      type: candidats.length === 0 ? "facture_sans_etude_resolue" : "facture_etude_ambigue",
      index, referenceHistorique: numero ?? null, indicesEtudesCandidates: candidats, gravite: "bloquante",
    });
  });

  temps.forEach((ligne, index) => {
    const numero = ligne?.etude;
    const candidats = typeof numero === "string" ? (etudesParNumero.get(numero) || []) : [];
    if (candidats.length !== 1) anomalies.push({
      type: candidats.length === 0 ? "temps_sans_etude_resolue" : "temps_etude_ambigue",
      index, referenceHistorique: numero ?? null, indicesEtudesCandidates: candidats, gravite: "bloquante",
    });
    if (typeof ligne?.prenom !== "string" || ligne.prenom.trim() === "") anomalies.push({
      type: "temps_sans_personne_identifiable", index, gravite: "bloquante",
    });
  });

  return {
    migrationAutomatiqueAutorisee: anomalies.length === 0,
    resume: {
      nombreEtudes: etudes.length, nombreFactures: factures.length, nombreLignesTemps: temps.length,
      doublonsNumerosEtude: doublonsNumerosEtude.length, nomsClientsReutilises: doublonsClients.length,
      prenomsReutilises: homonymesPossibles.length,
      anomaliesBloquantes: anomalies.filter(a => a.gravite === "bloquante").length,
    },
    anomalies,
  };
}

module.exports = { regrouperParValeur, auditerDonneesHistoriques };
