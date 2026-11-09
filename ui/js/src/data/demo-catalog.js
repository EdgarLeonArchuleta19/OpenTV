/* data/demo-catalog.js — Catálogo de demostración integrado (VOD de ejemplo y addVod).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------- demo data */
/* Server-driven in the real APK. These records only exercise the layouts. */
var GENRES = ['Acción', 'Drama', 'Comedia', 'Suspenso', 'Aventura',
              'Animación', 'Familiar', 'Ciencia ficción'];

var VOD = [];
var CATEGORY_BY_PREFIX = {
  'Destacado': 'destacado', 'Película': 'pelicula', 'Serie': 'serie',
  'Gratis': 'gratis', 'Infantil': 'infantil', 'UHD': 'uhd', 'Extra': 'extra'
};
function addVod(prefix, count, base) {
  for (var i = 1; i <= count; i++) {
    var g1 = GENRES[(base + i) % GENRES.length];
    var g2 = GENRES[(base + i + 3) % GENRES.length];
    VOD.push({
      id: VOD.length + 1,
      title: prefix + ' demo ' + pad2(i),
      category: CATEGORY_BY_PREFIX[prefix] || '',
      score: (7.9 + ((base + i) % 16) / 10).toFixed(1),
      year: 2018 + ((base + i) % 7),
      duration: (1 + ((base + i) % 2)) + ' h ' + (10 + ((base * 7 + i * 5) % 45)) + ' min',
      genres: g1 === g2 ? [g1] : [g1, g2],
      director: 'Director demo ' + pad2(i),
      actors: 'Actor demo ' + pad2(i) + ', Actriz demo ' + pad2(i + 1),
      synopsis: 'Sinopsis de demostración para ' + prefix.toLowerCase() + ' demo ' + pad2(i) +
        '. Este texto sólo existe para comprobar el recorte a dos líneas, el interlineado y ' +
        'la sangría de la etiqueta "Sinopsis :" definidos en activity_voddetails.',
      kind: prefix.toLowerCase()
    });
  }
}
addVod('Destacado', 5, 1);
addVod('Película', 7, 2);
addVod('Serie', 7, 3);
addVod('Gratis', 5, 4);
addVod('Infantil', 8, 5);
addVod('UHD', 4, 6);
addVod('Extra', 4, 7);
