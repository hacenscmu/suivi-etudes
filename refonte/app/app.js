/* HAC — application v3 : interface branchée sur le serveur Apps Script (client v3, file hors ligne, synchronisation). */
(() => {
  "use strict";
  const { creerEtatVide, construireVueApplication, preparerAjout, preparerModification, appliquerCommande } = window.HAC;
  const { creerSynchro, creerClientApiV3, stockageNavigateur, transportFetch, creerServeurMemoireV3, calculerAlertes, analyserAlerteClient, resoudreRelation, EN_COURS, ALERTES, calculerPaie } = window.HAC;
  let filtreEtudes = "En cours";
  let etudeOuverte = null;
  let clientOuvert = null;
  const alertesParEtude = () => calculerAlertes({ etudes: donneesVues().etudes, factures: donneesVues().factures, interventions: donneesVues().interventions, config: synchro?.lireConfig() || {}, aujourdhui: aujourdHui() });
  // ---- Mode essai : un serveur v3 simulé sur ce téléphone, avec des données d'exemple. Aucune donnée réelle. ----
  const JETON_ESSAI = "essai-local-hac-v3";
  const v1 = o => Object.fromEntries(o.map(x => [x.id, { ...x, _v: 1 }]));
  const EXEMPLE = {
    clients: v1([{ id: "client_0001", raisonSociale: "Soléa Industrie", relationType: "ponctuelle" }, { id: "client_0002", raisonSociale: "Novalys", relationType: "longue_duree", cadenceFacturation: "mensuelle", dateProchaineFacture: "2026-10-10" }]),
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
  const dateFr = s => s ? String(s).split("-").reverse().join("/") : "";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // ---- Mandats : la fin d'un mandat = veille du suivant (comme en v12) ----
  let mandatSel = (() => { try { return localStorage.getItem("hac.v3.mandat") || "Tous les mandats"; } catch { return "Tous les mandats"; } })();
  const mandats = () => [...(synchro?.lireConfig()?.mandats || [])].filter(m => m && m.nom && m.debut).sort((a, b) => a.debut.localeCompare(b.debut));
  const mandatDe = date => { if (!date) return ""; let r = ""; for (const m of mandats()) if (date >= m.debut && (!m.fin || date <= m.fin)) r = m.nom; return r; };
  // Vue d'un mandat : ses études, avec leurs factures et interventions (liens toujours cohérents).
  const donneesVues = () => {
    if (mandatSel === "Tous les mandats" || !mandats().some(m => m.nom === mandatSel)) return data;
    const ids = new Set(data.etudes.filter(e => mandatDe(e.date) === mandatSel).map(e => e.id));
    return { ...data, etudes: data.etudes.filter(e => ids.has(e.id)), factures: data.factures.filter(f => ids.has(f.etudeId)), interventions: data.interventions.filter(i => ids.has(i.etudeId)) };
  };
  function selecteurMandat() {
    const el = document.getElementById("mandatSel"); if (!el) return;
    el.innerHTML = ["Tous les mandats", ...mandats().map(m => m.nom)].map(n => '<option' + (n === mandatSel ? " selected" : "") + ">" + escapeHtml(n) + "</option>").join("");
    el.onchange = () => { mandatSel = el.value; try { localStorage.setItem("hac.v3.mandat", mandatSel); } catch {} render(); };
  }
  const view = () => construireVueApplication(donneesVues(), { dateFin: aujourdHui(), nombreMois: 6, tva: synchro?.lireConfig()?.tva ?? 0.2 });

  function nav() {
    ["tabs", "mobileTabs"].forEach(id => {
      document.getElementById(id).innerHTML = pages.map((p, i) =>
        '<button data-page="' + p + '" class="' + (p === current ? "active" : "") + '">' +
        (id === "mobileTabs" ? "<b>" + icons[i] + "</b>" : "") + p + "</button>"
      ).join("");
    });
    document.querySelectorAll("[data-page]").forEach(button => {
      button.addEventListener("click", () => { current = button.dataset.page; etudeOuverte = null; render(); });
    });
  }

  function heading(title, sub, action = "") {
    return '<div class="section-head"><div><h2>' + title + '</h2><span>' + sub + "</span></div>" + action + "</div>";
  }

  // Préférences d'affichage locales : aucun champ métier ni synchronisation supplémentaire.
  const CLE_DISPOSITION_DASHBOARD = "hac.v3.dashboard.disposition";
  function lireDispositionDashboard() {
    const defaut = { ordre: ["activite", "encaissement"], visibles: { activite: true, encaissement: true } };
    try {
      const p = JSON.parse(localStorage.getItem(CLE_DISPOSITION_DASHBOARD) || "null");
      if (!p || typeof p !== "object") return defaut;
      const ordre = Array.isArray(p.ordre) ? p.ordre.filter(x => ["activite", "encaissement"].includes(x)) : [];
      return {
        ordre: [...new Set([...ordre, "activite", "encaissement"])],
        visibles: { activite: p.visibles?.activite !== false, encaissement: p.visibles?.encaissement !== false },
      };
    } catch { return defaut; }
  }

  function ouvrirDispositionDashboard() {
    const p = lireDispositionDashboard();
    formulaire({
      titre: "Personnaliser le tableau de bord",
      valeurs: {
        visibleActivite: p.visibles.activite ? "oui" : "non",
        positionActivite: String(p.ordre.indexOf("activite") + 1),
        visibleEncaissement: p.visibles.encaissement ? "oui" : "non",
        positionEncaissement: String(p.ordre.indexOf("encaissement") + 1),
      },
      champs: [
        { name: "visibleActivite", label: "Graphique des JEH travaillées", type: "select", required: true, options: [["oui", "Afficher"], ["non", "Masquer"]] },
        { name: "positionActivite", label: "Position du graphique JEH", type: "select", required: true, options: [["1", "En premier"], ["2", "En second"]] },
        { name: "visibleEncaissement", label: "Graphique des encaissements", type: "select", required: true, options: [["oui", "Afficher"], ["non", "Masquer"]] },
        { name: "positionEncaissement", label: "Position du graphique encaissement", type: "select", required: true, options: [["1", "En premier"], ["2", "En second"]] },
      ],
      onValider: d => {
        if (d.visibleActivite === "oui" && d.visibleEncaissement === "oui" && d.positionActivite === d.positionEncaissement) {
          return "Choisis deux positions différentes lorsque les deux graphiques sont affichés.";
        }
        const ordre = Number(d.positionActivite) < Number(d.positionEncaissement)
          ? ["activite", "encaissement"] : ["encaissement", "activite"];
        try {
          localStorage.setItem(CLE_DISPOSITION_DASHBOARD, JSON.stringify({
            ordre, visibles: { activite: d.visibleActivite === "oui", encaissement: d.visibleEncaissement === "oui" },
          }));
        } catch { return "Impossible d’enregistrer les préférences sur cet appareil."; }
        return null;
      },
    });
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
    const parEtude = donneesVues().etudes.map(e => ({ e, a: AL.get(e.id)?.alertes || [] })).filter(x => x.a.length);
    const alertsEtudes = parEtude.map(({ e, a }) => '<button type="button" class="alert invoice-button" data-etude="' + e.id + '"><div class="alert-icon">' + a.length + '</div><div><strong>' +
      escapeHtml(nomEtude(e)) + "</strong><small>" + a.map(x => escapeHtml(x.texte)).join(" · ") + "</small></div></button>").join("");
    const etudesPourAlertes = donneesVues().etudes;
    const clientsAyantEtude = new Set(data.etudes.map(e => e.clientId));
    const alertesEtudesClients = etudesPourAlertes.flatMap(etude => {
      const client = data.clients.find(c => c.id === etude.clientId);
      if (!client) return [];
      const r = analyserAlerteClient(client, etude);
      if (r.anomalie) return [{ client, etude, texte: "Renseigner la date de référence de facturation" }];
      if (r.alerteActivable && r.prochaineEcheance <= aujourdHui()) {
        return [{ client, etude, texte: "Facture périodique à émettre · échéance du " + dateFr(r.prochaineEcheance) }];
      }
      return [];
    });
    const alertesClientsSansEtude = data.clients.filter(client => !clientsAyantEtude.has(client.id)).flatMap(client => {
      const r = analyserAlerteClient(client);
      if (r.anomalie) return [{ client, etude: null, texte: "Renseigner la date de référence de facturation" }];
      if (r.alerteActivable && r.prochaineEcheance <= aujourdHui()) {
        return [{ client, etude: null, texte: "Facture périodique à émettre · échéance du " + dateFr(r.prochaineEcheance) }];
      }
      return [];
    });
    const alertesClients = [...alertesEtudesClients, ...alertesClientsSansEtude];
    const alertsClients = alertesClients.map(({ client, etude, texte }) => {
      const cible = etude ? 'data-etude="' + etude.id + '"' : 'data-client="' + client.id + '"';
      const detail = etude ? escapeHtml(nomEtude(etude)) + " · " : "";
      return '<button type="button" class="alert invoice-button" ' + cible + '><div class="alert-icon">!</div><div><strong>' +
        escapeHtml(client.raisonSociale || "Client") + "</strong><small>" + detail + escapeHtml(texte) + "</small></div></button>";
    }).join("");
    const alerts = alertsEtudes + alertsClients;
    const panneaux = {
      activite: '<section class="panel"><h3>Activité des étudiants</h3><div class="sub">Durées individuelles converties en JEH</div><div class="bars">' +
        mois.map((m, i) => '<div class="barcol"><b>' + m.jeh.toLocaleString("fr-FR") + '</b><div class="bar ' + (i === mois.length - 1 ? "hot" : "") +
          '" style="height:' + (m.jeh / max * 100) + '%"></div><small>' + escapeHtml(m.mois.slice(5)) + "</small></div>").join("") +
        "</div></section>",
      encaissement: '<section class="panel"><h3>Encaissement</h3><div class="sub">Part du CA signé déjà encaissée</div><div class="ring-wrap"><div class="ring" style="background:conic-gradient(var(--pink) 0 ' +
        percent + '%,#f4eaf0 ' + percent + '% 100%)"></div><div class="ring-info"><strong>' + money(d.encaisse) + '</strong><small>sur ' + money(d.caSigne) +
        ' HT signés</small></div></div><div class="sub">' + money(d.resteAEncaisser) + " HT restent à encaisser</div></section>",
    };
    const disposition = lireDispositionDashboard();
    const graphiques = disposition.ordre.filter(id => disposition.visibles[id]).map(id => panneaux[id]);
    const zoneGraphiques = graphiques.length
      ? '<div class="grid' + (graphiques.length === 1 ? ' one' : '') + '">' + graphiques.join("") + "</div>"
      : '<section class="panel"><div class="empty">Tous les graphiques sont masqués. Utilise « Personnaliser » pour en réafficher.</div></section>';
    return '<div class="stats">' +
      '<div class="stat"><div class="label">JEH travaillées · étudiants</div><strong>' + (d.totalJehTravaillees ?? "—").toLocaleString?.("fr-FR") + '</strong><small>Interventions réalisées uniquement</small></div>' +
      '<div class="stat"><div class="label">Chiffre d’affaires signé HT</div><strong>' + money(d.caSigne) + '</strong><small>' + d.nombreEtudes + " études suivies</small></div>" +
      '<div class="stat"><div class="label">Déjà encaissé HT</div><strong>' + money(d.encaisse) + '</strong><small>' + percent + " % du CA signé</small></div>" +
      '<div class="stat"><div class="label">Reste à encaisser HT</div><strong>' + money(d.resteAEncaisser) + '</strong><small>' + facturesOuvertes.length + " facture(s) non payée(s)</small></div>" +
      "</div>" + heading("Activité", "JEH réellement travaillées · 6 derniers mois", '<button class="ghost action" id="dashboardLayout">Personnaliser</button>') +
      zoneGraphiques +
      heading("Alertes à traiter", (parEtude.length + alertesClients.length) + " élément(s) concerné(s)") +
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
      '<section class="listbox rows">' + (rows.map(s => {
        const relation = resoudreRelation(data.clients.find(c => c.id === s.clientId), s);
        const relationLabel = relation.anomalie ? "Relation à vérifier" : relation.type === "longue_duree" ? "Longue durée" : "Ponctuelle";
        const relationInfo = relationLabel + (relation.cadenceFacturation ? " · " + relation.cadenceFacturation : "");
        return '<button type="button" class="item invoice-button" data-etude="' + s.id + '"><div class="item-main"><strong>' + escapeHtml(s.num) + " · " + escapeHtml(s.clientLibelle) +
          '</strong><small>' + escapeHtml(relationInfo) + " · " + escapeHtml(AL.get(s.id)?.facture || "—") + (AL.get(s.id)?.alertes.length ? ' · <span class="accent">⚠ ' + escapeHtml(AL.get(s.id).alertes[0].texte) + (AL.get(s.id).alertes.length > 1 ? " (+" + (AL.get(s.id).alertes.length - 1) + ")" : "") + "</span>" : "") + '</small></div><span class="pill ' +
          (s.statut === "Archivée" ? "green" : s.statut === "Devis envoyé" ? "pink" : "") + '">' + escapeHtml(s.statut) +
          '</span><div class="amount">' + money(s.montant / 1.2) + " HT</div></button>";
      }).join("") || '<div class="empty">Aucune étude. Commencez par « ＋ Client » puis « ＋ Étude ».</div>') + "</section>" +
      heading("Clients", data.clients.length + " clients") + '<section class="listbox rows">' + data.clients.map(c => {
        const alerte = analyserAlerteClient(c);
        const cadence = c.cadenceFacturation ? " · " + ({ mensuelle: "mensuelle", trimestrielle: "trimestrielle", semestrielle: "semestrielle", annuelle: "annuelle" }[c.cadenceFacturation] || "cadence inconnue") : "";
        const prochaine = alerte.prochaineEcheance ? " · prochaine échéance " + dateFr(alerte.prochaineEcheance) : alerte.anomalie ? " · date de référence à renseigner" : "";
        return '<button type="button" class="item invoice-button" data-client="' + c.id + '"><div class="item-main"><strong>' + escapeHtml(c.raisonSociale) + '</strong><small>' +
          (c.relationType === "longue_duree" ? "Relation longue durée" + cadence + prochaine : "Mission ponctuelle") + " · " + data.etudes.filter(e => e.clientId === c.id).length + " étude(s)</small></div></button>";
      }).join("") + "</section>";
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
      paieHtml() + formationHtml() +
      heading("Bulletins de versement", data.bvs.length + " BV", '<button class="action" id="addBV">＋ BV</button>') +
      '<section class="listbox rows">' + (data.lignesBV.map(l => {
        const bv = data.bvs.find(b => b.id === l.bvId), jeh = Number(l.jeh) || 0;
        return '<div class="item"><div class="item-main"><strong>' + escapeHtml(nomMembre(l.membreId)) + " · " + escapeHtml(bv?.reference || bv?.date || "") + '</strong><small>' + escapeHtml(bv?.date || "") +
          (jeh > 0 && jeh < 1 ? " · cotisations calculées sur 1 JEH" : "") + '</small></div><div class="amount">' + jeh.toLocaleString("fr-FR") + " JEH</div></div>";
      }).join("") || '<div class="empty">Aucun BV.</div>') + "</section>";
  }

  // ---------- Rapport d'étude ----------
  function rapport(id) {
    const e = data.etudes.find(x => x.id === id);
    if (!e) { etudeOuverte = null; return studies(view()); }
    const relation = resoudreRelation(data.clients.find(c => c.id === e.clientId), e);
    const relationLabel = relation.type === "longue_duree" ? "Longue durée" : relation.type === "ponctuelle" ? "Ponctuelle" : "À vérifier";
    const cadenceLabel = relation.anomalie ? "à vérifier" : relation.cadenceFacturation || "sans périodicité";
    const A = alertesParEtude().get(id) || calculerAlertes({ etudes: [e], factures: data.factures, interventions: data.interventions, config: synchro?.lireConfig() || {}, aujourdhui: aujourdHui() }).get(id);
    const tva = synchro?.lireConfig()?.tva ?? 0.2, inv = data.factures.filter(f => f.etudeId === id), ls = data.interventions.filter(i => i.etudeId === id);
    const f3 = n => (Math.round(Number(n || 0) * 1000) / 1000).toLocaleString("fr-FR");
    const per = {}; ls.forEach(i => { const p = per[i.membreId] || (per[i.membreId] = { jeh: 0, brut: 0, aPayer: false }); if (i.statut === "Payé" || i.statut === "Pas payé") { const j = Number(i.minutesIndividuelles || 0) / 480; p.jeh += j; p.brut += j * Number(i.prixJehHt || 0); } if (i.statut === "Pas payé") p.aPayer = true; });
    const nomM = mid => data.membres.find(m => m.id === mid)?.nomComplet || "?";
    const niveaux = data.membres.map(m => [m, (data.formation || []).find(f => f.membreId === m.id)?.niveaux?.[id]]).filter(x => Number.isInteger(x[1]));
    const tuile = (l, v) => '<div class="stat"><div class="label">' + l + "</div><strong>" + v + "</strong></div>";
    return '<button class="ghost action" id="retourEtudes">‹ Études</button>' +
      heading(escapeHtml(nomEtude(e)), escapeHtml(e.statut || "") + " · " + escapeHtml(A.facture || "—") + (mandatDe(e.date) ? " · " + escapeHtml(mandatDe(e.date)) : ""), '<button class="action" data-modifier-etude="' + id + '">Modifier</button>') +
      (e.resume ? '<p class="sub">' + escapeHtml(e.resume) + "</p>" : "") +
      '<p class="sub">Collaboration : ' + relationLabel + " · Facturation : " + cadenceLabel + "</p>" +
      (A.alertes.length ? '<section class="panel">' + A.alertes.map(a => '<div class="alert"><div class="alert-icon">!</div><div><strong>' + escapeHtml(a.texte) + "</strong></div></div>").join("") + "</section>" : "") +
      heading("Finances", "") + '<div class="stats">' + tuile("Montant TTC", money(e.montant)) + tuile("Encaissé TTC", money(A.encaisse)) + tuile("Reste à encaisser", A.reste === null ? "—" : money(A.reste)) + tuile("Prochaine échéance", A.echeance || "—") + "</div>" +
      '<p class="sub">' + money(Number(e.montant || 0) / (1 + tva)) + " HT · JEH client " + (e.jeh ? money(e.jeh) : "—") + (e.frais ? " · frais " + money(e.frais) + " HT" : "") + "</p>" +
      heading("Factures", inv.length + " facture(s)", '<button class="action" data-facture-pour="' + id + '">＋ Facture</button>') +
      '<section class="listbox rows">' + (inv.map(f => '<button type="button" class="item invoice-button" data-invoice="' + f.id + '"><div class="item-main"><strong>' + escapeHtml(f.type || "Facture") + "</strong><small>" + escapeHtml(f.date || "") + (f.echeance ? " · échéance " + escapeHtml(f.echeance) : "") + '</small></div><span class="pill ' + (f.etat === "Payée" ? "green" : "pink") + '">' + escapeHtml(f.etat) + '</span><div class="amount">' + money(f.montant) + " TTC</div></button>").join("") || '<div class="empty">Aucune facture.</div>') + "</section>" +
      heading("JEH", "Facturées " + f3(A.jehFacturees) + " · rémunérées " + f3(A.jehRemunerees), '<button class="action" data-interv-pour="' + id + '">＋ Intervention</button>') +
      '<section class="listbox rows">' + (Object.entries(per).map(([mid, p]) => '<div class="item"><div class="item-main"><strong>' + escapeHtml(nomM(mid)) + " · " + f3(p.jeh) + " JEH</strong><small>" + money(p.brut) + ' brut</small></div><span class="pill ' + (p.aPayer ? "pink" : "green") + '">' + (p.aPayer ? "À payer" : "Payé") + "</span></div>").join("") || '<div class="empty">Aucune intervention.</div>') + "</section>" +
      (ls.length ? '<details class="sub" style="margin-top:8px"><summary>Voir les ' + ls.length + " lignes</summary>" + ls.map(i => '<button type="button" class="item invoice-button" data-interv="' + i.id + '"><div class="item-main"><strong>' + escapeHtml(nomM(i.membreId)) + "</strong><small>" + escapeHtml(i.date || "") + " · " + escapeHtml(i.statut || "") + '</small></div><div class="amount">' + f3(Number(i.minutesIndividuelles || 0) / 480) + " JEH</div></button>").join("") + "</details>" : "") +
      (niveaux.length ? heading("Formation sur cette étude", "") + '<p class="sub">' + niveaux.map(([m, n]) => escapeHtml(m.nomComplet) + " · niveau " + n).join(" · ") + "</p>" : "");
  }

  // ---------- Qualité formation : niveau 0 à 4 par membre et par étude ----------
  const NIVEAUX = ["0 · Non formé", "1 · Notions", "2 · Autonome avec appui", "3 · Autonome", "4 · Référent (peut former)"];
  function formationHtml() {
    const ouvertes = data.etudes.filter(e => e.statut !== "Archivée" && e.statut !== "Refusé / sans suite"), fermees = data.etudes.filter(e => !ouvertes.includes(e));
    const cols = ouvertes.concat(fermees);
    if (!data.membres.length || !cols.length) return "";
    const niv = (mid, eid) => (data.formation || []).find(f => f.membreId === mid)?.niveaux?.[eid];
    return heading("Qualité formation", "Niveau de 0 à 4 par intervenant et par étude") + '<div class="listbox" style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;padding:8px">Intervenant</th>' +
      cols.map(e => '<th style="padding:6px;' + (fermees.includes(e) ? "opacity:.6" : "") + '">' + escapeHtml(e.num || "?") + "</th>").join("") + "</tr></thead><tbody>" +
      data.membres.map(m => "<tr><td style=\"padding:6px 8px;white-space:nowrap\"><b>" + escapeHtml(m.nomComplet) + "</b></td>" + cols.map(e => { const v = niv(m.id, e.id); return '<td><select data-niveau="' + m.id + "|" + e.id + '" aria-label="Niveau"><option value=""></option>' + [0, 1, 2, 3, 4].map(k => "<option" + (v === k ? " selected" : "") + ">" + k + "</option>").join("") + "</select></td>"; }).join("") + "</tr>").join("") +
      '</tbody></table></div><details class="sub"><summary>Échelle</summary>' + NIVEAUX.join(" · ") + "</details>";
  }
  async function changerNiveau(mid, eid, valeur) {
    const existant = (data.formation || []).find(f => f.membreId === mid);
    const niveaux = { ...(existant?.niveaux || {}) };
    if (valeur === "") delete niveaux[eid]; else niveaux[eid] = Number(valeur);
    const cmd = existant ? { type: "modifier", collection: "formation", id: existant.id, modifications: { niveaux } }
      : (() => { const id = nouvelId("formation"); return { type: "ajouter", collection: "formation", id, enregistrement: { id, membreId: mid, nom: data.membres.find(m => m.id === mid)?.nomComplet || "", niveaux } }; })();
    if (!Array.isArray(data.formation)) data = { ...data, formation: [] };
    const r = await synchro.executerPlusieurs([cmd]);
    if (!r.valide) { alert(r.anomalies.map(a => a.raison || a).join("\n")); return; }
    data = synchro.lireEtat(); await majStatut(); render();
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
    const e = etatSynchro, c = synchro?.lireConfig() || {};
    const ligne = (titre, detail, bouton) => '<div class="item"><div class="item-main"><strong>' + titre + "</strong><small>" + detail + "</small></div>" + (bouton || "") + "</div>";
    const btn = (id, txt) => '<button class="ghost action" data-reglage="' + id + '">' + txt + "</button>";
    const pc = x => (Math.round(Number(x || 0) * 10000) / 100).toLocaleString("fr-FR") + " %";
    const tot = o => Object.values(o || {}).reduce((s, v) => s + Number(v || 0), 0);
    const off = c.alertesOff || {};
    return heading("Réglages", "Paramètres partagés par toute l’équipe") +
      '<section class="listbox rows">' +
      ligne("Mandats", mandats().map(m => escapeHtml(m.nom) + " (dès le " + escapeHtml(m.debut) + ")").join(" · ") || "Aucun mandat", btn("mandat", "＋ Mandat")) +
      ligne("TVA et relances", "TVA " + pc(c.tva ?? 0.2) + " · 1re relance à " + (c.relance1 ?? 3) + " j · 2e relance après " + (c.relance2 ?? 10) + " j", btn("tva", "Modifier")) +
      ligne("Règles CNJE", c.cnje?.date ? "Depuis le " + escapeHtml(c.cnje.date) + " · JEH client " + (c.cnje.min ?? 80) + "–" + (c.cnje.max ?? 450) + " € · intervenant ≤ " + (c.cnje.maxInt ?? 300) + " €" : "Aucune règle appliquée", btn("cnje", "Modifier")) +
      ligne("Cotisations", "SMIC " + (c.smic ?? 12.31) + " € · salariales " + pc(c.cot ? tot(c.cot) : 0.183) + " · patronales " + pc(c.patr ? tot(c.patr) : 0.3014) + " · chômage " + pc(c.chomage ?? 0), btn("cot", "Modifier")) +
      ligne("Alertes", c.alertesOn === false ? "Toutes désactivées" : (ALERTES.length - ALERTES.filter(a => off[a[0]]).length) + " activées sur " + ALERTES.length, btn("alertes", "Choisir")) +
      "</section>" + heading("Synchronisation", "Cet appareil") + '<section class="listbox rows">' +
      ligne("Serveur", escapeHtml(connexion?.essai ? "Mode essai (serveur simulé sur ce téléphone)" : connexion?.url ? "Connecté" : "Non connecté")) +
      ligne("Données affichées", e.source === "serveur" ? "À jour avec le serveur" : e.source === "cache" ? "Dernière version gardée sur cet appareil (hors ligne)" : "Aucune") +
      ligne("Modifications en attente d’envoi", String(e.enAttente), '<button class="ghost action" id="syncNow">Synchroniser</button>') +
      ligne("Exporter", "Télécharger une sauvegarde complète (.json)", '<button class="ghost action" id="exportJson">Exporter</button>') +
      ligne("Se déconnecter de cet appareil", "Efface l’adresse, le jeton et les données gardées sur ce téléphone", '<button class="ghost action" id="logout">Déconnexion</button>') +
      "</section>";
  }
  async function sauverConfig(modifs) {
    const r = await synchro.enregistrerConfig({ ...(synchro.lireConfig() || {}), ...modifs });
    if (!r.valide) return r.anomalies.join(" · ");
    await majStatut(); return null;
  }
  const pourcent = x => Math.round(Number(x || 0) * 10000) / 100;
  const versTaux = x => (x === null || x === "" ? 0 : Number(x) / 100);
  function ouvrirReglage(cle) {
    const c = synchro.lireConfig() || {};
    if (cle === "mandat") return formulaire({ titre: "Nouveau mandat", valeurs: {}, champs: [
      { name: "nom", label: "Nom (ex. 2026-2027)", required: true },
      { name: "debut", label: "Date de début", type: "date", required: true, aide: "La fin est la veille du mandat suivant." },
    ], onValider: d => mandats().some(m => m.nom === d.nom) ? "Ce mandat existe déjà." : sauverConfig({ mandats: [...mandats(), { nom: d.nom, debut: d.debut }] }) });
    if (cle === "tva") return formulaire({ titre: "TVA et relances", valeurs: { tva: pourcent(c.tva ?? 0.2), relance1: c.relance1 ?? 3, relance2: c.relance2 ?? 10 }, champs: [
      { name: "tva", label: "TVA (%)", type: "number", required: true },
      { name: "relance1", label: "1re relance (jours après l’échéance)", type: "number", required: true },
      { name: "relance2", label: "2e relance (au-delà de … jours)", type: "number", required: true },
    ], onValider: d => sauverConfig({ tva: versTaux(d.tva), relance1: Math.round(d.relance1), relance2: Math.round(d.relance2) }) });
    if (cle === "cnje") return formulaire({ titre: "Règles CNJE", valeurs: { date: c.cnje?.date || "", min: c.cnje?.min ?? 80, max: c.cnje?.max ?? 450, maxInt: c.cnje?.maxInt ?? 300 }, champs: [
      { name: "date", label: "Appliquer aux études créées depuis le", type: "date", aide: "Vide = aucune alerte CNJE." },
      { name: "min", label: "JEH client minimum HT (€)", type: "number", required: true },
      { name: "max", label: "JEH client maximum HT (€)", type: "number", required: true },
      { name: "maxInt", label: "JEH intervenant maximum HT (€)", type: "number", required: true },
    ], onValider: d => sauverConfig({ cnje: { date: d.date, min: d.min, max: d.max, maxInt: d.maxInt } }) });
    if (cle === "cot") {
      const cot = c.cot || { maladie: 0.013, retraiteP: 0.069, retraiteD: 0.004, csgD: 0.068, csgND: 0.029 };
      const patr = c.patr || { maladie: 0.13, at: 0.0123, retraiteP: 0.0855, retraiteD: 0.0211, famille: 0.0525, autres: 0 };
      const champs = [{ name: "smic", label: "SMIC horaire brut (€) · 12,31 € depuis le 01/06/2026", type: "number", required: true }, { name: "chomage", label: "Chômage (%)", type: "number" }]
        .concat(Object.keys(cot).map(k => ({ name: "cot_" + k, label: "Salariale · " + k + " (%)", type: "number" })))
        .concat(Object.keys(patr).map(k => ({ name: "patr_" + k, label: "Patronale · " + k + " (%)", type: "number" })));
      const valeurs = { smic: c.smic ?? 12.31, chomage: pourcent(c.chomage ?? 0) };
      Object.keys(cot).forEach(k => { valeurs["cot_" + k] = pourcent(cot[k]); }); Object.keys(patr).forEach(k => { valeurs["patr_" + k] = pourcent(patr[k]); });
      return formulaire({ titre: "Cotisations", valeurs, champs, onValider: d => {
        const nc = {}, np = {}; Object.keys(cot).forEach(k => { nc[k] = versTaux(d["cot_" + k]); }); Object.keys(patr).forEach(k => { np[k] = versTaux(d["patr_" + k]); });
        return sauverConfig({ smic: d.smic, chomage: versTaux(d.chomage), cot: nc, patr: np });
      } });
    }
    if (cle === "alertes") {
      const off = c.alertesOff || {};
      return formulaire({ titre: "Alertes affichées", valeurs: { tout: c.alertesOn === false ? "non" : "oui", ...Object.fromEntries(ALERTES.map(a => [a[0], off[a[0]] ? "non" : "oui"])) }, champs: [
        { name: "tout", label: "Toutes les alertes", type: "select", required: true, options: [["oui", "Activées"], ["non", "Désactivées"]] },
        ...ALERTES.map(a => ({ name: a[0], label: a[1], type: "select", required: true, options: [["oui", "Oui"], ["non", "Non"]], aide: a[2] })),
      ], onValider: d => sauverConfig({ alertesOn: d.tout === "oui", alertesOff: Object.fromEntries(ALERTES.filter(a => d[a[0]] === "non").map(a => [a[0], true])) }) });
    }
  }
  function exporter() {
    const blob = new Blob([JSON.stringify({ format: "hac-v3", exporteLe: new Date().toISOString(), config: synchro.lireConfig(), donnees: data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "hac-sauvegarde-" + aujourdHui() + ".json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
    const e = (id ? data.etudes.find(x => x.id === id) : null) || {};
    const modeCadence = e.cadenceFacturationMode ?? (Object.prototype.hasOwnProperty.call(e, "cadenceFacturation") ? (e.cadenceFacturation ? "personnalisee" : "aucune") : "client");
    formulaire({ titre: id ? "Modifier l’étude" : "Nouvelle étude", valeurs: {
      ...e, relationType: e.relationType ?? "__client__", cadenceFacturationMode: modeCadence,
      cadenceFacturation: e.cadenceFacturation || "", dateProchaineFacture: e.dateProchaineFacture || "",
      date: e.date || aujourdHui(), statut: e.statut || "Faisabilité",
    }, champs: [
      { name: "clientId", label: "Client", type: "select", required: true, options: data.clients.map(c => [c.id, c.raisonSociale]), aide: data.clients.length ? "" : "Créez d’abord un client (bouton « ＋ Client »)." },
      { name: "num", label: "N° d’étude", required: true },
      { name: "resume", label: "Résumé" },
      { name: "relationType", label: "Relation pour cette étude", type: "select", required: true, options: [["__client__", "Hériter du client"], ["ponctuelle", "Ponctuelle"], ["longue_duree", "Longue durée"]], aide: "Permet de déroger au type de collaboration du client." },
      { name: "cadenceFacturationMode", label: "Facturation périodique", type: "select", required: true, options: [["client", "Hériter du client"], ["aucune", "Aucune facturation périodique"], ["personnalisee", "Cadence propre à l’étude"]], aide: "La cadence client peut être conservée, désactivée ou remplacée pour cette étude." },
      { name: "cadenceFacturation", label: "Cadence spécifique", type: "select", options: [["mensuelle", "Mensuelle"], ["trimestrielle", "Trimestrielle"], ["semestrielle", "Semestrielle"], ["annuelle", "Annuelle"]], aide: "Utilisée uniquement si « Cadence propre à l’étude » est sélectionné." },
      { name: "dateProchaineFacture", label: "Date de référence (facultative)", type: "date", aide: "Laisser vide pour reprendre la date de référence du client." },
      { name: "statut", label: "Statut", type: "select", required: true, options: synchro?.lireConfig()?.statuts || STATUTS_ETUDE },
      { name: "montant", label: "Montant TTC (€)", type: "number" },
      { name: "jeh", label: "Prix de la JEH client HT (€)", type: "number", aide: "Fourchette CNJE : 80 à 450 € HT" },
      { name: "frais", label: "Dont frais HT (labo…, hors JEH)", type: "number" },
      { name: "date", label: "Date de création", type: "date", required: true },
    ], onValider: d => {
      if (!["__client__", "ponctuelle", "longue_duree"].includes(d.relationType)) return "Choisis le type de relation de l’étude.";
      if (!["client", "aucune", "personnalisee"].includes(d.cadenceFacturationMode)) return "Choisis le mode de facturation périodique.";
      d.relationType = d.relationType === "__client__" ? null : d.relationType;
      if (d.cadenceFacturationMode === "personnalisee" && !d.cadenceFacturation) return "Choisis une cadence spécifique.";
      if (d.cadenceFacturationMode !== "personnalisee") d.cadenceFacturation = null;
      d.dateProchaineFacture = d.dateProchaineFacture || null;
      d.client = data.clients.find(c => c.id === d.clientId)?.raisonSociale || "";
      return enregistrer("etudes", id, d, "etude");
    } });
  }
  function ficheClient(id) {
    const c = data.clients.find(x => x.id === id);
    if (!c) { clientOuvert = null; return studies(view()); }
    const etudes = data.etudes.filter(e => e.clientId === id);
    const ids = new Set(etudes.map(e => e.id));
    const factures = data.factures.filter(f => ids.has(f.etudeId));
    const totalFacture = factures.reduce((n, f) => n + Number(f.montant || 0), 0);
    const encaisse = factures.filter(f => f.etat === "Payée").reduce((n, f) => n + Number(f.montant || 0), 0);
    const relation = c.relationType === "longue_duree" ? "Longue durée" : "Ponctuelle";
    const cadence = c.cadenceFacturation ? ({ mensuelle: "Mensuelle", trimestrielle: "Trimestrielle", semestrielle: "Semestrielle", annuelle: "Annuelle" }[c.cadenceFacturation] || c.cadenceFacturation) : "Aucune périodicité définie";
    const prochaine = analyserAlerteClient(c);
    const tuile = (label, valeur) => '<div class="stat"><div class="label">' + label + '</div><strong>' + valeur + "</strong></div>";
    return '<button class="ghost action" id="retourClients">‹ Clients</button>' +
      heading(escapeHtml(c.raisonSociale), relation, '<button class="action" data-modifier-client="' + id + '">Modifier la fiche</button>') +
      '<section class="panel"><h3>Informations client</h3><div class="client-details">' +
      (c.contact ? '<div><small>Contact</small><strong>' + escapeHtml(c.contact) + "</strong></div>" : "") +
      (c.email ? '<div><small>E-mail</small><strong><a href="mailto:' + escapeHtml(c.email) + '">' + escapeHtml(c.email) + "</a></strong></div>" : "") +
      (c.telephone ? '<div><small>Téléphone</small><strong><a href="tel:' + escapeHtml(c.telephone) + '">' + escapeHtml(c.telephone) + "</a></strong></div>" : "") +
      (c.adresse ? '<div><small>Adresse</small><strong>' + escapeHtml(c.adresse) + "</strong></div>" : "") +
      (c.siret ? '<div><small>SIRET</small><strong>' + escapeHtml(c.siret) + "</strong></div>" : "") +
      (c.notes ? '<div class="client-notes"><small>Notes</small><p>' + escapeHtml(c.notes) + "</p></div>" : "") +
      (!c.contact && !c.email && !c.telephone && !c.adresse && !c.siret && !c.notes ? '<p class="sub">Les coordonnées et notes pourront être ajoutées en modifiant cette fiche.</p>' : "") +
      "</div></section>" +
      heading("Relation commerciale", "Paramètres de collaboration et de facturation") +
      '<section class="panel"><div class="client-details"><div><small>Type de relation</small><strong>' + relation + "</strong></div><div><small>Facturation périodique</small><strong>" + cadence + "</strong></div>" +
      (c.dateProchaineFacture ? '<div><small>Date de référence</small><strong>' + dateFr(c.dateProchaineFacture) + "</strong></div>" : "") +
      (prochaine.prochaineEcheance ? '<div><small>Prochaine échéance calculée</small><strong>' + dateFr(prochaine.prochaineEcheance) + "</strong></div>" : "") +
      "</div>" + (prochaine.anomalie ? '<p class="sub accent">Date de référence de facturation à vérifier.</p>' : "") + "</section>" +
      heading("Activité", etudes.length + " étude(s)") +
      '<div class="stats">' + tuile("Études", etudes.length) + tuile("Factures", factures.length) + tuile("Facturé TTC", money(totalFacture)) + tuile("Encaissé TTC", money(encaisse)) + "</div>" +
      heading("Études associées", "Touchez une étude pour ouvrir son suivi") +
      '<section class="listbox rows">' + (etudes.map(e => '<button type="button" class="item invoice-button" data-etude="' + e.id + '"><div class="item-main"><strong>' + escapeHtml(e.num || "Étude") + '</strong><small>' + escapeHtml(e.statut || "") + " · " + dateFr(e.date) + '</small></div><div class="amount">' + money(e.montant) + " TTC</div></button>").join("") || '<div class="empty">Aucune étude associée.</div>') + "</section>" +
      heading("Factures", factures.length + " facture(s)") +
      '<section class="listbox rows">' + (factures.map(f => '<button type="button" class="item invoice-button" data-invoice="' + f.id + '"><div class="item-main"><strong>' + escapeHtml(f.type || "Facture") + '</strong><small>' + dateFr(f.date) + (f.echeance ? " · échéance " + dateFr(f.echeance) : "") + '</small></div><span class="pill ' + (f.etat === "Payée" ? "green" : "pink") + '">' + escapeHtml(f.etat || "État à renseigner") + '</span><div class="amount">' + money(f.montant) + " TTC</div></button>").join("") || '<div class="empty">Aucune facture associée.</div>') + "</section>";
  }

  function ouvrirClient(id) {
    const c = id ? data.clients.find(x => x.id === id) : {};
    formulaire({ titre: id ? "Modifier le client" : "Nouveau client", valeurs: { relationType: "ponctuelle", cadenceFacturation: "", dateProchaineFacture: "", ...c }, champs: [
      { name: "raisonSociale", label: "Raison sociale / nom du client", required: true },
      { name: "contact", label: "Nom du contact" },
      { name: "email", label: "E-mail", type: "email" },
      { name: "telephone", label: "Téléphone", type: "tel" },
      { name: "adresse", label: "Adresse" },
      { name: "siret", label: "SIRET" },
      { name: "notes", label: "Notes internes" },
      { name: "relationType", label: "Type de collaboration", type: "select", required: true, options: [["ponctuelle", "Ponctuelle (mission délimitée)"], ["longue_duree", "Longue durée (relation durable, type CDI)"]] },
      { name: "cadenceFacturation", label: "Cadence de facturation", type: "select", options: [["mensuelle", "Mensuelle"], ["trimestrielle", "Trimestrielle"], ["semestrielle", "Semestrielle"], ["annuelle", "Annuelle"]], aide: "Facultative : renseignez-la uniquement si une facture périodique est prévue." },
      { name: "dateProchaineFacture", label: "Date de référence de facturation", type: "date", aide: "Date de la dernière facture ou du dernier jalon ; la prochaine échéance est calculée avec la cadence." },
    ], onValider: d => {
      if (d.relationType !== "longue_duree") { d.cadenceFacturation = null; d.dateProchaineFacture = null; }
      else { d.cadenceFacturation = d.cadenceFacturation || null; d.dateProchaineFacture = d.dateProchaineFacture || null; }
      return enregistrer("clients", id, d, "client");
    } });
  }
  function ouvrirFacture(id, preset = {}) {
    const f = id ? data.factures.find(x => x.id === id) : preset;
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
  function ouvrirIntervention(id, preset = {}) {
    const i = id ? data.interventions.find(x => x.id === id) : preset;
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
    selecteurMandat();
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
      Études: () => (clientOuvert ? ficheClient(clientOuvert) : etudeOuverte ? rapport(etudeOuverte) : studies(v)),
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
    brancher("[data-etude]", el => { clientOuvert = null; etudeOuverte = el.dataset.etude; current = "Études"; render(); window.scrollTo(0, 0); });
    brancher("#retourEtudes", () => { etudeOuverte = null; clientOuvert = null; render(); });
    brancher("#retourClients", () => { clientOuvert = null; render(); });
    brancher("[data-modifier-client]", el => ouvrirClient(el.dataset.modifierClient));
    brancher("[data-modifier-etude]", el => ouvrirEtude(el.dataset.modifierEtude));
    brancher("[data-facture-pour]", el => ouvrirFacture(null, { etudeId: el.dataset.facturePour }));
    brancher("[data-interv-pour]", el => ouvrirIntervention(null, { etudeId: el.dataset.intervPour }));
    document.querySelectorAll("[data-niveau]").forEach(el => el.addEventListener("change", () => { const [m, e] = el.dataset.niveau.split("|"); changerNiveau(m, e, el.value); }));
    brancher("[data-filtre]", el => { filtreEtudes = el.dataset.filtre; render(); });
    brancher("[data-payer]", el => creerBVPour(el.dataset.payer));
    brancher("[data-reglage]", el => ouvrirReglage(el.dataset.reglage));
    brancher("#dashboardLayout", () => ouvrirDispositionDashboard());
    brancher("#exportJson", () => exporter());
    brancher("[data-client]", el => { clientOuvert = el.dataset.client; etudeOuverte = null; current = "Études"; render(); window.scrollTo(0, 0); });
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
