'use strict';

/*
 * Los CDN de vídeo alojados en CacheFly responden por HTTPS con un certificado
 * de *.cachefly.net que no incluye su propio dominio. El proxy del Modo Directo
 * lo resuelve verificando contra "cachefly.net" (proxy.js), pero FFmpeg no
 * permite separar el nombre verificado del nombre pedido. Para FFmpeg se usa
 * HTTP en estos hosts, que sirven el mismo contenido.
 */
var CACHEFLY_HOSTS = /swzablvpm|kyalbhxgw|m3x8o50te|qnrgmzpcw|faolmbghu/i;

function ffmpegUrl(url) {
  var m = /^https:\/\/([^\/:?#]+)(:443)?(?=[\/?#]|$)/i.exec(url || '');
  if (!m || !CACHEFLY_HOSTS.test(m[1])) return url;
  return 'http://' + m[1] + url.slice(m[0].length);
}

module.exports = { ffmpegUrl: ffmpegUrl, CACHEFLY_HOSTS: CACHEFLY_HOSTS };
