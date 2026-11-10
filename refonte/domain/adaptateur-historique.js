/**
 * HAC refonte — adaptateur historique en lecture seule.
 *
 * Convertit les collections Firestore v11 en objets reliés par identifiants.
 * Les correspondances client/membre doivent être fournies explicitement.
 * Aucun regroupement automatique des lignes de temps en BV : v11 ne contient
 * pas de frontière de bulletin fiable.
 */
const { auditerDonneesHistoriques } = require("./audit-migration");

function entries(collection) {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) return [];
  return Object.entries(collection).map(([sourceId, data]) => ({
    sourceId,
    data: data && typeof data === "object" && !Array.isArray(data) ? data : {},
  }));
}

const ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;

function adaptateurHistorique({
  etudes = {},
  factures = {},
  temps = {},
  clientIdParEtudeSource = {},
  membreIdParTempsSource = {},
  createId,
} = {}) {
  if (typeof createId !== "function") {
    throw new TypeError("createId doit être fourni : aucun identifiant de repli n'est généré.");
  }

  const E = entries(etudes);
  const F = entries(factures);
  const T = entries(temps);
  const audit = auditerDonneesHistoriques({
    etudes: E.map(x => x.data),
    factures: F.map(x => x.data),
    temps: T.map(x => x.data),
  });

  if (!audit.migrationAutomatiqueAutorisee) {
    return {
      statut: "bloquee",
      audit,
      donnees: { etudes: [], factures: [], temps: [] },
      correspondancesManquantes: [],
    };
  }

  const ids = new Set();
  const attribuerId = (sourceId, prefixe) => {
    let id = ID_VALIDE.test(sourceId) ? sourceId : createId(prefixe);
    if (typeof id !== "string" || !ID_VALIDE.test(id) || ids.has(id)) {
      throw new Error("createId doit produire un identifiant stable, valide et unique.");
    }
    ids.add(id);
    return id;
  };

  const idEtudeParSource = new Map();
  const etudesCibles = E.map(({ sourceId, data }) => {
    const id = attribuerId(sourceId, "etu");
    idEtudeParSource.set(sourceId, id);
    const clientBrut = clientIdParEtudeSource[sourceId] ?? null;
    const clientId = typeof clientBrut === "string" && ID_VALIDE.test(clientBrut) ? clientBrut : null;
    return { ...data, id, sourceLegacyId: sourceId, clientId };
  });

  const idEtudeParNumero = new Map();
  E.forEach(({ sourceId, data }) => idEtudeParNumero.set(data.num, idEtudeParSource.get(sourceId)));

  const facturesCibles = F.map(({ sourceId, data }) => {
    return {
      ...data,
      id: attribuerId(sourceId, "fac"),
      sourceLegacyId: sourceId,
      etudeId: idEtudeParNumero.get(data.etude),
    };
  });

  const tempsCibles = T.map(({ sourceId, data }) => {
    const etude = E.find(x => x.data.num === data.etude);
    return {
      ...data,
      id: attribuerId(sourceId, "tmp"),
      sourceLegacyId: sourceId,
      etudeId: idEtudeParNumero.get(data.etude),
      membreId: typeof membreIdParTempsSource[sourceId] === "string" && ID_VALIDE.test(membreIdParTempsSource[sourceId])
        ? membreIdParTempsSource[sourceId] : null,
      bvId: null,
      statutMigrationBV: "a_regrouper_manuellement",
    };
  });

  const correspondancesManquantes = [
    ...etudesCibles.filter(e => !e.clientId).map(e => ({
      type: "client", sourceLegacyId: e.sourceLegacyId, libelle: e.client ?? null,
    })),
    ...tempsCibles.filter(t => !t.membreId).map(t => ({
      type: "membre", sourceLegacyId: t.sourceLegacyId, libelle: t.prenom ?? null,
    })),
  ];

  return {
    statut: correspondancesManquantes.length ? "a_completer" : "pret_a_reviser",
    audit,
    donnees: { etudes: etudesCibles, factures: facturesCibles, temps: tempsCibles },
    correspondancesManquantes,
    avertissements: [
      "Les lignes de temps ne sont pas transformées automatiquement en BV : leur regroupement doit être confirmé.",
      "Les états et champs historiques sont conservés tels quels ; aucune normalisation métier silencieuse n'est appliquée.",
      "Ce résultat est un aperçu de migration, pas une commande d'écriture ni une autorisation de déploiement.",
    ],
  };
}

module.exports = { adaptateurHistorique };
