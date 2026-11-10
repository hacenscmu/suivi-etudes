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
| `temps.jeh` | `jehV11` | conservé brut ; aucune conversion avant qualification explicite |
| `etudes.jeh`, `etudes.frais` | conservés | prix HT de la JEH client (CNJE 80–450 €) ; frais hors JEH |
| `factures.etude` (n°) | `etudeId` | numéro unique obligatoire, sinon blocage |
| facture sans état ou sans type | complété comme v11, **signalé** | `etatSuppose` / `typeSuppose` |
| ligne JEH sans statut | `statut: null`, **signalée** | exclue des JEH travaillées tant qu'elle n'est pas classée |
| lignes « Payé » | `bvHistorique: "non_ventile"` | aucun BV inventé |

Le champ historique `temps.jeh` n'a pas de signification confirmée dans les échanges retrouvés. Par défaut il reste dans `jehV11`, avec une question de qualification ; aucun prix intervenant n'est déduit. Pour le qualifier, ajouter explicitement `"jehTemps": "prix_intervenant_ht"` ou `"jehTemps": "nombre_jeh"` aux correspondances. Les aperçus comportant des anomalies ou des questions affichent `apercu_a_verifier`, pas `apercu_pret`.

## Fichier de correspondances (facultatif)

```json
{
  "clients": { "b+t  environnement": "cli_bt_sudouest" },
  "membres": { "Alex": "mbr_alex_martin" },
  "tempsVersMembre": { "t123": "mbr_alex_dupont" },
  "formationVersMembre": { "f_alex": "mbr_alex_dupont" },
  "nomsMembres": { "mbr_alex_dupont": "Alex Dupont" },
  "jehTemps": "prix_intervenant_ht"
}
```

Les identifiants sont **déterministes** : relancer l'aperçu sur le même export donne les mêmes identifiants.
