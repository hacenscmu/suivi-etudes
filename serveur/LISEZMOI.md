# Installer le serveur sécurisé (Code.gs) — à faire avec la mise en ligne de l'appli v17

Les données ne bougent pas : même Google Sheet, même feuille « Données ».
Faites ces étapes **sur ordinateur**, le même jour que la fusion de l'appli v17.

1. **Sauvegarde** : dans l'appli, Paramètres → Exporter mes données (fichier .json). Gardez-le.
2. **Ouvrir le script** : script.google.com → votre projet « Suivi des études ».
3. **Garder l'ancienne version** : copiez tout le contenu actuel de `Code.gs` dans un fichier texte (retour arrière possible).
4. **Remplacer** : effacez tout `Code.gs`, collez le contenu de `serveur/Code.gs`, puis Enregistrer (icône disquette).
5. **Créer votre code d'accès** : en haut, choisissez la fonction `creerMonCode` (changez le nom dans la dernière ligne si besoin), cliquez sur **Exécuter**, autorisez si Google le demande. Le code s'affiche dans le **Journal d'exécution** : copiez-le (il ne sera plus affiché).
   Pour chaque autre membre : remplacez le nom dans `creerMonCode` (ex. `creerJeton('Alex.M')`) et exécutez à nouveau ; transmettez-lui son code en privé.
6. **Déployer** : Déployer → Gérer les déploiements → crayon → Version : **Nouvelle version** → Déployer. L'adresse /exec ne change pas.
7. **Dans l'appli** (après la fusion de la v17) : Paramètres → Code d'accès personnel → collez votre code → Valider.

Pour retirer l'accès à quelqu'un : exécutez `revoquerJeton('Prénom.N')`. Pour voir la liste : `listerJetons`.
Retour arrière : recollez l'ancien Code.gs (étape 3) et redéployez une nouvelle version.
