/**
 * HAC — synchronisation de l'application avec le serveur v3.
 *
 * Relie la couche application (état en mémoire, commandes) au client API v3 et à la file hors ligne :
 *  - démarrage : on envoie d'abord ce qui attend dans la file, puis on recharge depuis le serveur ;
 *    sans réseau, on repart du dernier état connu (cache local, qui inclut les modifications en attente) ;
 *  - chaque modification est appliquée tout de suite à l'écran (optimiste), mise en file avec un opId
 *    stable et la version attendue, puis envoyée ;
 *  - la version locale est avancée de 1 à la mise en file (le serveur incrémente de 1), pour que deux
 *    modifications successives hors ligne de la même fiche ne se contredisent pas ;
 *  - un conflit n'est jamais résolu en silence : la file s'arrête et l'interface demande quoi faire.
 * Aucune dépendance au navigateur : stockage, client et générateur d'opId sont injectés (testable dans Node).
 */
const { creerEtatVide, construireVueApplication } = require("../application/lecture");
const { creerFileHorsLigne } = require("../backend/file-hors-ligne");

const CHAMPS_SERVEUR = ["_v", "_par", "_le", "_opId", "_deleted"];
const sansChampsServeur = r => { const o = { ...r }; CHAMPS_SERVEUR.forEach(f => delete o[f]); return o; };

function creerSynchro({ client, stockage, creerOpId }) {
  if (!client || !stockage || typeof creerOpId !== "function") throw new TypeError("client, stockage et creerOpId sont obligatoires");
  const file = creerFileHorsLigne({
    stockage: { lire: async () => (await stockage.lire("file")) ?? [], ecrire: v => stockage.ecrire("file", v) },
    api: client,
  });
  let etat = creerEtatVide(), config = null, source = "vide", dernierBlocage = null;

  const memoriser = () => stockage.ecrire("cache", { etat, config, le: new Date().toISOString() });

  async function chargerServeur() {
    const r = await client.loadAll();
    etat = { ...creerEtatVide(), ...r.collections };
    config = r.config;
    source = "serveur";
    await memoriser();
  }
  async function chargerCache() {
    const c = await stockage.lire("cache");
    if (c && c.etat) { etat = { ...creerEtatVide(), ...c.etat }; config = c.config ?? null; source = "cache"; return true; }
    return false;
  }

  async function synchroniser() {
    const r = await file.synchroniser();
    dernierBlocage = r.bloquePar;
    // On ne recharge depuis le serveur que si plus rien n'attend : sinon on perdrait l'affichage des modifications locales.
    if (r.restantes === 0) {
      try { await chargerServeur(); } catch (e) { if (e?.code !== "NETWORK_ERROR") throw e; }
    }
    return r;
  }

  return Object.freeze({
    lireEtat: () => etat,
    lireConfig: () => config,
    session: () => client.session(),
    adminAcces: () => client.adminAcces(),
    definirRole: options => client.definirRole(options),
    regenererCode: options => client.regenererCode(options),
    desactiverAcces: options => client.desactiverAcces(options),
    reactiverAcces: options => client.reactiverAcces(options),
    changerMonCode: () => client.changerMonCode(),
    statut: async () => ({ source, enAttente: (await file.inspecter()).length, blocage: dernierBlocage }),

    async demarrer() {
      await chargerCache();
      try {
        const r = await synchroniser();
        if (r.restantes === 0 && source !== "serveur") await chargerServeur();
      } catch (e) {
        if (e?.code !== "NETWORK_ERROR") throw e;
        if (source === "vide") throw e; // ni réseau ni cache : rien à afficher
      }
      return this.statut();
    },

    /** Applique une commande (preparerAjout / preparerModification) puis l'envoie au serveur. */
    async executer(commande) {
      return this.executerPlusieurs([commande]);
    },

    /**
     * Suppression logique optimiste. La vue métier est validée avant mise en file :
     * une fiche encore référencée (client, étude, membre, BV) ne peut donc pas disparaître.
     */
    async supprimer(collection, id) {
      if (collection === "config" || !Array.isArray(etat[collection])) {
        return { valide: false, anomalies: ["Collection non supprimable ou inconnue"] };
      }
      const fiche = etat[collection].find(x => x.id === id);
      if (!fiche) return { valide: false, anomalies: ["Fiche introuvable"] };
      const attendue = Number.isSafeInteger(fiche._v) ? fiche._v : 0;
      const suivant = { ...etat, [collection]: etat[collection].filter(x => x.id !== id) };
      const verif = construireVueApplication(suivant);
      if (!verif.valide) return { valide: false, anomalies: verif.anomalies };
      // Les fiches historiques ont une version 0 : les versionner avant leur tombstone.
      if (attendue === 0) {
        await file.ajouter({
          type: "save", collection, id, record: sansChampsServeur(fiche),
          opId: creerOpId(), expectedVersion: 0,
        });
      }
      await file.ajouter({
        type: "delete", collection, id, opId: creerOpId(), expectedVersion: attendue === 0 ? 1 : attendue,
      });
      etat = suivant;
      await memoriser();
      let envoi;
      try { envoi = await synchroniser(); }
      catch (e) {
        if (e?.code !== "NETWORK_ERROR") throw e;
        envoi = { restantes: (await file.inspecter()).length };
      }
      return { valide: true, envoi };
    },

    /**
     * Applique plusieurs commandes comme un tout (ex. un BV et sa ligne) : l'état final est validé une seule fois,
     * puis les écritures partent dans l'ordre (le parent avant l'enfant, comme l'exige le serveur).
     */
    async executerPlusieurs(commandes) {
      let suivant = etat;
      for (const c of commandes) {
        const col = c?.collection;
        if (!Array.isArray(suivant[col])) return { valide: false, anomalies: ["Collection inconnue"] };
        if (c.type === "ajouter") {
          if (!c.enregistrement || c.enregistrement.id !== c.id || suivant[col].some(x => x.id === c.id)) return { valide: false, anomalies: ["Ajout invalide"] };
          suivant = { ...suivant, [col]: [...suivant[col], { ...c.enregistrement }] };
        } else if (c.type === "modifier") {
          if (!suivant[col].some(x => x.id === c.id) || !c.modifications || "id" in c.modifications) return { valide: false, anomalies: ["Modification invalide"] };
          suivant = { ...suivant, [col]: suivant[col].map(x => (x.id === c.id ? { ...x, ...c.modifications } : x)) };
        } else return { valide: false, anomalies: ["Type de commande non pris en charge"] };
      }
      const verif = construireVueApplication(suivant);
      if (!verif.valide) return { valide: false, anomalies: verif.anomalies };
      for (const c of commandes) {
        const col = c.collection, id = c.id;
        const fiche = suivant[col].find(x => x.id === id);
        const attendue = Number.isSafeInteger(fiche?._v) ? fiche._v : 0;
        await file.ajouter({ type: "save", collection: col, id, record: sansChampsServeur(fiche), opId: creerOpId(), expectedVersion: attendue });
        suivant = { ...suivant, [col]: suivant[col].map(x => (x.id === id ? { ...x, _v: attendue + 1 } : x)) };
      }
      etat = suivant;
      await memoriser();
      let envoi;
      try { envoi = await synchroniser(); } catch (e) { if (e?.code !== "NETWORK_ERROR") throw e; envoi = { restantes: (await file.inspecter()).length }; }
      return { valide: true, envoi };
    },

    synchroniser,

    /** Enregistre la fiche unique de réglages (config/main), versionnée comme les autres fiches. */
    async enregistrerConfig(nouvelle) {
      if (!nouvelle || typeof nouvelle !== "object" || Array.isArray(nouvelle)) return { valide: false, anomalies: ["Réglages invalides"] };
      const attendue = Number.isSafeInteger(config?._v) ? config._v : 0;
      const record = { ...sansChampsServeur(nouvelle), id: "main" };
      await file.ajouter({ type: "save", collection: "config", id: "main", record, opId: creerOpId(), expectedVersion: attendue });
      config = { ...record, _v: attendue + 1 };
      await memoriser();
      let envoi;
      try { envoi = await synchroniser(); } catch (e) { if (e?.code !== "NETWORK_ERROR") throw e; envoi = { restantes: (await file.inspecter()).length }; }
      return { valide: true, envoi };
    },

    /** Conflit : abandonner les modifications en attente et repartir de la version du serveur. */
    async abandonnerEtRecharger() {
      for (const op of await file.inspecter()) await file.abandonner(op.opId);
      dernierBlocage = null;
      await chargerServeur();
    },
  });
}

/** Stockage navigateur (localStorage), protégé contre les erreurs (navigation privée, quota). */
function stockageNavigateur(prefixe = "hac.v3.") {
  return {
    async lire(cle) { try { const v = globalThis.localStorage.getItem(prefixe + cle); return v ? JSON.parse(v) : null; } catch { return null; } },
    async ecrire(cle, valeur) { globalThis.localStorage.setItem(prefixe + cle, JSON.stringify(valeur)); },
  };
}

/** Transport fetch vers l'application Web Apps Script (text/plain : évite la requête préliminaire CORS). */
function transportFetch(url) {
  return async requete => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(requete), redirect: "follow" });
    return { status: r.status, body: await r.text() };
  };
}

module.exports = { creerSynchro, stockageNavigateur, transportFetch };
