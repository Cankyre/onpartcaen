# Scripts - Mémory pour Caen

Ce dossier contient les scripts utilitaires pour générer et maintenir les données du projet.

## Scripts disponibles

### build-db.cjs
**Description** : Génère la base de données SQLite à partir des données OpenStreetMap

**Usage** :
```bash
node scripts/build-db.cjs
```

**Ce qu'il fait** :
1. Interroge l'API Overpass pour récupérer les arrêts et lignes Twisto
2. Filtre et traite les données (stop_group, détours, etc.)
3. Génère `/public/stops.sqlite` avec :
   - Table `stops` (id, name, aliases, lat, lon, line, line_ref, network, operator, stop_group)
   - Table `lines` (id, ref, name, color_hex, network, geojson)

**Durée** : 1-3 minutes (appel réseau)

**Modifications** :
- `multiQuaiStops` : Définir les arrêts multi-quai (théâtre, hôtel de ville, etc.)
- `detourIntermediates` : Arrêts de détour à ignorer
- `lineColors` : Couleurs officielles des lignes (ou utiliser extract-colors.cjs)

---

### fetch-geojson.cjs
**Description** : Télécharge les tracés GeoJSON de toutes les lignes depuis OpenStreetMap

**Usage** :
```bash
node scripts/fetch-geojson.cjs
```

**Ce qu'il fait** :
1. Pour chaque ligne Twisto (T1-T3, 1-138)
2. Interroge Overpass API pour récupérer les relations OSM
3. Convertit en GeoJSON (LineString ou MultiLineString)
4. Sauvegarde dans `/public/geo/lines/{ref}.geojson`

**Durée** : ~5 minutes (délai 2s entre chaque requête)

**Résultat** :
- 61 fichiers GeoJSON créés
- Utilisés par MapView.svelte pour afficher les tracés sur la carte

**Personnalisation** :
Modifier la liste `LINES` pour ajouter/retirer des lignes :
```javascript
const LINES = [
  'T1', 'T2', 'T3',
  '1', '2', '3', // ...
];
```

---

### extract-colors.cjs
**Description** : Extrait automatiquement les couleurs dominantes des icônes PNG

**Prérequis** :
```bash
npm install --save-dev pngjs
```

**Usage** :
```bash
node scripts/extract-colors.cjs
```

**Ce qu'il fait** :
1. Analyse tous les PNG dans `/public/icons/`
2. Pour chaque image, extrait la couleur dominante (hors blanc/noir/gris)
3. Affiche le code JavaScript à copier dans `build-db.cjs`

**Résultat** :
```javascript
const lineColors = {
  'T1': '#23A638',
  'T2': '#E73132',
  'T3': '#009ADF',
  // ... 61 lignes au total
};
```

**Utilisation** :
1. Exécuter le script
2. Copier la sortie dans `build-db.cjs` (section `lineColors`)
3. Régénérer la DB avec `node scripts/build-db.cjs`

---

## Workflow complet

### Première installation
```bash
# 1. Générer la base de données
node scripts/build-db.cjs

# 2. Télécharger les tracés GeoJSON
node scripts/fetch-geojson.cjs

# 3. Lancer le projet
npm run dev
```

### Mise à jour des couleurs
```bash
# 1. Extraire les couleurs depuis les icônes
node scripts/extract-colors.cjs

# 2. Copier/coller le résultat dans build-db.cjs

# 3. Régénérer la DB
node scripts/build-db.cjs
```

### Mise à jour des tracés
```bash
# Re-télécharger tous les tracés
node scripts/fetch-geojson.cjs

# Ou télécharger une seule ligne (modifier le script)
```

---

## Dépannage

### Erreur "pngjs not found"
```bash
npm install --save-dev pngjs
```

### Erreur "Overpass API timeout"
- Vérifier la connexion internet
- Augmenter le timeout dans la query (ligne `[timeout:360]`)
- Réessayer plus tard

### Tracés GeoJSON incomplets
- Certaines lignes peuvent ne pas avoir de relation OSM
- Vérifier manuellement sur OpenStreetMap
- Les lignes sans tracé fonctionneront quand même (arrêts visibles)

### DB vide ou incomplète
- Vérifier que le réseau "Twisto" existe dans OSM
- Vérifier que les arrêts ont le tag `network=Twisto`
- Consulter les logs du script pour voir les erreurs

---

## Notes techniques

### API Overpass
- URL: https://overpass.kumi.systems/api/interpreter
- Rate limit: respecté via délais de 2s entre requêtes
- Timeout: 60s par requête (fetch-geojson), 360s (build-db)

### Format GeoJSON
```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "properties": {
      "ref": "T1",
      "name": "Ligne T1",
      "network": "Twisto"
    },
    "geometry": {
      "type": "LineString",
      "coordinates": [[lon, lat], ...]
    }
  }]
}
```

### Schéma SQLite
```sql
CREATE TABLE stops (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  line TEXT NOT NULL,
  line_ref TEXT NOT NULL,
  network TEXT NOT NULL,
  operator TEXT NOT NULL,
  stop_group INTEGER
);

CREATE TABLE lines (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  network TEXT NOT NULL,
  geojson TEXT
);
```

---

## Maintenance

### Fréquence de mise à jour
- **DB** : Mensuelle ou quand nouveau arrêt/ligne ajouté
- **GeoJSON** : Trimestrielle ou si tracé modifié
- **Couleurs** : Uniquement si nouvelles icônes

### Sauvegarde
Les fichiers générés à sauvegarder :
- `/public/stops.sqlite`
- `/public/geo/lines/*.geojson`

Les scripts sont versionnés dans Git et ne nécessitent pas de sauvegarde séparée.
