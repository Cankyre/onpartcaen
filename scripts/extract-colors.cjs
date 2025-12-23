#!/usr/bin/env node

/**
 * Script pour extraire les couleurs dominantes des icônes de lignes
 * Analyse les PNG et extrait la couleur principale (hors blanc/noir)
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

// Fonction pour convertir RGB en HEX
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('').toUpperCase();
}

// Fonction pour déterminer si une couleur est blanc/noir/gris
function isGrayscale(r, g, b) {
  const avg = (r + g + b) / 3;
  const variance = Math.max(Math.abs(r - avg), Math.abs(g - avg), Math.abs(b - avg));
  
  // Si variance faible, c'est du gris
  if (variance < 30) {
    // Si trop clair ou trop sombre, ignorer
    if (avg > 200 || avg < 50) return true;
  }
  
  return false;
}

// Analyser une image PNG
function extractColorFromPNG(filePath) {
  return new Promise((resolve, reject) => {
    const colorCounts = {};
    
    fs.createReadStream(filePath)
      .pipe(new PNG())
      .on('parsed', function() {
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            const idx = (this.width * y + x) << 2;
            const r = this.data[idx];
            const g = this.data[idx + 1];
            const b = this.data[idx + 2];
            const a = this.data[idx + 3];
            
            // Ignorer pixels transparents
            if (a < 128) continue;
            
            // Ignorer blanc/noir/gris
            if (isGrayscale(r, g, b)) continue;
            
            const hex = rgbToHex(r, g, b);
            colorCounts[hex] = (colorCounts[hex] || 0) + 1;
          }
        }
        
        // Trouver la couleur la plus fréquente
        let maxCount = 0;
        let dominantColor = null;
        
        for (const [color, count] of Object.entries(colorCounts)) {
          if (count > maxCount) {
            maxCount = count;
            dominantColor = color;
          }
        }
        
        resolve(dominantColor);
      })
      .on('error', reject);
  });
}

// Fonction principale
async function main() {
  console.log('📸 Extraction des couleurs depuis les icônes PNG...\n');
  
  const files = fs.readdirSync(ICONS_DIR).filter(f => f.endsWith('.png') && !f.includes('Navette') && !f.includes('Noctibus') && !f.includes('oneway'));
  
  const lineColors = {};
  
  for (const file of files) {
    const lineName = file.replace('.png', '');
    const filePath = path.join(ICONS_DIR, file);
    
    try {
      const color = await extractColorFromPNG(filePath);
      if (color) {
        lineColors[lineName] = color;
        console.log(`✓ ${lineName.padEnd(6)} → ${color}`);
      } else {
        console.log(`⚠ ${lineName.padEnd(6)} → Aucune couleur trouvée`);
      }
    } catch (error) {
      console.error(`✗ ${lineName.padEnd(6)} → Erreur: ${error.message}`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📋 Code à copier dans build-db.cjs:\n');
  
  console.log('const lineColors = {');
  
  // Trier par ordre alphanumérique
  const sortedKeys = Object.keys(lineColors).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, '')) || 0;
    const numB = parseInt(b.replace(/\D/g, '')) || 0;
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b);
  });
  
  for (const key of sortedKeys) {
    console.log(`  '${key}': '${lineColors[key]}',`);
  }
  
  console.log('};');
  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ ${Object.keys(lineColors).length} couleurs extraites avec succès !`);
}

// Installer pngjs si nécessaire
try {
  require('pngjs');
  main().catch(console.error);
} catch (e) {
  console.log('⚠️  Installation de pngjs requise...');
  console.log('Exécutez: npm install --save-dev pngjs');
  console.log('Puis relancez: node scripts/extract-colors.cjs');
  process.exit(1);
}
