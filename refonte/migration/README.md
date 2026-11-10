# Migration v11 → v3 — mode aperçu

`migrer-v11.js` lit l'**export JSON** de l'app (menu « Exporter ») et produit un **aperçu** des données v3, accompagné d'un rapport. Il n'écrit rien : ni dans le Sheet, ni sur le serveur, ni dans le fichier source.

```
node refonte/migration/migrer-v11.js export.json [correspondances.json] [dossier-sortie]
```

Sortie : `apercu-v3.json` (collections v3, totaux, anomalies) et `rapport-migration.md` (à lire par Pauline).

## Règles appliquées

| Donnée v11 | Devient | Règle |
|---|---|---|
| `etudes.client` (texte) | `clients` + `clientId` | un client par nom normalisé ; regroupements soumis à Pauline |
| `temps.prenom` | `membres` + `membreId` | un membre par prénom ; homonymes à séparer avec `correspondances.json` |
| `temps.min`, `temps.nb` | `minutesIndividuelles` | `min ÷ nb` (règle v11 : 120 min à 2 = 60 min chacun) |
| `temps.jeh` | `prixJehHt` | tarif intervenant (alerte au-dessus de 300 € HT) |
| `etudes.jeh`, `etudes.frais` | conservés | prix HT de la JEH client (CNJE 80–450 €) ; frais hors JEH |
| `factures.etude` (n°) | `etudeId` | numéro unique obligatoire, sinon blocage |
| facture sans état ou sans type | complété comme v11, **signalé** | `etatSuppose` / `typeSuppose` |
| ligne JEH sans statut | `statut: null`, **signalée** | exclue des JEH travaillées tant qu'elle n'est pas classée |
| lignes « Payé » | `bvHistorique: "non_ventile"` | aucun BV inventé |

## Fichier de correspondances (facultatif)

```json
{
  "clients": { "b+t  environnement": "cli_bt_sudouest" },
  "membres": { "Alex": "mbr_alex_martin" },
  "tempsVersMembre": { "t123": "mbr_alex_dupont" }
}
```

Les identifiants sont **déterministes** : relancer l'aperçu sur le même export donne les mêmes identifiants.
