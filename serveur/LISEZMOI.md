# Installer le serveur sécurisé (Code.gs) — à faire avec la mise en ligne de l'appli v17

Les données ne bougent pas : même Google Sheet, même feuille « Données ».
Faites ces étapes **sur ordinateur**, le même jour que la fusion de l'appli v17.

1. **Sauvegarde** : dans l'appli, Paramètres → Exporter mes données (fichier .json). Gardez-le.
2. **Ouvrir le script** : script.google.com → votre projet « Suivi des études ».
3. **Garder l'ancienne version** : copiez tout le contenu actuel de `Code.gs` dans un fichier texte (retour arrière possible).
4. **Remplacer** : effacez tout `Code.gs`, collez le contenu de `serveur/Code.gs`, puis Enregistrer (icône disquette).
5. **Votre code administrateur (une seule fois)** : si vous avez déjà un code, il devient administrateur automatiquement. Sinon : choisissez la fonction `creerMonCode`, cliquez sur **Exécuter** et copiez le code affiché dans le **Journal d'exécution**.
   Les codes des autres membres se gèrent ensuite **dans l'appli** : Paramètres → Membres et codes d'accès.
6. **Déployer** : Déployer → Gérer les déploiements → crayon → Version : **Nouvelle version** → Déployer. L'adresse /exec ne change pas.
7. **Dans l'appli** (après la fusion de la v17) : Paramètres → Code d'accès personnel → collez votre code → Valider.

Dans l'appli (Paramètres → Membres et codes d'accès) :
- **Membre** = tous les droits ; **Salarié** = voit uniquement ses lignes de JEH, sa paie et sa formation, en lecture.
- Toute personne présente dans les JEH ou la formation apparaît automatiquement comme Salarié, avec un code simple de 8 caractères à lui transmettre (bouton Copier).
- Changer le rôle d'une personne, lui donner un nouveau code, la désactiver ; chacun peut changer son propre code.
Retour arrière : recollez l'ancien Code.gs (étape 3) et redéployez une nouvelle version.
