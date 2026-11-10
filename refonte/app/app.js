/* HAC — application v3 : interface branchée sur le serveur Apps Script (client v3, file hors ligne, synchronisation). */
(() => {
  "use strict";
  const { creerEtatVide, construireVueApplication, preparerAjout, preparerModification, appliquerCommande } = window.HAC;
  const { creerSynchro, creerClientApiV3, stockageNavigateur, transportFetch, creerServeurMemoireV3, calculerAlertes, EN_COURS, calculerPaie } = window.HAC;
  let filtreEtudes = "En cours";
  const alertesParEtude = () => calculerAlertes({ etudes: data.etudes, factures: data.factures, interventions: data.interventions, config: synchro?.lireConfig() || {}, aujourdhui: aujourdHui() });
  // ---- Mode essai : un serveur v3 simulé sur ce téléphone, avec des données d'exemple. Aucune donnée réelle. ----
  const JETON_ESSAI = "essai-local-hac-v3";
  const v1 = o => Object.fromEntries(o.map(x => [x.id, { ...x, _v: 1 }]));
  const EXEMPLE = {
    clients: v1([{ id: "client_0001", raisonSociale: "Soléa Industrie", relationType: "ponctuelle" }, { id: "client_0002", raisonSociale: "Novalys", relationType: "longue_duree" }]),
    membres: v1([{ id: "membre_0001", nomComplet: "Camille Martin", role: "Cheffe de projet" }, { id: "membre_0002", nomComplet: "Lucas Bernard" }]),
    etudes: v1([{ id: "etude_0001", clientId: "client_0001", client: "Soléa Industrie", num: "HAC-2026-018", date: "2026-09-04", statut: "En réalisation", montant: 5040, jeh: 400 },
      { id: "etude_0002", clientId: "client_0002", client: "Novalys", num: "HAC-2026-021", date: "2026-11-03", statut: "Devis envoyé", montant: 1800, jeh: 350 }]),
    factures: v1([{ id: "facture_0001", etudeId: "etude_0001", type: "Acompte", etat: "Payée", montant: 2520, date: "2026-09-10", datePaiement: "2026-09-25" },
      { id: "facture_0002", etudeId: "etude_0001", type: "Solde", etat: "Émise", montant: 2520, date: "2026-10-20", echeance: "2026-11-20" }]),
    interventions: v1([{ id: "interv_0001", etudeId: "etude_0001", membreId: "membre_0001", date: "2026-10-02", statut: "Payé", minutesIndividuelles: 960, prixJehHt: 300 },
      { id: "interv_0002", etudeId: "etude_0001", membreId: "membre_0002", date: "2026-10-14", statut: "Pas payé", minutesIndividuelles: 240, prixJehHt: 300 }]),
  };
  function transportEssai() {
    const CLE = "hac.v3.essai.donnees";
    let donnees = null; try { donnees = JSON.parse(localStorage.getItem(CLE) || "null"); } catch { donnees = null; }
    const serveur = creerServeurMemoireV3({ token: JETON_ESSAI, donnees: donnees || EXEMPLE, maintenant: () => new Date().toISOString() });
    return async requete => { const r = await serveur.transport(requete); try { localStorage.setItem(CLE, JSON.stringify(serveur.lireDonnees())); } catch {} return r; };
  }

  // ---- Connexion : adresse du serveur Apps Script et jeton personnel, gardés sur cet appareil ----
  const CONN = "hac.v3.connexion";
  const lireConnexion = () => { try { return JSON.parse(localStorage.getItem(CONN) || "null"); } catch { return null; } };
  let connexion = lireConnexion();
  let synchro = null;
  let data = creerEtatVide();
  let etatSynchro = { source: "vide", enAttente: 0, blocage: null };
  const aujourdHui = () => new Date().toISOString().slice(0, 10);
  const nouvelId = prefixe => prefixe + "_" + crypto.getRandomValues(new Uint32Array(3)).reduce((s, n) => s + n.toString(36), "").slice(0, 16).padEnd(8, "0");

  const pages = ["Accueil", "Études", "Finances", "Équipe", "Réglages"];
  const icons = ["⌂", "▤", "€", "♙", "⚙"];
  let current = "Accueil";
  let recherche = "";
  const money = n => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const view = () => construireVueApplication(data, { dateFin: aujourdHui(), nombreMois: 6, tva: synchro?.lireConfig()?.tva ?? 0.2 });

  function nav() {
    ["tabs", "mobileTabs"].forEach(id => {
      document.getElementById(id).innerHTML = pages.map((p, i) =>
        '<button data-page="' + p + '" class="' + (p === current ? "active" : "") + '">' +
        (id === "mobileTabs" ? "<b>" + icons[i] + "</b>" : "") + p + "</button>"
      ).join("");
    });
    document.querySelectorAll("[data-page]").forEach(button => {
      button.addEventListener("click", () => { current = button.dataset.page; render(); });
    });
  }

  function heading(title, sub, action = "") {
    return '<div class="section-head"><div><h2>' + title + '</h2><span>' + sub + "</span></div>" + action + "</div>";
  }

  function dashboard(v) {
    const d = v.tableauDeBord;
    const mois = d.jehParMois || [];
    const max = Math.max(1, ...mois.map(m => m.jeh));
    const percent = d.caSigne > 0 ? Math.round(d.encaisse / d.caSigne * 100) : 0;
    const facturesOuvertes = data.factures.filter(f => f.etat !== "Payée");
    const alertesFactures = facturesOuvertes.map(f => {
      const study = data.etudes.find(e => e.id === f.etudeId);
      const client = data.clients.find(c => c.id === study?.clientId);
      return '<div class="alert"><div class="alert-icon">!</div><div><strong>Facture à encaisser · ' +
        escapeHtml(client?.raisonSociale || study?.client || "Client") + '</strong><small>' +
        escapeHtml(study?.num || "") + " · " + money(f.montant / 1.2) + " HT · " + escapeHtml(f.type || "Facture") +
        "</small></div></div>";
    }).join("");
    const alertesJeh = (d.alertesInterventions || []).map(a => {
      const intervention = data.interventions[a.index];
      const study = data.etudes.find(e => e.id === intervention?.etudeId);
      const member = data.membres.find(m => m.id === intervention?.membreId);
      return '<div class="alert"><div class="alert-icon">!</div><div><strong>Prix JEH intervenant supérieur à 300 € HT</strong><small>' +
        escapeHtml(member?.nomComplet || "Intervenant") + " · " + escapeHtml(study?.num || "Étude") +
        " · " + money(intervention?.prixJehHt) + " HT/JEH</small></div></div>";
    }).join("");
    const AL = alertesParEtude();
    const parEtude = data.etudes.map(e => ({ e, a: AL.get(e.id)?.alertes || [] })).filter(x => x.a.length);
    const alerts = parEtude.map(({ e, a }) => '<button type="button" class="alert invoice-button" data-etude="' + e.id + '"><div class="alert-icon">' + a.length + '</div><div><strong>' +
      escapeHtml(nomEtude(e)) + "</strong><small>" + a.map(x => escapeHtml(x.texte)).join(" · ") + "</small></div></button>").join("");
    return '<div class="stats">' +
      '<div class="stat"><div class="label">JEH travaillées · étudiants</div><strong>' + (d.totalJehTravaillees ?? "—").toLocaleString?.("fr-FR") + '</strong><small>Interventions réalisées uniquement</small></div>' +
      '<div class="stat"><div class="label">Chiffre d’affaires signé HT</div><strong>' + money(d.caSigne) + '</strong><small>' + d.nombreEtudes + " études suivies</small></div>" +
      '<div class="stat"><div class="label">Déjà encaissé HT</div><strong>' + money(d.encaisse) + '</strong><small>' + percent + " % du CA signé</small></div>" +
      '<div class="stat"><div class="label">Reste à encaisser HT</div><strong>' + money(d.resteAEncaisser) + '</strong><small>' + facturesOuvertes.length + " facture(s) non payée(s)</small></div>" +
      "</div>" + heading("Activité", "JEH réellement travaillées · 6 derniers mois") +
      '<div class="grid"><section class="panel"><h3>Activité des étudiants</h3><div class="sub">Durées individuelles converties en JEH</div><div class="bars">' +
      mois.map((m, i) => '<div class="barcol"><b>' + m.jeh.toLocaleString("fr-FR") + '</b><div class="bar ' + (i === mois.length - 1 ? "hot" : "") +
        '" style="height:' + (m.jeh / max * 100) + '%"></div><small>' + escapeHtml(m.mois.slice(5)) + "</small></div>").join("") +
      '</div></section><section class="panel"><h3>Encaissement</h3><div class="sub">Part du CA signé déjà encaissée</div><div class="ring-wrap"><div class="ring" style="background:conic-gradient(var(--pink) 0 ' +
      percent + '%,#f4eaf0 ' + percent + '% 100%)"></div><div class="ring-info"><strong>' + money(d.encaisse) + '</strong><small>sur ' + money(d.caSigne) +
      ' HT signés</small></div></div><div class="sub">' + money(d.resteAEncaisser) + " HT restent à encaisser</div></section></div>" +
      heading("Alertes à traiter", parEtude.length + " étude(s) concernée(s)") +
      '<section class="panel">' + (alerts || '<div class="empty">Aucune alerte. Tout est à jour.</div>') + "</section>";
  }

  function studies(v) {
    const AL = alertesParEtude();
    const FILTRES = { "En cours": s => EN_COURS.includes(s.statut), "Archivées": s => s.statut === "Archivée", "Refusées": s => s.statut === "Refusé / sans suite", "Alertes": s => (AL.get(s.id)?.alertes || []).length > 0, "Toutes": () => true };
    const rows = v.listes.etudes.filter(FILTRES[filtreEtudes]).filter(s => [s.num, s.clientLibelle, s.statut].join(" ").toLowerCase().includes(recherche.toLowerCase()));
    const puces = '<div class="toolbar" style="flex-wrap:wrap;margin-bottom:10px">' + Object.keys(FILTRES).map(k => '<button type="button" class="pill ' + (k === filtreEtudes ? "pink" : "") + '" data-filtre="' + k + '">' + k +
      " (" + v.listes.etudes.filter(FILTRES[k]).length + ")</button>").join("") + "</div>";
    return heading("Études", data.etudes.length + " études",
      '<div class="toolbar"><input class="search" id="search" placeholder="Rechercher une étude…" value="' + escapeHtml(recherche) +
      '"><button class="ghost action" id="addClient">＋ Client</button><button class="action" id="addStudy">＋ Étude</button></div>') + puces +
      '<section class="listbox rows">' + (rows.map(s => '<button type="button" class="item invoice-button" data-etude="' + s.id + '"><div class="item-main"><strong>' + escapeHtml(s.num) + " · " + escapeHtml(s.clientLibelle) +
        '</strong><small>' + escapeHtml(AL.get(s.id)?.facture || "—") + (AL.get(s.id)?.alertes.length ? ' · <span class="accent">⚠ ' + escapeHtml(AL.get(s.id).alertes[0].texte) + (AL.get(s.id).alertes.length > 1 ? " (+" + (AL.get(s.id).alertes.length - 1) + ")" : "") + "</span>" : "") + '</small></div><span class="pill ' +
        (s.statut === "Archivée" ? "green" : s.statut === "Devis envoyé" ? "pink" : "") + '">' + escapeHtml(s.statut) +
        '</span><div class="amount">' + money(s.montant / 1.2) + " HT</div></button>").join("") || '<div class="empty">Aucune étude. Commencez par « ＋ Client » puis « ＋ Étude ».</div>') + "</section>" +
      heading("Clients", data.clients.length + " clients") + '<section class="listbox rows">' + data.clients.map(c => '<button type="button" class="item invoice-button" data-client="' + c.id + '"><div class="item-main"><strong>' + escapeHtml(c.raisonSociale) + '</strong><small>' + (c.relationType === "longue_duree" ? "Relation récurrente" : "Mission ponctuelle") + " · " + data.etudes.filter(e => e.clientId === c.id).length + " étude(s)</small></div></button>").join("") + "</section>";
  }

  function finances(v) {
    const d = v.tableauDeBord;
    return [
      '<div class="stats">',
      '<div class="stat"><div class="label">Facturé HT</div><strong>' + money(d.montantFacture) + '</strong><small>' + data.factures.length + ' factures</small></div>',
      '<div class="stat"><div class="label">Encaissé HT</div><strong>' + money(d.encaisse) + '</strong><small>Factures payées</small></div>',
      '<div class="stat"><div class="label">En attente HT</div><strong>' + money(d.resteAEncaisser) + '</strong><small>Factures non payées</small></div>',
      '<div class="stat"><div class="label">À facturer HT</div><strong>' + money(Math.max(0, d.caSigne - d.montantFacture)) + '</strong><small>CA signé moins facturé</small></div>',
      '</div>',
      heading("Factures", "Touchez une facture pour la modifier", '<button class="action" id="addFacture">＋ Facture</button>'),
      '<section class="listbox rows">',
      v.listes.factures.map(f =>
        '<button class="item invoice-button" data-invoice="' + f.id + '" type="button">' +
        '<div class="item-main"><strong>' + escapeHtml(f.type || "Facture") + ' · ' + escapeHtml(f.etudeLibelle) + '</strong>' +
        '<small>' + escapeHtml(f.etat) + '</small></div>' +
        '<span class="pill ' + (f.etat === "Payée" ? "green" : "pink") + '">' +
        (f.etat === "Payée" ? "Payée" : "À encaisser") + '</span>' +
        '<div class="amount">' + money(f.montant / 1.2) + ' HT</div></button>'
      ).join(""),
      '</section>'
    ].join("");
  }

  function team(v) {
    const totals = new Map(v.tableauDeBord.jehParMembre.map(x => [x.membreId, x.jeh]));
    const nomMembre = id => data.membres.find(m => m.id === id)?.nomComplet || "?";
    const interv = [...data.interventions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return heading("Équipe", "JEH réellement travaillées par étudiant", '<button class="action" id="addMembre">＋ Membre</button>') +
      '<section class="listbox rows">' + (v.listes.membres.map(m => '<button type="button" class="item invoice-button" data-membre="' + m.id + '"><div class="mark" style="width:36px;height:36px;border-radius:50%;font-size:12px">' +
        escapeHtml(m.libelle.split(" ").map(x => x[0]).join("").slice(0, 2)) + '</div><div class="item-main"><strong>' + escapeHtml(m.libelle) +
        '</strong><small>' + escapeHtml(m.role || "Membre") + '</small></div><div class="amount">' +
        ((totals.get(m.id) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 3 })) + " JEH</div></button>").join("") || '<div class="empty">Aucun membre.</div>') + "</section>" +
      heading("Interventions", interv.length + " ligne(s) · une ligne par personne", '<button class="action" id="addInterv">＋ Intervention</button>') +
      '<section class="listbox rows">' + (interv.map(i => {
        const e = data.etudes.find(x => x.id === i.etudeId);
        return '<button type="button" class="item invoice-button" data-interv="' + i.id + '"><div class="item-main"><strong>' + escapeHtml(nomMembre(i.membreId)) + " · " + escapeHtml(e?.num || "") +
          '</strong><small>' + escapeHtml(i.date) + " · " + escapeHtml(i.statut) + '</small></div><div class="amount">' + (Number(i.minutesIndividuelles || 0) / 480).toLocaleString("fr-FR", { maximumFractionDigits: 3 }) + " JEH</div></button>";
      }).join("") || '<div class="empty">Aucune intervention.</div>') + "</section>" +
      paieHtml() +
      heading("Bulletins de versement", data.bvs.length + " BV", '<button class="action" id="addBV">＋ BV</button>') +
      '<section class="listbox rows">' + (data.lignesBV.map(l => {
        const bv = data.bvs.find(b => b.id === l.bvId), jeh = Number(l.jeh) || 0;
        return '<div class="item"><div class="item-main"><strong>' + escapeHtml(nomMembre(l.membreId)) + " · " + escapeHtml(bv?.reference || bv?.date || "") + '</strong><small>' + escapeHtml(bv?.date || "") +
          (jeh > 0 && jeh < 1 ? " · cotisations calculées sur 1 JEH" : "") + '</small></div><div class="amount">' + jeh.toLocaleString("fr-FR") + " JEH</div></div>";
      }).join("") || '<div class="empty">Aucun BV.</div>') + "</section>";
  }

  function paieHtml() {
    const P = calculerPaie({ interventions: data.interventions, membres: data.membres, config: synchro?.lireConfig() || {} });
    const aVerser = P.lignes.filter(r => r.jehAPayer > 0);
    const f3 = n => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
    return heading("À verser (prochain BV)", money(P.total.net) + " net en tout · coût Junior " + money(P.total.cout)) +
      '<section class="listbox rows">' + (aVerser.map(r => '<div class="item"><div class="item-main"><strong>' + escapeHtml(r.nom) + " · " + money(r.net) + ' net</strong><small>' +
        f3(r.jehAPayer) + " JEH · brut " + money(r.brut) + " · coût Junior " + money(r.cout) + (r.assiette > r.jehAPayer ? " · cotisé sur 1 JEH" : "") +
        (r.sansPrix ? ' · <span class="accent">prix JEH intervenant manquant</span>' : "") + " · déjà payé " + money(r.dejaPaye) +
        '</small></div><button class="action" data-payer="' + r.membreId + '">Créer le BV</button></div>').join("") || '<div class="empty">Personne à payer pour le moment.</div>') + "</section>" +
      '<details class="sub" style="margin-top:8px"><summary>Comment c’est calculé ?</summary>Pour chaque personne : les interventions « Fait, pas encore payé ». Brut = JEH × prix JEH intervenant. Net = brut − cotisations salariales ; coût Junior = brut + charges patronales. Base d’une JEH : 4 h de SMIC. En dessous de 1 JEH, cotisations et charges sont calculées sur 1 JEH. « Créer le BV » enregistre le bulletin et passe ces lignes à « Payé ».</details>';
  }
  async function creerBVPour(membreId) {
    const P = calculerPaie({ interventions: data.interventions, membres: data.membres, config: synchro?.lireConfig() || {} });
    const r = P.lignes.find(x => x.membreId === membreId);
    if (!r || !(r.jehAPayer > 0)) return;
    if (!confirm("Créer le BV de " + r.nom + " (" + money(r.net) + " net) et passer ses lignes à « Payé » ?")) return;
    const bvId = nouvelId("bv"), ligneId = nouvelId("ligne");
    const bv = { id: bvId, date: aujourdHui(), reference: "BV " + r.nom + " " + aujourdHui(), brut: Math.round(r.brut * 100) / 100, net: Math.round(r.net * 100) / 100, coutJunior: Math.round(r.cout * 100) / 100 };
    const commandes = [
      { type: "ajouter", collection: "bvs", id: bvId, enregistrement: bv },
      { type: "ajouter", collection: "lignesBV", id: ligneId, enregistrement: { id: ligneId, bvId, membreId, jeh: Math.round(r.jehAPayer * 1e6) / 1e6 } },
      ...data.interventions.filter(i => i.membreId === membreId && i.statut === "Pas payé").map(i => ({ type: "modifier", collection: "interventions", id: i.id, modifications: { statut: "Payé", bvId } })),
    ];
    const res = await synchro.executerPlusieurs(commandes);
    if (!res.valide) { alert(res.anomalies.map(a => a.raison || a).join("\n")); return; }
    data = synchro.lireEtat(); await majStatut(); render();
  }

  function settings() {
    const e = etatSynchro;
    return heading("Réglages", "Connexion et synchronisation") +
      '<section class="listbox rows"><div class="item"><div class="item-main"><strong>Serveur</strong><small>' + escapeHtml(connexion?.essai ? "Mode essai (serveur simulé sur ce téléphone)" : connexion?.url ? "Connecté" : "Non connecté") + '</small></div></div>' +
      '<div class="item"><div class="item-main"><strong>Données affichées</strong><small>' + (e.source === "serveur" ? "À jour avec le serveur" : e.source === "cache" ? "Dernière version gardée sur cet appareil (hors ligne)" : "Aucune") + '</small></div></div>' +
      '<div class="item"><div class="item-main"><strong>Modifications en attente d’envoi</strong><small>' + e.enAttente + '</small></div><button class="ghost action" id="syncNow">Synchroniser</button></div>' +
      '<div class="item"><div class="item-main"><strong>Taux de TVA</strong><small>' + Math.round((synchro?.lireConfig()?.tva ?? 0.2) * 100) + ' %</small></div></div>' +
      '<div class="item"><div class="item-main"><strong>Se déconnecter de cet appareil</strong><small>Efface l’adresse, le jeton et les données gardées sur ce téléphone</small></div><button class="ghost action" id="logout">Déconnexion</button></div></section>';
  }

  // ---------- Formulaires ----------
  const STATUTS_ETUDE = ["Faisabilité", "Devis envoyé", "Devis signé", "Convention envoyée", "Convention signée", "Convention étudiant avant réalisation", "En réalisation", "Archivée", "Refusé / sans suite"];
  const STATUTS_JEH = [["Pas payé", "Fait, pas encore payé"], ["Payé", "Payé (BV versé)"], ["A venir", "À venir"], ["Non effectué", "Non effectué"]];
  const opts = (liste, val) => liste.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return '<option value="' + escapeHtml(v) + '"' + (String(v) === String(val ?? "") ? " selected" : "") + ">" + escapeHtml(l) + "</option>"; }).join("");
  const nomEtude = e => (e.num || "Étude") + " · " + (data.clients.find(c => c.id === e.clientId)?.raisonSociale || e.client || "");

  function formulaire({ titre, champs, valeurs = {}, onValider, supprimer = null }) {
    const dialog = document.createElement("dialog");
    dialog.className = "study-dialog";
    const html = champs.map(c => {
      const v = valeurs[c.name] ?? c.defaut ?? "";
      const req = c.required ? " required" : "";
      let input;
      if (c.type === "select") input = '<select name="' + c.name + '"' + req + ">" + (c.required ? "" : '<option value="">—</option>') + opts(c.options, v) + "</select>";
      else input = '<input name="' + c.name + '" type="' + (c.type || "text") + '"' + req + (c.type === "number" ? ' step="any" min="0" inputmode="decimal"' : "") + ' value="' + escapeHtml(v) + '">';
      return "<label>" + escapeHtml(c.label) + input + (c.aide ? '<small class="sub">' + escapeHtml(c.aide) + "</small>" : "") + "</label>";
    }).join("");
    dialog.innerHTML = '<form method="dialog"><div class="section-head"><h2>' + escapeHtml(titre) + '</h2><button class="ghost close-dialog" value="cancel" aria-label="Fermer">×</button></div>' + html +
      '<p class="sub" data-erreur style="color:var(--red)"></p><div class="dialog-actions"><button class="ghost" value="cancel">Annuler</button><button class="action" data-ok value="default">Enregistrer</button></div></form>';
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("form").addEventListener("submit", async ev => {
      if (!ev.submitter?.hasAttribute("data-ok")) return;
      ev.preventDefault();
      const f = new FormData(ev.currentTarget), d = {};
      champs.forEach(c => { const raw = String(f.get(c.name) ?? "").trim(); d[c.name] = c.type === "number" ? (raw === "" ? null : Number(raw.replace(",", "."))) : raw; });
      const erreur = await onValider(d);
      if (erreur) { dialog.querySelector("[data-erreur]").textContent = erreur; return; }
      dialog.close(); render();
    });
    dialog.showModal();
  }

  async function enregistrer(collection, id, donnees, prefixe) {
    const prepared = id
      ? preparerModification({ etat: data, collection, id, modifications: donnees })
      : preparerAjout({ etat: data, collection, donnees, creerId: () => nouvelId(prefixe) });
    if (!prepared.valide) return prepared.anomalies.map(a => a.raison || a).join(" · ");
    const r = await synchro.executer(prepared.commande);
    if (!r.valide) return r.anomalies.map(a => a.raison || a).join(" · ");
    data = synchro.lireEtat(); await majStatut(); return null;
  }

  function ouvrirEtude(id) {
    const e = id ? data.etudes.find(x => x.id === id) : {};
    formulaire({ titre: id ? "Modifier l’étude" : "Nouvelle étude", valeurs: { ...e, date: e.date || aujourdHui(), statut: e.statut || "Faisabilité" }, champs: [
      { name: "clientId", label: "Client", type: "select", required: true, options: data.clients.map(c => [c.id, c.raisonSociale]), aide: data.clients.length ? "" : "Créez d’abord un client (bouton « ＋ Client »)." },
      { name: "num", label: "N° d’étude", required: true },
      { name: "resume", label: "Résumé" },
      { name: "statut", label: "Statut", type: "select", required: true, options: synchro?.lireConfig()?.statuts || STATUTS_ETUDE },
      { name: "montant", label: "Montant TTC (€)", type: "number" },
      { name: "jeh", label: "Prix de la JEH client HT (€)", type: "number", aide: "Fourchette CNJE : 80 à 450 € HT" },
      { name: "frais", label: "Dont frais HT (labo…, hors JEH)", type: "number" },
      { name: "date", label: "Date de création", type: "date", required: true },
    ], onValider: d => { d.client = data.clients.find(c => c.id === d.clientId)?.raisonSociale || ""; return enregistrer("etudes", id, d, "etude"); } });
  }
  function ouvrirClient(id) {
    const c = id ? data.clients.find(x => x.id === id) : {};
    formulaire({ titre: id ? "Modifier le client" : "Nouveau client", valeurs: { relationType: "ponctuelle", ...c }, champs: [
      { name: "raisonSociale", label: "Nom du client", required: true },
      { name: "relationType", label: "Type de collaboration", type: "select", required: true, options: [["ponctuelle", "Ponctuelle (mission délimitée)"], ["longue_duree", "Récurrente (relation suivie)"]] },
    ], onValider: d => enregistrer("clients", id, d, "client") });
  }
  function ouvrirFacture(id) {
    const f = id ? data.factures.find(x => x.id === id) : {};
    formulaire({ titre: id ? "Modifier la facture" : "Nouvelle facture", valeurs: { type: "Acompte", etat: "Émise", date: aujourdHui(), ...f }, champs: [
      { name: "etudeId", label: "Étude", type: "select", required: true, options: data.etudes.map(e => [e.id, nomEtude(e)]) },
      { name: "type", label: "Type", type: "select", required: true, options: ["Acompte", "Intermédiaire", "Solde"] },
      { name: "etat", label: "État", type: "select", required: true, options: ["Émise", "Payée"] },
      { name: "montant", label: "Montant TTC (€)", type: "number", required: true },
      { name: "date", label: "Date d’émission", type: "date" },
      { name: "echeance", label: "Échéance", type: "date" },
      { name: "datePaiement", label: "Date de paiement", type: "date" },
    ], onValider: d => { if (d.etat === "Payée" && !d.datePaiement) d.datePaiement = aujourdHui(); return enregistrer("factures", id, d, "facture"); } });
  }
  function ouvrirMembre(id) {
    const m = id ? data.membres.find(x => x.id === id) : {};
    formulaire({ titre: id ? "Modifier le membre" : "Nouveau membre", valeurs: m, champs: [
      { name: "nomComplet", label: "Prénom et nom", required: true },
      { name: "role", label: "Rôle (facultatif)" },
    ], onValider: d => enregistrer("membres", id, d, "membre") });
  }
  function ouvrirIntervention(id) {
    const i = id ? data.interventions.find(x => x.id === id) : {};
    formulaire({ titre: id ? "Modifier l’intervention" : "Nouvelle intervention (JEH)", valeurs: { date: aujourdHui(), statut: "Pas payé", nb: 1, duree: i.minutesIndividuelles, ...i }, champs: [
      { name: "etudeId", label: "Étude", type: "select", required: true, options: data.etudes.map(e => [e.id, nomEtude(e)]) },
      { name: "membreId", label: "Intervenant", type: "select", required: true, options: data.membres.map(m => [m.id, m.nomComplet]) },
      { name: "date", label: "Date", type: "date", required: true },
      { name: "statut", label: "Statut", type: "select", required: true, options: STATUTS_JEH },
      { name: "duree", label: "Durée totale (minutes)", type: "number", required: true },
      { name: "nb", label: "Nombre de personnes", type: "number", required: true, aide: "Une ligne par personne : la durée est répartie (120 min à 2 = 60 min chacun). 480 min = 1 JEH." },
      { name: "prixJehHt", label: "JEH intervenant HT (€)", type: "number", aide: "Plafond HAC : 300 € HT" },
    ], onValider: d => {
      if (!(d.nb >= 1) || d.nb % 1) return "Le nombre de personnes doit être un entier d’au moins 1.";
      const { duree, nb, ...reste } = d;
      return enregistrer("interventions", id, { ...reste, minutesIndividuelles: Math.round((duree / nb) * 100) / 100 }, "interv");
    } });
  }
  function ouvrirBV() {
    formulaire({ titre: "Nouveau bulletin de versement", valeurs: { date: aujourdHui() }, champs: [
      { name: "membreId", label: "Intervenant", type: "select", required: true, options: data.membres.map(m => [m.id, m.nomComplet]) },
      { name: "date", label: "Date du BV", type: "date", required: true },
      { name: "reference", label: "Référence" },
      { name: "jeh", label: "JEH versées", type: "number", required: true, aide: "En dessous de 1 JEH, cotisations et charges sont calculées sur 1 JEH (le BV reste valide)." },
    ], onValider: async d => {
      const bvId = nouvelId("bv"), ligneId = nouvelId("ligne");
      const p1 = preparerAjout({ etat: data, collection: "bvs", donnees: { date: d.date, reference: d.reference }, creerId: () => bvId });
      const etatAvecBv = { ...data, bvs: [...data.bvs, p1.commande?.enregistrement].filter(Boolean) };
      const p2 = preparerAjout({ etat: etatAvecBv, collection: "lignesBV", donnees: { bvId, membreId: d.membreId, jeh: d.jeh }, creerId: () => ligneId });
      const pb = [p1, p2].find(x => !x.valide); if (pb) return pb.anomalies.map(a => a.raison || a).join(" · ");
      const r = await synchro.executerPlusieurs([p1.commande, p2.commande]);
      if (!r.valide) return r.anomalies.map(a => a.raison || a).join(" · ");
      data = synchro.lireEtat(); await majStatut(); return null;
    } });
  }

  function render() {
    const v = view();
    nav();
    banniere();
    const content = document.getElementById("content");
    if (!v.valide) {
      content.innerHTML = '<section class="panel"><h2>Données incohérentes</h2><p>Les indicateurs sont masqués pour éviter un résultat trompeur.</p><ul>' +
        v.anomalies.map(a => "<li>" + escapeHtml(a.raison || a) + "</li>").join("") + "</ul></section>";
      return;
    }
    content.innerHTML = ({
      Accueil: () => dashboard(v),
      Études: () => studies(v),
      Finances: () => finances(v),
      Équipe: () => team(v),
      Réglages: settings,
    })[current]();
    document.getElementById("syncNow")?.addEventListener("click", () => synchroniser());
    document.getElementById("logout")?.addEventListener("click", deconnecter);
    const search = document.getElementById("search");
    if (search) search.addEventListener("input", () => { recherche = search.value; const pos = search.selectionStart; render(); const next = document.getElementById("search"); next?.focus(); next?.setSelectionRange(pos, pos); });
    const brancher = (sel, f) => document.querySelectorAll(sel).forEach(el => el.addEventListener("click", () => f(el)));
    brancher("#addStudy", () => ouvrirEtude());
    brancher("#addClient", () => ouvrirClient());
    brancher("#addFacture", () => ouvrirFacture());
    brancher("#addMembre", () => ouvrirMembre());
    brancher("#addInterv", () => ouvrirIntervention());
    brancher("#addBV", () => ouvrirBV());
    brancher("[data-etude]", el => ouvrirEtude(el.dataset.etude));
    brancher("[data-filtre]", el => { filtreEtudes = el.dataset.filtre; render(); });
    brancher("[data-payer]", el => creerBVPour(el.dataset.payer));
    brancher("[data-client]", el => ouvrirClient(el.dataset.client));
    brancher("[data-invoice]", el => ouvrirFacture(el.dataset.invoice));
    brancher("[data-membre]", el => ouvrirMembre(el.dataset.membre));
    brancher("[data-interv]", el => ouvrirIntervention(el.dataset.interv));
  }

  // ---- Synchronisation ----
  async function majStatut() { if (synchro) etatSynchro = await synchro.statut(); }
  function banniere() {
    const el = document.getElementById("syncBanner");
    const e = { ...etatSynchro, blocage: etatSynchro.blocage?.code === "NETWORK_ERROR" ? null : etatSynchro.blocage }; // hors ligne = simple attente
    if (e.blocage?.code === "VERSION_CONFLICT") {
      el.className = "sync conflict";
      el.innerHTML = "Quelqu’un a modifié la même fiche entre-temps. Vos modifications en attente n’ont pas été envoyées. " +
        '<button class="action" id="resolve">Reprendre la version à jour</button>';
      document.getElementById("resolve").onclick = async () => {
        if (!confirm("Les modifications non envoyées seront abandonnées. Continuer ?")) return;
        await synchro.abandonnerEtRecharger(); data = synchro.lireEtat(); await majStatut(); render();
      };
    } else if (e.blocage) {
      el.className = "sync warn"; el.textContent = "Synchronisation interrompue (" + e.blocage.code + "). Réessayez avec « Synchroniser » dans Réglages.";
    } else if (e.enAttente > 0) {
      el.className = "sync warn"; el.textContent = e.enAttente + " modification(s) gardée(s) sur ce téléphone, envoi dès le retour du réseau.";
    } else if (e.source === "cache") {
      el.className = "sync warn"; el.textContent = "Hors ligne : dernière version connue affichée.";
    } else if (connexion?.essai) {
      el.className = "sync warn"; el.textContent = "Mode essai : données d’exemple, gardées sur ce téléphone uniquement. Aucune donnée réelle n’est lue ni modifiée.";
    } else { el.className = "sync hidden"; el.textContent = ""; }
  }
  async function executer(prepared) {
    if (!prepared.valide) { alert(prepared.anomalies.map(a => a.raison || a).join("\n")); return false; }
    const r = await synchro.executer(prepared.commande);
    if (!r.valide) { alert(r.anomalies.map(a => a.raison || a).join("\n")); return false; }
    data = synchro.lireEtat(); await majStatut(); return true;
  }
  async function synchroniser() {
    try { await synchro.synchroniser(); } catch (e) { /* hors ligne : on garde l'état local */ }
    data = synchro.lireEtat(); await majStatut(); render();
  }
  function deconnecter() {
    if (!confirm("Déconnecter cet appareil ? Les modifications non envoyées seront perdues.")) return;
    Object.keys(localStorage).filter(k => k.startsWith("hac.v3.")).forEach(k => localStorage.removeItem(k));
    location.reload();
  }
  async function demarrer() {
    const client = creerClientApiV3({ transport: connexion.essai ? transportEssai() : transportFetch(connexion.url), obtenirToken: () => connexion.token });
    synchro = creerSynchro({ client, stockage: stockageNavigateur(), creerOpId: () => nouvelId("op") });
    try { etatSynchro = await synchro.demarrer(); }
    catch (e) {
      if (e.code === "AUTH_INVALID" || e.code === "AUTH_REQUIRED") { localStorage.removeItem(CONN); afficherConnexion("Jeton refusé par le serveur."); return; }
      afficherConnexion("Connexion impossible : " + (e.message || e.code)); return;
    }
    data = synchro.lireEtat();
    document.getElementById("login").classList.add("hidden");
    render();
    window.addEventListener("online", synchroniser);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) synchroniser(); });
  }
  function afficherConnexion(message) {
    const box = document.getElementById("login");
    box.classList.remove("hidden");
    document.getElementById("loginMsg").textContent = message || "";
    document.getElementById("essai").onclick = () => { connexion = { essai: true, token: JETON_ESSAI }; localStorage.setItem(CONN, JSON.stringify(connexion)); demarrer(); };
    document.getElementById("loginForm").onsubmit = ev => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      const url = String(f.get("url") || "").trim(), token = String(f.get("token") || "").trim();
      if (!/^https:\/\/script\.google\.com\//.test(url)) { document.getElementById("loginMsg").textContent = "L’adresse doit commencer par https://script.google.com/"; return; }
      if (!token) return;
      connexion = { url, token };
      localStorage.setItem(CONN, JSON.stringify(connexion));
      demarrer();
    };
  }

  document.getElementById("quickAdd").addEventListener("click", () => { current = "Études"; render(); ouvrirEtude(); });
  if ((connexion?.url || connexion?.essai) && connexion?.token) demarrer(); else afficherConnexion();
})();
